/**
 * Tyre Degradation Estimation Module — Race Engineering Grade v2
 *
 * Estimates tyre degradation per stint via iteratively reweighted
 * robust linear regression on a professionally filtered
 * "core degradation window" of lap times.
 *
 * Pipeline:
 *  1. Structural exclusion (pit-out, in-lap, invalid durations)
 *  2. Robust outlier removal (MAD-based)
 *  3. Warmup exclusion (compound-specific, data-driven)
 *  4. Cliff detection (regression-residual + worsening-trend)
 *  5. Iterative robust regression with outlier downweighting
 *  6. Fit robustness classification
 *
 * Backward-compatible: DegradationResult retains all existing fields;
 * new fields are optional.
 */

import type { Lap, StintData } from "./openf1";
import { getCanonicalProfile } from "./tyreCompoundProfiles";

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
  fitPointsCount?: number;
  lapsExcludedCount?: number;
  warmupLapsExcluded?: number;
  cliffLapsExcluded?: number;
  windowStartTyreLife?: number;
  windowEndTyreLife?: number;
  rmse?: number | null;
  slopeStdError?: number | null;
  cliffDetected?: boolean;
  cliffStartTyreLife?: number | null;
  filterSummary?: string[];
  /* ── v2 metadata ── */
  /** Robustness classification of the fit */
  fitRobustness?: "LOW" | "MEDIUM" | "HIGH";
  /** Whether iterative robust regression was applied */
  robustFitApplied?: boolean;
  /** Reasons for selecting the core window */
  coreWindowSelectionReason?: string[];
}

/* ══════════════════════════════════════════════════════════════════
 * COMPOUND-SPECIFIC DEGRADATION PROFILES
 * ══════════════════════════════════════════════════════════════════ */

interface CompoundDegradationProfile {
  warmupExclusionLaps: number;
  madMultiplier: number;
  /** Absolute minimum laps to attempt any regression */
  minCoreLapsTechnical: number;
  /** Minimum laps for a robust/reliable fit */
  minCoreLapsReliable: number;
  cliffResidualMultiplier: number;
  cliffMinConsecutive: number;
  /** Cliff: also check if trailing laps show worsening trend */
  cliffWorseningThreshold: number;
}

function deriveLegacyProfile(compound: string | null): CompoundDegradationProfile {
  const c = getCanonicalProfile(compound);
  return {
    warmupExclusionLaps: c.filtering.warmupExclusionLaps,
    madMultiplier: c.filtering.madMultiplier,
    minCoreLapsTechnical: c.filtering.minCoreLapsTechnical,
    minCoreLapsReliable: c.filtering.minCoreLapsReliable,
    cliffResidualMultiplier: c.cliff.residualMultiplier,
    cliffMinConsecutive: c.cliff.minConsecutive,
    cliffWorseningThreshold: c.cliff.worseningThreshold,
  };
}

const COMPOUND_DEGRADATION_PROFILES: Record<string, CompoundDegradationProfile> = {
  SOFT: deriveLegacyProfile("SOFT"),
  MEDIUM: deriveLegacyProfile("MEDIUM"),
  HARD: deriveLegacyProfile("HARD"),
};

const DEFAULT_PROFILE: CompoundDegradationProfile = deriveLegacyProfile(null);

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

/** Number of robust regression iterations (pass 1 = OLS, then reweight) */
const ROBUST_ITERATIONS = 2;

/** Huber-like threshold: residuals above this * RMSE get downweighted */
const ROBUST_RESIDUAL_THRESHOLD = 1.5;

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
 * Weighted least squares linear regression: y = slope * x + intercept
 * If weights are omitted, all weights = 1 (standard OLS).
 */
function weightedLinearRegression(
  xs: number[],
  ys: number[],
  weights?: number[],
): RegressionResult | null {
  const n = xs.length;
  if (n < 2) return null;

  const w = weights ?? new Array(n).fill(1);
  let sumW = 0, sumWX = 0, sumWY = 0, sumWXY = 0, sumWXX = 0;
  for (let i = 0; i < n; i++) {
    sumW += w[i];
    sumWX += w[i] * xs[i];
    sumWY += w[i] * ys[i];
    sumWXY += w[i] * xs[i] * ys[i];
    sumWXX += w[i] * xs[i] * xs[i];
  }

  const denom = sumW * sumWXX - sumWX * sumWX;
  if (Math.abs(denom) < 1e-12) return null;

  const slope = (sumW * sumWXY - sumWX * sumWY) / denom;
  const intercept = (sumWY - slope * sumWX) / sumW;

  const meanY = sumWY / sumW;
  let ssTot = 0, ssRes = 0;
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i] + intercept;
    const res = ys[i] - predicted;
    residuals.push(res);
    ssTot += w[i] * (ys[i] - meanY) ** 2;
    ssRes += w[i] * res * res;
  }
  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  const rmse = Math.sqrt(ssRes / sumW);

  let slopeStdError: number | null = null;
  if (n > 2) {
    const s2 = ssRes / (sumW * (n - 2) / n);
    const meanX = sumWX / sumW;
    let ssX = 0;
    for (let i = 0; i < n; i++) ssX += w[i] * (xs[i] - meanX) ** 2;
    if (ssX > 0) slopeStdError = Math.sqrt(s2 / ssX);
  }

  return { slope, intercept, rSquared, rmse, slopeStdError, residuals };
}

