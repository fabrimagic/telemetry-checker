/**
 * Stint Pace Loss Analysis
 *
 * Derives per-stint pace loss rate from cumulative deviation data.
 * Used as an AUXILIARY indicator in the VRE — NOT a direct tyre degradation measure.
 *
 * Anti-hallucination principles:
 * - Does not treat pace loss as pure tyre degradation
 * - Flags contamination from traffic, battles, weather, neutralizations
 * - Classifies reliability explicitly
 * - Returns UNRELIABLE when data is contaminated
 */

import type { DriverCumulativeDeviation, LapDeviation } from "./cumulativeDeviation";
import type { BattleContext } from "./vreContext";
import type { WeatherCondition } from "./weatherClassification";
import type { TrackStatus } from "./trackStatusClassification";
import type { StintData } from "./openf1";

/* ── Configuration ── */

export interface PaceLossConfig {
  /** Number of laps at stint start for baseline (default 3) */
  start_window: number;
  /** Number of laps at stint end for comparison (default 3) */
  end_window: number;
  /** Min valid laps in a stint to compute pace loss (default 6) */
  min_stint_laps: number;
  /** Threshold: pace_loss_rate <= this → STABLE */
  stable_threshold: number;
  /** Threshold: pace_loss_rate <= this → NORMAL_LOSS */
  normal_loss_threshold: number;
  /** Threshold: pace_loss_rate <= this → HIGH_LOSS */
  high_loss_threshold: number;
  /** Threshold: pace_loss_rate > this → CLIFF_RISK */
  cliff_threshold: number;
  /** Max fraction of contaminated laps before UNRELIABLE (default 0.5) */
  max_contamination_ratio: number;
}

export const DEFAULT_PACE_LOSS_CONFIG: PaceLossConfig = {
  start_window: 3,
  end_window: 3,
  min_stint_laps: 6,
  stable_threshold: 0.03,
  normal_loss_threshold: 0.10,
  high_loss_threshold: 0.20,
  cliff_threshold: 0.30,
  max_contamination_ratio: 0.5,
};

/* ── Types ── */

export type PaceLossStatus = "STABLE" | "NORMAL_LOSS" | "HIGH_LOSS" | "CLIFF_RISK" | "UNRELIABLE";

export interface PaceLossContaminationFlags {
  traffic: boolean;
  weather: boolean;
  neutralization: boolean;
  battle: boolean;
  /**
   * True when at least one lap in the stint was identified as a
   * lapped-traffic encounter by `lappedTraffic.ts`. Additive, optional
   * upstream: when the encounter set isn't provided, this stays `false`
   * and behavior is identical to the pre-change baseline.
   */
  lapped_traffic: boolean;
}

export type PaceLossConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface StintPaceLossResult {
  stint_number: number;
  stint_pace_loss_rate: number | null;
  pace_loss_status: PaceLossStatus;
  pace_loss_used_for_strategy: boolean;
  pace_loss_reason: string;
  pace_loss_confidence: PaceLossConfidence;
  pace_loss_contamination_flags: PaceLossContaminationFlags;
  valid_laps_used: number;
  contaminated_laps_count: number;
}

/* ── Core functions ── */

/**
 * Extract laps from cumulative deviation data that fall within a stint.
 */
function extractStintLaps(
  driverDev: DriverCumulativeDeviation,
  stint: StintData,
): LapDeviation[] {
  return driverDev.laps.filter(
    (l) => l.lap_number >= stint.lap_start && l.lap_number <= stint.lap_end,
  );
}

/**
 * Identify contaminated laps within a stint.
 */
function identifyContaminatedLaps(
  stintLapNumbers: number[],
  battleContext: BattleContext | null,
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  lappedTrafficEncounterLaps: Set<number> | null = null,
): { contaminated: Set<number>; flags: PaceLossContaminationFlags } {
  const contaminated = new Set<number>();
  const flags: PaceLossContaminationFlags = {
    traffic: false,
    weather: false,
    neutralization: false,
    battle: false,
    lapped_traffic: false,
  };

  for (const lap of stintLapNumbers) {
    // Weather contamination
    const wc = weatherMap.get(lap);
    if (wc === "WET" || wc === "MIXED") {
      contaminated.add(lap);
      flags.weather = true;
    }

    // Neutralization contamination
    const ts = trackStatusMap.get(lap);
    if (ts && ts !== "GREEN") {
      contaminated.add(lap);
      flags.neutralization = true;
    }

    // Battle contamination
    if (battleContext?.battle_laps.has(lap)) {
      contaminated.add(lap);
      flags.battle = true;
    }

    // Lapped-traffic contamination (additive; null = disabled → identical to legacy behavior)
    if (lappedTrafficEncounterLaps && lappedTrafficEncounterLaps.has(lap)) {
      contaminated.add(lap);
      flags.lapped_traffic = true;
    }
  }

  // If battles present, also flag traffic (battles imply dirty air)
  if (flags.battle) {
    flags.traffic = true;
  }

  return { contaminated, flags };
}

