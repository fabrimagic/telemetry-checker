/**
 * Race Context Scenario System
 * 
 * Provides what-if scenario modifiers for the Virtual Race Engineer.
 * Each scenario modifies model weights/parameters WITHOUT altering observed data.
 * 
 * Anti-hallucination: scenarios ONLY change multipliers and weights.
 * No fake events, no altered telemetry, no invented lap times.
 */

/* ── Scenario IDs ── */

export type ScenarioId =
  | "REAL_CONTEXT"
  | "GREEN_RACE"
  | "SAFETY_CAR"
  | "VSC"
  | "CLEAN_AIR"
  | "HEAVY_TRAFFIC"
  | "LIGHT_RAIN"
  | "MIXED_CONDITIONS"
  | "TYRE_CLIFF_RISK"
  | "LATE_RACE_ATTACK"
  | "BATTLE_MODE"
  | "UNDERCUT_SCENARIO"
  | "OVERCUT_SCENARIO";

/* ── Scenario Modifiers ── */

export interface ScenarioModifiers {
  pit_loss_multiplier: number;
  traffic_weight: number;
  degradation_weight: number;
  opportunity_weight: number;
  confidence_penalty: number; // 0 = no penalty, negative = reduce confidence
  weather_weight: number;
  neutralization_weight: number;
  risk_penalty_weight: number;
  track_position_weight: number;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  description: string;
  modifiers: ScenarioModifiers;
}

/* ── Default (no modification) ── */

const DEFAULT_MODIFIERS: ScenarioModifiers = {
  pit_loss_multiplier: 1.0,
  traffic_weight: 1.0,
  degradation_weight: 1.0,
  opportunity_weight: 1.0,
  confidence_penalty: 0,
  weather_weight: 1.0,
  neutralization_weight: 1.0,
  risk_penalty_weight: 1.0,
  track_position_weight: 1.0,
};

/* ── Scenario Definitions ── */

export const SCENARIO_DEFINITIONS: Record<ScenarioId, ScenarioDefinition> = {
  REAL_CONTEXT: {
    id: "REAL_CONTEXT",
    label: "Real conditions",
    description: "Nessuna modifica: usa solo il contesto reale osservato",
    modifiers: { ...DEFAULT_MODIFIERS },
  },
  GREEN_RACE: {
    id: "GREEN_RACE",
    label: "Green race",
    description: "Gara senza neutralizzazioni — pesi standard per pit e traffico",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      neutralization_weight: 0,
      opportunity_weight: 0.8,
    },
  },
  SAFETY_CAR: {
    id: "SAFETY_CAR",
    label: "Safety Car",
    description: "Scenario ipotetico che riduce il pit loss e aumenta il valore del pit opportunistico",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      pit_loss_multiplier: 0.62,
      traffic_weight: 0.85,
      opportunity_weight: 1.30,
      neutralization_weight: 1.5,
      track_position_weight: 0.8,
    },
  },
  VSC: {
    id: "VSC",
    label: "Virtual Safety Car",
    description: "Scenario ipotetico con riduzione moderata del pit loss e pit opportunistico favorito",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      pit_loss_multiplier: 0.78,
      traffic_weight: 0.90,
      opportunity_weight: 1.15,
      neutralization_weight: 1.3,
    },
  },
  CLEAN_AIR: {
    id: "CLEAN_AIR",
    label: "Clean air",
    description: "Scenario senza traffico — undercut/overcut più leggibili",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      traffic_weight: 0.1,
      track_position_weight: 1.2,
    },
  },
  HEAVY_TRAFFIC: {
    id: "HEAVY_TRAFFIC",
    label: "Heavy traffic",
    description: "Traffico elevato — penalizza i rientri ravvicinati e aumenta il peso del traffic predictor",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      traffic_weight: 1.6,
      track_position_weight: 1.3,
      risk_penalty_weight: 1.2,
    },
  },
  LIGHT_RAIN: {
    id: "LIGHT_RAIN",
    label: "Light rain",
    description: "Pioggia leggera — confidenza ridotta, raccomandazioni più conservative",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      confidence_penalty: -1,
      degradation_weight: 1.1,
      weather_weight: 1.4,
      risk_penalty_weight: 1.3,
    },
  },
  MIXED_CONDITIONS: {
    id: "MIXED_CONDITIONS",
    label: "Mixed conditions",
    description: "Condizioni miste — alta incertezza, strategie conservative favorite",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      confidence_penalty: -2,
      degradation_weight: 1.15,
      weather_weight: 1.6,
      risk_penalty_weight: 1.5,
      opportunity_weight: 0.7,
    },
  },
  TYRE_CLIFF_RISK: {
    id: "TYRE_CLIFF_RISK",
    label: "Tyre cliff risk",
    description: "Rischio cliff gomme — penalizza stint estesi, anticipa la pit window",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      degradation_weight: 1.5,
      risk_penalty_weight: 1.3,
      opportunity_weight: 1.1,
    },
  },
  LATE_RACE_ATTACK: {
    id: "LATE_RACE_ATTACK",
    label: "Late race attack",
    description: "Fase di attacco finale — favorisce strategie aggressive",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      degradation_weight: 0.85,
      traffic_weight: 0.9,
      track_position_weight: 1.4,
      risk_penalty_weight: 0.7,
      opportunity_weight: 1.2,
    },
  },
  BATTLE_MODE: {
    id: "BATTLE_MODE",
    label: "Battle mode",
    description: "Battaglia attiva — aumenta il peso delle battaglie e della pressione posizionale",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      traffic_weight: 1.2,
      track_position_weight: 1.5,
      risk_penalty_weight: 1.1,
    },
  },
  UNDERCUT_SCENARIO: {
    id: "UNDERCUT_SCENARIO",
    label: "Undercut window",
    description: "Finestra undercut — favorisce pit anticipato e clean air post-pit",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      traffic_weight: 0.7,
      degradation_weight: 1.2,
      track_position_weight: 1.3,
      opportunity_weight: 1.2,
    },
  },
  OVERCUT_SCENARIO: {
    id: "OVERCUT_SCENARIO",
    label: "Overcut window",
    description: "Finestra overcut — favorisce estensione stint se il passo è sostenibile",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      degradation_weight: 0.85,
      traffic_weight: 1.1,
      track_position_weight: 1.2,
      risk_penalty_weight: 0.9,
    },
  },
};

