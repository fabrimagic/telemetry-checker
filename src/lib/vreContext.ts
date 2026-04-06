/**
 * VRE Integrated Strategy Context
 * 
 * Orchestration layer that collects outputs from all existing analytical modules
 * and normalizes them into a unified strategy context for the Virtual Race Engineer.
 * 
 * Modules integrated:
 * - Tyre degradation (already in VRE engine)
 * - Weather classification (already in VRE engine)
 * - Track status / flags (already in VRE engine)
 * - Race diary events (new)
 * - Cumulative deviation (new)
 * - Battle detection (new)
 * - Traffic predictor (already in VRE engine)
 * - Race phase awareness (already in VRE engine)
 * - Risk appetite mode (already in VRE engine)
 * 
 * Anti-hallucination: This module only surfaces data that is actually available.
 * Missing modules produce explicit fallback values and lower confidence.
 */

import type { DiaryEvent, BattleType } from "./raceDiary";
import type { DriverCumulativeDeviation, CumulativeDeviationResult } from "./cumulativeDeviation";
import type { WeatherCondition } from "./weatherClassification";
import type { TrackStatus } from "./trackStatusClassification";
import type { RiskMode } from "./riskAppetite";
import type { DegradationStatus } from "./degradationValidation";
import type { TrafficLevel } from "./trafficPredictor";

/* ── Battle Context ── */

export interface BattleEpisodeSummary {
  startLap: number;
  endLap: number;
  battleType: BattleType;
  opponent: string;
  minGap: number;
  durationSeconds: number;
}

export interface BattleContext {
  total_episodes: number;
  total_battle_laps: number;
  attacking_episodes: number;
  defending_episodes: number;
  longest_episode: BattleEpisodeSummary | null;
  episodes: BattleEpisodeSummary[];
  /** Laps where the driver was in a battle */
  battle_laps: Set<number>;
}

/* ── Weather Context ── */

export interface WeatherContext {
  wet_laps: number;
  mixed_laps: number;
  dry_laps: number;
  had_weather_change: boolean;
  /** First lap where weather changed from dry */
  first_non_dry_lap: number | null;
}

/* ── Track Status Context ── */

export interface TrackStatusContext {
  sc_laps: number;
  vsc_laps: number;
  red_laps: number;
  yellow_laps: number;
  total_neutralized_laps: number;
  /** Lap numbers under neutralization */
  neutralized_laps: number[];
  had_safety_car: boolean;
  had_vsc: boolean;
  had_red_flag: boolean;
}

/* ── Cumulative Deviation Context ── */

export interface CumulativeDeviationContext {
  available: boolean;
  driver_final_delta: number | null;
  /** Lap where cumulative deviation started consistently increasing (loss) */
  loss_trend_start_lap: number | null;
  /** Max cumulative deviation observed */
  max_deviation: number | null;
  /** Lap of max deviation */
  max_deviation_lap: number | null;
  winner_code: string | null;
}

/* ── Diary Context ── */

export interface DiaryContext {
  total_events: number;
  overtakes_done: number;
  overtakes_received: number;
  pit_events: number;
  race_control_events: number;
  /** Key diary events relevant to strategy (pit stops, position changes near pit laps) */
  strategy_relevant_events: { lap: number; description: string }[];
}

/* ── Traffic Summary ── */

export interface TrafficSummary {
  total_predictions: number;
  worst_level: TrafficLevel;
  avg_time_loss: number;
  has_pack_risk: boolean;
  has_low_confidence: boolean;
}

/* ── Degradation Validation Summary ── */

export interface DegradationValidationSummary {
  total_stints: number;
  valid_count: number;
  neutral_count: number;
  invalid_count: number;
  overall_quality: "GOOD" | "MIXED" | "POOR";
  has_custom_override: boolean;
}

/* ── Pace Loss Summary ── */

export interface PaceLossSummary {
  stints_analyzed: number;
  stints_usable: number;
  has_cliff_risk: boolean;
  has_high_loss: boolean;
  worst_status: string | null;
}

/* ── Unified Strategy Context ── */

export interface IntegratedStrategyContext {
  battle_context: BattleContext | null;
  weather_context: WeatherContext | null;
  track_status_context: TrackStatusContext | null;
  cumulative_deviation_context: CumulativeDeviationContext | null;
  diary_context: DiaryContext | null;
  /** Traffic prediction summary for candidate pit laps */
  traffic_summary: TrafficSummary | null;
  /** Degradation validation quality summary */
  degradation_summary: DegradationValidationSummary | null;
  /** Pace loss from cumulative deviation summary */
  pace_loss_summary: PaceLossSummary | null;
  /** Active risk mode */
  risk_mode: RiskMode | null;
  /** Factors that reduce confidence due to missing data */
  data_gaps: string[];
}

