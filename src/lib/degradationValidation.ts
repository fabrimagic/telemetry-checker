/**
 * Tyre Degradation Validation Module
 * 
 * Classifies each degradation estimate as VALID, NEUTRAL, or INVALID.
 * Prevents unreliable estimates (especially negative slopes) from being
 * used as strategic input in the Virtual Race Engineer.
 * 
 * Supports both simple DegradationResult and CorrectedDegradationResult.
 * When a corrected model is available, validation is based on slope_corrected.
 * 
 * Anti-hallucination: A negative slope does NOT mean "tyre gaining performance".
 * It means the estimate is contaminated by fuel effect, warm-up, traffic,
 * track evolution, weather, short stint, or statistical noise.
 */

import type { DegradationResult } from "./tyreDegradation";
import type { CorrectedDegradationResult } from "./correctedDegradation";

/* ── Configuration ── */

export interface DegradationValidationConfig {
  /** Slope below this → INVALID (e.g. -0.02 means slopes < -0.02 are invalid) */
  negative_tolerance: number;
  /** |slope| <= this → NEUTRAL (too weak to be meaningful) */
  neutral_tolerance: number;
  /** Minimum laps for a reliable estimate */
  min_valid_laps: number;
  /** Minimum R² for fit quality (if available) */
  min_r_squared: number;
  /** Fallback degradation slope when no valid estimate is available (sec/lap, conservative) */
  neutral_fallback_slope: number;
}

export const DEFAULT_VALIDATION_CONFIG: DegradationValidationConfig = {
  negative_tolerance: -0.02,
  neutral_tolerance: 0.01,
  min_valid_laps: 4,
  min_r_squared: 0.1,
  neutral_fallback_slope: 0.03, // conservative neutral fallback ~30ms/lap
};

/* ── Types ── */

export type DegradationStatus = "VALID" | "NEUTRAL" | "INVALID";

export interface DegradationValidationResult {
  /** Original degradation result */
  original: DegradationResult;
  /** Classification */
  status: DegradationStatus;
  /** Whether this value should be used for VRE strategy calculations */
  used_for_strategy: boolean;
  /** Human-readable reason for classification */
  reason: string;
  /** Slope actually used by the VRE (may differ from original if fallback applied) */
  effective_slope: number;
  /** Whether a fallback was applied */
  fallback_applied: boolean;
  /** Description of fallback if applied */
  fallback_description: string | null;
  /** Original slope for reference */
  original_slope: number;
  /** Fit quality assessment */
  fit_quality: "GOOD" | "ACCEPTABLE" | "POOR" | "INSUFFICIENT";
  /** Confidence in this specific estimate */
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** Whether corrected model was used */
  model_corrected: boolean;
  /** Raw slope (simple regression) */
  slope_raw: number;
  /** Corrected slope (multivariate, if available) */
  slope_corrected: number;
  /** Fuel proxy type used (if corrected) */
  fuel_proxy_type: string | null;
  /** Whether weather correction was applied */
  weather_correction_used: boolean;
  /** Model type identifier */
  model_type: string;
}

/* ── Helpers ── */

function isCorrectedResult(r: DegradationResult): r is CorrectedDegradationResult {
  return "model_type" in r && "slope_raw" in r && "slope_corrected" in r;
}

/* ── Validation ── */