export const ALL_SCENARIO_IDS: ScenarioId[] = Object.keys(SCENARIO_DEFINITIONS) as ScenarioId[];

/* ── Helpers ── */

export function getScenarioDefinition(id: ScenarioId): ScenarioDefinition {
  return SCENARIO_DEFINITIONS[id];
}

export function isSimulatedScenario(id: ScenarioId): boolean {
  return id !== "REAL_CONTEXT";
}

/**
 * Build effective modifiers combining scenario + existing phase adjustments.
 * Scenario modifiers multiply on top of phase adjustments.
 */
/**
 * Compute a scaling factor for timed scenarios.
 * When durationLaps is provided, the factor is based on the duration window
 * relative to total race length instead of remaining race fraction.
 * Before activation_lap: modifiers are NOT applied (factor = 0).
 * From activation_lap onward: modifiers apply proportionally.
 * Returns a value between 0 and 1 that blends the modifier toward full strength.
 */
export function computeTimedScenarioScale(
  activationLap: number | null,
  totalLaps: number,
  currentContextLap?: number,
  durationLaps?: number | null,
): number {
  if (activationLap == null || activationLap <= 1) {
    // No activation lap: if duration is set, scale by duration/totalLaps
    if (durationLaps != null && durationLaps > 0 && totalLaps > 0) {
      const effectiveDuration = Math.min(durationLaps, totalLaps);
      return Math.max(0.1, Math.min(1.0, effectiveDuration / totalLaps));
    }
    return 1.0; // full effect
  }
  if (totalLaps <= 0) return 1.0;
  if (activationLap > totalLaps) return 0.0; // beyond race end, no effect

  if (durationLaps != null && durationLaps > 0) {
    // Window-based: scale by duration window / total laps
    const effectiveEnd = Math.min(activationLap + durationLaps - 1, totalLaps);
    const effectiveDuration = effectiveEnd - activationLap + 1;
    return Math.max(0.1, Math.min(1.0, effectiveDuration / totalLaps));
  }

  // Legacy: remaining race fraction from activation lap
  const remainingFraction = (totalLaps - activationLap + 1) / totalLaps;
  return Math.max(0.1, Math.min(1.0, remainingFraction));
}

/**
 * Compute the scenario active window (start/end laps).
 * Returns null if scenario is REAL_CONTEXT or no activation lap set.
 */
export function computeScenarioWindow(
  activationLap: number | null,
  durationLaps: number | null,
  totalLaps: number,
): { start: number; end: number } | null {
  if (activationLap == null && durationLaps == null) return null;
  const start = activationLap ?? 1;
  if (durationLaps != null && durationLaps > 0) {
    return { start, end: Math.min(start + durationLaps - 1, totalLaps) };
  }
  return { start, end: totalLaps };
}

