import type { WeatherCondition } from "./weatherClassification";
import type { TrackStatus } from "./trackStatusClassification";

/* ── Types ── */

export type RacePhase =
  | "START_PHASE"
  | "EARLY_STINT"
  | "PRIMARY_PIT_WINDOW"
  | "MID_RACE_MANAGEMENT"
  | "LATE_RACE_ATTACK"
  | "FINAL_LAPS"
  | "NEUTRALIZATION_PHASE"
  | "WEATHER_TRANSITION_PHASE"
  | "UNKNOWN_PHASE";

export type PhaseConfidence = "LOW" | "MEDIUM" | "HIGH";

/**
 * Strategy phase: describes the strategic posture implied by timing & context.
 * Distinct from execution phase (what the driver should do now).
 */
export type StrategyPhase =
  | "TYRE_SAVING"
  | "PUSH_PHASE"
  | "PIT_DECISION_ZONE"
  | "POSITION_DEFENCE"
  | "OPPORTUNISTIC"
  | null;

/**
 * Execution phase: describes the immediate operational focus.
 */
export type ExecutionPhase =
  | "MANAGING"
  | "ATTACKING"
  | "DEFENDING"
  | "REACTING"
  | null;

export interface RacePhaseResult {
  current_phase: RacePhase;
  phase_reason: string;
  phase_adjustments: PhaseAdjustments;
  /** Confidence in the phase classification based on available evidence */
  phase_confidence?: PhaseConfidence;
  /** Observable evidence supporting this classification */
  phase_evidence?: string[];
  /** Race timing phase — purely lap/distance based */
  race_timing_phase?: RacePhase;
  /** Strategic posture implied by the current situation */
  strategy_phase?: StrategyPhase;
  /** Immediate operational focus */
  execution_phase?: ExecutionPhase;
}

export interface PhaseAdjustments {
  degradation_weight: number;
  traffic_weight: number;
  track_position_weight: number;
  risk_penalty_weight: number;
  neutralization_opportunity_weight: number;
}

/* ── Configurable thresholds ── */

const THRESHOLDS = {
  START_PHASE_LAPS: 3,
  EARLY_STINT_MAX_PCT: 0.20,
  PIT_WINDOW_MARGIN_LAPS: 5,
  LATE_RACE_PCT: 0.75,
  FINAL_LAPS_COUNT: 5,
  /** Laps to look back for recent neutralization history */
  RECENT_NEUTRALIZATION_WINDOW: 3,
  /** Laps to look back for weather trend */
  WEATHER_LOOKBACK: 3,
} as const;

/* ── Phase labels ── */

const PHASE_LABELS: Record<RacePhase, string> = {
  START_PHASE: "Fase di partenza",
  EARLY_STINT: "Stint iniziale",
  PRIMARY_PIT_WINDOW: "Finestra pit principale",
  MID_RACE_MANAGEMENT: "Gestione centro gara",
  LATE_RACE_ATTACK: "Attacco finale",
  FINAL_LAPS: "Ultimi giri",
  NEUTRALIZATION_PHASE: "Neutralizzazione attiva",
  WEATHER_TRANSITION_PHASE: "Transizione meteo",
  UNKNOWN_PHASE: "Fase non determinata",
};

export function getPhaseLabel(phase: RacePhase): string {
  return PHASE_LABELS[phase] ?? phase;
}

/* ── Default adjustments per phase ── */

const PHASE_ADJUSTMENTS: Record<RacePhase, PhaseAdjustments> = {
  START_PHASE: {
    degradation_weight: 0.8,
    traffic_weight: 0.7,
    track_position_weight: 1.3,
    risk_penalty_weight: 1.2,
    neutralization_opportunity_weight: 0.8,
  },
  EARLY_STINT: {
    degradation_weight: 1.0,
    traffic_weight: 0.9,
    track_position_weight: 1.1,
    risk_penalty_weight: 1.0,
    neutralization_opportunity_weight: 1.0,
  },
  PRIMARY_PIT_WINDOW: {
    degradation_weight: 1.2,
    traffic_weight: 1.2,
    track_position_weight: 1.0,
    risk_penalty_weight: 0.9,
    neutralization_opportunity_weight: 1.2,
  },
  MID_RACE_MANAGEMENT: {
    degradation_weight: 1.1,
    traffic_weight: 1.0,
    track_position_weight: 1.0,
    risk_penalty_weight: 1.0,
    neutralization_opportunity_weight: 1.0,
  },
  LATE_RACE_ATTACK: {
    degradation_weight: 1.0,
    traffic_weight: 1.1,
    track_position_weight: 1.2,
    risk_penalty_weight: 0.8,
    neutralization_opportunity_weight: 1.3,
  },
  FINAL_LAPS: {
    degradation_weight: 0.8,
    traffic_weight: 1.3,
    track_position_weight: 1.4,
    risk_penalty_weight: 1.3,
    neutralization_opportunity_weight: 0.5,
  },
  NEUTRALIZATION_PHASE: {
    degradation_weight: 0.7,
    traffic_weight: 0.6,
    track_position_weight: 0.8,
    risk_penalty_weight: 0.7,
    neutralization_opportunity_weight: 1.5,
  },
  WEATHER_TRANSITION_PHASE: {
    degradation_weight: 0.9,
    traffic_weight: 0.8,
    track_position_weight: 0.9,
    risk_penalty_weight: 1.4,
    neutralization_opportunity_weight: 1.0,
  },
  UNKNOWN_PHASE: {
    degradation_weight: 1.0,
    traffic_weight: 1.0,
    track_position_weight: 1.0,
    risk_penalty_weight: 1.0,
    neutralization_opportunity_weight: 1.0,
  },
};