export function validateDegradationEstimate(
  result: DegradationResult,
  config: DegradationValidationConfig = DEFAULT_VALIDATION_CONFIG,
): DegradationValidationResult {
  const corrected = isCorrectedResult(result);
  const slopeRaw = corrected ? (result as CorrectedDegradationResult).slope_raw : result.slopeSecPerLap;
  const slopeCorrected = corrected ? (result as CorrectedDegradationResult).slope_corrected : result.slopeSecPerLap;
  const rSqCorrected = corrected ? (result as CorrectedDegradationResult).r_squared_corrected : result.rSquared;
  
  // Validation is based on the corrected slope (which IS the raw slope when no correction available)
  const slope = slopeCorrected;
  const laps = result.lapsUsed;
  const rSq = rSqCorrected;

  // Assess fit quality
  const fitQuality: DegradationValidationResult["fit_quality"] =
    rSq >= 0.7 ? "GOOD" :
    rSq >= 0.3 ? "ACCEPTABLE" :
    rSq >= config.min_r_squared ? "POOR" : "INSUFFICIENT";

  const reasons: string[] = [];
  let status: DegradationStatus = "VALID";

  // 1. Check laps
  if (laps < config.min_valid_laps) {
    status = "INVALID";
    reasons.push(`Giri validi insufficienti (${laps} < ${config.min_valid_laps})`);
  }

  // 2. Check fit quality
  if (fitQuality === "INSUFFICIENT") {
    status = "INVALID";
    reasons.push(`Qualità del fit insufficiente (R²=${rSq.toFixed(3)} < ${config.min_r_squared})`);
  }

  // 3. Check slope (corrected)
  if (status !== "INVALID") {
    if (slope < config.negative_tolerance) {
      status = "INVALID";
      reasons.push(`Slope ${corrected ? "corretta" : ""} negativa oltre la tolleranza (${slope.toFixed(3)} < ${config.negative_tolerance})`);
      if (corrected && slopeRaw < 0 && slopeCorrected < 0) {
        reasons.push("Anche dopo correzione per fuel proxy e temperatura, la slope resta negativa");
      }
    } else if (Math.abs(slope) <= config.neutral_tolerance) {
      status = "NEUTRAL";
      reasons.push(`Slope ${corrected ? "corretta " : ""}vicina a zero (|${slope.toFixed(3)}| ≤ ${config.neutral_tolerance}): segnale di degrado troppo debole`);
    } else if (slope > config.neutral_tolerance) {
      if (fitQuality === "POOR") {
        status = "NEUTRAL";
        reasons.push(`Slope ${corrected ? "corretta " : ""}positiva ma fit di bassa qualità (R²=${rSq.toFixed(3)})`);
      } else {
        reasons.push(`Slope ${corrected ? "corretta " : ""}positiva con fit accettabile`);
      }
    }
  }

  // Add info about raw vs corrected when model corrected
  if (corrected && slopeRaw < 0 && slopeCorrected > 0 && status === "VALID") {
    reasons.push(`Slope grezza negativa (${slopeRaw.toFixed(3)}) corretta a positiva (${slopeCorrected.toFixed(3)}) dopo rimozione effetto fuel/temperatura`);
  }

  const reason = reasons.length > 0 ? reasons.join("; ") : "Stima valida";

  // Determine effective slope and fallback
  let effectiveSlope = slope;
  let fallbackApplied = false;
  let fallbackDescription: string | null = null;
  let usedForStrategy = true;

  if (status === "INVALID") {
    usedForStrategy = false;
    effectiveSlope = config.neutral_fallback_slope;
    fallbackApplied = true;
    fallbackDescription = `Fallback conservativo applicato (${config.neutral_fallback_slope} sec/giro) — stima originale esclusa`;
  } else if (status === "NEUTRAL") {
    effectiveSlope = Math.max(slope, 0);
    if (effectiveSlope !== slope) {
      fallbackApplied = true;
      fallbackDescription = "Slope negativa lieve portata a zero per uso strategico prudente";
    }
    usedForStrategy = true;
  }

  const confidence: DegradationValidationResult["confidence"] =
    status === "VALID" && fitQuality !== "POOR" ? "HIGH" :
    status === "NEUTRAL" ? "MEDIUM" : "LOW";

  const cr = corrected ? result as CorrectedDegradationResult : null;

  return {
    original: result,
    status,
    used_for_strategy: usedForStrategy,
    reason,
    effective_slope: effectiveSlope,
    fallback_applied: fallbackApplied,
    fallback_description: fallbackDescription,
    original_slope: slopeRaw,
    fit_quality: fitQuality,
    confidence,
    model_corrected: corrected,
    slope_raw: slopeRaw,
    slope_corrected: slopeCorrected,
    fuel_proxy_type: cr?.fuel_proxy_type ?? null,
    weather_correction_used: cr?.weather_correction_used ?? false,
    model_type: cr?.model_type ?? "simple",
  };
}

/* ── Batch validation ── */

export function validateAllDegradationEstimates(
  results: DegradationResult[],
  config: DegradationValidationConfig = DEFAULT_VALIDATION_CONFIG,
): DegradationValidationResult[] {
  return results.map(r => validateDegradationEstimate(r, config));
}

/* ── Fallback selection ── */

export function selectDegradationFallback(
  invalidResult: DegradationValidationResult,
  allValidated: DegradationValidationResult[],
  config: DegradationValidationConfig = DEFAULT_VALIDATION_CONFIG,
): { slope: number; description: string } {
  const compound = invalidResult.original.compound;
  const driverNumber = invalidResult.original.driverNumber;

  // 1. Same driver, same compound, VALID
  const sameDriverSameCompound = allValidated.find(v =>
    v.status === "VALID" &&
    v.original.driverNumber === driverNumber &&
    v.original.compound === compound &&
    v.original.stint !== invalidResult.original.stint
  );
  if (sameDriverSameCompound) {
    return {
      slope: sameDriverSameCompound.effective_slope,
      description: `Fallback da stint ${sameDriverSameCompound.original.stint} stesso pilota e compound (${sameDriverSameCompound.effective_slope.toFixed(3)} sec/giro)`,
    };
  }

  // 2. Any driver, same compound, VALID
  const anyDriverSameCompound = allValidated.find(v =>
    v.status === "VALID" &&
    v.original.compound === compound
  );
  if (anyDriverSameCompound) {
    return {
      slope: anyDriverSameCompound.effective_slope,
      description: `Fallback da ${anyDriverSameCompound.original.acronym} stint ${anyDriverSameCompound.original.stint} stesso compound (${anyDriverSameCompound.effective_slope.toFixed(3)} sec/giro)`,
    };
  }

  // 3. Neutral fallback
  return {
    slope: config.neutral_fallback_slope,
    description: `Nessun riferimento credibile disponibile — fallback conservativo neutro (${config.neutral_fallback_slope} sec/giro)`,
  };
}

export function resolveDegradationForStrategy(
  validated: DegradationValidationResult[],
  config: DegradationValidationConfig = DEFAULT_VALIDATION_CONFIG,
): DegradationValidationResult[] {
  return validated.map(v => {
    if (v.status !== "INVALID") return v;

    const fallback = selectDegradationFallback(v, validated, config);
    return {
      ...v,
      effective_slope: fallback.slope,
      fallback_description: fallback.description,
    };
  });
}
