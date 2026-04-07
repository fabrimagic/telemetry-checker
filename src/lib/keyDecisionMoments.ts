/**
 * Key Decision Moments — Decision Point Extraction & Historical Analog Finder
 *
 * Identifies moments during a race where a "pit vs stay out" decision was plausible,
 * builds structured context snapshots, evaluates short-term outcomes, and finds
 * historical analogs from OpenF1 data (max 5 years).
 *
 * Anti-hallucination:
 * - Uses only observed data from existing modules
 * - Never invents events, battles, decisions, or causal relationships
 * - Explicitly flags insufficient data, weak analogs, and low confidence
 * - Correlations are never presented as certainties
 */

import type { Lap, StintData, PitData, WeatherData, RaceControlMessage, IntervalData, PositionData, Driver, SessionInfo } from "./openf1";
import type { WeatherCondition } from "./weatherClassification";
import type { TrackStatus } from "./trackStatusClassification";
import type { TrafficPrediction } from "./trafficPredictor";
import type { StintPaceLossResult } from "./stintPaceLoss";
import type { DegradationValidationResult } from "./degradationValidation";
import type { DiaryEvent } from "./raceDiary";
import type { DriverCumulativeDeviation, LapDeviation } from "./cumulativeDeviation";

/* ══════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════ */

export type DecisionType = "PIT_NOW" | "STAY_OUT" | "MARGINAL";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type AnalogStrength = "STRONG" | "WEAK" | "NONE";

export interface DecisionDriver {
  factor: string;
  direction: "PIT" | "STAY_OUT" | "NEUTRAL";
  weight: "HIGH" | "MEDIUM" | "LOW";
  detail?: string;
}

export interface ContextSnapshot {
  session_key: number;
  driver_number: number;
  driver_acronym: string;
  lap_window: [number, number];
  current_stint_number: number;
  compound: string;
  tyre_age: number;
  degradation_slope: number | null;
  degradation_status: string | null;
  pace_loss_status: string | null;
  pace_loss_rate: number | null;
  battle_active: boolean;
  battle_type: string | null;
  traffic_level: string | null;
  traffic_time_loss: number | null;
  weather_state: string;
  neutralization_state: string;
  track_position: number | null;
  gap_ahead: number | null;
  gap_behind: number | null;
  cumulative_loss_trend: "WORSENING" | "STABLE" | "IMPROVING" | null;
  laps_remaining: number;
}

export interface DecisionOutcome {
  laps_observed: number;
  position_change: number | null;
  pace_delta_vs_before: number | null;
  next_event: string | null;
  outcome_summary: string;
}

export interface HistoricalAnalog {
  session_key: number;
  year: number;
  gp_name: string;
  driver_acronym: string;
  lap_window: [number, number];
  similarity_score: number;
  matching_factors: string[];
  differences: string[];
  decision_taken: DecisionType;
  outcome_summary: string;
  reliability: ConfidenceLevel;
  analog_strength: AnalogStrength;
}

export interface DecisionPoint {
  id: string;
  lap_window: [number, number];
  primary_lap: number;
  decision_type: DecisionType;
  drivers: DecisionDriver[];
  confidence: ConfidenceLevel;
  context: ContextSnapshot;
  real_action: "PIT" | "STAY_OUT";
  real_action_detail: string;
  outcome: DecisionOutcome;
  analogs: HistoricalAnalog[];
  analogs_status: "LOADED" | "LOADING" | "NOT_LOADED" | "NO_DATA" | "ERROR";
  reliability_notes: string[];
}

export interface KeyDecisionMomentsResult {
  decision_points: DecisionPoint[];
  total_points: number;
  data_coverage_years: number;
  warnings: string[];
}

/* ══════════════════════════════════════════════════════════════
   1. Decision Point Extractor
   ══════════════════════════════════════════════════════════════ */

interface ExtractionInput {
  laps: Lap[];
  stints: StintData[];
  pitStops: PitData[];
  weatherMap: Map<number, WeatherCondition>;
  trackStatusMap: Map<number, TrackStatus>;
  trafficAnalysis: TrafficPrediction[];
  paceLossResults: StintPaceLossResult[];
  degradationValidations: DegradationValidationResult[];
  diaryEvents: DiaryEvent[] | null;
  driverCumDev: DriverCumulativeDeviation | null;
  positions: PositionData[];
  intervals: IntervalData[];
  driverNumber: number;
  driverAcronym: string;
  sessionKey: number;
  totalLaps: number;
}

/**
 * Extract decision points from existing VRE data.
 * A decision point is identified when at least one trigger condition is met.
 */
