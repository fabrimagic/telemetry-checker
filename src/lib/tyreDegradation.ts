import type { Lap, StintData } from "./openf1";

export interface DegradationResult {
  driverNumber: number;
  acronym: string;
  color: string;
  stint: number;
  compound: string;
  lapsUsed: number;
  slopeSecPerLap: number;
  intercept: number;
  rSquared: number;
  points: { tyreLife: number; lapTime: number }[];
}

/**
 * Simple linear regression: y = a*x + b
 * Returns { slope, intercept, rSquared }
 */
function linearRegression(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
    sumYY += ys[i] * ys[i];
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R²
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ys[i] - meanY) ** 2;
    ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, rSquared };
}

const MIN_LAPS = 3;

export function calculateTyreDegradation(
  driverNumber: number,
  acronym: string,
  color: string,
  laps: Lap[],
  stints: StintData[]
): DegradationResult[] {
  if (!stints.length || !laps.length) return [];

  const results: DegradationResult[] = [];

  for (const stint of stints) {
    const stintLaps = laps.filter(
      (l) =>
        l.lap_number >= stint.lap_start &&
        l.lap_number <= stint.lap_end &&
        l.lap_duration != null &&
        l.lap_duration > 0 &&
        !l.is_pit_out_lap
    );

    // Exclude in-lap (last lap of stint if there's a next stint)
    const filteredLaps = stintLaps.filter(
      (l) => l.lap_number !== stint.lap_end || stint.lap_end === laps[laps.length - 1]?.lap_number
    );

    if (filteredLaps.length < MIN_LAPS) continue;

    // Calculate median to filter anomalous laps (>7% from median)
    const durations = filteredLaps.map((l) => l.lap_duration!).sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];
    const threshold = median * 1.07;

    const validLaps = filteredLaps.filter((l) => l.lap_duration! <= threshold);
    if (validLaps.length < MIN_LAPS) continue;

    const xs: number[] = [];
    const ys: number[] = [];
    const points: { tyreLife: number; lapTime: number }[] = [];

    for (const l of validLaps) {
      const tyreLife = (stint.tyre_age_at_start ?? 0) + (l.lap_number - stint.lap_start);
      xs.push(tyreLife);
      ys.push(l.lap_duration!);
      points.push({ tyreLife, lapTime: l.lap_duration! });
    }

    const reg = linearRegression(xs, ys);
    if (!reg) continue;

    results.push({
      driverNumber,
      acronym,
      color,
      stint: stint.stint_number,
      compound: stint.compound,
      lapsUsed: validLaps.length,
      slopeSecPerLap: Math.round(reg.slope * 1000) / 1000,
      intercept: Math.round(reg.intercept * 1000) / 1000,
      rSquared: Math.round(reg.rSquared * 1000) / 1000,
      points,
    });
  }

  return results;
}
