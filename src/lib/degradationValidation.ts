/**
 * Tyre Degradation Validation Module — Race Engineering Grade
 * 
 * Classifies each degradation estimate as VALID, NEUTRAL, or INVALID
 * using compound-specific profiles, multi-criteria assessment,
 * and contextual heuristics inspired by F1 strategy engineering.
 * 
 * Anti-hallucination: A negative slope does NOT mean "tyre gaining performance".
 * It means the estimate is contaminated by fuel effect, warm-up, traffic,
 * track evolution, weather, short stint, or statistical noise.
 * 
 * Backward-compatible with virtualRaceEngineer.ts — same public API.
 */

import type { DegradationResult } from "./tyreDegradation";
import type { CorrectedDegradationResult } from "./correctedDegradation";
import { getCanonicalProfile } from "./tyreCompoundProfiles";

/* ══════════════════════════════════════════════════════════════════
 * COMPOUND-SPECIFIC VALIDATION PROFILES
 * ══════════════════════════════════════════════════════════════════ */

export interface CompoundValidationProfile {
  /** Slope below this → INVALID */
  negative_tolerance: number;
  /** |slope| <= this → NEUTRAL (too weak to be meaningful) */
  neutral_tolerance: number;
  /** Maximum plausible slope (s/lap) — above this → INVALID */
  max_plausible_slope: number;
  /** Fallback degradation slope for this compound */
  neutral_fallback_slope: number;
  /** Minimum laps — below this → INVALID */
  min_laps_invalid: number;
  /** Laps in [min_laps_invalid, min_laps_valid) → at most NEUTRAL */
  min_laps_valid: number;
  /** Minimum R² for VALID */
  min_r_squared: number;
  /** Maximum correction magnitude ratio before cautionary flag */
  max_correction_ratio: number;
  /**
   * Minimum |t-stat| (= |slope| / slopeStdError) required for VALID.
   * Below → cap at NEUTRAL. Set to 0 to disable the check for this compound.
   * Standard threshold ≈ 2.0 (~95% significance).
   * Skipped silently when slopeStdError is unavailable (n ≤ 2).
   */
  min_t_stat_valid: number;
  /**
   * Threshold of |corrected − raw| above which a sign flip is considered "large"
   * → cap to NEUTRAL regardless of stint length. ~50% of max_plausible_slope.
   */
  sign_flip_large_correction_threshold: number;
}

/**
 * Compound-specific profiles reflecting real F1 tyre behaviour.
 * 
 * SOFT: Higher expected degradation, faster emergence, shorter stints acceptable.
 * MEDIUM: Moderate degradation, intermediate behaviour.
 * HARD: Lower expected degradation, slower to emerge, needs longer stints for credible fit.
 */
// CHANGELOG:
// - Previous min_r_squared: SOFT/MEDIUM=0.10, HARD=0.12 (too permissive: a model
//   explaining only 10% of variance was accepted as usable).
// - New min_r_squared: SOFT/MEDIUM=0.25, HARD=0.30 (statistically defensible for
//   typical F1 stint length 8-15 laps).
// - Works in tandem with t-stat significance check: R² controls explanatory power,
//   t-stat controls coefficient significance.
//
// NOTE: Values now derived from the canonical compound profiles in
// tyreCompoundProfiles.ts. Refactor is purely structural — bit-identical
// behaviour to the previous hard-coded literals.
function deriveValidationProfile(compound: string): CompoundValidationProfile {
  const c = getCanonicalProfile(compound);
  return {
    negative_tolerance: c.validation.negative_tolerance,
    neutral_tolerance: c.validation.neutral_tolerance,
    max_plausible_slope: c.validation.max_plausible_slope,
    neutral_fallback_slope: c.validation.neutral_fallback_slope,
    min_laps_invalid: c.validation.min_laps_invalid,
    min_laps_valid: c.validation.min_laps_valid,
    min_r_squared: c.validation.min_r_squared,
    max_correction_ratio: c.validation.max_correction_ratio,
    min_t_stat_valid: c.validation.min_t_stat_valid ?? 0,
    sign_flip_large_correction_threshold: c.validation.sign_flip_large_correction_threshold,
  };
}

