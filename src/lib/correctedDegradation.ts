/**
 * Corrected Tyre Degradation Module — Two-Stage Model
 *
 * Stage A: Estimate non-tyre effects (fuel proxy, track temp, air temp)
 *          using centered variables, then compute residual lap times.
 * Stage B: Regress residual lap times on tyre_life to isolate degradation.
 *
 * This avoids multicollinearity issues from fitting all variables simultaneously
 * on short stints, which produced absurd coefficients (e.g. -17 s/lap).
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

/* ── Configuration ── */

export interface CorrectedDegradationConfig {
  /** Fuel proxy type */
  fuel_proxy_type: "laps_remaining" | "lap_number";
  /** Minimum laps for simple model */
  min_laps: number;
  /** Minimum laps for corrected multivariate model (higher than simple) */
  min_laps_corrected: number;
  /** Outlier threshold: exclude laps > median * (1 + threshold) */
  outlier_threshold: number;
  /** Maximum plausible degradation slope (s/lap) — above this, result is suspect */
  max_plausible_slope: number;
}

export const DEFAULT_CORRECTED_CONFIG: CorrectedDegradationConfig = {
  fuel_proxy_type: "laps_remaining",
  min_laps: 4,
  min_laps_corrected: 8,
  outlier_threshold: 0.07,
  max_plausible_slope: 0.30,
};

/* ── Types ── */

export interface LapWeatherData {
  lap_number: number;
  track_temperature: number | null;
  air_temperature: number | null;
}

export interface CorrectedDegradationResult extends DegradationResult {
  /** Model type identifier */
  model_type: "corrected_two_stage" | "corrected_fuel_only" | "simple_fallback";
  /** Raw slope from simple tyre_life-only regression */
  slope_raw: number;
  /** Corrected slope: coefficient of tyre_life on residualized lap times */
  slope_corrected: number;
  /** Fuel proxy type used */
  fuel_proxy_type: string;
  /** Whether weather correction was applied */
  weather_correction_used: boolean;
  /** All model coefficients for transparency */
  coefficients: {
    intercept: number;
    tyre_life: number;
    fuel_proxy: number;
    track_temp: number | null;
    air_temp: number | null;
  };
  /** R² of the corrected model (stage B) */
  r_squared_corrected: number;
  /** R² of stage A (non-tyre effect removal) */
  r_squared_stage_a: number | null;
}

/* ── Weather association ── */

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

/* ── Fuel proxy ── */

export function buildFuelProxy(
  lapNumber: number,
  totalLaps: number,
  type: CorrectedDegradationConfig["fuel_proxy_type"],
): number {
  if (type === "laps_remaining") return totalLaps - lapNumber;
  return lapNumber;
}

/* ── Simple linear regression ── */

function simpleLinearRegression(xs: number[], ys: number[]): { slope: number; intercept: number; rSquared: number } | null {
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
  return { slope, intercept, rSquared };
}

/* ── Multivariate OLS (for Stage A: non-tyre features only) ── */

function multivariateOLS(
  X: number[][], // each row is [x1, x2, ..., xk] (NO intercept column)
  y: number[],
): { coefficients: number[]; rSquared: number; residuals: number[] } | null {
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

  return { coefficients, rSquared, residuals };
}

/* ── Utility ── */

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/* ── Two-Stage Corrected Degradation ── */