export function extractDecisionPoints(input: ExtractionInput): DecisionPoint[] {
  const {
    laps, stints, pitStops, weatherMap, trackStatusMap,
    trafficAnalysis, paceLossResults, degradationValidations,
    diaryEvents, driverCumDev, positions, intervals,
    driverNumber, driverAcronym, sessionKey, totalLaps,
  } = input;

  const pitLapSet = new Set(pitStops.map(p => p.lap_number));
  const points: DecisionPoint[] = [];
  const processedLaps = new Set<number>();

  // Build cumulative deviation lookup
  const cumDevMap = new Map<number, LapDeviation>();
  if (driverCumDev) {
    for (const ld of driverCumDev.laps) {
      cumDevMap.set(ld.lap_number, ld);
    }
  }

  // Build position/gap lookups
  const positionAtLap = buildPositionLookup(driverNumber, laps, positions);
  const gapLookup = buildGapLookup(driverNumber, laps, intervals);

  // Scan each lap for trigger conditions
  for (let lap = 3; lap <= totalLaps - 2; lap++) {
    if (processedLaps.has(lap)) continue;

    const triggers = evaluateTriggers(
      lap, stints, pitLapSet, weatherMap, trackStatusMap,
      trafficAnalysis, paceLossResults, degradationValidations,
      diaryEvents, cumDevMap, totalLaps,
    );

    if (triggers.length === 0) continue;

    // Create decision window (1-3 laps)
    const windowStart = Math.max(1, lap - 1);
    const windowEnd = Math.min(totalLaps, lap + 1);

    // Mark laps as processed
    for (let l = windowStart; l <= windowEnd; l++) processedLaps.add(l);

    // Build context snapshot
    const context = buildContextSnapshot(
      lap, sessionKey, driverNumber, driverAcronym, stints,
      degradationValidations, paceLossResults, weatherMap, trackStatusMap,
      trafficAnalysis, diaryEvents, cumDevMap, positionAtLap, gapLookup, totalLaps,
    );

    // Determine decision drivers
    const drivers = buildDecisionDrivers(triggers, context);

    // Classify decision type
    const pitDriverCount = drivers.filter(d => d.direction === "PIT").length;
    const stayDriverCount = drivers.filter(d => d.direction === "STAY_OUT").length;
    let decisionType: DecisionType = "MARGINAL";
    if (pitDriverCount >= stayDriverCount + 2) decisionType = "PIT_NOW";
    else if (stayDriverCount >= pitDriverCount + 2) decisionType = "STAY_OUT";

    // Real action
    const pitInWindow = pitStops.find(p => p.lap_number >= windowStart && p.lap_number <= windowEnd + 1);
    const realAction = pitInWindow ? "PIT" as const : "STAY_OUT" as const;
    const realDetail = pitInWindow
      ? `Pit stop al giro ${pitInWindow.lap_number} (corsia: ${pitInWindow.lane_duration.toFixed(1)}s)`
      : `Rimasto in pista (giri ${windowStart}–${windowEnd})`;

    // Compute short-term outcome
    const outcome = computeOutcome(lap, realAction, laps, positionAtLap, totalLaps);

    // Confidence
    const highQualityDrivers = drivers.filter(d => d.weight === "HIGH").length;
    const confidence: ConfidenceLevel = highQualityDrivers >= 2 ? "HIGH" : highQualityDrivers >= 1 ? "MEDIUM" : "LOW";

    // Reliability notes
    const reliabilityNotes: string[] = [];
    if (context.degradation_slope === null) reliabilityNotes.push("Dato di degrado non disponibile per questo stint");
    if (context.gap_ahead === null) reliabilityNotes.push("Gap al pilota davanti non disponibile");
    if (!driverCumDev) reliabilityNotes.push("Deviazione cumulativa non disponibile");
    if (context.traffic_level === "UNKNOWN" || context.traffic_level === null) {
      reliabilityNotes.push("Previsione traffico non disponibile per questo giro");
    }

    points.push({
      id: `dp_${sessionKey}_${driverNumber}_${lap}`,
      lap_window: [windowStart, windowEnd],
      primary_lap: lap,
      decision_type: decisionType,
      drivers,
      confidence,
      context,
      real_action: realAction,
      real_action_detail: realDetail,
      outcome,
      analogs: [],
      analogs_status: "NOT_LOADED",
      reliability_notes: reliabilityNotes,
    });
  }

  return points;
}

/* ── Trigger evaluation ── */

type TriggerType =
  | "PIT_WINDOW"
  | "DEGRADATION_CRITICAL"
  | "BATTLE_ACTIVE"
  | "TRAFFIC_RELEVANT"
  | "WEATHER_CHANGE"
  | "NEUTRALIZATION"
  | "CUMULATIVE_LOSS_WORSENING"
  | "ACTUAL_PIT";

interface Trigger {
  type: TriggerType;
  detail: string;
}

