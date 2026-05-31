/**
 * Race Context Scenario System
 *
 * Provides what-if scenario modifiers for the Virtual Race Engineer.
 * Each scenario modifies model weights/parameters WITHOUT altering observed data.
 *
 * Anti-hallucination: scenarios ONLY change multipliers and weights.
 * No fake events, no altered telemetry, no invented lap times.
 *
 * Architecture:
 *   ScenarioDefinition  →  static modifier presets (tuned, not arbitrary)
 *   Severity / Relevance / Feasibility  →  internal helpers that modulate
 *       effective modifier strength based on timing, duration and race context
 *   Public API  →  unchanged, backward-compatible
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

/* ══════════════════════════════════════════════════════════════════
 *  INTERNAL CONFIGURATION
 * ══════════════════════════════════════════════════════════════════ */

/** Central config – all tunable constants live here */
const CFG = {
  /** Minimum scale factor to avoid total nullification */
  MIN_SCALE: 0.08,

  /* ── Timed scale curve ── */
  /** Below this fraction of race, scenario is "brief" → damped impact */
  BRIEF_FRACTION: 0.12,
  /** Damping exponent for brief scenarios (>1 = more damping) */
  BRIEF_DAMPING_EXP: 1.35,
  /** Scale curve exponent for normal durations (slight sub-linear) */
  NORMAL_CURVE_EXP: 0.88,

  /* ── Late-race damping ── */
  /** Activation lap beyond this fraction → apply late-race damping */
  LATE_RACE_THRESHOLD: 0.85,
  /** Maximum damping for very late scenarios */
  LATE_RACE_MAX_DAMP: 0.55,

  /* ── Severity bands ── */
  /** Severity levels for each scenario (0–1, higher = more extreme) */
  SEVERITY: {
    REAL_CONTEXT: 0,
    GREEN_RACE: 0.15,
    SAFETY_CAR: 0.75,
    VSC: 0.55,
    CLEAN_AIR: 0.20,
    HEAVY_TRAFFIC: 0.45,
    LIGHT_RAIN: 0.40,
    MIXED_CONDITIONS: 0.65,
    TYRE_CLIFF_RISK: 0.55,
    LATE_RACE_ATTACK: 0.50,
    BATTLE_MODE: 0.40,
    UNDERCUT_SCENARIO: 0.35,
    OVERCUT_SCENARIO: 0.30,
  } as Record<ScenarioId, number>,

  /* ── Feasibility ── */
  /** Min laps remaining for the scenario to be considered feasible */
  MIN_FEASIBLE_LAPS: 3,
  /** Min duration laps for non-trivial impact */
  MIN_MEANINGFUL_DURATION: 2,

  /* ── Validation messages ── */
  MSG_LAP_GE1: "Il giro deve essere un intero ≥ 1",
  MSG_DUR_GE1: "La durata deve essere un intero ≥ 1",
  MSG_VERY_SHORT: "Durata molto breve — impatto trascurabile",
  MSG_LATE_LIMITED: "Scenario con impatto limitato negli ultimi giri",
} as const;

/* ══════════════════════════════════════════════════════════════════
 *  DEFAULT MODIFIERS (neutral baseline)
 * ══════════════════════════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════════════════════════
 *  SHARED NEUTRALIZATION PIT LOSS CONSTANTS
 *  Single source of truth for the pit-loss reduction under
 *  observed/simulated neutralisations. Used by both scenario
 *  definitions (below) and the observed-data path in
 *  virtualRaceEngineer.ts (getObservedPitLossMultiplier).
 * ══════════════════════════════════════════════════════════════════ */

export const NEUTRALIZATION_PIT_LOSS = {
  SC: 0.62,    // ~38% reduction under full Safety Car
  VSC: 0.78,   // ~22% reduction under Virtual Safety Car
  MIXED: 0.90, // partial discount for mixed/transitional status
} as const;

