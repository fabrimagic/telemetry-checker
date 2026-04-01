/**
 * Tyre Degradation Validation Module
 * 
 * Classifies each degradation estimate as VALID, NEUTRAL, or INVALID.
 * Prevents unreliable estimates (especially negative slopes) from being
 * used as strategic input in the Virtual Race Engineer.
 * 
 * Anti-hallucination: A negative slope does NOT mean "tyre gaining performance".
 * It means the estimate is contaminated by fuel effect, warm-up, traffic,
 * track evolution, weather, short stint, or statistical noise.
 */

import type { DegradationResult } from "./tyreDegradation";

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
}

/* ── Validation ── */

export function validateDegradationEstimate(
  result: DegradationResult,
  config: DegradationValidationConfig = DEFAULT_VALIDATION_CONFIG,
): DegradationValidationResult {
  const slope = result.slopeSecPerLap;
  const laps = result.lapsUsed;
  const rSq = result.rSquared;

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

  // 3. Check slope
  if (status !== "INVALID") {
    if (slope < config.negative_tolerance) {
      status = "INVALID";
      reasons.push(`Slope negativa oltre la tolleranza (${slope.toFixed(3)} < ${config.negative_tolerance})`);
    } else if (Math.abs(slope) <= config.neutral_tolerance) {
      status = "NEUTRAL";
      reasons.push(`Slope vicina a zero (|${slope.toFixed(3)}| ≤ ${config.neutral_tolerance}): segnale di degrado troppo debole`);
    } else if (slope > config.neutral_tolerance) {
      // Positive slope but check if fit is poor
      if (fitQuality === "POOR") {
        status = "NEUTRAL";
        reasons.push(`Slope positiva ma fit di bassa qualità (R²=${rSq.toFixed(3)})`);
      } else {
        reasons.push("Slope positiva con fit accettabile");
      }
    }
  }

  // Build reason string
  const reason = reasons.length > 0 ? reasons.join("; ") : "Stima valida";

  // Determine effective slope and fallback
  let effectiveSlope = slope;
  let fallbackApplied = false;
  let fallbackDescription: string | null = null;
  let usedForStrategy = true;

  if (status === "INVALID") {
    usedForStrategy = false;
    // Will be resolved by selectDegradationFallback later
    effectiveSlope = config.neutral_fallback_slope;
    fallbackApplied = true;
    fallbackDescription = `Fallback conservativo applicato (${config.neutral_fallback_slope} sec/giro) — stima originale esclusa`;
  } else if (status === "NEUTRAL") {
    // Use slope but cap at a minimum to avoid strategic distortion
    effectiveSlope = Math.max(slope, 0);
    if (effectiveSlope !== slope) {
      fallbackApplied = true;
      fallbackDescription = "Slope negativa lieve portata a zero per uso strategico prudente";
    }
    usedForStrategy = true; // Used but with reduced confidence
  }

  // Confidence for this estimate
  const confidence: DegradationValidationResult["confidence"] =
    status === "VALID" && fitQuality !== "POOR" ? "HIGH" :
    status === "NEUTRAL" ? "MEDIUM" : "LOW";

  return {
    original: result,
    status,
    used_for_strategy: usedForStrategy,
    reason,
    effective_slope: effectiveSlope,
    fallback_applied: fallbackApplied,
    fallback_description: fallbackDescription,
    original_slope: slope,
    fit_quality: fitQuality,
    confidence,
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

/**
 * Select the best fallback for an INVALID degradation estimate.
 * Priority:
 * 1. Same compound from another valid stint of the same driver
 * 2. Same compound from any validated result in session
 * 3. Neutral conservative fallback
 * 
 * Never invents data. If no credible fallback exists, uses neutral_fallback_slope.
 */
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

/**
 * Resolve the effective degradation input for the VRE.
 * Applies fallback selection for INVALID results.
 */
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