function evaluateTriggers(
  lap: number,
  stints: StintData[],
  pitLapSet: Set<number>,
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  trafficAnalysis: TrafficPrediction[],
  paceLossResults: StintPaceLossResult[],
  degradationValidations: DegradationValidationResult[],
  diaryEvents: DiaryEvent[] | null,
  cumDevMap: Map<number, LapDeviation>,
  totalLaps: number,
): Trigger[] {
  const triggers: Trigger[] = [];

  // 1. Actual pit stop at this lap
  if (pitLapSet.has(lap) || pitLapSet.has(lap + 1)) {
    triggers.push({ type: "ACTUAL_PIT", detail: `Pit stop reale al giro ${pitLapSet.has(lap) ? lap : lap + 1}` });
  }

  // 2. Inside or near pit window
  const currentStint = stints.find(s => lap >= s.lap_start && lap <= s.lap_end);
  if (currentStint) {
    const stintLength = lap - currentStint.lap_start;
    const tyreAge = (currentStint.tyre_age_at_start ?? 0) + stintLength;
    // Typical pit windows: SOFT ≥12, MEDIUM ≥16, HARD ≥20
    const windowThresholds: Record<string, number> = { SOFT: 12, MEDIUM: 16, HARD: 20, INTERMEDIATE: 10, WET: 8 };
    const threshold = windowThresholds[currentStint.compound] ?? 15;
    if (tyreAge >= threshold - 3) {
      triggers.push({ type: "PIT_WINDOW", detail: `Pneumatico ${currentStint.compound} a ${tyreAge} giri di vita (soglia: ~${threshold})` });
    }
  }

  // 3. Degradation critical
  if (currentStint) {
    const dv = degradationValidations.find(v => v.original.stint === currentStint.stint_number);
    if (dv && dv.effective_slope > 0.08) {
      triggers.push({ type: "DEGRADATION_CRITICAL", detail: `Degrado elevato: ${dv.effective_slope.toFixed(3)} s/giro` });
    }
  }

  // 4. Pace loss high or cliff risk
  if (currentStint) {
    const pl = paceLossResults.find(p => p.stint_number === currentStint.stint_number);
    if (pl && (pl.pace_loss_status === "HIGH_LOSS" || pl.pace_loss_status === "CLIFF_RISK")) {
      triggers.push({ type: "DEGRADATION_CRITICAL", detail: `Pace loss status: ${pl.pace_loss_status}` });
    }
  }

  // 5. Battle active
  if (diaryEvents) {
    const battleAtLap = diaryEvents.find(e =>
      e.type === "BATTLE" &&
      e.details.startLap != null &&
      e.details.endLap != null &&
      lap >= e.details.startLap &&
      lap <= e.details.endLap
    );
    if (battleAtLap) {
      triggers.push({ type: "BATTLE_ACTIVE", detail: battleAtLap.description });
    }
  }

  // 6. Traffic relevant for pit at this lap
  const trafficPred = trafficAnalysis.find(t => t.pit_lap === lap || t.pit_lap === lap + 1);
  if (trafficPred && (trafficPred.traffic_level === "HEAVY" || trafficPred.estimated_traffic_time_loss > 2)) {
    triggers.push({ type: "TRAFFIC_RELEVANT", detail: `Traffico ${trafficPred.traffic_level} stimato: +${trafficPred.estimated_traffic_time_loss.toFixed(1)}s` });
  }

  // 7. Weather change
  const wPrev = weatherMap.get(lap - 1);
  const wCurr = weatherMap.get(lap);
  if (wPrev && wCurr && wPrev !== wCurr) {
    triggers.push({ type: "WEATHER_CHANGE", detail: `Cambio meteo: ${wPrev} → ${wCurr}` });
  } else if (wCurr && wCurr !== "DRY") {
    // Also trigger if currently non-dry
    triggers.push({ type: "WEATHER_CHANGE", detail: `Condizioni ${wCurr}` });
  }

  // 8. Neutralization
  const ts = trackStatusMap.get(lap);
  if (ts && ts !== "GREEN") {
    triggers.push({ type: "NEUTRALIZATION", detail: `Neutralizzazione: ${ts}` });
  }

  // 9. Cumulative loss worsening consistently
  const recentLaps = [cumDevMap.get(lap), cumDevMap.get(lap - 1), cumDevMap.get(lap - 2)].filter(Boolean) as LapDeviation[];
  if (recentLaps.length >= 3 && recentLaps.every(l => l.delta_lap > 0.05)) {
    triggers.push({ type: "CUMULATIVE_LOSS_WORSENING", detail: "Perdita cumulativa in peggioramento costante (3+ giri)" });
  }

  return triggers;
}

/* ── Context Snapshot Builder ── */