/* ══════════════════════════════════════════════════════════════════
 *  SCENARIO DEFINITIONS
 *  Modifiers are calibrated to be realistic and moderate.
 *  Extreme values are avoided — contextual scaling handles intensity.
 * ══════════════════════════════════════════════════════════════════ */

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
      opportunity_weight: 0.85,
    },
  },
  SAFETY_CAR: {
    id: "SAFETY_CAR",
    label: "Safety Car",
    description: "Riduce il pit loss e aumenta il valore del pit opportunistico sotto SC",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      pit_loss_multiplier: NEUTRALIZATION_PIT_LOSS.SC,
      traffic_weight: 0.85,
      opportunity_weight: 1.25,
      neutralization_weight: 1.45,
      track_position_weight: 0.82,
    },
  },
  VSC: {
    id: "VSC",
    label: "Virtual Safety Car",
    description: "Riduzione moderata del pit loss e pit opportunistico favorito sotto VSC",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      pit_loss_multiplier: NEUTRALIZATION_PIT_LOSS.VSC,
      traffic_weight: 0.92,
      opportunity_weight: 1.12,
      neutralization_weight: 1.25,
    },
  },

  CLEAN_AIR: {
    id: "CLEAN_AIR",
    label: "Clean air",
    description: "Scenario senza traffico — undercut/overcut più leggibili",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      traffic_weight: 0.12,
      track_position_weight: 1.15,
    },
  },
  HEAVY_TRAFFIC: {
    id: "HEAVY_TRAFFIC",
    label: "Heavy traffic",
    description: "Traffico elevato — penalizza rientri ravvicinati e aumenta il peso del traffico",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      traffic_weight: 1.50,
      track_position_weight: 1.25,
      risk_penalty_weight: 1.18,
    },
  },
  LIGHT_RAIN: {
    id: "LIGHT_RAIN",
    label: "Light rain",
    description: "Pioggia leggera — confidenza ridotta, raccomandazioni più conservative",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      confidence_penalty: -1,
      degradation_weight: 1.08,
      weather_weight: 1.35,
      risk_penalty_weight: 1.22,
    },
  },
  MIXED_CONDITIONS: {
    id: "MIXED_CONDITIONS",
    label: "Mixed conditions",
    description: "Condizioni miste — alta incertezza, strategie conservative favorite",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      confidence_penalty: -2,
      degradation_weight: 1.12,
      weather_weight: 1.50,
      risk_penalty_weight: 1.40,
      opportunity_weight: 0.75,
    },
  },
  TYRE_CLIFF_RISK: {
    id: "TYRE_CLIFF_RISK",
    label: "Tyre cliff risk",
    description: "Rischio cliff gomme — penalizza stint estesi, anticipa la pit window",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      degradation_weight: 1.40,
      risk_penalty_weight: 1.25,
      opportunity_weight: 1.08,
    },
  },
  LATE_RACE_ATTACK: {
    id: "LATE_RACE_ATTACK",
    label: "Late race attack",
    description: "Fase di attacco finale — favorisce strategie aggressive",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      degradation_weight: 0.88,
      traffic_weight: 0.92,
      track_position_weight: 1.35,
      risk_penalty_weight: 0.72,
      opportunity_weight: 1.15,
    },
  },
  BATTLE_MODE: {
    id: "BATTLE_MODE",
    label: "Battle mode",
    description: "Battaglia attiva — aumenta peso di posizione e pressione competitiva",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      traffic_weight: 1.18,
      track_position_weight: 1.42,
      risk_penalty_weight: 1.08,
    },
  },
  UNDERCUT_SCENARIO: {
    id: "UNDERCUT_SCENARIO",
    label: "Undercut window",
    description: "Finestra undercut — favorisce pit anticipato e clean air post-pit",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      traffic_weight: 0.72,
      degradation_weight: 1.15,
      track_position_weight: 1.25,
      opportunity_weight: 1.15,
    },
  },
  OVERCUT_SCENARIO: {
    id: "OVERCUT_SCENARIO",
    label: "Overcut window",
    description: "Finestra overcut — favorisce estensione stint se il passo è sostenibile",
    modifiers: {
      ...DEFAULT_MODIFIERS,
      degradation_weight: 0.88,
      traffic_weight: 1.08,
      track_position_weight: 1.15,
      risk_penalty_weight: 0.92,
    },
  },
};

export const ALL_SCENARIO_IDS: ScenarioId[] = Object.keys(SCENARIO_DEFINITIONS) as ScenarioId[];

