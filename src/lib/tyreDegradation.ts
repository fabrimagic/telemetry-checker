/**
 * Tyre Degradation Estimation Module — Race Engineering Grade
 *
 * Estimates tyre degradation per stint via robust linear regression on
 * a professionally filtered "core degradation window" of lap times.
 *
 * Pipeline:
 *  1. Structural exclusion (pit-out, in-lap, invalid durations)
 *  2. Robust outlier removal (MAD-based)
 *  3. Warmup exclusion (compound-specific first-laps removal)
 *  4. Cliff detection (anomalous late-stint laps removed from fit)
 *  5. Core window regression with extended statistics
 *
 * Backward-compatible: DegradationResult retains all existing fields;
 * new fields are optional.
 */

import type { Lap, StintData } from "./openf1";

/* ══════════════════════════════════════════════════════════════════
 * TYPES
 * ══════════════════════════════════════════════════════════════════ */

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
  /* ── Optional metadata (backward-compatible) ── */
  /** Number of laps in the core regression window */
  fitPointsCount?: number;
  /** Total laps excluded by all filters */
  lapsExcludedCount?: number;
  /** Warmup laps excluded from regression */
  warmupLapsExcluded?: number;
  /** Cliff laps excluded from regression */
  cliffLapsExcluded?: number;
  /** Tyre life at start of core regression window */
  windowStartTyreLife?: number;
  /** Tyre life at end of core regression window */
  windowEndTyreLife?: number;
  /** Root mean square error of the regression */
  rmse?: number | null;
  /** Standard error of the slope estimate */
  slopeStdError?: number | null;
  /** Whether a tyre cliff was detected in the stint */
  cliffDetected?: boolean;
  /** Tyre life at which the cliff begins */
  cliffStartTyreLife?: number | null;
  /** Summary of filters applied */
  filterSummary?: string[];
}

/* ══════════════════════════════════════════════════════════════════
 * COMPOUND-SPECIFIC DEGRADATION PROFILES
 * ══════════════════════════════════════════════════════════════════ */

interface CompoundDegradationProfile {
  /** Laps to exclude at stint start for warmup (compound-specific) */
  warmupExclusionLaps: number;
  /** MAD multiplier for outlier detection (higher = more lenient) */
  madMultiplier: number;
  /** Minimum laps after all exclusions for a valid regression */
  minCoreLaps: number;
  /** Cliff detection: residual threshold as multiple of RMSE */
  cliffResidualMultiplier: number;
  /** Cliff detection: minimum consecutive anomalous end-laps */
  cliffMinConsecutive: number;
}

const COMPOUND_DEGRADATION_PROFILES: Record<string, CompoundDegradationProfile> = {
  SOFT: {
    warmupExclusionLaps: 1,
    madMultiplier: 3.0,
    minCoreLaps: 3,
    cliffResidualMultiplier: 2.0,
    cliffMinConsecutive: 1,
  },
  MEDIUM: {
    warmupExclusionLaps: 1,
    madMultiplier: 3.0,
    minCoreLaps: 3,
    cliffResidualMultiplier: 2.2,
    cliffMinConsecutive: 2,
  },
  HARD: {
    warmupExclusionLaps: 2,
    madMultiplier: 3.5,
    minCoreLaps: 3,
    cliffResidualMultiplier: 2.5,
    cliffMinConsecutive: 2,
  },
};

const DEFAULT_PROFILE: CompoundDegradationProfile = {
  warmupExclusionLaps: 1,
  madMultiplier: 3.0,
  minCoreLaps: 3,
  cliffResidualMultiplier: 2.2,
  cliffMinConsecutive: 2,
};

function getCompoundProfile(compound: string): CompoundDegradationProfile {
  return COMPOUND_DEGRADATION_PROFILES[compound?.toUpperCase()] ?? DEFAULT_PROFILE;
}

/* ══════════════════════════════════════════════════════════════════
 * GLOBAL CONFIGURATION
 * ══════════════════════════════════════════════════════════════════ */

/** Absolute minimum laps before any filtering — below this, skip stint entirely */
const MIN_STRUCTURAL_LAPS = 3;

/** Fallback MAD floor to prevent zero-MAD edge cases */
const MAD_FLOOR = 0.3;

/* ══════════════════════════════════════════════════════════════════
 * EXTENDED LINEAR REGRESSION
 * ══════════════════════════════════════════════════════════════════ */

interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  rmse: number;
  slopeStdError: number | null;
  residuals: number[];
}

/**
 * Ordinary least squares linear regression: y = slope * x + intercept
 * Returns extended statistics for downstream validation.
 */