function buildContextSnapshot(
  lap: number,
  sessionKey: number,
  driverNumber: number,
  driverAcronym: string,
  stints: StintData[],
  degradationValidations: DegradationValidationResult[],
  paceLossResults: StintPaceLossResult[],
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  trafficAnalysis: TrafficPrediction[],
  diaryEvents: DiaryEvent[] | null,
  cumDevMap: Map<number, LapDeviation>,
  positionAtLap: Map<number, number>,
  gapLookup: Map<number, { ahead: number | null; behind: number | null }>,
  totalLaps: number,
): ContextSnapshot {
  const currentStint = stints.find(s => lap >= s.lap_start && lap <= s.lap_end);
  const stintLength = currentStint ? lap - currentStint.lap_start : 0;
  const tyreAge = currentStint ? (currentStint.tyre_age_at_start ?? 0) + stintLength : 0;

  const dv = currentStint ? degradationValidations.find(v => v.original.stint === currentStint.stint_number) : null;
  const pl = currentStint ? paceLossResults.find(p => p.stint_number === currentStint.stint_number) : null;

  const trafficPred = trafficAnalysis.find(t => Math.abs(t.pit_lap - lap) <= 1);

  const battleActive = diaryEvents?.some(e =>
    e.type === "BATTLE" && e.details.startLap != null && e.details.endLap != null &&
    lap >= e.details.startLap && lap <= e.details.endLap
  ) ?? false;

  const battleEvent = battleActive
    ? diaryEvents?.find(e => e.type === "BATTLE" && lap >= (e.details.startLap ?? 0) && lap <= (e.details.endLap ?? 0))
    : null;

  // Cumulative loss trend
  let cumTrend: "WORSENING" | "STABLE" | "IMPROVING" | null = null;
  const recentDevs = [cumDevMap.get(lap - 2), cumDevMap.get(lap - 1), cumDevMap.get(lap)].filter(Boolean) as LapDeviation[];
  if (recentDevs.length >= 2) {
    const avgDelta = recentDevs.reduce((s, l) => s + l.delta_lap, 0) / recentDevs.length;
    if (avgDelta > 0.1) cumTrend = "WORSENING";
    else if (avgDelta < -0.1) cumTrend = "IMPROVING";
    else cumTrend = "STABLE";
  }

  const gaps = gapLookup.get(lap) ?? { ahead: null, behind: null };
  const weather = weatherMap.get(lap) ?? "DRY";
  const trackStatus = trackStatusMap.get(lap) ?? "GREEN";

  return {
    session_key: sessionKey,
    driver_number: driverNumber,
    driver_acronym: driverAcronym,
    lap_window: [Math.max(1, lap - 1), Math.min(totalLaps, lap + 1)],
    current_stint_number: currentStint?.stint_number ?? 0,
    compound: currentStint?.compound ?? "UNKNOWN",
    tyre_age: tyreAge,
    degradation_slope: dv?.effective_slope ?? null,
    degradation_status: dv?.status ?? null,
    pace_loss_status: pl?.pace_loss_status ?? null,
    pace_loss_rate: pl?.stint_pace_loss_rate ?? null,
    battle_active: battleActive,
    battle_type: battleEvent?.details.battleType ?? null,
    traffic_level: trafficPred?.traffic_level ?? null,
    traffic_time_loss: trafficPred?.estimated_traffic_time_loss ?? null,
    weather_state: weather,
    neutralization_state: trackStatus,
    track_position: positionAtLap.get(lap) ?? null,
    gap_ahead: gaps.ahead,
    gap_behind: gaps.behind,
    cumulative_loss_trend: cumTrend,
    laps_remaining: totalLaps - lap,
  };
}

/* ── Decision Drivers Builder ── */

function buildDecisionDrivers(triggers: Trigger[], ctx: ContextSnapshot): DecisionDriver[] {
  const drivers: DecisionDriver[] = [];

  for (const t of triggers) {
    switch (t.type) {
      case "PIT_WINDOW":
        drivers.push({
          factor: "Finestra pit",
          direction: "PIT",
          weight: ctx.tyre_age > 20 ? "HIGH" : "MEDIUM",
          detail: t.detail,
        });
        break;

      case "DEGRADATION_CRITICAL":
        drivers.push({
          factor: "Degrado critico",
          direction: "PIT",
          weight: "HIGH",
          detail: t.detail,
        });
        break;

      case "BATTLE_ACTIVE":
        // If defending, pit might lose position; if attacking, pit might waste opportunity
        drivers.push({
          factor: "Battaglia attiva",
          direction: ctx.battle_type === "DEFENDING" ? "STAY_OUT" : "NEUTRAL",
          weight: "MEDIUM",
          detail: t.detail,
        });
        break;

      case "TRAFFIC_RELEVANT":
        drivers.push({
          factor: "Traffico al rientro",
          direction: "STAY_OUT",
          weight: (ctx.traffic_time_loss ?? 0) > 3 ? "HIGH" : "MEDIUM",
          detail: t.detail,
        });
        break;

      case "WEATHER_CHANGE":
        drivers.push({
          factor: "Cambio meteo",
          direction: ctx.weather_state === "WET" ? "PIT" : "NEUTRAL",
          weight: ctx.weather_state === "WET" ? "HIGH" : "MEDIUM",
          detail: t.detail,
        });
        break;

      case "NEUTRALIZATION":
        drivers.push({
          factor: "Neutralizzazione",
          direction: "PIT",
          weight: ctx.neutralization_state === "SC" ? "HIGH" : "MEDIUM",
          detail: t.detail,
        });
        break;

      case "CUMULATIVE_LOSS_WORSENING":
        drivers.push({
          factor: "Perdita cumulativa in peggioramento",
          direction: "PIT",
          weight: "MEDIUM",
          detail: t.detail,
        });
        break;

      case "ACTUAL_PIT":
        // This is informational, doesn't push a direction
        drivers.push({
          factor: "Pit stop effettuato",
          direction: "NEUTRAL",
          weight: "HIGH",
          detail: t.detail,
        });
        break;
    }
  }

  // Additional context-based drivers
  if (ctx.gap_behind !== null && ctx.gap_behind < 1.5) {
    drivers.push({
      factor: "Gap ridotto da dietro",
      direction: "PIT",
      weight: "MEDIUM",
      detail: `Pilota dietro a ${ctx.gap_behind.toFixed(1)}s — rischio undercut`,
    });
  }

  if (ctx.laps_remaining < 10) {
    drivers.push({
      factor: "Pochi giri rimanenti",
      direction: "STAY_OUT",
      weight: ctx.laps_remaining < 5 ? "HIGH" : "MEDIUM",
      detail: `${ctx.laps_remaining} giri al traguardo`,
    });
  }

  return drivers;
}

