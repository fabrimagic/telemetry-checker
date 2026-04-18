/**
 * Corrected Tyre Degradation Module — Two-Stage Model v2
 *
 * Stage A: Estimate non-tyre effects (fuel proxy, track temp, air temp)
 *          using centered & scaled variables, then compute residual lap times.
 * Stage B: Regress residual lap times on tyre_life to isolate degradation.
 *
 * v2 improvements:
 *  - Aligned filtering pipeline with tyreDegradation.ts (MAD outliers,
 *    warmup exclusion, cliff detection)
 *  - Fuel proxy quality assessment
 *  - Correction stability metadata (magnitude, raw-vs-corrected agreement)
 *  - Improved plausibility gate with multi-factor checks
 *  - Numerical conditioning checks for multivariate regression
 *
 * IMPORTANT:
 * - fuel_proxy is NOT real fuel load (OpenF1 does not expose it).
 * - Temperature corrections use nearest-timestamp matching from OpenF1 weather.
 * - The corrected slope is a better estimate but NOT a perfect team-grade measure.
 */

import type { Lap, StintData, WeatherData } from "./openf1";
import type { DegradationResult } from "./tyreDegradation";
import type { WeatherCondition } from "./weatherClassification";
import type { TrackStatus } from "./trackStatusClassification";

/* ══════════════════════════════════════════════════════════════════
 * CONFIGURATION
 * ══════════════════════════════════════════════════════════════════ */

export interface CorrectedDegradationConfig {
  fuel_proxy_type: "laps_remaining" | "lap_number" | "st_speed";
  min_laps: number;
  min_laps_corrected: number;
  outlier_threshold: number;
  max_plausible_slope: number;
}

export const DEFAULT_CORRECTED_CONFIG: CorrectedDegradationConfig = {
  fuel_proxy_type: "laps_remaining",
  min_laps: 4,
  min_laps_corrected: 8,
  outlier_threshold: 0.07,
  max_plausible_slope: 0.30,
};

/** Compound-specific correction profiles */
interface CorrectedCompoundProfile {
  madMultiplier: number;
  warmupExclusionLaps: number;
  minCoreLapsTechnical: number;
  /** Max correction magnitude before flagging instability */
  maxCorrectionMagnitude: number;
}

const CORRECTED_COMPOUND_PROFILES: Record<string, CorrectedCompoundProfile> = {
  SOFT: {
    madMultiplier: 3.0,
    warmupExclusionLaps: 1,
    minCoreLapsTechnical: 3,
    maxCorrectionMagnitude: 0.15,
  },
  MEDIUM: {
    madMultiplier: 3.0,
    warmupExclusionLaps: 1,
    minCoreLapsTechnical: 3,
    maxCorrectionMagnitude: 0.12,
  },
  HARD: {
    madMultiplier: 3.5,
    warmupExclusionLaps: 2,
    minCoreLapsTechnical: 4,
    maxCorrectionMagnitude: 0.10,
  },
};

const DEFAULT_CORRECTED_COMPOUND: CorrectedCompoundProfile = {
  madMultiplier: 3.0,
  warmupExclusionLaps: 1,
  minCoreLapsTechnical: 3,
  maxCorrectionMagnitude: 0.12,
};

function getCorrectedCompoundProfile(compound: string): CorrectedCompoundProfile {
  return CORRECTED_COMPOUND_PROFILES[compound?.toUpperCase()] ?? DEFAULT_CORRECTED_COMPOUND;
}

/** MAD floor for outlier detection */
const MAD_FLOOR = 0.3;

/* ══════════════════════════════════════════════════════════════════
 * TYPES
 * ══════════════════════════════════════════════════════════════════ */

export interface LapWeatherData {
  lap_number: number;
  track_temperature: number | null;
  air_temperature: number | null;
}