/**
 * Calculate pace loss rate for a single stint.
 *
 * Uses delta_lap values from cumulative deviation (not cumulative_delta).
 * Compares mean delta of first N laps vs last N laps of the stint.
 * Excludes contaminated laps from calculation windows.
 */
export function calculateStintPaceLossRate(
  stintLaps: LapDeviation[],
  contaminatedLaps: Set<number>,
  config: PaceLossConfig = DEFAULT_PACE_LOSS_CONFIG,
): { rate: number | null; validCount: number } {
  // Filter to clean laps only
  const cleanLaps = stintLaps.filter((l) => !contaminatedLaps.has(l.lap_number));

  if (cleanLaps.length < config.min_stint_laps) {
    return { rate: null, validCount: cleanLaps.length };
  }

  // Sort by lap number
  const sorted = [...cleanLaps].sort((a, b) => a.lap_number - b.lap_number);

  // Extract start and end windows
  const startWindow = sorted.slice(0, Math.min(config.start_window, Math.floor(sorted.length / 2)));
  const endWindow = sorted.slice(-Math.min(config.end_window, Math.floor(sorted.length / 2)));

  if (startWindow.length === 0 || endWindow.length === 0) {
    return { rate: null, validCount: cleanLaps.length };
  }

  const meanStart = startWindow.reduce((s, l) => s + l.delta_lap, 0) / startWindow.length;
  const meanEnd = endWindow.reduce((s, l) => s + l.delta_lap, 0) / endWindow.length;

  // Pace loss = how much slower the end window is compared to start window
  const rate = meanEnd - meanStart;

  return { rate: Math.round(rate * 1000) / 1000, validCount: cleanLaps.length };
}

/**
 * Classify pace loss rate into a status category.
 */
export function classifyPaceLossRate(
  rate: number | null,
  contaminationRatio: number,
  config: PaceLossConfig = DEFAULT_PACE_LOSS_CONFIG,
): PaceLossStatus {
  if (rate == null) return "UNRELIABLE";
  if (contaminationRatio > config.max_contamination_ratio) return "UNRELIABLE";
  if (rate < 0) return "STABLE"; // Improving pace
  if (rate <= config.stable_threshold) return "STABLE";
  if (rate <= config.normal_loss_threshold) return "NORMAL_LOSS";
  if (rate <= config.cliff_threshold) return "HIGH_LOSS";
  return "CLIFF_RISK";
}

/**
 * Evaluate reliability and confidence of pace loss metric.
 */
function evaluateConfidence(
  status: PaceLossStatus,
  contaminationFlags: PaceLossContaminationFlags,
  contaminationRatio: number,
  validLaps: number,
  config: PaceLossConfig,
): PaceLossConfidence {
  if (status === "UNRELIABLE") return "LOW";

  let score = 3; // Start at HIGH

  // Reduce for contamination
  if (contaminationRatio > 0.3) score -= 1;
  if (contaminationRatio > 0.15) score -= 1;

  // Reduce for too few laps
  if (validLaps < config.min_stint_laps + 2) score -= 1;

  // Reduce if multiple contamination sources
  const flagCount = [contaminationFlags.traffic, contaminationFlags.weather,
    contaminationFlags.neutralization, contaminationFlags.battle].filter(Boolean).length;
  if (flagCount >= 2) score -= 1;

  if (score >= 3) return "HIGH";
  if (score >= 2) return "MEDIUM";
  return "LOW";
}

/**
 * Build reason string for the pace loss result.
 */
function buildReason(
  status: PaceLossStatus,
  rate: number | null,
  flags: PaceLossContaminationFlags,
): string {
  if (status === "UNRELIABLE") {
    const reasons: string[] = [];
    if (flags.battle) reasons.push("battaglie");
    if (flags.weather) reasons.push("meteo");
    if (flags.neutralization) reasons.push("neutralizzazioni");
    if (flags.traffic) reasons.push("traffico");
    return reasons.length > 0
      ? `Metrica non affidabile per contaminazione da ${reasons.join(", ")}`
      : "Dati insufficienti per calcolare la perdita di passo";
  }
  if (status === "STABLE") {
    return rate != null && rate < 0
      ? "Passo in miglioramento nello stint — nessun segnale di degrado"
      : "Passo stabile nello stint rispetto al riferimento";
  }
  if (status === "NORMAL_LOSS") {
    return "Perdita di passo moderata nello stint, coerente con degrado normale";
  }
  if (status === "HIGH_LOSS") {
    return "Perdita di passo significativa negli ultimi giri dello stint rispetto al riferimento";
  }
  if (status === "CLIFF_RISK") {
    return "Perdita di passo critica: possibile segnale di tyre cliff o forte calo prestazionale";
  }
  return "";
}

/**
 * Main entry: compute pace loss analysis for all stints of a driver.
 */