/* ── Timing phase (pure lap/distance, no context) ── */

function resolveTimingPhase(currentLap: number, totalLaps: number): RacePhase {
  if (currentLap <= THRESHOLDS.START_PHASE_LAPS) return "START_PHASE";
  const remaining = totalLaps - currentLap;
  if (remaining < THRESHOLDS.FINAL_LAPS_COUNT) return "FINAL_LAPS";
  const pct = currentLap / totalLaps;
  if (pct >= THRESHOLDS.LATE_RACE_PCT) return "LATE_RACE_ATTACK";
  if (pct < THRESHOLDS.EARLY_STINT_MAX_PCT) return "EARLY_STINT";
  return "MID_RACE_MANAGEMENT";
}

/* ── Strategy phase derivation ── */

function deriveStrategyPhase(
  mainPhase: RacePhase,
  hasPittedAlready: boolean,
  inPitWindow: boolean,
): StrategyPhase {
  if (mainPhase === "NEUTRALIZATION_PHASE") return "OPPORTUNISTIC";
  if (mainPhase === "WEATHER_TRANSITION_PHASE") return "OPPORTUNISTIC";
  if (inPitWindow && !hasPittedAlready) return "PIT_DECISION_ZONE";
  if (mainPhase === "FINAL_LAPS" || mainPhase === "LATE_RACE_ATTACK") return "PUSH_PHASE";
  if (mainPhase === "EARLY_STINT" || mainPhase === "START_PHASE") return "TYRE_SAVING";
  return "TYRE_SAVING";
}

/* ── Execution phase derivation ── */

function deriveExecutionPhase(
  mainPhase: RacePhase,
): ExecutionPhase {
  if (mainPhase === "NEUTRALIZATION_PHASE" || mainPhase === "WEATHER_TRANSITION_PHASE") return "REACTING";
  if (mainPhase === "FINAL_LAPS" || mainPhase === "LATE_RACE_ATTACK") return "ATTACKING";
  return "MANAGING";
}

/* ── Recent track status analysis ── */

function hasRecentNeutralization(
  currentLap: number,
  trackStatusMap: Map<number, TrackStatus>,
  window: number,
): { active: boolean; recentCount: number; statuses: TrackStatus[] } {
  const statuses: TrackStatus[] = [];
  let count = 0;
  for (let l = currentLap; l >= Math.max(1, currentLap - window + 1); l--) {
    const s = trackStatusMap.get(l);
    if (s && s !== "GREEN") {
      count++;
      statuses.push(s);
    }
  }
  return { active: count > 0, recentCount: count, statuses };
}

/* ── Recent weather analysis ── */

function hasRecentWeatherChange(
  currentLap: number,
  weatherMap: Map<number, WeatherCondition>,
  window: number,
): { transition: boolean; conditions: WeatherCondition[] } {
  const conditions: WeatherCondition[] = [];
  for (let l = currentLap; l >= Math.max(1, currentLap - window + 1); l--) {
    const w = weatherMap.get(l);
    if (w) conditions.push(w);
  }
  const transition = conditions.some((w) => w === "WET" || w === "MIXED");
  return { transition, conditions };
}

/* ── Detection ── */