/* ── Builder functions ── */

export function buildBattleContext(diaryEvents: DiaryEvent[]): BattleContext | null {
  const battles = diaryEvents.filter(e => e.type === "BATTLE");
  if (battles.length === 0) return null;

  const episodes: BattleEpisodeSummary[] = battles.map(e => ({
    startLap: e.details.startLap ?? e.lapNumber ?? 0,
    endLap: e.details.endLap ?? e.lapNumber ?? 0,
    battleType: e.details.battleType ?? "BOTH",
    opponent: e.details.battleType === "DEFENDING" 
      ? (e.details.driverBehind ?? "?")
      : (e.details.driverAhead ?? "?"),
    minGap: e.details.minGap ?? 0,
    durationSeconds: e.details.durationSeconds ?? 0,
  }));

  const battleLaps = new Set<number>();
  for (const ep of episodes) {
    for (let l = ep.startLap; l <= ep.endLap; l++) {
      battleLaps.add(l);
    }
  }

  const longest = episodes.reduce((best, ep) =>
    ep.durationSeconds > (best?.durationSeconds ?? 0) ? ep : best,
    null as BattleEpisodeSummary | null
  );

  return {
    total_episodes: episodes.length,
    total_battle_laps: battleLaps.size,
    attacking_episodes: episodes.filter(e => e.battleType === "ATTACKING" || e.battleType === "BOTH").length,
    defending_episodes: episodes.filter(e => e.battleType === "DEFENDING" || e.battleType === "BOTH").length,
    longest_episode: longest,
    episodes,
    battle_laps: battleLaps,
  };
}

export function buildWeatherContext(weatherMap: Map<number, WeatherCondition>): WeatherContext {
  let wet = 0, mixed = 0, dry = 0;
  let firstNonDry: number | null = null;
  for (const [lap, cond] of weatherMap) {
    if (cond === "WET") { wet++; if (firstNonDry === null) firstNonDry = lap; }
    else if (cond === "MIXED") { mixed++; if (firstNonDry === null) firstNonDry = lap; }
    else dry++;
  }
  return {
    wet_laps: wet,
    mixed_laps: mixed,
    dry_laps: dry,
    had_weather_change: wet > 0 || mixed > 0,
    first_non_dry_lap: firstNonDry,
  };
}

export function buildTrackStatusContext(trackStatusMap: Map<number, TrackStatus>): TrackStatusContext {
  let sc = 0, vsc = 0, red = 0, yellow = 0;
  const neutralized: number[] = [];
  for (const [lap, status] of trackStatusMap) {
    if (status === "SC") { sc++; neutralized.push(lap); }
    else if (status === "VSC") { vsc++; neutralized.push(lap); }
    else if (status === "RED") { red++; neutralized.push(lap); }
    else if (status === "YELLOW" || status === "DOUBLE_YELLOW" || status === "MIXED") { yellow++; }
  }
  return {
    sc_laps: sc,
    vsc_laps: vsc,
    red_laps: red,
    yellow_laps: yellow,
    total_neutralized_laps: neutralized.length,
    neutralized_laps: neutralized.sort((a, b) => a - b),
    had_safety_car: sc > 0,
    had_vsc: vsc > 0,
    had_red_flag: red > 0,
  };
}

export function buildCumulativeDeviationContext(
  cumDevResult: CumulativeDeviationResult | null,
  driverNumber: number,
): CumulativeDeviationContext {
  if (!cumDevResult || cumDevResult.error || cumDevResult.drivers.length === 0) {
    return { available: false, driver_final_delta: null, loss_trend_start_lap: null, max_deviation: null, max_deviation_lap: null, winner_code: null };
  }

  const driverData = cumDevResult.drivers.find(d => d.driver_number === driverNumber);
  if (!driverData || driverData.laps.length === 0) {
    return { available: false, driver_final_delta: null, loss_trend_start_lap: null, max_deviation: null, max_deviation_lap: null, winner_code: cumDevResult.winner_driver_code };
  }

  // Find where cumulative deviation started consistently increasing
  let lossTrendStart: number | null = null;
  let maxDev = 0;
  let maxDevLap: number | null = null;
  
  for (const lap of driverData.laps) {
    if (lap.cumulative_delta > maxDev) {
      maxDev = lap.cumulative_delta;
      maxDevLap = lap.lap_number;
    }
  }

  // Detect consistent loss trend: 3+ consecutive laps with positive delta
  let consecutive = 0;
  for (const lap of driverData.laps) {
    if (lap.delta_lap > 0) {
      consecutive++;
      if (consecutive >= 3 && lossTrendStart === null) {
        lossTrendStart = lap.lap_number - 2;
      }
    } else {
      consecutive = 0;
    }
  }

  return {
    available: true,
    driver_final_delta: driverData.final_cumulative_delta,
    loss_trend_start_lap: lossTrendStart,
    max_deviation: maxDev > 0 ? Math.round(maxDev * 10) / 10 : null,
    max_deviation_lap: maxDevLap,
    winner_code: cumDevResult.winner_driver_code,
  };
}

