import type { Lap, StintData, PitData } from "./openf1";

export interface LongRunResult {
  driverNumber: number;
  acronym: string;
  color: string;
  stintNumber: number;
  compound: string;
  lapStartLongRun: number;
  lapEndLongRun: number;
  lapsCount: number;
  avgLapTime: number;
  stdLapTime: number;
  degradationSlope: number;
  score: number;
  isLongRun: boolean;
}

interface ConsecutiveSequence {
  laps: Lap[];
  stintData: StintData;
}

const DEFAULT_MIN_LAPS = 5;

/**
 * Build a set of pit-in lap numbers (last lap before each pit stop).
 */
function pitInLaps(pits: PitData[]): Set<number> {
  return new Set(pits.map((p) => p.lap_number));
}

/**
 * Filter invalid laps from a stint:
 * - out laps
 * - in laps (ending with pit)
 * - null/zero duration
 * - outliers (< median*0.99 or > median*1.07)
 */
function filterValidLaps(
  stintLaps: Lap[],
  pitInSet: Set<number>
): Lap[] {
  // Step 1: basic filters
  const basic = stintLaps.filter(
    (l) =>
      l.lap_duration != null &&
      l.lap_duration > 0 &&
      !l.is_pit_out_lap &&
      !pitInSet.has(l.lap_number)
  );

  if (basic.length < 2) return basic;

  // Step 2: outlier removal via median
  const durations = basic.map((l) => l.lap_duration!).sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)];
  const lowThreshold = median * 0.99;
  const highThreshold = median * 1.07;

  return basic.filter(
    (l) => l.lap_duration! >= lowThreshold && l.lap_duration! <= highThreshold
  );
}

/**
 * Group laps into consecutive sequences by lap_number.
 */
function buildConsecutiveSequences(laps: Lap[]): Lap[][] {
  if (!laps.length) return [];
  const sorted = [...laps].sort((a, b) => a.lap_number - b.lap_number);
  const sequences: Lap[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].lap_number === sorted[i - 1].lap_number + 1) {
      sequences[sequences.length - 1].push(sorted[i]);
    } else {
      sequences.push([sorted[i]]);
    }
  }

  return sequences.filter((s) => s.length >= MIN_LAPS);
}

/**
 * Simple linear regression: y = slope*x + intercept
 */
function linReg(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: 0 };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i]; sxy += xs[i] * ys[i]; sxx += xs[i] * xs[i];
  }
  const d = n * sxx - sx * sx;
  if (d === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / d;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function mean(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

/**
 * Score a consecutive sequence to determine if it's a race-simulation long run.
 */
function scoreSequence(
  laps: Lap[],
  stint: StintData
): { score: number; avgLapTime: number; stdLapTime: number; slope: number } {
  const durations = laps.map((l) => l.lap_duration!);
  const avgLapTime = mean(durations);
  const stdLapTime = std(durations);

  let score = 0;

  // 1. Length score
  const len = laps.length;
  if (len >= 8) score += 30;
  else if (len >= 6) score += 20;
  else score += 10;

  // 2. Regularity score
  if (stdLapTime < 0.5) score += 25;
  else if (stdLapTime <= 0.8) score += 15;
  else score += 5;

  // 3. Degradation trend
  const xs = laps.map(
    (l) => (stint.tyre_age_at_start ?? 0) + (l.lap_number - stint.lap_start)
  );
  const ys = durations;
  const { slope } = linReg(xs, ys);

  if (slope > 0 && slope <= 0.2) score += 20;
  else if (slope > 0.2) score += 5;
  // slope <= 0 → +0

  // 4. Push lap penalty
  const medianD = [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)];
  if (durations.some((d) => d < medianD * 0.99)) score -= 25;

  // 5. High variability penalty
  const range = Math.max(...durations) - Math.min(...durations);
  if (range > 2.0) score -= 15;

  return { score, avgLapTime, stdLapTime, slope };
}

/**
 * Detect long runs for a single driver in a Practice session.
 * Returns the best long-run candidate per stint.
 */
export function detectLongRuns(
  driverNumber: number,
  acronym: string,
  color: string,
  laps: Lap[],
  stints: StintData[],
  pits: PitData[]
): LongRunResult[] {
  if (!stints.length || !laps.length) return [];

  const pitSet = pitInLaps(pits);
  const results: LongRunResult[] = [];

  for (const stint of stints) {
    const stintLaps = laps.filter(
      (l) => l.lap_number >= stint.lap_start && l.lap_number <= stint.lap_end
    );

    const valid = filterValidLaps(stintLaps, pitSet);
    const sequences = buildConsecutiveSequences(valid);

    if (!sequences.length) continue;

    // Score each sequence, pick the best
    let best: {
      seq: Lap[];
      score: number;
      avgLapTime: number;
      stdLapTime: number;
      slope: number;
    } | null = null;

    for (const seq of sequences) {
      const s = scoreSequence(seq, stint);
      if (
        !best ||
        s.score > best.score ||
        (s.score === best.score && seq.length > best.seq.length)
      ) {
        best = { seq, ...s };
      }
    }

    if (!best) continue;

    const first = best.seq[0].lap_number;
    const last = best.seq[best.seq.length - 1].lap_number;

    results.push({
      driverNumber,
      acronym,
      color,
      stintNumber: stint.stint_number,
      compound: stint.compound,
      lapStartLongRun: first,
      lapEndLongRun: last,
      lapsCount: best.seq.length,
      avgLapTime: Math.round(best.avgLapTime * 1000) / 1000,
      stdLapTime: Math.round(best.stdLapTime * 1000) / 1000,
      degradationSlope: Math.round(best.slope * 1000) / 1000,
      score: Math.round(best.score),
      isLongRun: best.score >= 40,
    });
  }

  return results;
}

/**
 * Given long-run results, produce filtered laps & virtual stints
 * for the tyre degradation calculator.
 */
export function longRunToStintsAndLaps(
  laps: Lap[],
  longRuns: LongRunResult[],
  stints: StintData[]
): { filteredLaps: Lap[]; virtualStints: StintData[] } {
  const validRuns = longRuns.filter((lr) => lr.isLongRun);
  if (!validRuns.length) return { filteredLaps: [], virtualStints: [] };

  const filteredLaps: Lap[] = [];
  const virtualStints: StintData[] = [];

  for (const lr of validRuns) {
    const originalStint = stints.find((s) => s.stint_number === lr.stintNumber);
    if (!originalStint) continue;

    const runLaps = laps.filter(
      (l) => l.lap_number >= lr.lapStartLongRun && l.lap_number <= lr.lapEndLongRun
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