export function detectRacePhase(
  currentLap: number,
  totalLaps: number,
  pitWindowStart: number | null,
  pitWindowEnd: number | null,
  hasPittedAlready: boolean,
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
): RacePhaseResult {
  const evidence: string[] = [];
  const racePct = totalLaps > 0 ? currentLap / totalLaps : 0;
  const remaining = totalLaps - currentLap;

  // Always compute timing phase for metadata
  const timingPhase = resolveTimingPhase(currentLap, totalLaps);
  evidence.push(`Giro ${currentLap}/${totalLaps} (${(racePct * 100).toFixed(0)}%)`);

  // Pit window status
  const inPitWindow =
    pitWindowStart != null &&
    pitWindowEnd != null &&
    currentLap >= pitWindowStart - THRESHOLDS.PIT_WINDOW_MARGIN_LAPS &&
    currentLap <= pitWindowEnd + THRESHOLDS.PIT_WINDOW_MARGIN_LAPS &&
    !hasPittedAlready;

  // ── Priority 1: Active neutralization ──
  const neutralInfo = hasRecentNeutralization(
    currentLap,
    trackStatusMap,
    THRESHOLDS.RECENT_NEUTRALIZATION_WINDOW,
  );
  const currentTrackStatus = trackStatusMap.get(currentLap);

  if (currentTrackStatus && currentTrackStatus !== "GREEN") {
    evidence.push(`Track status: ${currentTrackStatus} al giro ${currentLap}`);
    if (neutralInfo.recentCount > 1) {
      evidence.push(`Neutralizzazione persistente (${neutralInfo.recentCount} giri recenti)`);
    }

    return {
      current_phase: "NEUTRALIZATION_PHASE",
      phase_reason: `Neutralizzazione attiva (${currentTrackStatus}) al giro ${currentLap}`,
      phase_adjustments: PHASE_ADJUSTMENTS.NEUTRALIZATION_PHASE,
      phase_confidence: "HIGH",
      phase_evidence: evidence,
      race_timing_phase: timingPhase,
      strategy_phase: deriveStrategyPhase("NEUTRALIZATION_PHASE", hasPittedAlready, inPitWindow),
      execution_phase: deriveExecutionPhase("NEUTRALIZATION_PHASE"),
    };
  }

  // ── Priority 2: Weather transition ──
  const weatherInfo = hasRecentWeatherChange(
    currentLap,
    weatherMap,
    THRESHOLDS.WEATHER_LOOKBACK,
  );

  if (weatherInfo.transition) {
    const wetCount = weatherInfo.conditions.filter((c) => c === "WET").length;
    const mixedCount = weatherInfo.conditions.filter((c) => c === "MIXED").length;
    const totalSamples = weatherInfo.conditions.length;

    // Confidence: HIGH if majority of recent laps are wet, MEDIUM if mixed signals
    const confidence: PhaseConfidence =
      wetCount >= 2 ? "HIGH" : mixedCount >= 2 || wetCount >= 1 ? "MEDIUM" : "LOW";

    evidence.push(`Meteo recente: ${weatherInfo.conditions.join(", ")} (${totalSamples} giri)`);

    return {
      current_phase: "WEATHER_TRANSITION_PHASE",
      phase_reason: "Condizioni meteo variabili rilevate nei giri recenti",
      phase_adjustments: PHASE_ADJUSTMENTS.WEATHER_TRANSITION_PHASE,
      phase_confidence: confidence,
      phase_evidence: evidence,
      race_timing_phase: timingPhase,
      strategy_phase: deriveStrategyPhase("WEATHER_TRANSITION_PHASE", hasPittedAlready, inPitWindow),
      execution_phase: deriveExecutionPhase("WEATHER_TRANSITION_PHASE"),
    };
  }

  // ── Priority 3: Start phase ──
  if (currentLap <= THRESHOLDS.START_PHASE_LAPS) {
    evidence.push(`Giro ${currentLap} ≤ soglia partenza (${THRESHOLDS.START_PHASE_LAPS})`);
    return {
      current_phase: "START_PHASE",
      phase_reason: `Primi ${THRESHOLDS.START_PHASE_LAPS} giri dopo il via`,
      phase_adjustments: PHASE_ADJUSTMENTS.START_PHASE,
      phase_confidence: "HIGH",
      phase_evidence: evidence,
      race_timing_phase: timingPhase,
      strategy_phase: deriveStrategyPhase("START_PHASE", hasPittedAlready, inPitWindow),
      execution_phase: deriveExecutionPhase("START_PHASE"),
    };
  }

  // ── Priority 4: Final laps ──
  if (remaining < THRESHOLDS.FINAL_LAPS_COUNT) {
    evidence.push(`${remaining} giri rimanenti < soglia (${THRESHOLDS.FINAL_LAPS_COUNT})`);
    return {
      current_phase: "FINAL_LAPS",
      phase_reason: `Ultimi ${THRESHOLDS.FINAL_LAPS_COUNT} giri della gara`,
      phase_adjustments: PHASE_ADJUSTMENTS.FINAL_LAPS,
      phase_confidence: "HIGH",
      phase_evidence: evidence,
      race_timing_phase: timingPhase,
      strategy_phase: deriveStrategyPhase("FINAL_LAPS", hasPittedAlready, inPitWindow),
      execution_phase: deriveExecutionPhase("FINAL_LAPS"),
    };
  }

  // ── Priority 5: Late race attack ──
  if (racePct >= THRESHOLDS.LATE_RACE_PCT) {
    evidence.push(`${(racePct * 100).toFixed(0)}% completato ≥ soglia late race (${THRESHOLDS.LATE_RACE_PCT * 100}%)`);
    // Slightly lower confidence if just barely past threshold
    const confidence: PhaseConfidence = racePct >= 0.85 ? "HIGH" : "MEDIUM";

    return {
      current_phase: "LATE_RACE_ATTACK",
      phase_reason: `Oltre il ${Math.round(THRESHOLDS.LATE_RACE_PCT * 100)}% della gara — fase di attacco finale`,
      phase_adjustments: PHASE_ADJUSTMENTS.LATE_RACE_ATTACK,
      phase_confidence: confidence,
      phase_evidence: evidence,
      race_timing_phase: timingPhase,
      strategy_phase: deriveStrategyPhase("LATE_RACE_ATTACK", hasPittedAlready, inPitWindow),
      execution_phase: deriveExecutionPhase("LATE_RACE_ATTACK"),
    };
  }

  // ── Priority 6: Primary pit window ──
  if (inPitWindow && pitWindowStart != null && pitWindowEnd != null) {
    const deepInWindow =
      currentLap >= pitWindowStart && currentLap <= pitWindowEnd;
    const confidence: PhaseConfidence = deepInWindow ? "HIGH" : "MEDIUM";

    evidence.push(
      `Giro ${currentLap} nella finestra pit (${pitWindowStart}–${pitWindowEnd}${!deepInWindow ? " +margine" : ""})`,
    );
    if (!hasPittedAlready) evidence.push("Pit stop non ancora effettuato");

    return {
      current_phase: "PRIMARY_PIT_WINDOW",
      phase_reason: `Nella finestra pit stimata (giri ${pitWindowStart}–${pitWindowEnd}), degrado crescente`,
      phase_adjustments: PHASE_ADJUSTMENTS.PRIMARY_PIT_WINDOW,
      phase_confidence: confidence,
      phase_evidence: evidence,
      race_timing_phase: timingPhase,
      strategy_phase: deriveStrategyPhase("PRIMARY_PIT_WINDOW", hasPittedAlready, inPitWindow),
      execution_phase: deriveExecutionPhase("PRIMARY_PIT_WINDOW"),
    };
  }

  // ── Priority 7: Early stint ──
  if (racePct < THRESHOLDS.EARLY_STINT_MAX_PCT) {
    evidence.push(`${(racePct * 100).toFixed(0)}% completato < soglia early stint (${THRESHOLDS.EARLY_STINT_MAX_PCT * 100}%)`);
    return {
      current_phase: "EARLY_STINT",
      phase_reason: "Stint iniziale, carburante alto e primi segnali di degrado",
      phase_adjustments: PHASE_ADJUSTMENTS.EARLY_STINT,
      phase_confidence: "HIGH",
      phase_evidence: evidence,
      race_timing_phase: timingPhase,
      strategy_phase: deriveStrategyPhase("EARLY_STINT", hasPittedAlready, inPitWindow),
      execution_phase: deriveExecutionPhase("EARLY_STINT"),
    };
  }

  // ── Priority 8: Mid race management (default) ──
  evidence.push("Nessun override attivo — fase di gestione centrale");
  // Check if we just exited a neutralization recently → slightly lower confidence
  const postNeutral = neutralInfo.recentCount > 0 && !neutralInfo.active;
  if (postNeutral) evidence.push("Neutralizzazione recente terminata — possibile riassestamento");
  const confidence: PhaseConfidence = postNeutral ? "MEDIUM" : "HIGH";

  return {
    current_phase: "MID_RACE_MANAGEMENT",
    phase_reason: "Gestione del ritmo e delle gomme nella parte centrale della gara",
    phase_adjustments: PHASE_ADJUSTMENTS.MID_RACE_MANAGEMENT,
    phase_confidence: confidence,
    phase_evidence: evidence,
    race_timing_phase: timingPhase,
    strategy_phase: deriveStrategyPhase("MID_RACE_MANAGEMENT", hasPittedAlready, inPitWindow),
    execution_phase: deriveExecutionPhase("MID_RACE_MANAGEMENT"),
  };
}
