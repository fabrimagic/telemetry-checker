import type { Lap, StintData, PitData } from "./openf1";
import { calculateTyreDegradation, type DegradationResult } from "./tyreDegradation";

export interface LongRunResult {
  driverNumber: number;
  acronym: string;
  color: string;
  stintNumber: number;
  compound: string;
  lapStartLongRun: number;
  lapEndLongRun: number;
  lapsCount: number;
  /** From validated DegradationResult */
  avgLapTime: number;
  /** From validated DegradationResult */
  degradationSlope: number;
  /** From validated DegradationResult */
  rSquared: number;
  /** From validated DegradationResult */
  fitRobustness: "LOW" | "MEDIUM" | "HIGH" | null;
  /** True only if main engine returns a DegradationResult with sufficient quality */
  isValidLongRun: boolean;
}

const DEFAULT_MIN_LAPS = 5;
const MIN_R_SQUARED_LONG_RUN = 0.25;
/**
 * Relative threshold (vs. sequence median lap time) above which the LAST lap
 * of a candidate long-run sequence is treated as an in-lap and trimmed.
 *
 * Rationale: when the engine receives a single virtual stint, its built-in
 * in-lap exclusion is bypassed (isLastStint is always true). Trimming here
 * ensures CV gating and regression operate on the pure rolling sequence.
 */
const IN_LAP_REL_THRESHOLD = 1.07;
/**
 * Maximum coefficient of variation (stddev/mean) tolerated on the candidate
 * long-run sequence. Push+rolling quali-sim sequences in Practice exhibit
 * CV > 18%, while real long runs sit below ~1.5%. A 5% cutoff cleanly
 * separates the two populations without rejecting noisy-but-genuine runs.
 *
 * Scope: this filter is intentionally local to longRunDetector. The main
 * tyre-degradation engine (calculateTyreDegradation) MUST keep accepting
 * full race stints (18-25 laps) where post-SC rolling laps inflate CV
 * legitimately.
 */
const MAX_CV_LONG_RUN = 0.05;

function coefficientOfVariation(laps: Lap[]): number {
  const durations = laps
    .map((l) => l.lap_duration)
    .filter((d): d is number => typeof d === "number" && d > 0);
  if (durations.length < 2) return 0;
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  if (mean <= 0) return 0;
  const variance =
    durations.reduce((acc, d) => acc + (d - mean) ** 2, 0) / durations.length;
  return Math.sqrt(variance) / mean;
}

function pitInLapsSet(pits: PitData[]): Set<number> {
  return new Set(pits.map((p) => p.lap_number));
}

/**
 * Identify consecutive sequences in a stint, excluding pit-in/out and null durations.
 * NOTE: NO outlier filtering here. That is the responsibility of the main engine
 * (compound-specific MAD).
 */
function buildConsecutiveSequences(
  stintLaps: Lap[],
  pitInSet: Set<number>,
  minLaps: number,
): Lap[][] {
  const valid = stintLaps.filter(
    (l) =>
      l.lap_duration != null &&
      l.lap_duration > 0 &&
      !l.is_pit_out_lap &&
      !pitInSet.has(l.lap_number),
  );
  if (!valid.length) return [];

  const sorted = [...valid].sort((a, b) => a.lap_number - b.lap_number);
  const sequences: Lap[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].lap_number === sorted[i - 1].lap_number + 1) {
      sequences[sequences.length - 1].push(sorted[i]);
    } else {
      sequences.push([sorted[i]]);
    }
  }
  return sequences.filter((s) => s.length >= minLaps);
}

function avgFromDegResult(r: DegradationResult): number {
  if (!r.points.length) return 0;
  const sum = r.points.reduce((acc, p) => acc + p.lapTime, 0);
  return Math.round((sum / r.points.length) * 1000) / 1000;
}

/**
 * Detect long runs for a driver in a Practice session.
 *
 * Pipeline:
 *  1) For each stint, identify consecutive sequences of valid laps (≥ minLaps).
 *  2) For each stint, pick the LONGEST consecutive sequence as the candidate
 *     (a race-simulation long run is the uninterrupted run on the same compound).
 *  3) Build a virtual stint and call calculateTyreDegradation, which applies
 *     compound-specific MAD, warmup exclusion, robust regression, etc.
 *  4) Mark isValidLongRun=true only if rSquared ≥ 0.25 AND lapsUsed ≥ minLaps.
 *
 * No multi-factor scoring, no inline regression, no ad-hoc outlier thresholds.
 * Statistical qualification is fully delegated to the main engine.
 */