export function buildDiaryContext(diaryEvents: DiaryEvent[], pitLaps: number[]): DiaryContext {
  const overtakesDone = diaryEvents.filter(e => e.type === "OVERTAKE_DONE").length;
  const overtakesReceived = diaryEvents.filter(e => e.type === "OVERTAKE_RECEIVED").length;
  const pitEvents = diaryEvents.filter(e => e.type === "PIT_STOP").length;
  const rcEvents = diaryEvents.filter(e => e.type === "RACE_CONTROL").length;

  // Find strategy-relevant events: position changes near pit stops, track-wide flags
  const strategyRelevant: { lap: number; description: string }[] = [];
  
  for (const e of diaryEvents) {
    if (e.lapNumber == null) continue;
    
    // Position changes near pit stops (±2 laps)
    const nearPit = pitLaps.some(pl => Math.abs(e.lapNumber! - pl) <= 2);
    
    if (e.type === "OVERTAKE_RECEIVED" && nearPit) {
      strategyRelevant.push({ lap: e.lapNumber, description: `Posizione persa prima/dopo pit: ${e.description}` });
    } else if (e.type === "OVERTAKE_DONE" && nearPit) {
      strategyRelevant.push({ lap: e.lapNumber, description: `Sorpasso vicino al pit: ${e.description}` });
    } else if (e.type === "RACE_CONTROL" && e.details.flag) {
      strategyRelevant.push({ lap: e.lapNumber, description: e.description });
    }
  }

  return {
    total_events: diaryEvents.length,
    overtakes_done: overtakesDone,
    overtakes_received: overtakesReceived,
    pit_events: pitEvents,
    race_control_events: rcEvents,
    strategy_relevant_events: strategyRelevant.slice(0, 10), // cap to avoid noise
  };
}

/**
 * Build the full integrated strategy context from all available modules.
 * Missing modules produce null values and add entries to data_gaps.
 */
export function buildIntegratedContext(
  diaryEvents: DiaryEvent[] | null,
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  cumDevResult: CumulativeDeviationResult | null,
  driverNumber: number,
  pitLaps: number[],
): IntegratedStrategyContext {
  const dataGaps: string[] = [];

  const battleCtx = diaryEvents ? buildBattleContext(diaryEvents) : null;
  if (!battleCtx) dataGaps.push("Battle detection non disponibile");

  const weatherCtx = buildWeatherContext(weatherMap);
  const trackStatusCtx = buildTrackStatusContext(trackStatusMap);
  
  const cumDevCtx = buildCumulativeDeviationContext(cumDevResult, driverNumber);
  if (!cumDevCtx.available) dataGaps.push("Deviazione cumulativa non disponibile");

  const diaryCtx = diaryEvents ? buildDiaryContext(diaryEvents, pitLaps) : null;
  if (!diaryCtx) dataGaps.push("Diario di gara non disponibile");

  return {
    battle_context: battleCtx,
    weather_context: weatherCtx,
    track_status_context: trackStatusCtx,
    cumulative_deviation_context: cumDevCtx,
    diary_context: diaryCtx,
    race_phase_summary: null,
    traffic_summary: null,
    degradation_summary: null,
    pace_loss_summary: null,
    risk_mode: null,
    data_gaps: dataGaps,
  };
}

/**
 * Enrich an existing IntegratedStrategyContext with summary references
 * from already-computed modules. No recalculation — pure aggregation.
 */
export function enrichIntegratedContext(
  ctx: IntegratedStrategyContext,
  racePhase: RacePhaseSummary | null,
  trafficSummary: TrafficSummary | null,
  degradationSummary: DegradationValidationSummary | null,
  paceLossSummary: PaceLossSummary | null,
  riskMode: RiskMode | null,
): IntegratedStrategyContext {
  return {
    ...ctx,
    race_phase_summary: racePhase,
    traffic_summary: trafficSummary,
    degradation_summary: degradationSummary,
    pace_loss_summary: paceLossSummary,
    risk_mode: riskMode,
  };
}