export interface CorrectedDegradationResult extends DegradationResult {
  model_type: "corrected_two_stage" | "corrected_fuel_only" | "simple_fallback";
  slope_raw: number;
  slope_corrected: number;
  fuel_proxy_type: string;
  weather_correction_used: boolean;
  coefficients: {
    intercept: number;
    tyre_life: number;
    fuel_proxy: number;
    track_temp: number | null;
    air_temp: number | null;
  };
  r_squared_corrected: number;
  r_squared_stage_a: number | null;
  /* ── v2 metadata (optional, backward-compatible) ── */
  /** Quality of the fuel proxy signal */
  fuel_proxy_quality?: "LOW" | "MEDIUM" | "HIGH";
  /** Confidence in the corrected model */
  corrected_model_confidence?: "LOW" | "MEDIUM" | "HIGH";
  /** Flags indicating correction instability */
  correction_instability_flags?: string[];
  /** Absolute magnitude of correction (|corrected - raw|) */
  correctionMagnitude?: number | null;
  /** Agreement between raw and corrected slopes */
  rawVsCorrectedAgreement?: "HIGH" | "MEDIUM" | "LOW";
  /** Whether corrected model was accepted conservatively */
  correctedModelAcceptedConservatively?: boolean;
  /** Coverage of fuel proxy when type === "st_speed" (0..1). Undefined for other types. */
  st_speed_coverage?: number;
}

/* ══════════════════════════════════════════════════════════════════
 * WEATHER ASSOCIATION
 * ══════════════════════════════════════════════════════════════════ */

export function associateWeatherToLaps(
  laps: Lap[],
  weather: WeatherData[],
): Map<number, LapWeatherData> {
  const result = new Map<number, LapWeatherData>();
  if (!weather.length) return result;

  const sortedWeather = [...weather].sort((a, b) => a.date.localeCompare(b.date));
  const weatherTimes = sortedWeather.map(w => new Date(w.date).getTime());

  for (const lap of laps) {
    if (!lap.date_start) {
      result.set(lap.lap_number, { lap_number: lap.lap_number, track_temperature: null, air_temperature: null });
      continue;
    }

    const lapTime = new Date(lap.date_start).getTime();
    let bestIdx = 0;
    let bestDist = Math.abs(weatherTimes[0] - lapTime);
    for (let i = 1; i < weatherTimes.length; i++) {
      const dist = Math.abs(weatherTimes[i] - lapTime);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }

    if (bestDist > 300_000) {
      result.set(lap.lap_number, { lap_number: lap.lap_number, track_temperature: null, air_temperature: null });
    } else {
      result.set(lap.lap_number, {
        lap_number: lap.lap_number,
        track_temperature: sortedWeather[bestIdx].track_temperature,
        air_temperature: sortedWeather[bestIdx].air_temperature,
      });
    }
  }

  return result;
}

/* ══════════════════════════════════════════════════════════════════
 * FUEL PROXY
 * ══════════════════════════════════════════════════════════════════ */

export function buildFuelProxy(
  lap: Lap,
  totalLaps: number,
  type: CorrectedDegradationConfig["fuel_proxy_type"],
): number | null {
  if (type === "laps_remaining") return totalLaps - lap.lap_number;
  if (type === "lap_number") return lap.lap_number;
  // "st_speed"
  return lap.st_speed;
}

/** Assess the quality of fuel proxy data for a stint (type-aware) */
function assessFuelProxyQuality(
  fuelProxies: number[],
  stintLength: number,
  type: CorrectedDegradationConfig["fuel_proxy_type"],
): "LOW" | "MEDIUM" | "HIGH" {
  if (fuelProxies.length < 4) return "LOW";

  const fuelStd = stdDev(fuelProxies);
  const fuelRange = Math.max(...fuelProxies) - Math.min(...fuelProxies);

  if (type === "st_speed") {
    // st_speed is in km/h; expected per-stint variation is small but informative
    if (fuelStd < 1.0 || fuelRange < 2.0) return "LOW";
    if (fuelRange >= 5.0 && fuelStd > 2.0) return "HIGH";
    return "MEDIUM";
  }

  // Legacy proxies (laps_remaining / lap_number): scale with stint length
  if (fuelStd < 0.5 || fuelRange < 2) return "LOW";
  if (fuelRange >= stintLength * 0.5 && fuelStd > 1.0) return "HIGH";
  return "MEDIUM";
}

/* ══════════════════════════════════════════════════════════════════
 * STATISTICS HELPERS
 * ══════════════════════════════════════════════════════════════════ */