export function detectLongRuns(
  driverNumber: number,
  acronym: string,
  color: string,
  laps: Lap[],
  stints: StintData[],
  pits: PitData[],
  minLaps: number = DEFAULT_MIN_LAPS,
): LongRunResult[] {
  if (!stints.length || !laps.length) return [];

  const pitSet = pitInLapsSet(pits);
  const results: LongRunResult[] = [];

  for (const stint of stints) {
    const stintLaps = laps.filter(
      (l) => l.lap_number >= stint.lap_start && l.lap_number <= stint.lap_end,
    );
    const sequences = buildConsecutiveSequences(stintLaps, pitSet, minLaps);
    if (!sequences.length) continue;

    // Longest sequence wins; ties go to the chronologically first.
    let candidate = sequences.reduce((best, seq) =>
      seq.length > best.length ? seq : best,
    );

    // Trim trailing in-lap if present. The main engine cannot do this for us
    // because it sees a single virtual stint (isLastStint=true → in-lap kept).
    // We compare the last lap to the median of the preceding ones; if it's
    // > IN_LAP_REL_THRESHOLD × median, it's an in-lap and we drop it.
    if (candidate.length >= minLaps + 1) {
      const head = candidate.slice(0, -1);
      const last = candidate[candidate.length - 1];
      const sorted = head
        .map((l) => l.lap_duration)
        .filter((d): d is number => typeof d === "number" && d > 0)
        .sort((a, b) => a - b);
      if (sorted.length) {
        const median = sorted[Math.floor(sorted.length / 2)];
        if (
          typeof last.lap_duration === "number" &&
          last.lap_duration > median * IN_LAP_REL_THRESHOLD
        ) {
          candidate = head;
        }
      }
    }

    // Reject push+rolling quali-sim sequences (CV > 5%). Real long runs
    // sit well below this threshold; mixed push/rolling stints sit above 18%.
    const cv = coefficientOfVariation(candidate);
    if (cv > MAX_CV_LONG_RUN) continue;

    const virtualStint: StintData = {
      ...stint,
      lap_start: candidate[0].lap_number,
      lap_end: candidate[candidate.length - 1].lap_number,
    };

    const degResults = calculateTyreDegradation(
      driverNumber,
      acronym,
      color,
      candidate,
      [virtualStint],
    );
    if (!degResults.length) continue;
    const deg = degResults[0];

    // Validity rule:
    //  - lapsUsed must meet the minimum, AND
    //  - either R² ≥ threshold (clear monotone trend) OR
    //    the slope is statistically flat (|slope| ≤ 2 × stdError).
    // The flat-slope branch prevents us from rejecting genuine long runs on
    // tyres that simply don't degrade (e.g., new HARD on a green track):
    // pace is stable, CV is tiny, and a flat slope is itself useful info.
    const slopeFlat =
      deg.slopeStdError != null &&
      deg.slopeStdError > 0 &&
      Math.abs(deg.slopeSecPerLap) <= 2 * deg.slopeStdError;

    const isValid =
      deg.lapsUsed >= minLaps &&
      (deg.rSquared >= MIN_R_SQUARED_LONG_RUN || slopeFlat);

    results.push({
      driverNumber,
      acronym,
      color,
      stintNumber: stint.stint_number,
      compound: stint.compound,
      lapStartLongRun: candidate[0].lap_number,
      lapEndLongRun: candidate[candidate.length - 1].lap_number,
      lapsCount: candidate.length,
      avgLapTime: avgFromDegResult(deg),
      degradationSlope: Math.round(deg.slopeSecPerLap * 1000) / 1000,
      rSquared: Math.round(deg.rSquared * 1000) / 1000,
      fitRobustness: deg.fitRobustness ?? null,
      isValidLongRun: isValid,
    });
  }

  return results;
}

/**
 * Given long-run results, produce filtered laps + virtual stints for downstream
 * consumers. Only entries with isValidLongRun=true are included.
 */
export function longRunToStintsAndLaps(
  laps: Lap[],
  longRuns: LongRunResult[],
  stints: StintData[],
): { filteredLaps: Lap[]; virtualStints: StintData[] } {
  const validRuns = longRuns.filter((lr) => lr.isValidLongRun);
  if (!validRuns.length) return { filteredLaps: [], virtualStints: [] };

  const filteredLaps: Lap[] = [];
  const virtualStints: StintData[] = [];

  for (const lr of validRuns) {
    const originalStint = stints.find((s) => s.stint_number === lr.stintNumber);
    if (!originalStint) continue;

    const runLaps = laps.filter(
      (l) =>
        l.lap_number >= lr.lapStartLongRun && l.lap_number <= lr.lapEndLongRun,
    );
    filteredLaps.push(...runLaps);

    virtualStints.push({
      ...originalStint,
      lap_start: lr.lapStartLongRun,
      lap_end: lr.lapEndLongRun,
    });
  }

  return { filteredLaps, virtualStints };
}
