/**
 * Corrected Tyre Degradation Module
 *
 * Replaces the simple lap_time ~ tyre_life regression with a multivariate model:
 *   lap_time = b + a1*tyre_life + a2*fuel_proxy + a3*track_temp + a4*air_temp
 *
 * The strategic degradation coefficient is a1 (tyre_life), isolated from
 * fuel effect, track temperature, and air temperature.
 *
 * IMPORTANT:
 * - fuel_proxy is NOT real fuel load (OpenF1 does not expose it).
 *   It is a proxy representing progressive car lightening.
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
  /** Minimum laps for multivariate regression */
  min_laps: number;
  /** Outlier threshold: exclude laps > median * (1 + threshold) */
  outlier_threshold: number;
}

export const DEFAULT_CORRECTED_CONFIG: CorrectedDegradationConfig = {
  fuel_proxy_type: "laps_remaining",
  min_laps: 4,
  outlier_threshold: 0.07,
};

/* ── Types ── */

export interface LapWeatherData {
  lap_number: number;
  track_temperature: number | null;
  air_temperature: number | null;
}

export interface CorrectedDegradationResult extends DegradationResult {
  /** Model type identifier */
  model_type: "corrected_multivariate" | "simple_fallback";
  /** Raw slope from simple tyre_life-only regression */
  slope_raw: number;
  /** Corrected slope: coefficient of tyre_life in multivariate model */
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
  /** R² of the corrected model */
  r_squared_corrected: number;
}

/* ── Weather association ── */

/**
 * Associate weather data to each lap by nearest timestamp.
 * Does NOT invent data — returns null if no weather available.
 */
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
    // Find nearest weather record
    let bestIdx = 0;
    let bestDist = Math.abs(weatherTimes[0] - lapTime);
    for (let i = 1; i < weatherTimes.length; i++) {
      const dist = Math.abs(weatherTimes[i] - lapTime);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }

    // Only use if within 5 minutes (300s)
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
  return lapNumber; // lap_number proxy
}

/* ── Multivariate OLS regression ── */

/**
 * Ordinary Least Squares for y = b0 + b1*x1 + b2*x2 + ... + bk*xk
 * Uses normal equations: b = (X'X)^-1 X'y
 * Returns coefficients array [b0, b1, ..., bk] and R²
 */