/* ══════════════════════════════════════════════════════════════════
 *  INTERNAL HELPERS — Severity / Relevance / Feasibility
 *  These refine how strongly a scenario's modifiers are applied.
 * ══════════════════════════════════════════════════════════════════ */

/**
 * Scenario severity: how extreme is the scenario by nature (0–1).
 * High severity → larger departure from baseline.
 */
function computeScenarioSeverity(id: ScenarioId): number {
  return CFG.SEVERITY[id] ?? 0;
}

/**
 * Scenario relevance: how much of the race does the scenario affect.
 * Returns 0–1 where 1 = entire race covered.
 * Uses the effective window fraction, with sub-linear scaling
 * so partial windows still get meaningful (but reduced) weight.
 */
function computeScenarioRelevance(
  activationLap: number | null,
  durationLaps: number | null,
  totalLaps: number,
): number {
  if (totalLaps <= 0) return 1.0;
  const start = activationLap ?? 1;
  const end = durationLaps != null && durationLaps > 0
    ? Math.min(start + durationLaps - 1, totalLaps)
    : totalLaps;
  const windowFraction = Math.max(0, end - start + 1) / totalLaps;
  // Sub-linear: sqrt gives partial windows more weight than pure linear
  return Math.min(1.0, Math.sqrt(windowFraction));
}

/**
 * Scenario feasibility: can this scenario produce meaningful effects?
 * Returns 0–1 where 0 = infeasible, 1 = fully feasible.
 * Penalises windows that are too short or too late for the scenario type.
 */
function computeScenarioFeasibility(
  id: ScenarioId,
  activationLap: number | null,
  durationLaps: number | null,
  totalLaps: number,
): number {
  if (id === "REAL_CONTEXT") return 1.0;
  if (totalLaps <= 0) return 1.0;

  const start = activationLap ?? 1;
  const remaining = totalLaps - start + 1;

  // Too few laps remaining → low feasibility
  if (remaining < CFG.MIN_FEASIBLE_LAPS) {
    return Math.max(0, remaining / CFG.MIN_FEASIBLE_LAPS);
  }

  // Very short explicit duration → reduced feasibility
  if (durationLaps != null && durationLaps > 0 && durationLaps < CFG.MIN_MEANINGFUL_DURATION) {
    return 0.4;
  }

  // Late-race scenarios: mild penalty unless the scenario is LATE_RACE_ATTACK
  if (id !== "LATE_RACE_ATTACK" && start / totalLaps > CFG.LATE_RACE_THRESHOLD) {
    const lateness = (start / totalLaps - CFG.LATE_RACE_THRESHOLD) / (1 - CFG.LATE_RACE_THRESHOLD);
    return Math.max(CFG.LATE_RACE_MAX_DAMP, 1.0 - lateness * 0.45);
  }

  return 1.0;
}

/**
 * Combined contextual scale: merges relevance and feasibility
 * with the raw timed scale. This is the internal "effective strength"
 * of the scenario at a given timing configuration.
 */
function computeContextualScale(
  id: ScenarioId,
  activationLap: number | null,
  totalLaps: number,
  durationLaps: number | null,
): number {
  const rawScale = computeRawTimedScale(activationLap, totalLaps, durationLaps);
  const relevance = computeScenarioRelevance(activationLap, durationLaps, totalLaps);
  const feasibility = computeScenarioFeasibility(id, activationLap, durationLaps, totalLaps);

  // Combine: raw provides the base, relevance & feasibility modulate
  // Using geometric-ish blend so all three contribute proportionally
  return Math.max(CFG.MIN_SCALE, rawScale * 0.5 + (rawScale * relevance * feasibility) * 0.5);
}

/* ══════════════════════════════════════════════════════════════════
 *  TIMED SCENARIO SCALE — improved non-linear model
 * ══════════════════════════════════════════════════════════════════ */

/**
 * Raw timed scale: the base factor before contextual adjustments.
 * Non-linear: brief scenarios are damped, long scenarios asymptote.
 */
