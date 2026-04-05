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
  const normalized = compound.toUpperCase();
  const config = TYRE_WARMUP_CONFIG[normalized];
  if (!config) return 0;
  if (lapAfterPit < 0 || lapAfterPit >= config.laps_affected) return 0;

  return config.base_penalty * Math.exp(-lapAfterPit / config.decay);
}

/**
 * Compute total warmup time lost for an entire stint.
 * 
 * @param compound - Tyre compound
 * @param isFirstStint - If true, no warmup applies (race start, tyres already warm from formation lap)
 * @returns total warmup penalty in seconds for the stint
 */
export function computeStintWarmupCost(compound: string, isFirstStint: boolean): number {
  if (isFirstStint) return 0;

  const normalized = compound.toUpperCase();
  const config = TYRE_WARMUP_CONFIG[normalized];
  if (!config) return 0;

  let total = 0;
  for (let i = 0; i < config.laps_affected; i++) {
    total += config.base_penalty * Math.exp(-i / config.decay);
  }
  return total;
}