export function computeAllStintPaceLoss(
  driverDev: DriverCumulativeDeviation | null,
  stints: StintData[],
  battleContext: BattleContext | null,
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  config: PaceLossConfig = DEFAULT_PACE_LOSS_CONFIG,
  lappedTrafficEncounterLaps: Set<number> | null = null,
): StintPaceLossResult[] {
  if (!driverDev || driverDev.laps.length === 0) {
    return stints.map((s) => ({
      stint_number: s.stint_number,
      stint_pace_loss_rate: null,
      pace_loss_status: "UNRELIABLE" as PaceLossStatus,
      pace_loss_used_for_strategy: false,
      pace_loss_reason: "Dati deviazione cumulativa non disponibili per questo stint",
      pace_loss_confidence: "LOW" as PaceLossConfidence,
      pace_loss_contamination_flags: { traffic: false, weather: false, neutralization: false, battle: false, lapped_traffic: false },
      valid_laps_used: 0,
      contaminated_laps_count: 0,
    }));
  }

  return stints.map((stint) => {
    const stintLaps = extractStintLaps(driverDev, stint);
    const lapNumbers = stintLaps.map((l) => l.lap_number);
    const { contaminated, flags } = identifyContaminatedLaps(
      lapNumbers, battleContext, weatherMap, trackStatusMap, lappedTrafficEncounterLaps,
    );

    const contaminationRatio = stintLaps.length > 0
      ? contaminated.size / stintLaps.length
      : 0;

    const { rate, validCount } = calculateStintPaceLossRate(stintLaps, contaminated, config);
    const status = classifyPaceLossRate(rate, contaminationRatio, config);
    const confidence = evaluateConfidence(status, flags, contaminationRatio, validCount, config);
    const reason = buildReason(status, rate, flags);

    // Determine if this should be used for strategy
    const usedForStrategy = status !== "UNRELIABLE" && confidence !== "LOW" && rate != null;

    return {
      stint_number: stint.stint_number,
      stint_pace_loss_rate: rate,
      pace_loss_status: status,
      pace_loss_used_for_strategy: usedForStrategy,
      pace_loss_reason: reason,
      pace_loss_confidence: confidence,
      pace_loss_contamination_flags: flags,
      valid_laps_used: validCount,
      contaminated_laps_count: contaminated.size,
    };
  });
}

/* ── Strategy integration helpers ── */

/**
 * Compute a degradation multiplier adjustment based on pace loss analysis.
 * Returns a value >= 1.0 that can be used to increase degradation weight
 * in the strategy cost function when pace loss indicates worse conditions
 * than the degradation model alone predicts.
 *
 * Returns 1.0 (no adjustment) when pace loss is stable, unreliable, or unused.
 */
export function paceLossDegradationAdjustment(
  paceLossResults: StintPaceLossResult[],
): number {
  const usable = paceLossResults.filter((r) => r.pace_loss_used_for_strategy && r.stint_pace_loss_rate != null);
  if (usable.length === 0) return 1.0;

  // Use the worst stint's pace loss to derive an adjustment
  const worstRate = Math.max(...usable.map((r) => r.stint_pace_loss_rate!));

  if (worstRate <= 0.03) return 1.0;      // STABLE — no adjustment
  if (worstRate <= 0.10) return 1.02;      // NORMAL_LOSS — minimal
  if (worstRate <= 0.20) return 1.06;      // HIGH_LOSS — moderate increase
  if (worstRate <= 0.30) return 1.12;      // approaching CLIFF
  return 1.18;                              // CLIFF_RISK — significant
}

/**
 * Compute a cliff penalty multiplier based on pace loss.
 * When pace loss indicates cliff risk, increase the cliff penalty
 * applied to long stints.
 */
export function paceLossCliffMultiplier(
  paceLossResults: StintPaceLossResult[],
): number {
  const hasCliffRisk = paceLossResults.some(
    (r) => r.pace_loss_used_for_strategy && r.pace_loss_status === "CLIFF_RISK",
  );
  const hasHighLoss = paceLossResults.some(
    (r) => r.pace_loss_used_for_strategy && r.pace_loss_status === "HIGH_LOSS",
  );

  if (hasCliffRisk) return 1.5;
  if (hasHighLoss) return 1.2;
  return 1.0;
}

/**
 * Compute pit urgency adjustment based on pace loss in the current (last) stint.
 * Positive value = more urgent (earlier pit recommended).
 * Returns laps to shift the pit window earlier.
 */
export function paceLossPitUrgencyShift(
  paceLossResults: StintPaceLossResult[],
): number {
  if (paceLossResults.length === 0) return 0;
  const lastStint = paceLossResults[paceLossResults.length - 1];
  if (!lastStint.pace_loss_used_for_strategy || lastStint.stint_pace_loss_rate == null) return 0;

  if (lastStint.pace_loss_status === "CLIFF_RISK") return -3;
  if (lastStint.pace_loss_status === "HIGH_LOSS") return -2;
  if (lastStint.pace_loss_status === "NORMAL_LOSS") return -1;
  return 0;
}