function linearRegression(xs: number[], ys: number[]): RegressionResult | null {
  const n = xs.length;
  if (n < 2) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² and residuals
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i] + intercept;
    const res = ys[i] - predicted;
    residuals.push(res);
    ssTot += (ys[i] - meanY) ** 2;
    ssRes += res * res;
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  // RMSE
  const rmse = Math.sqrt(ssRes / n);

  // Standard error of slope (null if n < 3)
  let slopeStdError: number | null = null;
  if (n > 2) {
    const s2 = ssRes / (n - 2); // residual variance
    const meanX = sumX / n;
    let ssX = 0;
    for (let i = 0; i < n; i++) ssX += (xs[i] - meanX) ** 2;
    if (ssX > 0) slopeStdError = Math.sqrt(s2 / ssX);
  }

  return { slope, intercept, rSquared, rmse, slopeStdError, residuals };
}

/* ══════════════════════════════════════════════════════════════════
 * ROBUST OUTLIER FILTER (MAD-based)
 * ══════════════════════════════════════════════════════════════════ */

/**
 * Filters laps using Median Absolute Deviation.
 * More robust than percentage-of-median for asymmetric distributions.
 */
function filterOutliersMAD(
  laps: { lap: Lap; tyreLife: number }[],
  madMultiplier: number,
): { kept: { lap: Lap; tyreLife: number }[]; removedCount: number } {
  if (laps.length < 3) return { kept: laps, removedCount: 0 };

  const durations = laps.map(l => l.lap.lap_duration!);
  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // MAD = median of |x_i - median|
  const absDevs = durations.map(d => Math.abs(d - median)).sort((a, b) => a - b);
  const mad = Math.max(absDevs[Math.floor(absDevs.length / 2)], MAD_FLOOR);

  const threshold = madMultiplier * mad;
  const kept = laps.filter(l => Math.abs(l.lap.lap_duration! - median) <= threshold);

  return { kept, removedCount: laps.length - kept.length };
}

/* ══════════════════════════════════════════════════════════════════
 * WARMUP EXCLUSION
 * ══════════════════════════════════════════════════════════════════ */

/**
 * Removes first N laps of a stint that are likely contaminated by
 * tyre warmup. Only excludes if the stint is long enough to afford it.
 */
function excludeWarmupLaps(
  laps: { lap: Lap; tyreLife: number }[],
  warmupCount: number,
  minCoreLaps: number,
): { kept: { lap: Lap; tyreLife: number }[]; excluded: number } {
  // Don't exclude if it would leave too few laps
  if (laps.length - warmupCount < minCoreLaps) return { kept: laps, excluded: 0 };

  // Only exclude if first laps are actually slower than median of the rest
  const restDurations = laps.slice(warmupCount).map(l => l.lap.lap_duration!);
  const restMedian = restDurations.sort((a, b) => a - b)[Math.floor(restDurations.length / 2)];

  let actualExcluded = 0;
  for (let i = 0; i < warmupCount && i < laps.length; i++) {
    if (laps[i].lap.lap_duration! > restMedian * 1.005) {
      actualExcluded = i + 1; // exclude up to and including this lap
    }
  }

  if (actualExcluded === 0) return { kept: laps, excluded: 0 };
  if (laps.length - actualExcluded < minCoreLaps) return { kept: laps, excluded: 0 };

  return { kept: laps.slice(actualExcluded), excluded: actualExcluded };
}

/* ══════════════════════════════════════════════════════════════════
 * CLIFF DETECTION
 * ══════════════════════════════════════════════════════════════════ */

interface CliffResult {
  detected: boolean;
  cliffStartTyreLife: number | null;
  lapsRemoved: number;
  coreLaps: { lap: Lap; tyreLife: number }[];
}

/**
 * Detects tyre cliff at end of stint by checking if the last N laps
 * have consistently positive residuals above a threshold.
 *
 * Uses an initial full-stint regression, then checks trailing residuals.
 */
function detectAndExcludeCliff(
  laps: { lap: Lap; tyreLife: number }[],
  profile: CompoundDegradationProfile,
  minCoreLaps: number,
): CliffResult {
  const noCliff: CliffResult = { detected: false, cliffStartTyreLife: null, lapsRemoved: 0, coreLaps: laps };

  if (laps.length < minCoreLaps + 2) return noCliff;

  // Do a preliminary regression on all laps
  const xs = laps.map(l => l.tyreLife);
  const ys = laps.map(l => l.lap.lap_duration!);
  const reg = linearRegression(xs, ys);
  if (!reg || reg.rmse === 0) return noCliff;

  const threshold = profile.cliffResidualMultiplier * reg.rmse;

  // Check trailing laps for consecutive large positive residuals
  let cliffStart = -1;
  let consecutive = 0;
  for (let i = laps.length - 1; i >= 0; i--) {
    if (reg.residuals[i] > threshold) {
      consecutive++;
      cliffStart = i;
    } else {
      break; // only trailing consecutive
    }
  }

  if (consecutive < profile.cliffMinConsecutive) return noCliff;
  if (laps.length - consecutive < minCoreLaps) return noCliff;

  return {
    detected: true,
    cliffStartTyreLife: laps[cliffStart].tyreLife,
    lapsRemoved: consecutive,
    coreLaps: laps.slice(0, cliffStart),
  };
}

