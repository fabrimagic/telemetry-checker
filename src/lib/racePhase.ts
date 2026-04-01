import type { RaceControlMessage } from "./openf1";
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

export interface RacePhaseResult {
  current_phase: RacePhase;
  phase_reason: string;
  phase_adjustments: PhaseAdjustments;
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
  // Priority 1: Active neutralization on current lap
  const currentTrackStatus = trackStatusMap.get(currentLap);
  if (currentTrackStatus && currentTrackStatus !== "GREEN") {
    return {
      current_phase: "NEUTRALIZATION_PHASE",
      phase_reason: `Neutralizzazione attiva (${currentTrackStatus}) al giro ${currentLap}`,
      phase_adjustments: PHASE_ADJUSTMENTS.NEUTRALIZATION_PHASE,
    };
  }

  // Priority 2: Weather transition (wet/mixed on current or recent laps)
  const recentWeatherLaps = [currentLap, currentLap - 1, currentLap - 2].filter(l => l >= 1);
  const hasWeatherTransition = recentWeatherLaps.some(l => {
    const w = weatherMap.get(l);
    return w === "WET" || w === "MIXED";
  });
  if (hasWeatherTransition) {
    return {
      current_phase: "WEATHER_TRANSITION_PHASE",
      phase_reason: `Condizioni meteo variabili rilevate nei giri recenti`,
      phase_adjustments: PHASE_ADJUSTMENTS.WEATHER_TRANSITION_PHASE,
    };
  }

  const racePct = currentLap / totalLaps;

  // Priority 3: Start phase
  if (currentLap <= THRESHOLDS.START_PHASE_LAPS) {
    return {
      current_phase: "START_PHASE",
      phase_reason: `Primi ${THRESHOLDS.START_PHASE_LAPS} giri dopo il via`,
      phase_adjustments: PHASE_ADJUSTMENTS.START_PHASE,
    };
  }

  // Priority 4: Final laps
  if (totalLaps - currentLap < THRESHOLDS.FINAL_LAPS_COUNT) {
    return {
      current_phase: "FINAL_LAPS",
      phase_reason: `Ultimi ${THRESHOLDS.FINAL_LAPS_COUNT} giri della gara`,
      phase_adjustments: PHASE_ADJUSTMENTS.FINAL_LAPS,
    };
  }

  // Priority 5: Late race attack
  if (racePct >= THRESHOLDS.LATE_RACE_PCT) {
    return {
      current_phase: "LATE_RACE_ATTACK",
      phase_reason: `Oltre il ${Math.round(THRESHOLDS.LATE_RACE_PCT * 100)}% della gara — fase di attacco finale`,
      phase_adjustments: PHASE_ADJUSTMENTS.LATE_RACE_ATTACK,
    };
  }

  // Priority 6: Primary pit window
  if (pitWindowStart != null && pitWindowEnd != null) {
    const windowLow = pitWindowStart - THRESHOLDS.PIT_WINDOW_MARGIN_LAPS;
    const windowHigh = pitWindowEnd + THRESHOLDS.PIT_WINDOW_MARGIN_LAPS;
    if (currentLap >= windowLow && currentLap <= windowHigh && !hasPittedAlready) {
      return {
        current_phase: "PRIMARY_PIT_WINDOW",
        phase_reason: `Nella finestra pit stimata (giri ${pitWindowStart}–${pitWindowEnd}), degrado crescente`,
        phase_adjustments: PHASE_ADJUSTMENTS.PRIMARY_PIT_WINDOW,
      };
    }
  }

  // Priority 7: Early stint
  if (racePct < THRESHOLDS.EARLY_STINT_MAX_PCT) {
    return {
      current_phase: "EARLY_STINT",
      phase_reason: `Stint iniziale, carburante alto e primi segnali di degrado`,
      phase_adjustments: PHASE_ADJUSTMENTS.EARLY_STINT,
    };
  }

  // Priority 8: Mid race management (default)
  return {
    current_phase: "MID_RACE_MANAGEMENT",
    phase_reason: `Gestione del ritmo e delle gomme nella parte centrale della gara`,
    phase_adjustments: PHASE_ADJUSTMENTS.MID_RACE_MANAGEMENT,
  };
}