function multivariateOLS(
  X: number[][], // each row is [x1, x2, ..., xk] (NO intercept column)
  y: number[],
): { coefficients: number[]; rSquared: number } | null {
  const n = X.length;
  if (n < 2) return null;
  const k = X[0].length;
  if (n <= k + 1) return null; // need more observations than parameters

  // Augment X with intercept column: [1, x1, x2, ..., xk]
  const p = k + 1;
  const Xa: number[][] = X.map(row => [1, ...row]);

  // Compute X'X (p x p)
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let sum = 0;
      for (let r = 0; r < n; r++) sum += Xa[r][i] * Xa[r][j];
      XtX[i][j] = sum;
    }
  }

  // Compute X'y (p x 1)
  const Xty: number[] = new Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    let sum = 0;
    for (let r = 0; r < n; r++) sum += Xa[r][i] * y[r];
    Xty[i] = sum;
  }

  // Solve XtX * b = Xty using Gaussian elimination with partial pivoting
  const aug: number[][] = XtX.map((row, i) => [...row, Xty[i]]);

  for (let col = 0; col < p; col++) {
    // Partial pivoting
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(aug[row][col]) > maxVal) { maxVal = Math.abs(aug[row][col]); maxRow = row; }
    }
    if (maxVal < 1e-12) return null; // singular
    if (maxRow !== col) [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    // Eliminate
    for (let row = 0; row < p; row++) {
      if (row === col) continue;
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= p; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  const coefficients = aug.map((row, i) => row[p] / row[i]);

  // R²
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (let r = 0; r < n; r++) {
    let yPred = 0;
    for (let j = 0; j < p; j++) yPred += coefficients[j] * Xa[r][j];
    ssTot += (y[r] - meanY) ** 2;
    ssRes += (y[r] - yPred) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return { coefficients, rSquared };
}

/* ── Simple linear regression (fallback) ── */

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

    // Exclude in-lap (last lap of non-final stint)
    const isLastStint = stint.lap_end === Math.max(...stints.map(s => s.lap_end));
    const withoutInLap = stintLaps.filter(l =>
      isLastStint || l.lap_number !== stint.lap_end
    );

    // Exclude wet/mixed laps if classification available
    let filteredLaps = withoutInLap;
    if (weatherMap) {
      filteredLaps = filteredLaps.filter(l => {
        const wc = weatherMap.get(l.lap_number);
        return wc !== "WET" && wc !== "MIXED";
      });
    }

    // Exclude neutralised laps if classification available
    if (trackStatusMap) {
      filteredLaps = filteredLaps.filter(l => {
        const ts = trackStatusMap.get(l.lap_number);
        return !ts || ts === "GREEN";
      });
    }

    if (filteredLaps.length < config.min_laps) continue;

    // Outlier removal: exclude laps > median * (1 + threshold)
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
    let hasWeather = true;

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
        hasWeather = false;
      }
    }

    // Simple regression for raw slope
    const rawReg = simpleLinearRegression(tyreLifes, lapTimes);
    if (!rawReg) continue;

    // Check variance in features (need variation for multivariate to make sense)
    const fuelStd = std(fuelProxies);
    const hasFuelVariance = fuelStd > 0.5;
    const trackTempStd = hasWeather ? std(trackTemps) : 0;
    const airTempStd = hasWeather ? std(airTemps) : 0;
    const hasTempVariance = trackTempStd > 0.3 || airTempStd > 0.3;

    // Build multivariate model
    let modelType: CorrectedDegradationResult["model_type"] = "simple_fallback";
    let slopeCorrected = rawReg.slope;
    let rSquaredCorrected = rawReg.rSquared;
    let coefficients: CorrectedDegradationResult["coefficients"] = {
      intercept: rawReg.intercept,
      tyre_life: rawReg.slope,
      fuel_proxy: 0,
      track_temp: null,
      air_temp: null,
    };
    let weatherCorrectionUsed = false;

    // Try multivariate: tyre_life + fuel_proxy [+ temps]
    if (hasFuelVariance && validLaps.length >= config.min_laps + 1) {
      let X: number[][];
      if (hasWeather && hasTempVariance && trackTemps.length === validLaps.length) {
        // Full model: tyre_life, fuel_proxy, track_temp, air_temp
        X = validLaps.map((_, i) => [tyreLifes[i], fuelProxies[i], trackTemps[i], airTemps[i]]);
        if (X.length > 5) { // Need enough data points for 5 params
          const mvResult = multivariateOLS(X, lapTimes);
          if (mvResult) {
            modelType = "corrected_multivariate";
            slopeCorrected = mvResult.coefficients[1]; // tyre_life coefficient
            rSquaredCorrected = mvResult.rSquared;
            coefficients = {
              intercept: mvResult.coefficients[0],
              tyre_life: mvResult.coefficients[1],
              fuel_proxy: mvResult.coefficients[2],
              track_temp: mvResult.coefficients[3],
              air_temp: mvResult.coefficients[4],
            };
            weatherCorrectionUsed = true;
          }
        }
      }

      if (modelType === "simple_fallback") {
        // Fallback: tyre_life + fuel_proxy only
        X = validLaps.map((_, i) => [tyreLifes[i], fuelProxies[i]]);
        if (X.length > 3) {
          const mvResult = multivariateOLS(X, lapTimes);
          if (mvResult) {
            modelType = "corrected_multivariate";
            slopeCorrected = mvResult.coefficients[1]; // tyre_life coefficient
            rSquaredCorrected = mvResult.rSquared;
            coefficients = {
              intercept: mvResult.coefficients[0],
              tyre_life: mvResult.coefficients[1],
              fuel_proxy: mvResult.coefficients[2],
              track_temp: null,
              air_temp: null,
            };
          }
        }
      }
    }

    results.push({
      // Base DegradationResult fields
      driverNumber,
      acronym,
      color,
      stint: stint.stint_number,
      compound: stint.compound,
      lapsUsed: validLaps.length,
      slopeSecPerLap: Math.round(slopeCorrected * 1000) / 1000,
      intercept: Math.round(coefficients.intercept * 1000) / 1000,
      rSquared: Math.round(rSquaredCorrected * 1000) / 1000,
      points,
      // Corrected-specific fields
      model_type: modelType,
      slope_raw: Math.round(rawReg.slope * 1000) / 1000,
      slope_corrected: Math.round(slopeCorrected * 1000) / 1000,
      fuel_proxy_type: config.fuel_proxy_type,
      weather_correction_used: weatherCorrectionUsed,
      coefficients: {
        intercept: Math.round(coefficients.intercept * 1000) / 1000,
        tyre_life: Math.round(coefficients.tyre_life * 1000) / 1000,
        fuel_proxy: Math.round(coefficients.fuel_proxy * 1000) / 1000,
        track_temp: coefficients.track_temp != null ? Math.round(coefficients.track_temp * 1000) / 1000 : null,
        air_temp: coefficients.air_temp != null ? Math.round(coefficients.air_temp * 1000) / 1000 : null,
      },
      r_squared_corrected: Math.round(rSquaredCorrected * 1000) / 1000,
    });
  }

  return results;
}

/* ── Utility ── */

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}