/**
 * Compound-specific profiles reflecting real F1 tyre behaviour.
 *
 * SOFT: Higher expected degradation, faster emergence, shorter stints acceptable.
 * MEDIUM: Moderate degradation, intermediate behaviour.
 * HARD: Lower expected degradation, slower to emerge, needs longer stints for credible fit.
 */
export const COMPOUND_PROFILES: Record<string, CompoundValidationProfile> = {
  SOFT: deriveValidationProfile("SOFT"),
  MEDIUM: deriveValidationProfile("MEDIUM"),
  HARD: deriveValidationProfile("HARD"),
};

/* ══════════════════════════════════════════════════════════════════
 * GLOBAL CONFIGURATION (backward-compatible)
 * ══════════════════════════════════════════════════════════════════ */

export interface DegradationValidationConfig {
  /** Slope below this → INVALID (global fallback) */
  negative_tolerance: number;
  /** |slope| <= this → NEUTRAL (global fallback) */
  neutral_tolerance: number;
  /** Minimum laps for a reliable estimate (global fallback) */
  min_valid_laps: number;
  /** Minimum R² for fit quality (global fallback) */
  min_r_squared: number;
  /** Fallback degradation slope (global fallback) */
  neutral_fallback_slope: number;
  /** Maximum plausible slope (global fallback) */
  max_plausible_slope: number;
  /** Compound-specific profiles (optional, uses defaults if missing) */
  compound_profiles?: Record<string, CompoundValidationProfile>;
}

export const DEFAULT_VALIDATION_CONFIG: DegradationValidationConfig = {
  negative_tolerance: -0.02,
  neutral_tolerance: 0.01,
  min_valid_laps: 4,
  min_r_squared: 0.25,
  neutral_fallback_slope: 0.03,
  max_plausible_slope: 0.30,
  compound_profiles: COMPOUND_PROFILES,
};

/* ══════════════════════════════════════════════════════════════════
 * TYPES
 * ══════════════════════════════════════════════════════════════════ */

export type DegradationStatus = "VALID" | "NEUTRAL" | "INVALID";

export type ReasonCategory = "STATISTICAL" | "PHYSICAL" | "CONTEXTUAL" | "MIXED";

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
  /* ── New optional fields (backward-compatible) ── */
  /** Reason category */
  reason_category?: ReasonCategory;
  /** Statistical quality flags */
  statistical_flags?: string[];
  /** Physical plausibility flags */
  plausibility_flags?: string[];
  /** Contextual (compound/stint) flags */
  context_flags?: string[];
  /** Compound profile used for validation */
  compound_profile_used?: string;
  /** T-statistic of the slope (|slope| / slopeStdError). Null if std error unavailable. */
  t_stat?: number | null;
}

/* ══════════════════════════════════════════════════════════════════
 * HELPERS
 * ══════════════════════════════════════════════════════════════════ */

function isCorrectedResult(r: DegradationResult): r is CorrectedDegradationResult {
  return "model_type" in r && "slope_raw" in r && "slope_corrected" in r;
}