function meanVal(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = meanVal(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function medianVal(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/* ══════════════════════════════════════════════════════════════════
 * ROBUST FILTERING (aligned with tyreDegradation.ts philosophy)
 * ══════════════════════════════════════════════════════════════════ */

/** MAD-based outlier filter for corrected module */
function filterOutliersMADCorrected(
  laps: Lap[],
  madMultiplier: number,
): { kept: Lap[]; removedCount: number } {
  if (laps.length < 3) return { kept: laps, removedCount: 0 };

  const durations = laps.map(l => l.lap_duration!);
  const median = medianVal(durations);
  const absDevs = durations.map(d => Math.abs(d - median));
  const mad = Math.max(medianVal(absDevs), MAD_FLOOR);

  const threshold = madMultiplier * mad;
  const kept = laps.filter(l => Math.abs(l.lap_duration! - median) <= threshold);

  return { kept, removedCount: laps.length - kept.length };
}

/** Warmup exclusion for corrected module */
function excludeWarmupCorrected(
  laps: Lap[],
  warmupCount: number,
  minLaps: number,
): { kept: Lap[]; excluded: number } {
  if (laps.length - warmupCount < minLaps) return { kept: laps, excluded: 0 };

  const restDurations = laps.slice(warmupCount).map(l => l.lap_duration!);
  const restMedian = medianVal(restDurations);

  let actualExcluded = 0;
  for (let i = 0; i < warmupCount && i < laps.length; i++) {
    if (laps[i].lap_duration! > restMedian * 1.003) {
      actualExcluded = i + 1;
    }
  }

  if (actualExcluded === 0 || laps.length - actualExcluded < minLaps) {
    return { kept: laps, excluded: 0 };
  }

  // Verify step-down is meaningful
  const warmupMean = meanVal(laps.slice(0, actualExcluded).map(l => l.lap_duration!));
  if (warmupMean - restMedian < 0.1) return { kept: laps, excluded: 0 };

  return { kept: laps.slice(actualExcluded), excluded: actualExcluded };
}

/* ══════════════════════════════════════════════════════════════════
 * REGRESSION
 * ══════════════════════════════════════════════════════════════════ */

function simpleLinearRegression(
  xs: number[],
  ys: number[],
): { slope: number; intercept: number; rSquared: number; rmse: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]; sumY += ys[i]; sumXY += xs[i] * ys[i]; sumXX += xs[i] * xs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ys[i] - meanY) ** 2;
    ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const rmse = Math.sqrt(ssRes / n);
  return { slope, intercept, rSquared, rmse };
}

/** Multivariate OLS with conditioning check */
function multivariateOLS(
  X: number[][],
  y: number[],
): { coefficients: number[]; rSquared: number; residuals: number[]; conditionWarning: boolean } | null {
  const n = X.length;
  if (n < 2) return null;
  const k = X[0].length;
  if (n <= k + 1) return null;

  const p = k + 1;
  const Xa: number[][] = X.map(row => [1, ...row]);

  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let sum = 0;
      for (let r = 0; r < n; r++) sum += Xa[r][i] * Xa[r][j];
      XtX[i][j] = sum;
    }
  }

  // Conditioning check: ratio of max to min diagonal
  const diag = XtX.map((row, i) => Math.abs(row[i]));
  const maxDiag = Math.max(...diag);
  const minDiag = Math.min(...diag);
  const conditionWarning = minDiag > 0 ? (maxDiag / minDiag > 1e6) : true;

  const Xty: number[] = new Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    let sum = 0;
    for (let r = 0; r < n; r++) sum += Xa[r][i] * y[r];
    Xty[i] = sum;
  }

  const aug: number[][] = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < p; col++) {
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(aug[row][col]) > maxVal) { maxVal = Math.abs(aug[row][col]); maxRow = row; }
    }
    if (maxVal < 1e-12) return null;
    if (maxRow !== col) [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    for (let row = 0; row < p; row++) {
      if (row === col) continue;
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= p; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  const coefficients = aug.map((row, i) => row[p] / row[i]);

  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0, ssRes = 0;
  const residuals: number[] = [];
  for (let r = 0; r < n; r++) {
    let yPred = 0;
    for (let j = 0; j < p; j++) yPred += coefficients[j] * Xa[r][j];
    const res = y[r] - yPred;
    residuals.push(res);
    ssTot += (y[r] - meanY) ** 2;
    ssRes += res ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return { coefficients, rSquared, residuals, conditionWarning };
}

/* ══════════════════════════════════════════════════════════════════
 * TWO-STAGE CORRECTED DEGRADATION
 * ══════════════════════════════════════════════════════════════════ */

function twoStageDegradation(
  tyreLifes: number[],
  fuelProxies: number[],
  trackTemps: number[] | null,
  airTemps: number[] | null,
  lapTimes: number[],
): {
  slope_corrected: number;
  r_squared_stage_a: number;
  r_squared_stage_b: number;
  rmse_stage_b: number;
  model_type: CorrectedDegradationResult["model_type"];
  coefficients: CorrectedDegradationResult["coefficients"];
  weather_used: boolean;
  conditionWarning: boolean;
} | null {
  const n = lapTimes.length;
  if (n < 4) return null;

  // Center and scale non-tyre features for numerical stability
  const fuelMean = meanVal(fuelProxies);
  const fuelStd = stdDev(fuelProxies);
  const fuelScale = fuelStd > 0.1 ? fuelStd : 1;
  const fuelCentered = fuelProxies.map(f => (f - fuelMean) / fuelScale);

  const hasWeather = trackTemps != null && airTemps != null && trackTemps.length === n;
  let trackScaled: number[] | null = null;
  let airScaled: number[] | null = null;
  let trackMean = 0, airMean = 0, trackScale = 1, airScale = 1;

  if (hasWeather) {
    trackMean = meanVal(trackTemps!);
    airMean = meanVal(airTemps!);
    const trackStd = stdDev(trackTemps!);
    const airStd = stdDev(airTemps!);
    if (trackStd > 0.3 || airStd > 0.3) {
      trackScale = trackStd > 0.1 ? trackStd : 1;
      airScale = airStd > 0.1 ? airStd : 1;
      trackScaled = trackTemps!.map(t => (t - trackMean) / trackScale);
      airScaled = airTemps!.map(t => (t - airMean) / airScale);
    }
  }

  // Stage A: Regress lap_time on non-tyre features
  let stageAResult: { coefficients: number[]; rSquared: number; residuals: number[]; conditionWarning: boolean } | null = null;
  let weatherUsed = false;
  let modelType: CorrectedDegradationResult["model_type"] = "corrected_fuel_only";
  let conditionWarning = false;

  if (trackScaled && airScaled && n > 5) {
    const X = fuelCentered.map((f, i) => [f, trackScaled![i], airScaled![i]]);
    stageAResult = multivariateOLS(X, lapTimes);
    if (stageAResult) {
      weatherUsed = true;
      modelType = "corrected_two_stage";
      conditionWarning = stageAResult.conditionWarning;
    }
  }

  if (!stageAResult && n > 2) {
    const X = fuelCentered.map(f => [f]);
    stageAResult = multivariateOLS(X, lapTimes);
    if (stageAResult) {
      modelType = "corrected_fuel_only";
      conditionWarning = stageAResult.conditionWarning;
    }
  }

  if (!stageAResult) return null;

  // Stage B: Regress residuals on tyre_life
  const residuals = stageAResult.residuals;
  const stageBResult = simpleLinearRegression(tyreLifes, residuals);
  if (!stageBResult) return null;

  // Un-scale coefficients for interpretability
  const stageACoeffs = stageAResult.coefficients;
  const fuelCoeff = stageACoeffs[1] / fuelScale;

  const coefficients: CorrectedDegradationResult["coefficients"] = {
    intercept: stageBResult.intercept + stageACoeffs[0],
    tyre_life: stageBResult.slope,
    fuel_proxy: fuelCoeff,
    track_temp: weatherUsed ? (stageACoeffs[2] / trackScale) : null,
    air_temp: weatherUsed ? (stageACoeffs[3] / airScale) : null,
  };

  return {
    slope_corrected: stageBResult.slope,
    r_squared_stage_a: stageAResult.rSquared,
    r_squared_stage_b: stageBResult.rSquared,
    rmse_stage_b: stageBResult.rmse,
    model_type: modelType,
    coefficients,
    weather_used: weatherUsed,
    conditionWarning,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * CORRECTION QUALITY ASSESSMENT
 * ══════════════════════════════════════════════════════════════════ */

function assessCorrectionQuality(
  slopeRaw: number,
  slopeCorrected: number,
  rSquaredStageA: number | null,
  rSquaredStageB: number,
  fuelProxyQuality: "LOW" | "MEDIUM" | "HIGH",
  lapsUsed: number,
  conditionWarning: boolean,
  compoundProfile: CorrectedCompoundProfile,
): {
  confidence: "LOW" | "MEDIUM" | "HIGH";
  flags: string[];
  agreement: "HIGH" | "MEDIUM" | "LOW";
  acceptedConservatively: boolean;
} {
  const flags: string[] = [];
  const correctionMag = Math.abs(slopeCorrected - slopeRaw);

  // Raw vs corrected agreement
  let agreement: "HIGH" | "MEDIUM" | "LOW";
  if (correctionMag < 0.02) {
    agreement = "HIGH";
  } else if (correctionMag < 0.06) {
    agreement = "MEDIUM";
  } else {
    agreement = "LOW";
    flags.push(`large_correction_magnitude:${correctionMag.toFixed(3)}`);
  }

  // Sign flip check
  if (slopeRaw > 0.01 && slopeCorrected < -0.01) {
    flags.push("sign_flip:positive_to_negative");
  } else if (slopeRaw < -0.01 && slopeCorrected > 0.01) {
    flags.push("sign_flip:negative_to_positive");
  }

  // Correction exceeds compound threshold
  if (correctionMag > compoundProfile.maxCorrectionMagnitude) {
    flags.push(`correction_exceeds_compound_limit:${compoundProfile.maxCorrectionMagnitude}`);
  }

  // Fuel proxy quality
  if (fuelProxyQuality === "LOW") {
    flags.push("weak_fuel_proxy");
  }

  // Stage A quality
  if (rSquaredStageA != null && rSquaredStageA < 0.1) {
    flags.push("stage_a_weak_fit");
  }

  // Conditioning
  if (conditionWarning) {
    flags.push("numerical_conditioning_warning");
  }

  // Short stint
  if (lapsUsed < 6) {
    flags.push("short_stint_correction");
  }

  // Confidence scoring
  let score = 0;
  if (agreement === "HIGH") score += 2;
  else if (agreement === "MEDIUM") score += 1;
  if (fuelProxyQuality === "HIGH") score += 1;
  else if (fuelProxyQuality === "MEDIUM") score += 0.5;
  if (rSquaredStageB > 0.5) score += 1;
  if (lapsUsed >= 8) score += 1;
  if (!conditionWarning) score += 0.5;
  if (flags.length === 0) score += 1;

  let confidence: "LOW" | "MEDIUM" | "HIGH";
  if (score >= 5) confidence = "HIGH";
  else if (score >= 3) confidence = "MEDIUM";
  else confidence = "LOW";

  // Conservative acceptance: accepted but with caveats
  const acceptedConservatively = flags.length >= 2 || agreement === "LOW";

  return { confidence, flags, agreement, acceptedConservatively };
}

/* ══════════════════════════════════════════════════════════════════
 * MAIN CORRECTED DEGRADATION CALCULATION
 * ══════════════════════════════════════════════════════════════════ */

export function calculateCorrectedTyreDegradation(
  driverNumber: number,
  acronym: string,
  color: string,
  laps: Lap[],
  stints: StintData[],
  weather: WeatherData[],
  totalSessionLaps: number,
  weatherMap?: Map<number, WeatherCondition>,
  trackStatusMap?: Map<number, TrackStatus>,
  config: CorrectedDegradationConfig = DEFAULT_CORRECTED_CONFIG,
): CorrectedDegradationResult[] {
  if (!stints.length || !laps.length) return [];

  const lapWeather = associateWeatherToLaps(laps, weather);
  const results: CorrectedDegradationResult[] = [];

  for (const stint of stints) {
    const compoundProfile = getCorrectedCompoundProfile(stint.compound);
    const filterSummary: string[] = [];

    // ── Step 1: Structural exclusions (aligned with base module) ──
    let stintLaps = laps.filter(l => {
      if (l.lap_number < stint.lap_start || l.lap_number > stint.lap_end) return false;
      if (l.lap_duration == null || l.lap_duration <= 0) return false;
      if (l.is_pit_out_lap) return false;
      return true;
    });

    // Exclude in-lap
    const isLastStint = stint.lap_end === Math.max(...stints.map(s => s.lap_end));
    stintLaps = stintLaps.filter(l => isLastStint || l.lap_number !== stint.lap_end);

    // Exclude wet/mixed laps
    if (weatherMap) {
      stintLaps = stintLaps.filter(l => {
        const wc = weatherMap.get(l.lap_number);
        return wc !== "WET" && wc !== "MIXED";
      });
    }

    // Exclude neutralised laps
    if (trackStatusMap) {
      stintLaps = stintLaps.filter(l => {
        const ts = trackStatusMap.get(l.lap_number);
        return !ts || ts === "GREEN";
      });
    }

    if (stintLaps.length < config.min_laps) continue;

    // ── Step 2: MAD-based outlier removal (aligned with base module) ──
    const { kept: afterMAD, removedCount: madRemoved } =
      filterOutliersMADCorrected(stintLaps, compoundProfile.madMultiplier);

    if (madRemoved > 0) {
      filterSummary.push(`MAD outlier filter: ${madRemoved} laps removed`);
    }
    stintLaps = afterMAD;

    if (stintLaps.length < config.min_laps) continue;

    // ── Step 3: Warmup exclusion (aligned with base module) ──
    const { kept: afterWarmup, excluded: warmupExcluded } =
      excludeWarmupCorrected(stintLaps, compoundProfile.warmupExclusionLaps, compoundProfile.minCoreLapsTechnical);

    if (warmupExcluded > 0) {
      filterSummary.push(`Warmup exclusion: ${warmupExcluded} initial laps`);
    }
    stintLaps = afterWarmup;

    if (stintLaps.length < config.min_laps) continue;

    // ── Step 4: Build features ──
    // tyreLifes/lapTimes/points are aligned to ALL filtered laps (used by rawReg).
    // The "_mv" parallel arrays are the subset where fuel proxy is non-null
    // (used by twoStageDegradation, which requires equal-length inputs).
    const tyreLifes: number[] = [];
    const lapTimes: number[] = [];
    const points: { tyreLife: number; lapTime: number }[] = [];

    const tyreLifes_mv: number[] = [];
    const lapTimes_mv: number[] = [];
    const fuelProxies_mv: number[] = [];
    const trackTemps_mv: number[] = [];
    const airTemps_mv: number[] = [];
    let weatherComplete = true;

    for (const l of stintLaps) {
      const tyreLife = (stint.tyre_age_at_start ?? 0) + (l.lap_number - stint.lap_start);
      tyreLifes.push(tyreLife);
      lapTimes.push(l.lap_duration!);
      points.push({ tyreLife, lapTime: l.lap_duration! });

      const fuelProxy = buildFuelProxy(l, totalSessionLaps, config.fuel_proxy_type);
      const wData = lapWeather.get(l.lap_number);

      if (fuelProxy !== null) {
        tyreLifes_mv.push(tyreLife);
        lapTimes_mv.push(l.lap_duration!);
        fuelProxies_mv.push(fuelProxy);
        if (wData?.track_temperature != null && wData?.air_temperature != null) {
          trackTemps_mv.push(wData.track_temperature);
          airTemps_mv.push(wData.air_temperature);
        } else {
          weatherComplete = false;
        }
      } else {
        // A null fuel proxy means we cannot use this lap in the multivariate fit
        // and the weather alignment is broken for that lap → disable weather stage.
        weatherComplete = false;
      }
    }

    // ── Step 5: Assess fuel proxy quality (type-aware) ──
    const fuelProxyQuality = assessFuelProxyQuality(
      fuelProxies_mv,
      stint.lap_end - stint.lap_start + 1,
      config.fuel_proxy_type,
    );

    // ── Step 6: Raw regression (always computed, on full filtered set) ──
    const rawReg = simpleLinearRegression(tyreLifes, lapTimes);
    if (!rawReg) continue;

    // ── Step 7: Attempt two-stage corrected model ──
    let modelType: CorrectedDegradationResult["model_type"] = "simple_fallback";
    let slopeCorrected = rawReg.slope;
    let rSquaredCorrected = rawReg.rSquared;
    let rSquaredStageA: number | null = null;
    let weatherCorrectionUsed = false;
    let conditionWarning = false;
    let correctedRmse = rawReg.rmse;
    let coefficients: CorrectedDegradationResult["coefficients"] = {
      intercept: rawReg.intercept,
      tyre_life: rawReg.slope,
      fuel_proxy: 0,
      track_temp: null,
      air_temp: null,
    };

    const hasFuelVariance = fuelProxyQuality !== "LOW";

    if (hasFuelVariance && lapTimes_mv.length >= config.min_laps_corrected) {
      const twoStage = twoStageDegradation(
        tyreLifes_mv, fuelProxies_mv,
        weatherComplete ? trackTemps_mv : null,
        weatherComplete ? airTemps_mv : null,
        lapTimes_mv,
      );

      if (twoStage && Math.abs(twoStage.slope_corrected) <= config.max_plausible_slope) {
        modelType = twoStage.model_type;
        slopeCorrected = twoStage.slope_corrected;
        rSquaredCorrected = twoStage.r_squared_stage_b;
        rSquaredStageA = twoStage.r_squared_stage_a;
        weatherCorrectionUsed = twoStage.weather_used;
        coefficients = twoStage.coefficients;
        conditionWarning = twoStage.conditionWarning;
        correctedRmse = twoStage.rmse_stage_b;
      }
    } else if (hasFuelVariance && lapTimes_mv.length >= config.min_laps + 1) {
      const twoStage = twoStageDegradation(
        tyreLifes_mv, fuelProxies_mv, null, null, lapTimes_mv,
      );

      if (twoStage && Math.abs(twoStage.slope_corrected) <= config.max_plausible_slope) {
        modelType = twoStage.model_type;
        slopeCorrected = twoStage.slope_corrected;
        rSquaredCorrected = twoStage.r_squared_stage_b;
        rSquaredStageA = twoStage.r_squared_stage_a;
        coefficients = twoStage.coefficients;
        conditionWarning = twoStage.conditionWarning;
        correctedRmse = twoStage.rmse_stage_b;
      }
    }

    // ── Step 8: Assess correction quality ──
    const correctionMagnitude = Math.abs(slopeCorrected - rawReg.slope);
    const quality = assessCorrectionQuality(
      rawReg.slope,
      slopeCorrected,
      rSquaredStageA,
      rSquaredCorrected,
      fuelProxyQuality,
      stintLaps.length,
      conditionWarning,
      compoundProfile,
    );

    const round3 = (v: number) => Math.round(v * 1000) / 1000;

    results.push({
      driverNumber,
      acronym,
      color,
      stint: stint.stint_number,
      compound: stint.compound,
      lapsUsed: stintLaps.length,
      slopeSecPerLap: round3(slopeCorrected),
      intercept: round3(coefficients.intercept),
      rSquared: round3(rSquaredCorrected),
      points,
      model_type: modelType,
      slope_raw: round3(rawReg.slope),
      slope_corrected: round3(slopeCorrected),
      fuel_proxy_type: config.fuel_proxy_type,
      weather_correction_used: weatherCorrectionUsed,
      coefficients: {
        intercept: round3(coefficients.intercept),
        tyre_life: round3(coefficients.tyre_life),
        fuel_proxy: round3(coefficients.fuel_proxy),
        track_temp: coefficients.track_temp != null ? round3(coefficients.track_temp) : null,
        air_temp: coefficients.air_temp != null ? round3(coefficients.air_temp) : null,
      },
      r_squared_corrected: round3(rSquaredCorrected),
      r_squared_stage_a: rSquaredStageA != null ? round3(rSquaredStageA) : null,
      filterSummary,
      rmse: round3(correctedRmse),
      // v2 metadata
      fuel_proxy_quality: fuelProxyQuality,
      corrected_model_confidence: quality.confidence,
      correction_instability_flags: quality.flags.length > 0 ? quality.flags : undefined,
      correctionMagnitude: round3(correctionMagnitude),
      rawVsCorrectedAgreement: quality.agreement,
      correctedModelAcceptedConservatively: quality.acceptedConservatively,
      st_speed_coverage:
        config.fuel_proxy_type === "st_speed"
          ? (stintLaps.length > 0 ? fuelProxies_mv.length / stintLaps.length : 0)
          : undefined,
    });
  }

  return results;
}