/**
 * Stage A: Remove non-tyre effects from lap times.
 * Regresses lap_time on centered fuel_proxy [+ centered temps],
 * returns residuals (lap_time minus predicted non-tyre contribution).
 *
 * Stage B: Regress residuals on tyre_life to get corrected degradation.
 */
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
  model_type: CorrectedDegradationResult["model_type"];
  coefficients: CorrectedDegradationResult["coefficients"];
  weather_used: boolean;
} | null {
  const n = lapTimes.length;
  if (n < 4) return null;

  // Center non-tyre features for numerical stability
  const fuelMean = mean(fuelProxies);
  const fuelCentered = fuelProxies.map(f => f - fuelMean);

  const hasWeather = trackTemps != null && airTemps != null && trackTemps.length === n;
  let trackCentered: number[] | null = null;
  let airCentered: number[] | null = null;

  if (hasWeather) {
    const trackMean = mean(trackTemps!);
    const airMean = mean(airTemps!);
    const trackStd = std(trackTemps!);
    const airStd = std(airTemps!);
    // Only include temps if there's meaningful variance
    if (trackStd > 0.3 || airStd > 0.3) {
      trackCentered = trackTemps!.map(t => t - trackMean);
      airCentered = airTemps!.map(t => t - airMean);
    }
  }

  // Stage A: Regress lap_time on non-tyre features (centered)
  let stageAResult: { coefficients: number[]; rSquared: number; residuals: number[] } | null = null;
  let weatherUsed = false;
  let modelType: CorrectedDegradationResult["model_type"] = "corrected_fuel_only";

  if (trackCentered && airCentered && n > 4) {
    // Try fuel + track_temp + air_temp
    const X = fuelCentered.map((f, i) => [f, trackCentered![i], airCentered![i]]);
    stageAResult = multivariateOLS(X, lapTimes);
    if (stageAResult) {
      weatherUsed = true;
      modelType = "corrected_two_stage";
    }
  }

  if (!stageAResult && n > 2) {
    // Fallback: fuel proxy only
    const X = fuelCentered.map(f => [f]);
    stageAResult = multivariateOLS(X, lapTimes);
    if (stageAResult) {
      modelType = "corrected_fuel_only";
    }
  }

  if (!stageAResult) return null;

  // Stage B: Regress residuals on tyre_life
  const residuals = stageAResult.residuals;
  const stageBResult = simpleLinearRegression(tyreLifes, residuals);
  if (!stageBResult) return null;

  // Build coefficient summary
  const stageACoeffs = stageAResult.coefficients;
  const coefficients: CorrectedDegradationResult["coefficients"] = {
    intercept: stageBResult.intercept + stageACoeffs[0],
    tyre_life: stageBResult.slope,
    fuel_proxy: stageACoeffs[1],
    track_temp: weatherUsed ? (stageACoeffs[2] ?? null) : null,
    air_temp: weatherUsed ? (stageACoeffs[3] ?? null) : null,
  };

  return {
    slope_corrected: stageBResult.slope,
    r_squared_stage_a: stageAResult.rSquared,
    r_squared_stage_b: stageBResult.rSquared,
    model_type: modelType,
    coefficients,
    weather_used: weatherUsed,
  };
}