/** Resolve compound-specific profile, falling back to global config */
function getProfile(compound: string, config: DegradationValidationConfig): CompoundValidationProfile {
  const profiles = config.compound_profiles ?? COMPOUND_PROFILES;
  const key = compound?.toUpperCase();
  if (profiles[key]) return profiles[key];
  // Build a fallback profile from global config
  return {
    negative_tolerance: config.negative_tolerance,
    neutral_tolerance: config.neutral_tolerance,
    max_plausible_slope: config.max_plausible_slope,
    neutral_fallback_slope: config.neutral_fallback_slope,
    min_laps_invalid: Math.max(2, config.min_valid_laps - 1),
    min_laps_valid: config.min_valid_laps + 2,
    min_r_squared: config.min_r_squared,
    max_correction_ratio: 3.0,
    min_t_stat_valid: 2.0,
    sign_flip_large_correction_threshold: 0.03,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * VALIDATION — Multi-criteria, compound-contextual
 * ══════════════════════════════════════════════════════════════════ */

export function validateDegradationEstimate(
  result: DegradationResult,
  config: DegradationValidationConfig = DEFAULT_VALIDATION_CONFIG,
): DegradationValidationResult {
  const corrected = isCorrectedResult(result);
  const slopeRaw = corrected ? (result as CorrectedDegradationResult).slope_raw : result.slopeSecPerLap;
  const slopeCorrected = corrected ? (result as CorrectedDegradationResult).slope_corrected : result.slopeSecPerLap;
  const rSqCorrected = corrected ? (result as CorrectedDegradationResult).r_squared_corrected : result.rSquared;

  const slope = slopeCorrected;
  const laps = result.lapsUsed;
  const rSq = rSqCorrected;
  const compound = result.compound?.toUpperCase() ?? "UNKNOWN";
  const profile = getProfile(compound, config);

  // ── Statistical significance check (t-stat) ──
  // Use the std error matching the slope being validated:
  //   - corrected models → slope_corrected_std_error (stage B), fallback to raw slopeStdError
  //   - simple models   → slopeStdError
  // Defensive: treat negative / NaN std errors as missing (skip the check).
  const cResult = corrected ? (result as CorrectedDegradationResult) : null;
  const stdErrCandidate = cResult
    ? (cResult.slope_corrected_std_error ?? result.slopeStdError ?? null)
    : (result.slopeStdError ?? null);
  const stdErr =
    stdErrCandidate != null && Number.isFinite(stdErrCandidate) && stdErrCandidate > 0
      ? stdErrCandidate
      : null;
  const tStat = stdErr != null ? Math.abs(slope) / stdErr : null;
  // Skip the check entirely when min_t_stat_valid <= 0 (escape hatch) or t-stat unavailable.
  const tStatInsufficient =
    tStat != null && profile.min_t_stat_valid > 0 && tStat < profile.min_t_stat_valid;

  // ── Flags ──
  const statisticalFlags: string[] = [];
  const plausibilityFlags: string[] = [];
  const contextFlags: string[] = [];

  if (tStatInsufficient) {
    statisticalFlags.push(
      `Slope non statisticamente significativa (t=${tStat!.toFixed(2)} < ${profile.min_t_stat_valid})`,
    );
  }

  // ── Fit quality (same thresholds, independent of compound) ──
  const fitQuality: DegradationValidationResult["fit_quality"] =
    rSq >= 0.7 ? "GOOD" :
    rSq >= 0.3 ? "ACCEPTABLE" :
    rSq >= profile.min_r_squared ? "POOR" : "INSUFFICIENT";

  // ── Correction magnitude check ──
  const correctionMagnitude = corrected ? Math.abs(slopeCorrected - slopeRaw) : 0;
  const correctionIsLarge = corrected && slope !== 0 &&
    (correctionMagnitude / Math.max(Math.abs(slope), 0.001)) > profile.max_correction_ratio;

  if (correctionIsLarge) {
    statisticalFlags.push(`Correzione raw→corrected molto ampia (Δ=${correctionMagnitude.toFixed(3)})`);
  }

  // ── Raw-to-corrected sign flip caution (bidirectional) ──
  // Both directions of flip (negative→positive, positive→negative) signal
  // that the multivariate correction is unstable. The strict-zero exclusion
  // avoids treating exact-zero slopes (where Math.sign returns 0) as flips.
  const signFlip = !!corrected
    && slopeRaw !== 0 && slopeCorrected !== 0
    && Math.sign(slopeRaw) !== Math.sign(slopeCorrected);
  if (signFlip) {
    const direction = slopeRaw < 0 ? "negativa→positiva" : "positiva→negativa";
    contextFlags.push(`Slope ${direction} dopo correzione (raw=${slopeRaw.toFixed(3)}, corrected=${slopeCorrected.toFixed(3)})`);
  }

  // ── Few laps flag ──
  if (laps <= profile.min_laps_valid && laps >= profile.min_laps_invalid) {
    statisticalFlags.push(`Stint borderline: ${laps} giri (minimo VALID: ${profile.min_laps_valid})`);
  }

  // ── Slope near thresholds ──
  if (slope > 0 && slope < profile.neutral_tolerance * 1.5 && slope > profile.neutral_tolerance) {
    statisticalFlags.push(`Slope molto vicina alla soglia NEUTRAL (${slope.toFixed(3)} ≈ ${profile.neutral_tolerance})`);
  }

  // ── High slope on short stint ──
  if (slope > profile.max_plausible_slope * 0.6 && laps < profile.min_laps_valid + 2) {
    plausibilityFlags.push(`Slope alta (${slope.toFixed(3)}) su stint breve (${laps} giri): stima poco robusta`);
  }

  // ── Classification ──
  const reasons: string[] = [];
  let status: DegradationStatus = "VALID";
  let reasonCategory: ReasonCategory = "STATISTICAL";

  // 1. Hard invalid: too few laps
  if (laps < profile.min_laps_invalid) {
    status = "INVALID";
    reasons.push(`Giri insufficienti (${laps} < ${profile.min_laps_invalid} min per ${compound})`);
    reasonCategory = "STATISTICAL";
  }

  // 2. Fit quality insufficient
  if (fitQuality === "INSUFFICIENT") {
    status = "INVALID";
    reasons.push(`Fit insufficiente (R²=${rSq.toFixed(3)} < ${profile.min_r_squared})`);
    reasonCategory = reasons.length > 1 ? "MIXED" : "STATISTICAL";
  }

  // 3. Slope checks (only if not already INVALID)
  if (status !== "INVALID") {
    if (slope > profile.max_plausible_slope) {
      status = "INVALID";
      reasons.push(`Slope fisicamente implausibile per ${compound} (${slope.toFixed(3)} > ${profile.max_plausible_slope} s/giro)`);
      reasonCategory = "PHYSICAL";
    } else if (slope < profile.negative_tolerance) {
      status = "INVALID";
      reasons.push(`Slope negativa oltre tolleranza per ${compound} (${slope.toFixed(3)} < ${profile.negative_tolerance})`);
      if (corrected && slopeRaw < 0 && slopeCorrected < 0) {
        reasons.push("Anche dopo correzione fuel/temperatura, la slope resta negativa");
      }
      reasonCategory = "PHYSICAL";
    } else if (Math.abs(slope) <= profile.neutral_tolerance) {
      status = "NEUTRAL";
      reasons.push(`Slope vicina a zero per ${compound} (|${slope.toFixed(3)}| ≤ ${profile.neutral_tolerance})`);
      reasonCategory = "STATISTICAL";
    } else if (slope > profile.neutral_tolerance) {
      if (fitQuality === "POOR") {
        status = "NEUTRAL";
        reasons.push(`Slope positiva ma fit di bassa qualità (R²=${rSq.toFixed(3)})`);
        reasonCategory = "STATISTICAL";
      } else {
        reasons.push(`Slope positiva con fit accettabile per ${compound}`);
      }
    }
  }

  // 4. Borderline laps: cap at NEUTRAL even if slope/fit look OK
  if (status === "VALID" && laps < profile.min_laps_valid) {
    status = "NEUTRAL";
    reasons.push(`Stint borderline (${laps} < ${profile.min_laps_valid} giri minimi per VALID su ${compound})`);
    reasonCategory = reasons.length > 1 ? "MIXED" : "CONTEXTUAL";
    contextFlags.push("Giri insufficienti per piena affidabilità: VALID declassato a NEUTRAL");
  }

  // 5. Sign flip + short stint → conservative NEUTRAL
  if (status === "VALID" && signFlip && laps < profile.min_laps_valid + 3) {
    status = "NEUTRAL";
    reasons.push(`Correzione inverte il segno della slope su stint non lungo (${laps} giri): prudenza`);
    reasonCategory = "CONTEXTUAL";
    contextFlags.push("Sign flip raw→corrected con stint non lungo: fiducia ridotta");
  }

  // 5b. Sign flip + large correction magnitude → conservative NEUTRAL regardless of stint length.
  // A multivariate correction that flips the slope sign AND moves it by more than the threshold
  // is a strong overfitting signal: fuel/weather coefficients are likely absorbing tyre-life signal.
  if (status === "VALID" && signFlip &&
      correctionMagnitude > profile.sign_flip_large_correction_threshold) {
    status = "NEUTRAL";
    reasons.push(
      `Correzione inverte il segno della slope con magnitudine ampia (Δ=${correctionMagnitude.toFixed(3)} > ${profile.sign_flip_large_correction_threshold}): possibile overfitting`,
    );
    reasonCategory = "MIXED";
    statisticalFlags.push("Sign flip + large correction → likely overfitting");
  }

  // 6. Large correction + borderline → downgrade to NEUTRAL
  if (status === "VALID" && correctionIsLarge) {
    status = "NEUTRAL";
    reasons.push(`Correzione raw→corrected molto ampia: fiducia ridotta`);
    reasonCategory = "MIXED";
  }

  // 7. Statistical significance: cap at NEUTRAL if t-stat insufficient.
  // Never escalates to INVALID (only existing physical/statistical criteria do).
  // Skipped silently when std error is unavailable (n ≤ 2 or zero variance in x).
  if (status === "VALID" && tStatInsufficient) {
    status = "NEUTRAL";
    reasons.push(
      `Slope non statisticamente significativa (t=${tStat!.toFixed(2)}, minimo ${profile.min_t_stat_valid})`,
    );
    reasonCategory = "STATISTICAL";
  }

  const reason = reasons.length > 0 ? reasons.join("; ") : "Stima valida";

  // ── Effective slope & fallback ──
  let effectiveSlope = slope;
  let fallbackApplied = false;
  let fallbackDescription: string | null = null;
  let usedForStrategy = true;

  if (status === "INVALID") {
    usedForStrategy = false;
    effectiveSlope = profile.neutral_fallback_slope;
    fallbackApplied = true;
    fallbackDescription = `Fallback conservativo ${compound} (${profile.neutral_fallback_slope} s/giro)`;
  } else if (status === "NEUTRAL") {
    effectiveSlope = Math.max(slope, 0);
    if (effectiveSlope !== slope) {
      fallbackApplied = true;
      fallbackDescription = "Slope negativa lieve portata a zero per uso strategico prudente";
    }
    usedForStrategy = true;
  }

  // ── Confidence — multi-factor ──
  let confidenceScore = 0;
  if (status === "VALID") confidenceScore += 3;
  else if (status === "NEUTRAL") confidenceScore += 1;

  if (fitQuality === "GOOD") confidenceScore += 3;
  else if (fitQuality === "ACCEPTABLE") confidenceScore += 2;
  else if (fitQuality === "POOR") confidenceScore += 0;

  if (laps >= profile.min_laps_valid + 4) confidenceScore += 2;
  else if (laps >= profile.min_laps_valid) confidenceScore += 1;

  if (!correctionIsLarge) confidenceScore += 1;
  if (!signFlip) confidenceScore += 1;

  const confidence: DegradationValidationResult["confidence"] =
    status === "INVALID" ? "LOW" :
    confidenceScore >= 8 ? "HIGH" :
    confidenceScore >= 5 ? "MEDIUM" : "LOW";

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
    // New optional fields
    reason_category: reasonCategory,
    statistical_flags: statisticalFlags,
    plausibility_flags: plausibilityFlags,
    context_flags: contextFlags,
    compound_profile_used: compound,
    t_stat: tStat,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * BATCH VALIDATION
 * ══════════════════════════════════════════════════════════════════ */

export function validateAllDegradationEstimates(
  results: DegradationResult[],
  config: DegradationValidationConfig = DEFAULT_VALIDATION_CONFIG,
): DegradationValidationResult[] {
  return results.map(r => validateDegradationEstimate(r, config));
}

/* ══════════════════════════════════════════════════════════════════
 * FALLBACK SELECTION — Ranked contextual scoring
 * ══════════════════════════════════════════════════════════════════ */

/** Score a candidate for fallback suitability (higher = better) */
function scoreFallbackCandidate(
  candidate: DegradationValidationResult,
  targetCompound: string,
  targetDriverNumber: number,
  targetLapsUsed: number,
): number {
  let score = 0;

  // Same driver bonus
  if (candidate.original.driverNumber === targetDriverNumber) score += 20;

  // Same compound bonus
  if (candidate.original.compound?.toUpperCase() === targetCompound.toUpperCase()) score += 40;

  // Status bonus
  if (candidate.status === "VALID") score += 15;
  else if (candidate.status === "NEUTRAL") score += 5;

  // Confidence bonus
  if (candidate.confidence === "HIGH") score += 10;
  else if (candidate.confidence === "MEDIUM") score += 5;

  // Fit quality bonus
  if (candidate.fit_quality === "GOOD") score += 8;
  else if (candidate.fit_quality === "ACCEPTABLE") score += 4;

  // Stint length similarity (penalize large differences)
  const lapsDiff = Math.abs(candidate.original.lapsUsed - targetLapsUsed);
  score -= Math.min(lapsDiff * 1.5, 15);

  return score;
}

export function selectDegradationFallback(
  invalidResult: DegradationValidationResult,
  allValidated: DegradationValidationResult[],
  config: DegradationValidationConfig = DEFAULT_VALIDATION_CONFIG,
): { slope: number; description: string } {
  const compound = invalidResult.original.compound?.toUpperCase() ?? "UNKNOWN";
  const driverNumber = invalidResult.original.driverNumber;
  const lapsUsed = invalidResult.original.lapsUsed;
  const profile = getProfile(compound, config);

  // Collect all usable candidates (VALID or NEUTRAL, not the same stint)
  const candidates = allValidated
    .filter(v =>
      (v.status === "VALID" || v.status === "NEUTRAL") &&
      v.original.stint !== invalidResult.original.stint &&
      v.effective_slope > 0
    )
    .map(v => ({
      validation: v,
      score: scoreFallbackCandidate(v, compound, driverNumber, lapsUsed),
    }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    const best = candidates[0];
    const v = best.validation;
    const sameDriver = v.original.driverNumber === driverNumber;
    const sameCompound = v.original.compound?.toUpperCase() === compound;

    let desc = `Fallback da ${sameDriver ? "stesso pilota" : v.original.acronym}`;
    desc += ` stint ${v.original.stint}`;
    desc += sameCompound ? ` stesso compound` : ` (${v.original.compound})`;
    desc += ` — ${v.effective_slope.toFixed(3)} s/giro`;
    desc += ` (score ${best.score.toFixed(0)}, ${v.confidence} confidence)`;

    return { slope: v.effective_slope, description: desc };
  }

  // No viable candidate → compound-specific fallback
  return {
    slope: profile.neutral_fallback_slope,
    description: `Nessun riferimento credibile — fallback conservativo ${compound} (${profile.neutral_fallback_slope} s/giro)`,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * RESOLVE FOR STRATEGY
 * ══════════════════════════════════════════════════════════════════ */

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