function computeRawTimedScale(
  activationLap: number | null,
  totalLaps: number,
  durationLaps: number | null,
): number {
  if (totalLaps <= 0) return 1.0;

  // No activation & no duration → full effect
  if (activationLap == null && (durationLaps == null || durationLaps <= 0)) {
    // duration-only: scale by fraction
    return 1.0;
  }

  // Duration-only (no activation lap): window at start of race
  if ((activationLap == null || activationLap <= 1) && durationLaps != null && durationLaps > 0) {
    const fraction = Math.min(durationLaps, totalLaps) / totalLaps;
    return applyScaleCurve(fraction);
  }

  const start = activationLap ?? 1;
  if (start > totalLaps) return 0.0;

  if (durationLaps != null && durationLaps > 0) {
    const effectiveEnd = Math.min(start + durationLaps - 1, totalLaps);
    const fraction = (effectiveEnd - start + 1) / totalLaps;
    return applyScaleCurve(fraction);
  }

  // Remaining-race fraction from activation lap
  const fraction = (totalLaps - start + 1) / totalLaps;
  return applyScaleCurve(fraction);
}

/**
 * Apply non-linear scale curve to a race fraction (0–1).
 * Brief fractions are damped more aggressively; long fractions asymptote.
 */
function applyScaleCurve(fraction: number): number {
  const clamped = Math.max(0, Math.min(1.0, fraction));
  if (clamped < CFG.BRIEF_FRACTION) {
    // Brief window: stronger damping via power curve
    const normBrief = clamped / CFG.BRIEF_FRACTION;
    return Math.max(CFG.MIN_SCALE, CFG.BRIEF_FRACTION * Math.pow(normBrief, CFG.BRIEF_DAMPING_EXP));
  }
  // Normal/long: sub-linear growth so partial windows still meaningful
  return Math.max(CFG.MIN_SCALE, Math.pow(clamped, CFG.NORMAL_CURVE_EXP));
}

/* ══════════════════════════════════════════════════════════════════
 *  MODIFIER BLENDING
 * ══════════════════════════════════════════════════════════════════ */

/**
 * Blend a single modifier value toward neutral using a scale factor.
 * When scale=1, the full modifier applies.
 * When scale=0, the neutral value is returned.
 * Severity is used to cap how far extreme modifiers can deviate
 * from neutral when the scenario relevance is low.
 */
function blendModifier(value: number, scale: number, neutral: number, severity?: number): number {
  const delta = value - neutral;
  let effectiveScale = scale;

  // If severity is provided and low, dampen extreme deltas
  if (severity != null && severity < 0.3 && Math.abs(delta) > 0.3) {
    effectiveScale *= 0.7 + severity;
  }

  return neutral + delta * effectiveScale;
}

/* ══════════════════════════════════════════════════════════════════
 *  PUBLIC API — unchanged signatures
 * ══════════════════════════════════════════════════════════════════ */

export function getScenarioDefinition(id: ScenarioId): ScenarioDefinition {
  return SCENARIO_DEFINITIONS[id];
}

export function isSimulatedScenario(id: ScenarioId): boolean {
  return id !== "REAL_CONTEXT";
}

/**
 * Compute a scaling factor for timed scenarios.
 * Signature unchanged — internally uses improved non-linear model.
 */