/** Standard OLS — convenience wrapper */
function linearRegression(xs: number[], ys: number[]): RegressionResult | null {
  return weightedLinearRegression(xs, ys);
}

/**
 * Iteratively Reweighted Least Squares (IRLS) with Huber-like weights.
 * Pass 1 = OLS; subsequent passes downweight high-residual points.
 * Returns the final regression and whether reweighting was actually applied.
 */
function robustLinearRegression(
  xs: number[],
  ys: number[],
  iterations: number = ROBUST_ITERATIONS,
): { result: RegressionResult; robustApplied: boolean } | null {
  let reg = linearRegression(xs, ys);
  if (!reg) return null;

  let robustApplied = false;

  for (let iter = 0; iter < iterations; iter++) {
    if (reg.rmse < 0.01) break; // data is very clean, no reweighting needed

    const threshold = ROBUST_RESIDUAL_THRESHOLD * reg.rmse;
    const weights = reg.residuals.map(r => {
      const absR = Math.abs(r);
      if (absR <= threshold) return 1.0;
      // Huber-like soft downweight: threshold / |r|
      return threshold / absR;
    });

    // Only reweight if some points actually get downweighted
    const hasDownweighted = weights.some(w => w < 0.99);
    if (!hasDownweighted) break;

    robustApplied = true;
    const newReg = weightedLinearRegression(xs, ys, weights);
    if (!newReg) break;
    reg = newReg;
  }

  return { result: reg, robustApplied };
}

/* ══════════════════════════════════════════════════════════════════
 * ROBUST OUTLIER FILTER (MAD-based)
 * ══════════════════════════════════════════════════════════════════ */

function filterOutliersMAD(
  laps: { lap: Lap; tyreLife: number }[],
  madMultiplier: number,
): { kept: { lap: Lap; tyreLife: number }[]; removedCount: number } {
  if (laps.length < 3) return { kept: laps, removedCount: 0 };

  const durations = laps.map(l => l.lap.lap_duration!);
  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const absDevs = durations.map(d => Math.abs(d - median)).sort((a, b) => a - b);
  const mad = Math.max(absDevs[Math.floor(absDevs.length / 2)], MAD_FLOOR);

  const threshold = madMultiplier * mad;
  const kept = laps.filter(l => Math.abs(l.lap.lap_duration! - median) <= threshold);

  return { kept, removedCount: laps.length - kept.length };
}

/* ══════════════════════════════════════════════════════════════════
 * WARMUP EXCLUSION — Data-driven with compound awareness
 * ══════════════════════════════════════════════════════════════════ */

/**
 * Removes first N laps of a stint contaminated by tyre warmup.
 * Uses a data-driven check: compares early-lap pace to core-stint median.
 * Also checks for a "step-down" between warmup block and core block.
 */