/* ══════════════════════════════════════════════════════════════════
 * MAIN CALCULATION
 * ══════════════════════════════════════════════════════════════════ */

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
    const profile = getCompoundProfile(stint.compound);
    const filterSummary: string[] = [];

    // ── Step 1: Structural exclusions ──
    const stintLaps = laps.filter(
      (l) =>
        l.lap_number >= stint.lap_start &&
        l.lap_number <= stint.lap_end &&
        l.lap_duration != null &&
        l.lap_duration > 0 &&
        !l.is_pit_out_lap
    );

    // Exclude in-lap (last lap of stint unless it's the final stint of the session)
    const isLastStint = stint.lap_end === Math.max(...stints.map(s => s.lap_end));
    const afterInLap = stintLaps.filter(
      (l) => isLastStint || l.lap_number !== stint.lap_end
    );

    if (afterInLap.length < MIN_STRUCTURAL_LAPS) continue;

    const structuralExcluded = stintLaps.length - afterInLap.length + (laps.filter(
      l => l.lap_number >= stint.lap_start && l.lap_number <= stint.lap_end
    ).length - stintLaps.length);

    if (structuralExcluded > 0) {
      filterSummary.push(`Structural exclusion: ${structuralExcluded} laps (pit-out, in-lap, invalid)`);
    }

    // Build tyreLife-annotated array
    let annotated = afterInLap.map(l => ({
      lap: l,
      tyreLife: (stint.tyre_age_at_start ?? 0) + (l.lap_number - stint.lap_start),
    }));

    // ── Step 2: MAD-based outlier removal ──
    const { kept: afterOutlier, removedCount: outlierRemoved } =
      filterOutliersMAD(annotated, profile.madMultiplier);

    if (outlierRemoved > 0) {
      filterSummary.push(`MAD outlier filter: ${outlierRemoved} laps removed (${profile.madMultiplier}σ)`);
    }
    annotated = afterOutlier;

    if (annotated.length < MIN_STRUCTURAL_LAPS) continue;

    // ── Step 3: Warmup exclusion ──
    const { kept: afterWarmup, excluded: warmupExcluded } =
      excludeWarmupLaps(annotated, profile.warmupExclusionLaps, profile.minCoreLaps);

    if (warmupExcluded > 0) {
      filterSummary.push(`Warmup exclusion: ${warmupExcluded} initial laps (${stint.compound})`);
    }
    annotated = afterWarmup;

    if (annotated.length < profile.minCoreLaps) continue;

    // ── Step 4: Cliff detection ──
    const cliff = detectAndExcludeCliff(annotated, profile, profile.minCoreLaps);

    if (cliff.detected) {
      filterSummary.push(`Cliff detected at tyre life ${cliff.cliffStartTyreLife}: ${cliff.lapsRemoved} laps excluded`);
    }

    const coreLaps = cliff.coreLaps;
    if (coreLaps.length < profile.minCoreLaps) continue;

    // ── Step 5: Core window regression ──
    const xs = coreLaps.map(l => l.tyreLife);
    const ys = coreLaps.map(l => l.lap.lap_duration!);
    const reg = linearRegression(xs, ys);
    if (!reg) continue;

    // Build full points array (all structurally valid laps for chart display)
    const allPoints = afterInLap.map(l => ({
      tyreLife: (stint.tyre_age_at_start ?? 0) + (l.lap_number - stint.lap_start),
      lapTime: l.lap_duration!,
    }));

    const totalExcluded = structuralExcluded + outlierRemoved + warmupExcluded + cliff.lapsRemoved;

    const round3 = (v: number) => Math.round(v * 1000) / 1000;

    results.push({
      driverNumber,
      acronym,
      color,
      stint: stint.stint_number,
      compound: stint.compound,
      lapsUsed: coreLaps.length,
      slopeSecPerLap: round3(reg.slope),
      intercept: round3(reg.intercept),
      rSquared: round3(reg.rSquared),
      points: allPoints,
      // Extended metadata
      fitPointsCount: coreLaps.length,
      lapsExcludedCount: totalExcluded,
      warmupLapsExcluded: warmupExcluded,
      cliffLapsExcluded: cliff.lapsRemoved,
      windowStartTyreLife: xs[0],
      windowEndTyreLife: xs[xs.length - 1],
      rmse: round3(reg.rmse),
      slopeStdError: reg.slopeStdError != null ? round3(reg.slopeStdError) : null,
      cliffDetected: cliff.detected,
      cliffStartTyreLife: cliff.cliffStartTyreLife,
      filterSummary,
    });
  }

  return results;
}