export function computeTimedScenarioScale(
  activationLap: number | null,
  totalLaps: number,
  currentContextLap?: number,
  durationLaps?: number | null,
): number {
  return computeRawTimedScale(activationLap, totalLaps, durationLaps ?? null);
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
 * Build effective modifiers combining scenario + existing phase adjustments.
 * Uses contextual scaling (severity + relevance + feasibility) for
 * more realistic blending instead of raw timed scale alone.
 */
export function applyScenarioToPhaseAdjustments(
  scenarioId: ScenarioId,
  phaseAdjustments: {
    degradation_weight: number;
    traffic_weight: number;
    track_position_weight: number;
    risk_penalty_weight: number;
    neutralization_opportunity_weight: number;
  },
  activationLap?: number | null,
  totalLaps?: number,
  durationLaps?: number | null,
): typeof phaseAdjustments {
  if (scenarioId === "REAL_CONTEXT") return phaseAdjustments;

  const mods = SCENARIO_DEFINITIONS[scenarioId].modifiers;
  const tl = totalLaps ?? 0;
  const al = activationLap ?? null;
  const dl = durationLaps ?? null;
  const scale = computeContextualScale(scenarioId, al, tl, dl);
  const severity = computeScenarioSeverity(scenarioId);

  return {
    degradation_weight: phaseAdjustments.degradation_weight * blendModifier(mods.degradation_weight, scale, 1.0, severity),
    traffic_weight: phaseAdjustments.traffic_weight * blendModifier(mods.traffic_weight, scale, 1.0, severity),
    track_position_weight: phaseAdjustments.track_position_weight * blendModifier(mods.track_position_weight, scale, 1.0, severity),
    risk_penalty_weight: phaseAdjustments.risk_penalty_weight * blendModifier(mods.risk_penalty_weight, scale, 1.0, severity),
    neutralization_opportunity_weight: phaseAdjustments.neutralization_opportunity_weight * blendModifier(mods.neutralization_weight, scale, 1.0, severity),
  };
}

/**
 * Build timed scenario modifiers with contextual scaling.
 * Same return type — internally uses severity-aware blending.
 */
export function buildTimedScenarioModifiers(
  scenarioId: ScenarioId,
  activationLap: number | null,
  totalLaps: number,
  durationLaps?: number | null,
): ScenarioModifiers {
  if (scenarioId === "REAL_CONTEXT") return { ...DEFAULT_MODIFIERS };

  const mods = SCENARIO_DEFINITIONS[scenarioId].modifiers;
  const scale = computeContextualScale(scenarioId, activationLap, totalLaps, durationLaps ?? null);
  const severity = computeScenarioSeverity(scenarioId);

  return {
    pit_loss_multiplier: blendModifier(mods.pit_loss_multiplier, scale, 1.0, severity),
    traffic_weight: blendModifier(mods.traffic_weight, scale, 1.0, severity),
    degradation_weight: blendModifier(mods.degradation_weight, scale, 1.0, severity),
    opportunity_weight: blendModifier(mods.opportunity_weight, scale, 1.0, severity),
    confidence_penalty: Math.round(mods.confidence_penalty * scale),
    weather_weight: blendModifier(mods.weather_weight, scale, 1.0, severity),
    neutralization_weight: blendModifier(mods.neutralization_weight, scale, 1.0, severity),
    risk_penalty_weight: blendModifier(mods.risk_penalty_weight, scale, 1.0, severity),
    track_position_weight: blendModifier(mods.track_position_weight, scale, 1.0, severity),
  };
}

/**
 * Validate scenario activation lap and duration.
 * Returns null if valid, or an error/warning message string.
 */
export function validateScenarioActivationLap(
  scenarioId: ScenarioId,
  activationLap: number | null,
  totalLaps: number,
  durationLaps?: number | null,
): string | null {
  if (scenarioId === "REAL_CONTEXT") return null;

  if (activationLap != null) {
    if (!Number.isInteger(activationLap) || activationLap < 1) return CFG.MSG_LAP_GE1;
    if (activationLap > totalLaps) return `Il giro deve essere ≤ ${totalLaps} (giri totali della gara)`;

    const remaining = totalLaps - activationLap + 1;
    if (remaining < CFG.MIN_FEASIBLE_LAPS && (durationLaps == null || durationLaps <= 0)) {
      return CFG.MSG_LATE_LIMITED;
    }
  }

  if (durationLaps != null) {
    if (!Number.isInteger(durationLaps) || durationLaps < 1) return CFG.MSG_DUR_GE1;
    const startLap = activationLap ?? 1;
    const endLap = startLap + durationLaps - 1;
    if (endLap > totalLaps) return `Finestra scenario troncata al giro ${totalLaps} (fine gara)`;
    if (durationLaps < CFG.MIN_MEANINGFUL_DURATION) return CFG.MSG_VERY_SHORT;
  }

  // Warn if the effective window is negligibly small
  if (activationLap != null || durationLaps != null) {
    const feasibility = computeScenarioFeasibility(scenarioId, activationLap ?? null, durationLaps ?? null, totalLaps);
    if (feasibility < 0.3) return "Finestra scenario troppo breve o tardiva per avere impatto significativo";
  }

  return null;
}