/* ── Outcome Comparator ── */

function computeOutcome(
  lap: number,
  realAction: "PIT" | "STAY_OUT",
  laps: Lap[],
  positionAtLap: Map<number, number>,
  totalLaps: number,
): DecisionOutcome {
  const observeWindow = 5;
  const endLap = Math.min(totalLaps, lap + observeWindow);
  const lapsObserved = endLap - lap;

  // Position change
  const posBefore = positionAtLap.get(lap);
  const posAfter = positionAtLap.get(endLap) ?? positionAtLap.get(endLap - 1);
  const posChange = (posBefore != null && posAfter != null) ? posAfter - posBefore : null;

  // Pace comparison: avg pace before vs after
  const lapsBefore = laps.filter(l => l.lap_number >= lap - 3 && l.lap_number < lap && l.lap_duration != null && l.lap_duration > 0 && !l.is_pit_out_lap);
  const lapsAfter = laps.filter(l => l.lap_number > lap && l.lap_number <= endLap && l.lap_duration != null && l.lap_duration > 0 && !l.is_pit_out_lap);
  
  const avgBefore = lapsBefore.length > 0 ? lapsBefore.reduce((s, l) => s + l.lap_duration!, 0) / lapsBefore.length : null;
  const avgAfter = lapsAfter.length > 0 ? lapsAfter.reduce((s, l) => s + l.lap_duration!, 0) / lapsAfter.length : null;
  const paceDelta = (avgBefore != null && avgAfter != null) ? Math.round((avgAfter - avgBefore) * 100) / 100 : null;

  // Next notable event
  let nextEvent: string | null = null;
  if (realAction === "PIT" && paceDelta !== null && paceDelta < -0.3) {
    nextEvent = `Passo migliorato di ${Math.abs(paceDelta).toFixed(1)}s/giro su gomme nuove`;
  } else if (realAction === "STAY_OUT" && paceDelta !== null && paceDelta > 0.3) {
    nextEvent = `Passo peggiorato di ${paceDelta.toFixed(1)}s/giro nei giri successivi`;
  }

  // Summary
  let summary: string;
  if (realAction === "PIT") {
    if (posChange != null && posChange > 0) {
      summary = `Pit effettuato. Persa ${Math.abs(posChange)} posizion${Math.abs(posChange) === 1 ? "e" : "i"} nel breve termine.`;
    } else if (posChange != null && posChange < 0) {
      summary = `Pit effettuato. Guadagnata ${Math.abs(posChange)} posizion${Math.abs(posChange) === 1 ? "e" : "i"} (undercut riuscito).`;
    } else {
      summary = "Pit effettuato. Posizione mantenuta.";
    }
    if (paceDelta !== null && paceDelta < -0.3) {
      summary += ` Passo migliorato di ${Math.abs(paceDelta).toFixed(1)}s/giro.`;
    }
  } else {
    if (paceDelta !== null && paceDelta > 0.3) {
      summary = `Rimasto in pista. Passo peggiorato di ${paceDelta.toFixed(1)}s/giro nei giri successivi.`;
    } else {
      summary = "Rimasto in pista. Passo stabile nel breve termine.";
    }
    if (posChange != null && posChange > 0) {
      summary += ` Persa ${Math.abs(posChange)} posizion${Math.abs(posChange) === 1 ? "e" : "i"}.`;
    }
  }

  return {
    laps_observed: lapsObserved,
    position_change: posChange,
    pace_delta_vs_before: paceDelta,
    next_event: nextEvent,
    outcome_summary: summary,
  };
}

/* ══════════════════════════════════════════════════════════════
   2. Historical Analog Finder
   ══════════════════════════════════════════════════════════════ */

/**
 * Signature used for analog matching.
 * Each field is a discrete bucket to enable comparison.
 */
interface DecisionSignature {
  neutralization: "SC" | "VSC" | "RED" | "NONE";
  weather: "DRY" | "MIXED" | "WET";
  battle: boolean;
  degradation_bucket: "LOW" | "MEDIUM" | "HIGH" | "CLIFF" | "UNKNOWN";
  traffic_class: "CLEAN" | "LIGHT" | "HEAVY" | "UNKNOWN";
  laps_remaining_bucket: "EARLY" | "MID" | "LATE" | "FINAL";
  tyre_age_bucket: "FRESH" | "MID" | "OLD" | "VERY_OLD";
  compound: string;
  position_bucket: "FRONT" | "MIDFIELD" | "BACK" | "UNKNOWN";
  cum_loss_trend: "WORSENING" | "STABLE" | "IMPROVING" | "UNKNOWN";
}

