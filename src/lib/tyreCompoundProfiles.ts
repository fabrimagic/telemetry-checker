/**
 * Canonical Tyre Compound Profiles
 * ─────────────────────────────────
 * Single source of truth for SOFT / MEDIUM / HARD compound parameters used by:
 *  - tyreDegradation.ts          → filtering + cliff detection
 *  - correctedDegradation.ts     → filtering + multivariate correction limits
 *  - degradationValidation.ts    → validation thresholds
 *
 * The three downstream modules continue to expose their own domain-specific
 * profile shapes, derived from this canonical structure. This is a PURELY
 * STRUCTURAL refactor — values are bit-identical to those previously hard-coded
 * in each module.
 */

export interface CanonicalCompoundProfile {
  /** Filtering & outlier detection (used by tyreDegradation + correctedDegradation) */
  filtering: {
    warmupExclusionLaps: number;
    madMultiplier: number;
    minCoreLapsTechnical: number;
    /** Used only by tyreDegradation today; kept here for extensibility. */
    minCoreLapsReliable: number;
  };
  /** Cliff detection (used by tyreDegradation only) */
  cliff: {
    residualMultiplier: number;
    minConsecutive: number;
    worseningThreshold: number;
  };
  /** Multivariate correction limits (used by correctedDegradation) */
  correction: {
    maxCorrectionMagnitude: number;
  };
  /** Validation thresholds (used by degradationValidation) */
  validation: {
    negative_tolerance: number;
    neutral_tolerance: number;
    max_plausible_slope: number;
    neutral_fallback_slope: number;
    min_laps_invalid: number;
    min_laps_valid: number;
    min_r_squared: number;
    max_correction_ratio: number;
    /** Optional: present only when the t-stat significance check is configured. */
    min_t_stat_valid?: number;
    /**
     * Threshold of |corrected − raw| above which a sign flip is considered "large"
     * → cap to NEUTRAL regardless of stint length. Set as ~50% of max_plausible_slope
     * for each compound: a correction that flips the sign AND moves the slope by more
     * than half the plausible range is a strong overfitting signal.
     */
    sign_flip_large_correction_threshold: number;
  };
}

export const CANONICAL_COMPOUND_PROFILES: Record<"SOFT" | "MEDIUM" | "HARD", CanonicalCompoundProfile> = {
  SOFT: {
    filtering: {
      warmupExclusionLaps: 1,
      madMultiplier: 3.0,
      minCoreLapsTechnical: 3,
      minCoreLapsReliable: 6,
    },
    cliff: {
      residualMultiplier: 1.8,
      minConsecutive: 1,
      worseningThreshold: 0.3,
    },
    correction: {
      maxCorrectionMagnitude: 0.15,
    },
    validation: {
      negative_tolerance: -0.01,
      neutral_tolerance: 0.015,
      max_plausible_slope: 0.25,
      neutral_fallback_slope: 0.05,
      min_laps_invalid: 3,
      min_laps_valid: 5,
      min_r_squared: 0.25,
      max_correction_ratio: 3.0,
      min_t_stat_valid: 2.0,
    },
  },
  MEDIUM: {
    filtering: {
      warmupExclusionLaps: 1,
      madMultiplier: 3.0,
      minCoreLapsTechnical: 3,
      minCoreLapsReliable: 6,
    },
    cliff: {
      residualMultiplier: 2.0,
      minConsecutive: 2,
      worseningThreshold: 0.4,
    },
    correction: {
      maxCorrectionMagnitude: 0.12,
    },
    validation: {
      negative_tolerance: -0.02,
      neutral_tolerance: 0.01,
      max_plausible_slope: 0.20,
      neutral_fallback_slope: 0.035,
      min_laps_invalid: 4,
      min_laps_valid: 6,
      min_r_squared: 0.25,
      max_correction_ratio: 3.0,
      min_t_stat_valid: 2.0,
    },
  },
  HARD: {
    filtering: {
      warmupExclusionLaps: 2,
      madMultiplier: 3.5,
      minCoreLapsTechnical: 4,
      minCoreLapsReliable: 7,
    },
    cliff: {
      residualMultiplier: 2.2,
      minConsecutive: 2,
      worseningThreshold: 0.5,
    },
    correction: {
      maxCorrectionMagnitude: 0.10,
    },
    validation: {
      negative_tolerance: -0.025,
      neutral_tolerance: 0.008,
      max_plausible_slope: 0.15,
      neutral_fallback_slope: 0.025,
      min_laps_invalid: 5,
      min_laps_valid: 7,
      min_r_squared: 0.30,
      max_correction_ratio: 2.5,
      min_t_stat_valid: 2.0,
    },
  },
};

/**
 * Default fallback used when a compound is unknown / unavailable.
 * - filtering + cliff: mirror tyreDegradation.ts DEFAULT_PROFILE
 * - correction: mirrors correctedDegradation.ts DEFAULT_CORRECTED_COMPOUND
 * - validation: mirrors DEFAULT_VALIDATION_CONFIG global fallback
 */
export const CANONICAL_DEFAULT_COMPOUND: CanonicalCompoundProfile = {
  filtering: {
    warmupExclusionLaps: 1,
    madMultiplier: 3.0,
    minCoreLapsTechnical: 3,
    minCoreLapsReliable: 6,
  },
  cliff: {
    residualMultiplier: 2.0,
    minConsecutive: 2,
    worseningThreshold: 0.4,
  },
  correction: {
    maxCorrectionMagnitude: 0.12,
  },
  validation: {
    negative_tolerance: -0.02,
    neutral_tolerance: 0.01,
    max_plausible_slope: 0.30,
    neutral_fallback_slope: 0.03,
    min_laps_invalid: 4,
    min_laps_valid: 6,
    min_r_squared: 0.25,
    max_correction_ratio: 3.0,
    min_t_stat_valid: 2.0,
  },
};

export function getCanonicalProfile(compound: string | null | undefined): CanonicalCompoundProfile {
  if (!compound) return CANONICAL_DEFAULT_COMPOUND;
  const key = compound.toUpperCase() as "SOFT" | "MEDIUM" | "HARD";
  return CANONICAL_COMPOUND_PROFILES[key] ?? CANONICAL_DEFAULT_COMPOUND;
}