function excludeWarmupLaps(
  laps: { lap: Lap; tyreLife: number }[],
  warmupCount: number,
  minCoreLaps: number,
): { kept: { lap: Lap; tyreLife: number }[]; excluded: number; reason: string } {
  if (laps.length - warmupCount < minCoreLaps) {
    return { kept: laps, excluded: 0, reason: "too_few_laps_to_exclude" };
  }

  const restDurations = laps.slice(warmupCount).map(l => l.lap.lap_duration!);
  const restSorted = [...restDurations].sort((a, b) => a - b);
  const restMedian = restSorted[Math.floor(restSorted.length / 2)];

  // Check for step-down: mean of warmup block vs median of core
  let warmupSum = 0;
  let warmupSlowerCount = 0;
  for (let i = 0; i < warmupCount && i < laps.length; i++) {
    warmupSum += laps[i].lap.lap_duration!;
    if (laps[i].lap.lap_duration! > restMedian * 1.003) {
      warmupSlowerCount++;
    }
  }

  // Require majority of warmup laps to be slower than core median
  if (warmupSlowerCount === 0) {
    return { kept: laps, excluded: 0, reason: "warmup_not_detected" };
  }

  // Find actual exclusion boundary: exclude consecutive slower-than-core laps
  let actualExcluded = 0;
  for (let i = 0; i < warmupCount && i < laps.length; i++) {
    if (laps[i].lap.lap_duration! > restMedian * 1.003) {
      actualExcluded = i + 1;
    }
  }

  if (actualExcluded === 0) return { kept: laps, excluded: 0, reason: "no_warmup_laps_slower" };
  if (laps.length - actualExcluded < minCoreLaps) {
    return { kept: laps, excluded: 0, reason: "would_leave_too_few" };
  }

  // Step-down verification: mean(warmup) vs restMedian
  const warmupMean = warmupSum / Math.min(warmupCount, laps.length);
  const stepDown = warmupMean - restMedian;
  if (stepDown < 0.1) {
    // Very small step-down; be conservative
    return { kept: laps, excluded: 0, reason: "step_down_too_small" };
  }

  return {
    kept: laps.slice(actualExcluded),
    excluded: actualExcluded,
    reason: `step_down=${stepDown.toFixed(3)}s`,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * CLIFF DETECTION — Residual + Worsening Trend
 * ══════════════════════════════════════════════════════════════════ */

interface CliffResult {
  detected: boolean;
  cliffStartTyreLife: number | null;
  lapsRemoved: number;
  coreLaps: { lap: Lap; tyreLife: number }[];
}

/**
 * Detects tyre cliff at end of stint using two complementary checks:
 * 1. Trailing laps with large positive residuals (existing logic)
 * 2. Worsening trend: consecutive lap-over-lap increases above threshold
 * Both must be consistent to trigger exclusion.
 */
function detectAndExcludeCliff(
  laps: { lap: Lap; tyreLife: number }[],
  profile: CompoundDegradationProfile,
  minCoreLaps: number,
): CliffResult {
  const noCliff: CliffResult = {
    detected: false,
    cliffStartTyreLife: null,
    lapsRemoved: 0,
    coreLaps: laps,
  };

  if (laps.length < minCoreLaps + 2) return noCliff;

  const xs = laps.map(l => l.tyreLife);
  const ys = laps.map(l => l.lap.lap_duration!);
  const reg = linearRegression(xs, ys);
  if (!reg || reg.rmse < 0.01) return noCliff;

  const residualThreshold = profile.cliffResidualMultiplier * reg.rmse;

  // Method 1: trailing residual check
  let residualCliffStart = -1;
  let residualConsecutive = 0;
  for (let i = laps.length - 1; i >= 0; i--) {
    if (reg.residuals[i] > residualThreshold) {
      residualConsecutive++;
      residualCliffStart = i;
    } else {
      break;
    }
  }

  // Method 2: worsening trend — consecutive lap-over-lap increases
  let worseningCliffStart = -1;
  let worseningConsecutive = 0;
  for (let i = laps.length - 1; i >= 1; i--) {
    const delta = ys[i] - ys[i - 1];
    if (delta > profile.cliffWorseningThreshold) {
      worseningConsecutive++;
      worseningCliffStart = i;
    } else {
      break;
    }
  }

  // Use whichever detected more laps, but require minimum consecutive
  let cliffStart = -1;
  let consecutive = 0;

  if (residualConsecutive >= profile.cliffMinConsecutive && worseningConsecutive >= 1) {
    // Both methods agree: use the earlier start
    cliffStart = Math.min(residualCliffStart, worseningCliffStart);
    consecutive = laps.length - cliffStart;
  } else if (residualConsecutive >= profile.cliffMinConsecutive + 1) {
    // Strong residual evidence alone
    cliffStart = residualCliffStart;
    consecutive = residualConsecutive;
  } else if (worseningConsecutive >= profile.cliffMinConsecutive + 1) {
    // Strong worsening evidence alone
    cliffStart = worseningCliffStart;
    consecutive = worseningConsecutive;
  }

  if (cliffStart < 0 || consecutive < profile.cliffMinConsecutive) return noCliff;
  if (laps.length - consecutive < minCoreLaps) return noCliff;

  return {
    detected: true,
    cliffStartTyreLife: laps[cliffStart].tyreLife,
    lapsRemoved: consecutive,
    coreLaps: laps.slice(0, cliffStart),
  };
}

/* ══════════════════════════════════════════════════════════════════
 * FIT ROBUSTNESS CLASSIFICATION
 * ══════════════════════════════════════════════════════════════════ */

function classifyFitRobustness(
  fitPoints: number,
  profile: CompoundDegradationProfile,
  rSquared: number,
  rmse: number,
  slopeStdError: number | null,
  slope: number,
): "LOW" | "MEDIUM" | "HIGH" {
  // Not enough laps for reliable fit
  if (fitPoints < profile.minCoreLapsTechnical + 1) return "LOW";

  // Borderline sample size
  if (fitPoints < profile.minCoreLapsReliable) {
    // Even with good R², short stints can't be HIGH
    return rSquared > 0.5 ? "MEDIUM" : "LOW";
  }

  // Enough laps — check statistical quality
  let score = 0;
  if (rSquared > 0.6) score++;
  if (rSquared > 0.3) score++;
  if (rmse < 0.5) score++;
  if (slopeStdError != null && slope !== 0 && Math.abs(slopeStdError / slope) < 0.5) score++;
  if (fitPoints >= 10) score++;

  if (score >= 4) return "HIGH";
  if (score >= 2) return "MEDIUM";
  return "LOW";
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
    const coreWindowReasons: string[] = [];

    // ── Step 1: Structural exclusions ──
    const stintLaps = laps.filter(
      (l) =>
        l.lap_number >= stint.lap_start &&
        l.lap_number <= stint.lap_end &&
        l.lap_duration != null &&
        l.lap_duration > 0 &&
        !l.is_pit_out_lap
    );

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
    const warmupResult = excludeWarmupLaps(
      annotated,
      profile.warmupExclusionLaps,
      profile.minCoreLapsTechnical,
    );

    if (warmupResult.excluded > 0) {
      filterSummary.push(`Warmup exclusion: ${warmupResult.excluded} initial laps (${stint.compound}, ${warmupResult.reason})`);
      coreWindowReasons.push(`warmup_excluded:${warmupResult.reason}`);
    }
    annotated = warmupResult.kept;

    if (annotated.length < profile.minCoreLapsTechnical) continue;

    // ── Step 4: Cliff detection ──
    const cliff = detectAndExcludeCliff(annotated, profile, profile.minCoreLapsTechnical);

    if (cliff.detected) {
      filterSummary.push(`Cliff detected at tyre life ${cliff.cliffStartTyreLife}: ${cliff.lapsRemoved} laps excluded`);
      coreWindowReasons.push(`cliff_excluded:${cliff.lapsRemoved}_laps`);
    }

    const coreLaps = cliff.coreLaps;
    if (coreLaps.length < profile.minCoreLapsTechnical) continue;

    // ── Step 5: Robust regression on core window ──
    const xs = coreLaps.map(l => l.tyreLife);
    const ys = coreLaps.map(l => l.lap.lap_duration!);

    const robustResult = robustLinearRegression(xs, ys);
    if (!robustResult) continue;

    const reg = robustResult.result;
    const robustApplied = robustResult.robustApplied;

    if (robustApplied) {
      filterSummary.push("Iterative robust regression applied (outlier downweighting)");
      coreWindowReasons.push("robust_regression_applied");
    }

    // ── Step 6: Fit robustness classification ──
    const fitRobustness = classifyFitRobustness(
      coreLaps.length,
      profile,
      reg.rSquared,
      reg.rmse,
      reg.slopeStdError,
      reg.slope,
    );
    coreWindowReasons.push(`fit_robustness:${fitRobustness}`);

    // Build full points array (all structurally valid laps for chart display)
    const allPoints = afterInLap.map(l => ({
      tyreLife: (stint.tyre_age_at_start ?? 0) + (l.lap_number - stint.lap_start),
      lapTime: l.lap_duration!,
    }));

    const totalExcluded = structuralExcluded + outlierRemoved + warmupResult.excluded + cliff.lapsRemoved;

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
      warmupLapsExcluded: warmupResult.excluded,
      cliffLapsExcluded: cliff.lapsRemoved,
      windowStartTyreLife: xs[0],
      windowEndTyreLife: xs[xs.length - 1],
      rmse: round3(reg.rmse),
      slopeStdError: reg.slopeStdError != null ? round3(reg.slopeStdError) : null,
      cliffDetected: cliff.detected,
      cliffStartTyreLife: cliff.cliffStartTyreLife,
      filterSummary,
      // v2 metadata
      fitRobustness,
      robustFitApplied: robustApplied,
      coreWindowSelectionReason: coreWindowReasons,
    });
  }

  return results;
}