function buildSignature(ctx: ContextSnapshot): DecisionSignature {
  // Neutralization
  let neutralization: DecisionSignature["neutralization"] = "NONE";
  if (ctx.neutralization_state === "SC") neutralization = "SC";
  else if (ctx.neutralization_state === "VSC") neutralization = "VSC";
  else if (ctx.neutralization_state === "RED") neutralization = "RED";

  // Weather
  let weather: DecisionSignature["weather"] = "DRY";
  if (ctx.weather_state === "WET") weather = "WET";
  else if (ctx.weather_state === "MIXED") weather = "MIXED";

  // Degradation bucket
  let degradation_bucket: DecisionSignature["degradation_bucket"] = "UNKNOWN";
  if (ctx.degradation_slope !== null) {
    if (ctx.degradation_slope < 0.03) degradation_bucket = "LOW";
    else if (ctx.degradation_slope < 0.06) degradation_bucket = "MEDIUM";
    else if (ctx.degradation_slope < 0.10) degradation_bucket = "HIGH";
    else degradation_bucket = "CLIFF";
  }

  // Traffic
  let traffic_class: DecisionSignature["traffic_class"] = "UNKNOWN";
  if (ctx.traffic_level === "CLEAN") traffic_class = "CLEAN";
  else if (ctx.traffic_level === "LIGHT") traffic_class = "LIGHT";
  else if (ctx.traffic_level === "HEAVY") traffic_class = "HEAVY";

  // Laps remaining bucket
  const totalRaceLaps = ctx.laps_remaining + (ctx.lap_window[1] - ctx.lap_window[0]);
  const pct = ctx.laps_remaining / Math.max(1, totalRaceLaps + ctx.lap_window[0]);
  let laps_remaining_bucket: DecisionSignature["laps_remaining_bucket"] = "MID";
  if (pct > 0.6) laps_remaining_bucket = "EARLY";
  else if (pct > 0.3) laps_remaining_bucket = "MID";
  else if (pct > 0.1) laps_remaining_bucket = "LATE";
  else laps_remaining_bucket = "FINAL";

  // Tyre age bucket
  let tyre_age_bucket: DecisionSignature["tyre_age_bucket"] = "MID";
  if (ctx.tyre_age < 8) tyre_age_bucket = "FRESH";
  else if (ctx.tyre_age < 15) tyre_age_bucket = "MID";
  else if (ctx.tyre_age < 22) tyre_age_bucket = "OLD";
  else tyre_age_bucket = "VERY_OLD";

  // Position bucket
  let position_bucket: DecisionSignature["position_bucket"] = "UNKNOWN";
  if (ctx.track_position !== null) {
    if (ctx.track_position <= 5) position_bucket = "FRONT";
    else if (ctx.track_position <= 14) position_bucket = "MIDFIELD";
    else position_bucket = "BACK";
  }

  return {
    neutralization,
    weather,
    battle: ctx.battle_active,
    degradation_bucket,
    traffic_class,
    laps_remaining_bucket,
    tyre_age_bucket,
    compound: ctx.compound,
    position_bucket,
    cum_loss_trend: ctx.cumulative_loss_trend ?? "UNKNOWN",
  };
}

/**
 * Compute similarity between two decision signatures.
 * Returns score 0–1 and lists of matching/differing factors.
 */
function computeSimilarity(
  sig1: DecisionSignature,
  sig2: DecisionSignature,
): { score: number; matches: string[]; differences: string[] } {
  const matches: string[] = [];
  const differences: string[] = [];

  const factors: { key: keyof DecisionSignature; weight: number; label: string }[] = [
    { key: "neutralization", weight: 0.20, label: "Neutralizzazione" },
    { key: "weather", weight: 0.12, label: "Meteo" },
    { key: "degradation_bucket", weight: 0.15, label: "Degrado gomme" },
    { key: "tyre_age_bucket", weight: 0.10, label: "Età gomme" },
    { key: "compound", weight: 0.08, label: "Mescola" },
    { key: "traffic_class", weight: 0.10, label: "Traffico" },
    { key: "laps_remaining_bucket", weight: 0.08, label: "Fase gara" },
    { key: "position_bucket", weight: 0.07, label: "Posizione" },
    { key: "battle", weight: 0.05, label: "Battaglia" },
    { key: "cum_loss_trend", weight: 0.05, label: "Trend perdita" },
  ];

  let totalWeight = 0;
  let matchWeight = 0;

  for (const f of factors) {
    totalWeight += f.weight;
    if (sig1[f.key] === sig2[f.key]) {
      matchWeight += f.weight;
      matches.push(f.label);
    } else {
      differences.push(`${f.label}: ${sig1[f.key]} vs ${sig2[f.key]}`);
    }
  }

  return {
    score: Math.round((matchWeight / totalWeight) * 100) / 100,
    matches,
    differences,
  };
}

/**
 * Build a historical analog from a past session's decision context.
 * This is called for each candidate past decision point.
 */