/* ── Main corrected degradation calculation ── */

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
    // Filter valid laps
    const stintLaps = laps.filter(l => {
      if (l.lap_number < stint.lap_start || l.lap_number > stint.lap_end) return false;
      if (l.lap_duration == null || l.lap_duration <= 0) return false;
      if (l.is_pit_out_lap) return false;
      return true;
    });

    // Exclude in-lap
    const isLastStint = stint.lap_end === Math.max(...stints.map(s => s.lap_end));
    const withoutInLap = stintLaps.filter(l =>
      isLastStint || l.lap_number !== stint.lap_end
    );

    // Exclude wet/mixed laps
    let filteredLaps = withoutInLap;
    if (weatherMap) {
      filteredLaps = filteredLaps.filter(l => {
        const wc = weatherMap.get(l.lap_number);
        return wc !== "WET" && wc !== "MIXED";
      });
    }

    // Exclude neutralised laps
    if (trackStatusMap) {
      filteredLaps = filteredLaps.filter(l => {
        const ts = trackStatusMap.get(l.lap_number);
        return !ts || ts === "GREEN";
      });
    }

    if (filteredLaps.length < config.min_laps) continue;

    // Outlier removal
    const durations = filteredLaps.map(l => l.lap_duration!).sort((a, b) => a - b);
    const med = durations[Math.floor(durations.length / 2)];
    const threshold = med * (1 + config.outlier_threshold);
    const validLaps = filteredLaps.filter(l => l.lap_duration! <= threshold);

    if (validLaps.length < config.min_laps) continue;

    // Build features
    const tyreLifes: number[] = [];
    const fuelProxies: number[] = [];
    const trackTemps: number[] = [];
    const airTemps: number[] = [];
    const lapTimes: number[] = [];
    const points: { tyreLife: number; lapTime: number }[] = [];
    let weatherComplete = true;

    for (const l of validLaps) {
      const tyreLife = (stint.tyre_age_at_start ?? 0) + (l.lap_number - stint.lap_start);
      const fuelProxy = buildFuelProxy(l.lap_number, totalSessionLaps, config.fuel_proxy_type);
      const wData = lapWeather.get(l.lap_number);

      tyreLifes.push(tyreLife);
      fuelProxies.push(fuelProxy);
      lapTimes.push(l.lap_duration!);
      points.push({ tyreLife, lapTime: l.lap_duration! });

      if (wData?.track_temperature != null && wData?.air_temperature != null) {
        trackTemps.push(wData.track_temperature);
        airTemps.push(wData.air_temperature);
      } else {
        weatherComplete = false;
      }
    }

    // Simple regression for raw slope (always computed)
    const rawReg = simpleLinearRegression(tyreLifes, lapTimes);
    if (!rawReg) continue;

    // Attempt two-stage corrected model if enough laps
    let modelType: CorrectedDegradationResult["model_type"] = "simple_fallback";
    let slopeCorrected = rawReg.slope;
    let rSquaredCorrected = rawReg.rSquared;
    let rSquaredStageA: number | null = null;
    let weatherCorrectionUsed = false;
    let coefficients: CorrectedDegradationResult["coefficients"] = {
      intercept: rawReg.intercept,
      tyre_life: rawReg.slope,
      fuel_proxy: 0,
      track_temp: null,
      air_temp: null,
    };

    // Only attempt corrected model if we have enough laps
    const fuelStd = std(fuelProxies);
    const hasFuelVariance = fuelStd > 0.5;

    if (hasFuelVariance && validLaps.length >= config.min_laps_corrected) {
      const twoStage = twoStageDegradation(
        tyreLifes,
        fuelProxies,
        weatherComplete ? trackTemps : null,
        weatherComplete ? airTemps : null,
        lapTimes,
      );

      if (twoStage) {
        // Plausibility check: reject absurd coefficients
        if (Math.abs(twoStage.slope_corrected) <= config.max_plausible_slope) {
          modelType = twoStage.model_type;
          slopeCorrected = twoStage.slope_corrected;
          rSquaredCorrected = twoStage.r_squared_stage_b;
          rSquaredStageA = twoStage.r_squared_stage_a;
          weatherCorrectionUsed = twoStage.weather_used;
          coefficients = twoStage.coefficients;
        }
        // If implausible, we silently fall back to simple model (already set as default)
      }
    } else if (hasFuelVariance && validLaps.length >= config.min_laps + 1) {
      // Not enough for full corrected model, but try fuel-only two-stage
      const twoStage = twoStageDegradation(
        tyreLifes,
        fuelProxies,
        null, null,
        lapTimes,
      );

      if (twoStage && Math.abs(twoStage.slope_corrected) <= config.max_plausible_slope) {
        modelType = twoStage.model_type;
        slopeCorrected = twoStage.slope_corrected;
        rSquaredCorrected = twoStage.r_squared_stage_b;
        rSquaredStageA = twoStage.r_squared_stage_a;
        coefficients = twoStage.coefficients;
      }
    }

    const round3 = (v: number) => Math.round(v * 1000) / 1000;

    results.push({
      driverNumber,
      acronym,
      color,
      stint: stint.stint_number,
      compound: stint.compound,
      lapsUsed: validLaps.length,
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
    });
  }

  return results;
}