/**
 * Blend a single modifier value with timing scale.
 * default_value is the neutral value (1.0 for multipliers, 0 for penalties).
 */
function blendModifier(value: number, scale: number, neutral: number): number {
  return neutral + (value - neutral) * scale;
}

/**
 * Build effective modifiers combining scenario + existing phase adjustments.
 * Scenario modifiers multiply on top of phase adjustments.
 * When activationLap/durationLaps are set, modifiers are scaled by the timed scenario factor.
 */
export function applyScenarioToPhaseAdjustments(
  scenarioId: ScenarioId,
  phaseAdjustments: { degradation_weight: number; traffic_weight: number; track_position_weight: number; risk_penalty_weight: number; neutralization_opportunity_weight: number },
  activationLap?: number | null,
  totalLaps?: number,
  durationLaps?: number | null,
): typeof phaseAdjustments {
  if (scenarioId === "REAL_CONTEXT") return phaseAdjustments;
  
  const mods = SCENARIO_DEFINITIONS[scenarioId].modifiers;
  const scale = computeTimedScenarioScale(activationLap ?? null, totalLaps ?? 0, undefined, durationLaps);

  return {
    degradation_weight: phaseAdjustments.degradation_weight * blendModifier(mods.degradation_weight, scale, 1.0),
    traffic_weight: phaseAdjustments.traffic_weight * blendModifier(mods.traffic_weight, scale, 1.0),
    track_position_weight: phaseAdjustments.track_position_weight * blendModifier(mods.track_position_weight, scale, 1.0),
    risk_penalty_weight: phaseAdjustments.risk_penalty_weight * blendModifier(mods.risk_penalty_weight, scale, 1.0),
    neutralization_opportunity_weight: phaseAdjustments.neutralization_opportunity_weight * blendModifier(mods.neutralization_weight, scale, 1.0),
  };
}

/**
 * Build timed scenario modifiers: scale each modifier based on activation lap timing.
 */
export function buildTimedScenarioModifiers(
  scenarioId: ScenarioId,
  activationLap: number | null,
  totalLaps: number,
  durationLaps?: number | null,
): ScenarioModifiers {
  if (scenarioId === "REAL_CONTEXT") return { ...DEFAULT_MODIFIERS };
  
  const mods = SCENARIO_DEFINITIONS[scenarioId].modifiers;
  const scale = computeTimedScenarioScale(activationLap, totalLaps, undefined, durationLaps);

  return {
    pit_loss_multiplier: blendModifier(mods.pit_loss_multiplier, scale, 1.0),
    traffic_weight: blendModifier(mods.traffic_weight, scale, 1.0),
    degradation_weight: blendModifier(mods.degradation_weight, scale, 1.0),
    opportunity_weight: blendModifier(mods.opportunity_weight, scale, 1.0),
    confidence_penalty: Math.round(mods.confidence_penalty * scale),
    weather_weight: blendModifier(mods.weather_weight, scale, 1.0),
    neutralization_weight: blendModifier(mods.neutralization_weight, scale, 1.0),
    risk_penalty_weight: blendModifier(mods.risk_penalty_weight, scale, 1.0),
    track_position_weight: blendModifier(mods.track_position_weight, scale, 1.0),
  };
}

/**
 * Validate scenario activation lap and duration.
 * Returns null if valid, or an error message string.
 */
export function validateScenarioActivationLap(
  scenarioId: ScenarioId,
  activationLap: number | null,
  totalLaps: number,
  durationLaps?: number | null,
): string | null {
  if (scenarioId === "REAL_CONTEXT") return null;
  if (activationLap != null) {
    if (!Number.isInteger(activationLap) || activationLap < 1) return "Il giro deve essere un intero ≥ 1";
    if (activationLap > totalLaps) return `Il giro deve essere ≤ ${totalLaps} (giri totali della gara)`;
    if (totalLaps - activationLap < 3 && (durationLaps == null || durationLaps <= 0)) return "Scenario con impatto limitato negli ultimi giri";
  }
  if (durationLaps != null) {
    if (!Number.isInteger(durationLaps) || durationLaps < 1) return "La durata deve essere un intero ≥ 1";
    const startLap = activationLap ?? 1;
    const endLap = startLap + durationLaps - 1;
    if (endLap > totalLaps) return `Finestra scenario troncata al giro ${totalLaps} (fine gara)`;
    if (durationLaps <= 1) return "Durata molto breve — impatto limitato";
  }
  return null;
}