export function buildHistoricalAnalog(
  pastContext: ContextSnapshot,
  pastDecision: "PIT" | "STAY_OUT",
  pastOutcomeSummary: string,
  currentSignature: DecisionSignature,
  gpName: string,
  year: number,
): HistoricalAnalog | null {
  const pastSignature = buildSignature(pastContext);
  const sim = computeSimilarity(currentSignature, pastSignature);

  // Minimum similarity threshold
  if (sim.score < 0.3) return null;

  const strength: AnalogStrength = sim.score >= 0.7 ? "STRONG" : sim.score >= 0.5 ? "WEAK" : "NONE";
  if (strength === "NONE") return null;

  const reliability: ConfidenceLevel = sim.score >= 0.7 ? "HIGH" : sim.score >= 0.55 ? "MEDIUM" : "LOW";

  return {
    session_key: pastContext.session_key,
    year,
    gp_name: gpName,
    driver_acronym: pastContext.driver_acronym,
    lap_window: pastContext.lap_window,
    similarity_score: sim.score,
    matching_factors: sim.matches,
    differences: sim.differences,
    decision_taken: pastDecision === "PIT" ? "PIT_NOW" : "STAY_OUT",
    outcome_summary: pastOutcomeSummary,
    reliability,
    analog_strength: strength,
  };
}

/* ══════════════════════════════════════════════════════════════
   3. Helper utilities
   ══════════════════════════════════════════════════════════════ */

function buildPositionLookup(
  driverNumber: number,
  laps: Lap[],
  positions: PositionData[],
): Map<number, number> {
  const map = new Map<number, number>();
  const driverPositions = positions.filter(p => p.driver_number === driverNumber);

  for (const lap of laps) {
    if (!lap.date_start) continue;
    const lapTime = new Date(lap.date_start).getTime();
    // Find closest position to lap start
    let closest: PositionData | null = null;
    let closestDist = Infinity;
    for (const p of driverPositions) {
      const dist = Math.abs(new Date(p.date).getTime() - lapTime);
      if (dist < closestDist) {
        closestDist = dist;
        closest = p;
      }
    }
    if (closest && closestDist < 120000) {
      map.set(lap.lap_number, closest.position);
    }
  }

  return map;
}

function buildGapLookup(
  driverNumber: number,
  laps: Lap[],
  intervals: IntervalData[],
): Map<number, { ahead: number | null; behind: number | null }> {
  const map = new Map<number, { ahead: number | null; behind: number | null }>();
  const driverIntervals = intervals.filter(iv => iv.driver_number === driverNumber);

  for (const lap of laps) {
    if (!lap.date_start) continue;
    const lapTime = new Date(lap.date_start).getTime();

    let closestIv: IntervalData | null = null;
    let closestDist = Infinity;
    for (const iv of driverIntervals) {
      const dist = Math.abs(new Date(iv.date).getTime() - lapTime);
      if (dist < closestDist) {
        closestDist = dist;
        closestIv = iv;
      }
    }

    if (closestIv && closestDist < 120000) {
      const ahead = typeof closestIv.interval === "number" ? closestIv.interval : null;
      // gap_behind requires the car behind's interval data — we approximate
      map.set(lap.lap_number, { ahead, behind: null });
    }
  }

  return map;
}

/* ══════════════════════════════════════════════════════════════
   4. Main entry point for KDM extraction (synchronous, no API calls)
   ══════════════════════════════════════════════════════════════ */

export function computeKeyDecisionMoments(input: ExtractionInput): KeyDecisionMomentsResult {
  const points = extractDecisionPoints(input);

  return {
    decision_points: points,
    total_points: points.length,
    data_coverage_years: 0, // Updated when analogs are loaded
    warnings: points.length === 0 ? ["Nessun momento decisionale plausibile identificato in questa gara"] : [],
  };
}

/* ══════════════════════════════════════════════════════════════
   5. Historical Analog Search (async — requires API calls)
   ══════════════════════════════════════════════════════════════ */

/**
 * Search for historical analogs for a specific decision point.
 * Requires fetching data from OpenF1 for past sessions.
 * Limited to max 5 years of history.
 *
 * This is designed to be called on-demand (user clicks to load analogs)
 * to avoid overwhelming the API with requests.
 */
