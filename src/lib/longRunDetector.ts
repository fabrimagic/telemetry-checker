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
    const candidate = sequences.reduce((best, seq) =>
      seq.length > best.length ? seq : best,
    );

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

    const isValid =
      deg.rSquared >= MIN_R_SQUARED_LONG_RUN && deg.lapsUsed >= minLaps;

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
