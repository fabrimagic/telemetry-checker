/**
 * Tyre Warmup Model
 * 
 * Simulates the temporary lap time penalty in the first laps after a pit stop,
 * due to tyres not being at optimal operating temperature.
 * 
 * Model: warmup_penalty(lap_after_pit) = base_penalty * exp(-lap_after_pit / decay)
 * 
 * - lap_after_pit = 0 on the first push lap after pit (out-lap excluded)
 * - Penalty decays exponentially and is zero after laps_affected
 * - This is NOT degradation: it's a temporary thermal effect
 * 
 * Realistic F1 behaviour:
 * - SOFT: fast warmup → small, short penalty
 * - MEDIUM: moderate warmup
 * - HARD: slow warmup → large, multi-lap penalty
 *   (undercut less effective on Hards because of this)
 * 
 * Future extensibility: multiply base_penalty by track_grip_factor or temperature_factor.
 */

export interface TyreWarmupConfig {
  base_penalty: number;   // seconds lost on first push lap
  decay: number;          // exponential decay constant (higher = slower warmup)
  laps_affected: number;  // max laps with penalty
}

export const TYRE_WARMUP_CONFIG: Record<string, TyreWarmupConfig> = {
  SOFT: {
    base_penalty: 0.6,
    decay: 1.2,
    laps_affected: 2,
  },
  MEDIUM: {
    base_penalty: 0.9,
    decay: 1.6,
    laps_affected: 3,
  },
  HARD: {
    base_penalty: 1.4,
    decay: 2.2,
    laps_affected: 4,
  },
};

/**
 * Compute the warmup penalty for a given compound at a given lap after pit.
 * 
 * @param compound - Tyre compound (SOFT, MEDIUM, HARD)
 * @param lapAfterPit - 0-indexed lap after pit (0 = first push lap)
 * @returns penalty in seconds, or 0 if no penalty applies
 */
export function computeTyreWarmupPenalty(compound: string, lapAfterPit: number): number {
  const normalized = (compound ?? "").toUpperCase();
  const config = TYRE_WARMUP_CONFIG[normalized];
  if (!config) return 0;
  if (lapAfterPit < 0 || lapAfterPit >= config.laps_affected) return 0;

  return config.base_penalty * Math.exp(-lapAfterPit / config.decay);
}

/**
 * Fraction of the full post-pit warmup that applies to the FIRST stint
 * (race start). Lower than 1 because the formation lap pre-heats the tyres,
 * but greater than 0 because a single out-lap doesn't bring them fully into
 * window — especially on HARD in cold ambient conditions.
 */
export const START_WARMUP_FRACTION = 0.4;

/**
 * Reference track temperature (°C) at which the temperature factor equals 1.
 * Below it warmup grows, above it shrinks.
 */
export const TEMP_REFERENCE_C = 30;

/**
 * Sensitivity of the temperature factor: each °C away from TEMP_REFERENCE_C
 * shifts the multiplier by this amount (linear, then clamped).
 */
export const TEMP_SENSITIVITY = 0.02;

export const TEMP_FACTOR_MIN = 0.5;
export const TEMP_FACTOR_MAX = 2.0;

/**
 * Compute the temperature factor for start warmup.
 * Returns 1 when trackTempC is undefined.
 * Colder than reference → > 1 (more penalty); hotter → < 1.
 */
export function computeStartWarmupTempFactor(trackTempC?: number): number {
  if (trackTempC == null || !Number.isFinite(trackTempC)) return 1;
  const raw = 1 + (TEMP_REFERENCE_C - trackTempC) * TEMP_SENSITIVITY;
  return Math.max(TEMP_FACTOR_MIN, Math.min(TEMP_FACTOR_MAX, raw));
}

/**
 * Compute the START warmup cost for a stint (race start, after formation lap).
 * Distinct from post-pit warmup: tyres start partly warm but a cold track and
 * a hard compound still cost time in the first laps.
 *
 * = sum(per-lap full warmup penalty) × START_WARMUP_FRACTION × tempFactor
 */
export function computeStartWarmupCost(compound: string, trackTempC?: number): number {
  const normalized = (compound ?? "").toUpperCase();
  const config = TYRE_WARMUP_CONFIG[normalized];
  if (!config) return 0;

  let full = 0;
  for (let i = 0; i < config.laps_affected; i++) {
    full += config.base_penalty * Math.exp(-i / config.decay);
  }
  return full * START_WARMUP_FRACTION * computeStartWarmupTempFactor(trackTempC);
}

/**
 * Start traction / launch penalty by compound (seconds), applied ONCE to the
 * first stint of a strategy (the standing start). Softer compounds give better
 * launch grip and warm into window faster off the line, so SOFT is the
 * reference (0 penalty). Harder starting compounds lose time at the getaway and
 * through the opening lap — an effect DISTINCT from the multi-lap thermal
 * warmup and not otherwise captured by the pure-pace simulation.
 *
 * Scope & honesty note: this is a deliberately MODERATE pure-time penalty
 * (~1-4s after the cold-track factor), reflecting launch + opening-lap pace,
 * NOT the full positional value of a good start (holding/gaining places, which
 * the model treats separately via position_score_adjustment). It nudges the
 * pace delta toward the realistic cost of starting on a harder compound; it is
 * intentionally not large enough to, by itself, flip a strategy ranking on the
 * basis of an implausible multi-second standing-start gap.
 *
 * Scaled by the SAME cold-track factor as warmup (computeStartWarmupTempFactor):
 * the colder the track, the larger the launch disadvantage of a harder compound.
 */
export const START_TRACTION_PENALTY: Record<string, number> = {
  SOFT: 0.0,
  MEDIUM: 1.5,
  HARD: 3.0,
};

export function computeStartTractionPenalty(compound: string, trackTempC?: number): number {
  const base = START_TRACTION_PENALTY[(compound ?? "").toUpperCase()] ?? 0;
  if (base === 0) return 0;
  return base * computeStartWarmupTempFactor(trackTempC);
}


/**
 * Compute total warmup time lost for an entire stint.
 *
 * @param compound - Tyre compound
 * @param isFirstStint - If true, applies the reduced START warmup (not zero).
 * @param trackTempC - Optional track temperature (°C). Only used for the
 *                    first stint; modulates the start warmup penalty.
 * @returns total warmup penalty in seconds for the stint
 */
export function computeStintWarmupCost(
  compound: string,
  isFirstStint: boolean,
  trackTempC?: number,
): number {
  if (isFirstStint) {
    return computeStartWarmupCost(compound, trackTempC);
  }

  const normalized = (compound ?? "").toUpperCase();
  const config = TYRE_WARMUP_CONFIG[normalized];
  if (!config) return 0;

  let total = 0;
  for (let i = 0; i < config.laps_affected; i++) {
    total += config.base_penalty * Math.exp(-i / config.decay);
  }
  return total;
}