export async function searchHistoricalAnalogs(
  point: DecisionPoint,
  currentSessionYear: number,
  fetchSessionsFn: (yearStart: number, yearEnd: number) => Promise<SessionInfo[]>,
  fetchSessionDataFn: (sessionKey: number) => Promise<{
    laps: Lap[];
    stints: StintData[];
    pitStops: PitData[];
    positions: PositionData[];
    intervals: IntervalData[];
    drivers: Driver[];
  } | null>,
): Promise<{ analogs: HistoricalAnalog[]; warnings: string[] }> {
  const warnings: string[] = [];
  const analogs: HistoricalAnalog[] = [];

  const currentSignature = buildSignature(point.context);
  const yearStart = currentSessionYear - 5;
  const yearEnd = currentSessionYear - 1;

  let sessions: SessionInfo[];
  try {
    sessions = await fetchSessionsFn(yearStart, yearEnd);
  } catch {
    return { analogs: [], warnings: ["Impossibile recuperare sessioni storiche da OpenF1"] };
  }

  // Filter to race sessions only
  const raceSessions = sessions.filter(s =>
    s.session_type === "Race" || s.session_name === "Race"
  );

  if (raceSessions.length === 0) {
    return { analogs: [], warnings: [`Nessuna sessione di gara trovata nel periodo ${yearStart}–${yearEnd}`] };
  }

  // Limit to max 10 sessions to avoid API overload
  const sampled = raceSessions.slice(0, 10);
  if (raceSessions.length > 10) {
    warnings.push(`Campione limitato a 10 sessioni su ${raceSessions.length} disponibili`);
  }

  for (let si = 0; si < sampled.length; si++) {
    const session = sampled[si];
    // Add delay between session fetches to respect rate limits
    if (si > 0) await new Promise(r => setTimeout(r, 1200));
    let data;
    try {
      data = await fetchSessionDataFn(session.session_key);
    } catch {
      continue;
    }
    if (!data || data.laps.length === 0 || data.stints.length === 0) continue;

    const sessionYear = new Date(session.date_start).getFullYear();
    const gpName = session.session_name || `Session ${session.session_key}`;

    const driverNumSet = new Set<number>();
    for (const s of data.stints) driverNumSet.add(s.driver_number);
    const allDriverNums: number[] = [];
    driverNumSet.forEach(n => allDriverNums.push(n));

    for (const dn of allDriverNums) {
      const driverLaps = data.laps.filter(l => l.driver_number === dn);
      const driverStints = data.stints.filter(s => s.driver_number === dn);
      const driverPits = data.pitStops.filter(p => p.driver_number === dn);
      const driverAcronym = data.drivers.find(d => d.driver_number === dn)?.name_acronym ?? `#${dn}`;

      if (driverLaps.length === 0 || driverStints.length === 0) continue;

      const totalLapsHist = Math.max(...driverLaps.map(l => l.lap_number));
      const posMapHist = buildPositionLookup(dn, driverLaps, data.positions);

      // Check each pit stop as a decision point
      for (const pit of driverPits) {
        const pitLap = pit.lap_number;
        const stintAtPit = driverStints.find(s => pitLap >= s.lap_start && pitLap <= s.lap_end + 1);
        if (!stintAtPit) continue;

        const tyreAge = (stintAtPit.tyre_age_at_start ?? 0) + (pitLap - stintAtPit.lap_start);

        // Build a simplified context snapshot for the historical point
        const histContext: ContextSnapshot = {
          session_key: session.session_key,
          driver_number: dn,
          driver_acronym: driverAcronym,
          lap_window: [Math.max(1, pitLap - 1), Math.min(totalLapsHist, pitLap + 1)],
          current_stint_number: stintAtPit.stint_number,
          compound: stintAtPit.compound,
          tyre_age: tyreAge,
          degradation_slope: null, // Not computed for historical
          degradation_status: null,
          pace_loss_status: null,
          pace_loss_rate: null,
          battle_active: false, // Not computed for historical
          battle_type: null,
          traffic_level: null,
          traffic_time_loss: null,
          weather_state: "DRY", // Simplified — no weather data fetched
          neutralization_state: "GREEN",
          track_position: posMapHist.get(pitLap) ?? null,
          gap_ahead: null,
          gap_behind: null,
          cumulative_loss_trend: null,
          laps_remaining: totalLapsHist - pitLap,
        };

        // Compute simplified outcome
        const posBeforePit = posMapHist.get(pitLap);
        const posAfterPit = posMapHist.get(Math.min(totalLapsHist, pitLap + 3));
        const posChange = posBeforePit != null && posAfterPit != null ? posAfterPit - posBeforePit : null;
        const outcomeSummary = posChange != null
          ? posChange > 0
            ? `Perse ${Math.abs(posChange)} posizioni dopo il pit`
            : posChange < 0
            ? `Guadagnate ${Math.abs(posChange)} posizioni dopo il pit`
            : "Posizione mantenuta dopo il pit"
          : "Esito non determinabile";

        const analog = buildHistoricalAnalog(
          histContext, "PIT", outcomeSummary, currentSignature, gpName, sessionYear,
        );

        if (analog) analogs.push(analog);
      }
    }
  }

  // Sort by similarity score descending
  analogs.sort((a, b) => b.similarity_score - a.similarity_score);

  // Keep top 5
  const topAnalogs = analogs.slice(0, 5);

  if (topAnalogs.length === 0) {
    warnings.push("Nessun caso comparabile trovato nella finestra storica");
  } else if (topAnalogs.every(a => a.analog_strength === "WEAK")) {
    warnings.push("Solo analoghi deboli trovati — confronto da leggere con cautela");
  }

  return { analogs: topAnalogs, warnings };
}

/* ══════════════════════════════════════════════════════════════
   Export signature builder for external use
   ══════════════════════════════════════════════════════════════ */
export { buildSignature };
export type { DecisionSignature };
