/**
 * Soft Sensors — Latent State Estimation Layer
 *
 * Estimates qualitative/semi-quantitative latent states useful for strategy
 * interpretation. Does NOT measure physical values — only infers observable
 * patterns from data already computed by upstream modules.
 *
 * Two layers:
 * 1. Timeline: per-lap state estimation
 * 2. Strategy Refinement: small, traceable adjustments to simulated strategy costs
 *
 * Anti-hallucination:
 * - No real temperatures, pressures or physical telemetry
 * - UNKNOWN when evidence is insufficient
 * - Every label accompanied by confidence and reasons
 * - Extreme states require multiple converging signals
 * - Adjustments are small, clamped, and anti-double-counting
 */

import type { StintAnalysis, PitStopAnalysis } from "./virtualRaceEngineer";
import type { WeatherCondition } from "./weatherClassification";
import type { TrackStatus } from "./trackStatusClassification";
import type { DegradationValidationResult } from "./degradationValidation";
import type { StintPaceLossResult } from "./stintPaceLoss";
import type { BattleContext } from "./vreContext";
import { TYRE_WARMUP_CONFIG } from "./tyreWarmup";

/* ══════════════════════════════════════════════════════════════════
 * TYPES
 * ══════════════════════════════════════════════════════════════════ */

export type SoftSensorConfidence = "HIGH" | "MEDIUM" | "LOW";

/**
 * NOTE: "OVERHEATED" è una label riservata: nessun estimatore attuale la emette.
 * Viene mantenuta nel tipo per compatibilità con i consumatori a valle (gate,
 * refinement e decision context) che la contemplano in modo difensivo. I rami
 * che la consumano non sono attivi finché non verrà introdotto un estimatore
 * dedicato.
 */
export type TyreThermalLabel = "COLD" | "WARMING_UP" | "IN_WINDOW" | "HOT" | "OVERHEATED" | "UNKNOWN";
export type TyreStressLabel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | "UNKNOWN";
export type TrackGripLabel = "LOW_GRIP" | "IMPROVING" | "STABLE" | "FALLING" | "MIXED" | "UNKNOWN";

export interface SoftSensorResult {
  label: string;
  score: number | null;
  confidence: SoftSensorConfidence;
  reasons: string[];
  contaminated_by?: string[];
  source_signals?: string[];
}

export interface TyreThermalSensor extends SoftSensorResult {
  label: TyreThermalLabel;
  /**
   * Completamento warmup osservato dai residui dei tempi sul giro (tyreAge a
   * partire dalla quale lo stint è considerato in finestra). `number` = stima
   * osservata disponibile; `null` = valutazione tentata ma non disponibile
   * (fallback al modello con confidence degradata); assente = giri del pilota
   * non forniti al call site (comportamento puramente da modello, legacy).
   */
  observed_warmup_completion?: number | null;
  /** "observed" quando la label warmup deriva dai residui; "model" altrimenti. */
  warmup_source?: "observed" | "model";
}

export interface TyreStressSensor extends SoftSensorResult {
  label: TyreStressLabel;
  /**
   * Sotto-punteggio derivato ESCLUSIVAMENTE da segnali osservazionali
   * indipendenti dal fit del degrado (età gomma/stint, battaglia attiva,
   * restart recente, meteo misto). È l'unica componente che può essere
   * usata come corroborazione indipendente in analyzeStressConsistency.
   */
  observational_score?: number;
  /**
   * Sotto-punteggio derivato dalle uscite di altri moduli (effective_slope
   * della validazione del degrado, stato del pace loss). NON può essere
   * usato come corroborazione della validazione del degrado, perché è già
   * funzione di quella stessa fonte: userlo introduce circolarità.
   */
  derived_score?: number;
}

export interface TrackGripSensor extends SoftSensorResult {
  label: TrackGripLabel;
}

/* ── Backward-compatible summary ── */
export interface SoftSensorsContext {
  tyre_thermal: TyreThermalSensor;
  tyre_stress: TyreStressSensor;
  track_grip: TrackGripSensor;
  overall_confidence: SoftSensorConfidence;
  reliability_notes: string[];
}

/* ── Lap-by-lap timeline types ── */
export interface SoftSensorsLapState {
  lap_number: number;
  stint_number: number;
  tyre_thermal: TyreThermalSensor;
  tyre_stress: TyreStressSensor;
  track_grip: TrackGripSensor;
  overall_confidence: SoftSensorConfidence;
  reliability_notes: string[];
}

export interface GripTransition {
  lap: number;
  from: TrackGripLabel;
  to: TrackGripLabel;
}

export interface SoftSensorsTimelineSummary {
  latest_state: SoftSensorsLapState | null;
  first_high_stress_lap: number | null;
  first_critical_stress_lap: number | null;
  warmup_laps_by_stint: Map<number, number>;
  grip_transitions: GripTransition[];
  overall_confidence: SoftSensorConfidence;
  reliability_notes: string[];
}

export interface SoftSensorsTimeline {
  by_lap: SoftSensorsLapState[];
  summary: SoftSensorsTimelineSummary;
}

/* ── Strategy refinement types ── */
export interface StrategySoftSensorAdjustment {
  thermal_adjustment_total: number;
  stress_adjustment_total: number;
  grip_adjustment_total: number;
  total_soft_sensor_adjustment: number;
  adjustment_reasons: string[];
  confidence: SoftSensorConfidence;
}

/* ── Scoring gate types ── */
export interface SoftSensorScoringGate {
  soft_sensor_scoring_enabled: boolean;
  soft_sensor_block_reason: string | null;
}

/**
 * Validates whether soft sensors can influence scoring.
 * Gate conditions:
 * 1. Timeline available and non-empty
 * 2. Overall confidence != LOW
 * 3. DegradationValidationContext overall_support != WEAK
 * 4. No major conflicts between thermal/stress/grip
 */
export function validateSoftSensorScoringGate(
  timeline: SoftSensorsTimeline | undefined,
  validationContext: DegradationValidationContext | undefined,
): SoftSensorScoringGate {
  if (!timeline || timeline.by_lap.length === 0) {
    return { soft_sensor_scoring_enabled: false, soft_sensor_block_reason: "Timeline soft sensors non disponibile" };
  }

  if (timeline.summary.overall_confidence === "LOW") {
    return { soft_sensor_scoring_enabled: false, soft_sensor_block_reason: "Confidence complessiva della timeline troppo bassa (LOW)" };
  }

  if (validationContext && validationContext.overall_support === "WEAK") {
    return { soft_sensor_scoring_enabled: false, soft_sensor_block_reason: "Supporto validazione degrado debole (WEAK) — soft sensors non affidabili per lo scoring" };
  }

  // Check signal coherence: if >40% of laps have conflicting extreme states, block
  const conflictLaps = timeline.by_lap.filter(l => {
    const thermalExtreme = l.tyre_thermal.label === "COLD" || l.tyre_thermal.label === "OVERHEATED";
    const stressExtreme = l.tyre_stress.label === "CRITICAL";
    const gripExtreme = l.track_grip.label === "LOW_GRIP" || l.track_grip.label === "FALLING";
    // Conflict: thermal says cold but stress says critical (contradictory)
    if (l.tyre_thermal.label === "COLD" && l.tyre_stress.label === "CRITICAL") return true;
    // Conflict: grip improving but stress critical and thermal overheated
    if (l.track_grip.label === "IMPROVING" && stressExtreme && thermalExtreme) return true;
    return false;
  });

  if (conflictLaps.length > timeline.by_lap.length * 0.4) {
    return { soft_sensor_scoring_enabled: false, soft_sensor_block_reason: "Segnali soft sensor in conflitto su oltre il 40% dei giri — scoring disabilitato" };
  }

  return { soft_sensor_scoring_enabled: true, soft_sensor_block_reason: null };
}

/** Maximum delta between strategies beyond which SS scoring is ignored */
const SS_SCORING_DELTA_THRESHOLD = 5.0; // seconds

/**
 * Compute soft sensor scoring delta for a strategy.
 * Returns the amount to add to the scoring adjusted_score.
 * 
 * Rules:
 * - If gate is closed → 0
 * - If strategy delta vs best is > threshold → 0
 * - Confidence weighting: HIGH=1.0, MEDIUM=0.5, LOW=0
 * - Global clamp: ±1.0s max effect on scoring
 */
export function computeSoftSensorScoringDelta(
  adjustment: StrategySoftSensorAdjustment,
  gate: SoftSensorScoringGate,
  strategyDelta: number,
  bestDelta: number,
): number {
  if (!gate.soft_sensor_scoring_enabled) return 0;

  // If this strategy is far from the best, SS cannot influence
  if (Math.abs(strategyDelta - bestDelta) > SS_SCORING_DELTA_THRESHOLD) return 0;

  const confWeight = adjustment.confidence === "HIGH" ? 1.0 : adjustment.confidence === "MEDIUM" ? 0.5 : 0;
  if (confWeight === 0) return 0;

  // SS adjustment is a cost (positive = penalty). For scoring, we invert:
  // higher SS cost → lower score
  const rawDelta = -adjustment.total_soft_sensor_adjustment * confWeight;

  // Clamp to ±1.0s to keep it weak
  return Math.max(-1.0, Math.min(1.0, Math.round(rawDelta * 100) / 100));
}

/* ── Warmup Interpretation types ── */
export interface WarmupAnomaly {
  stint_number: number;
  type: "FASTER_THAN_EXPECTED" | "SLOWER_THAN_EXPECTED";
  expected_laps: number;
  observed_laps: number;
  detail: string;
}

export interface WarmupInterpretation {
  warmup_observed_laps_by_stint: Map<number, number>;
  warmup_anomalies: WarmupAnomaly[];
  reliability_notes: string[];
}

/* ── Degradation Validation Context types ── */
export type ValidationSupportLevel = "STRONG" | "PARTIAL" | "WEAK";

export interface StintValidationContext {
  stint_number: number;
  support_level: ValidationSupportLevel;
  support_score: number;           // 0–1
  contamination_score: number;     // 0–1
  support_signals: string[];
  contradiction_signals: string[];
  notes: string[];
  adjusted_confidence: SoftSensorConfidence;
  /** Sub-axis details */
  thermal_support_score: number;
  thermal_contamination_flag: boolean;
  thermal_notes: string[];
  stress_support_score: number;
  stress_inconsistency_flag: boolean;
  stress_notes: string[];
  grip_contamination_score: number;
  grip_support_score: number;
  grip_notes: string[];
  /** Backward-compat */
  inconsistencies: string[];
}

export interface DegradationValidationContext {
  by_stint: StintValidationContext[];
  overall_support: ValidationSupportLevel;
  reliability_notes: string[];
}

/* ── Soft Sensor Context for Decision Points ── */
export interface DecisionSoftSensorContext {
  thermal_state_summary: string;
  stress_state_summary: string;
  grip_state_summary: string;
  consistency: SoftSensorConfidence;
  notes: string[];
}

/* ══════════════════════════════════════════════════════════════════
 * TYRE THERMAL STATE (single lap)
 * ══════════════════════════════════════════════════════════════════ */

export function estimateTyreThermalState(
  currentStint: StintAnalysis | null,
  currentLap: number,
  pitStops: PitStopAnalysis[],
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  battleContext: BattleContext | null,
  /**
   * Completamento warmup osservato per questo stint dai residui dei tempi:
   *   - `undefined`  → non valutato (giri del pilota non forniti): comportamento
   *                    puramente da modello, identico al pre-refactor.
   *   - `null`       → valutato ma non disponibile (fixture insufficienti):
   *                    fallback al modello con confidence degradata a MEDIUM
   *                    e reason "warmup da modello, non osservato".
   *   - `number`     → soglia osservata di tyreAge da cui lo stint è considerato
   *                    in finestra termica; sostituisce laps_affected del modello
   *                    per il confronto di warmup, lasciando invariati i rami
   *                    contestuali (restart, battaglia lunga, contaminazioni).
   */
  observedWarmupCompletion?: number | null,
): TyreThermalSensor {
  if (!currentStint) {
    return { label: "UNKNOWN", score: null, confidence: "LOW", reasons: ["Nessuno stint attivo disponibile"] };
  }

  const compound = (currentStint.compound ?? "").toUpperCase();
  const warmupConfig = TYRE_WARMUP_CONFIG[compound];
  const tyreAge = currentLap - currentStint.lap_start;
  const reasons: string[] = [];
  const contaminated: string[] = [];
  const sources: string[] = ["compound", "tyre_age", "warmup_model"];
  let confidence = "HIGH" as SoftSensorConfidence;

  const lapsAffected = warmupConfig?.laps_affected ?? 3;

  // Soglia di warmup: osservata quando disponibile, altrimenti modello.
  const hasObserved = typeof observedWarmupCompletion === "number";
  const effectiveWarmupLaps = hasObserved ? (observedWarmupCompletion as number) : lapsAffected;
  const warmupSource: "observed" | "model" = hasObserved ? "observed" : "model";
  if (hasObserved) sources.push("observed_warmup");
  const isInWarmup = tyreAge < effectiveWarmupLaps;
  // Fallback dichiarato: giri forniti ma osservazione non calcolabile.
  const isModelFallback = observedWarmupCompletion === null;

  const currentWeather = weatherMap.get(currentLap);
  if (currentWeather === "WET" || currentWeather === "MIXED") {
    contaminated.push("meteo non dry");
    confidence = "LOW";
    sources.push("weather");
  }

  const currentTrackStatus = trackStatusMap.get(currentLap);
  if (currentTrackStatus && currentTrackStatus !== "GREEN") {
    contaminated.push(`neutralizzazione: ${currentTrackStatus}`);
    if (confidence !== "LOW") confidence = "MEDIUM";
    sources.push("track_status");
  }

  let recentNeutralization = false;
  for (let l = Math.max(1, currentLap - 3); l < currentLap; l++) {
    const ts = trackStatusMap.get(l);
    if (ts === "SC" || ts === "VSC") {
      recentNeutralization = true;
      break;
    }
  }

  const inBattle = battleContext?.battle_laps.has(currentLap) ?? false;
  if (inBattle) {
    sources.push("battle_context");
  }

  let label: TyreThermalLabel;
  let score: number | null = null;

  if (contaminated.length > 1) {
    label = "UNKNOWN";
    reasons.push("Segnali contrastanti: lettura termica non affidabile");
    confidence = "LOW";
  } else if (isInWarmup) {
    // NOTA: nessuno dei rami sottostanti emette "OVERHEATED"; è una label
    // riservata (vedi commento sul tipo TyreThermalLabel).
    if (tyreAge === 0) {
      label = "COLD";
      score = 0.15;
      reasons.push(`Primo giro su ${compound} dopo pit stop`);
      if (compound === "HARD") {
        reasons.push("Mescola Hard: riscaldamento più lento (coerente con modello warmup)");
        score = 0.1;
      }
    } else {
      label = "WARMING_UP";
      const denom = Math.max(1, effectiveWarmupLaps);
      score = 0.2 + Math.min(1, tyreAge / denom) * 0.4;
      const src = hasObserved ? "osservato" : "previsto";
      reasons.push(`Giro ${tyreAge + 1} di ${effectiveWarmupLaps} ${src} per il riscaldamento (${compound})`);
    }
    if (inBattle) {
      // La battaglia disturba la lettura ma non cancella il fatto fisico del
      // riscaldamento: manteniamo la label warmup e degradiamo la confidence.
      contaminated.push("battaglia attiva");
      reasons.push("Battaglia attiva durante il warmup: lettura degradata ma coerente col riscaldamento");
      confidence = "MEDIUM";
    }
    if (recentNeutralization) {
      reasons.push("Neutralizzazione recente: gomme potenzialmente più fredde del previsto");
      if (score != null) score = Math.max(0.1, score - 0.15);
      if (confidence === "HIGH") confidence = "MEDIUM";
    }
  } else if (recentNeutralization && tyreAge < lapsAffected + 2) {
    label = "WARMING_UP";
    score = 0.35;
    reasons.push("Restart dopo neutralizzazione: gomme in fase di ri-riscaldamento");
    confidence = "MEDIUM";
  } else if (inBattle && tyreAge > lapsAffected * 2) {
    label = "HOT";
    score = 0.85;
    reasons.push("Battaglia attiva con gomme ad alta età: probabile stress termico elevato");
    confidence = "MEDIUM";
  } else if (tyreAge >= effectiveWarmupLaps) {
    label = "IN_WINDOW";
    score = 0.65;
    const src = hasObserved ? "osservati" : "previsti";
    reasons.push(`Gomme ${compound} a regime dopo ${effectiveWarmupLaps} giri ${src} di riscaldamento`);
    if (currentWeather === "WET" || currentWeather === "MIXED") {
      confidence = "LOW";
    }
  } else {
    label = "UNKNOWN";
    reasons.push("Dati insufficienti per stimare lo stato termico");
    confidence = "LOW";
  }

  if (isModelFallback) {
    reasons.push("Warmup da modello, non osservato (giri puliti insufficienti per la stima)");
    if (confidence === "HIGH") confidence = "MEDIUM";
  }

  return {
    label,
    score,
    confidence,
    reasons,
    contaminated_by: contaminated.length > 0 ? contaminated : undefined,
    source_signals: sources,
    observed_warmup_completion: hasObserved
      ? (observedWarmupCompletion as number)
      : (observedWarmupCompletion === null ? null : undefined),
    warmup_source: warmupSource,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * TYRE STRESS STATE (single lap)
 * ══════════════════════════════════════════════════════════════════ */

export function estimateTyreStressState(
  currentStint: StintAnalysis | null,
  degradationValidation: DegradationValidationResult | null,
  paceLossResult: StintPaceLossResult | null,
  battleContext: BattleContext | null,
  currentLap: number,
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
): TyreStressSensor {
  if (!currentStint) {
    return { label: "UNKNOWN", score: null, confidence: "LOW", reasons: ["Nessuno stint attivo disponibile"] };
  }

  const tyreAge = currentLap - currentStint.lap_start;
  const stintLength = currentStint.laps_count;
  const reasons: string[] = [];
  const contaminated: string[] = [];
  const sources: string[] = ["tyre_age", "stint_length"];
  let confidence = "HIGH" as SoftSensorConfidence;

  // Separazione in due accumulatori per rompere la circolarità con la
  // validazione del degrado. La somma osservazionale + derivato coincide con
  // lo stressScore che il sensore già produceva, così label, soglie e
  // confidence restano bit-identiche.
  //  - observational: segnali indipendenti dal fit (età gomma/stint, battaglia,
  //    restart, meteo misto). Sono l'unica componente utilizzabile a valle
  //    come corroborazione della validazione del degrado.
  //  - derived: contributi provenienti dalla effective_slope della validazione
  //    e dallo stato del pace loss. Non possono corroborare la validazione da
  //    cui provengono, pena doppio conteggio della stessa fonte.
  let observationalRaw = 0;
  let derivedRaw = 0;

  const ageRatio = stintLength > 0 ? tyreAge / stintLength : 0;
  if (ageRatio > 0.8) {
    observationalRaw += 0.3;
    reasons.push(`Gomma a ${Math.round(ageRatio * 100)}% della lunghezza stint`);
  } else if (ageRatio > 0.5) {
    observationalRaw += 0.15;
  }

  if (degradationValidation) {
    sources.push("degradation_validation");
    if (degradationValidation.status === "INVALID") {
      contaminated.push("validazione degrado INVALID");
      confidence = "MEDIUM";
    } else if (degradationValidation.status === "VALID") {
      const slope = degradationValidation.effective_slope;
      if (slope > 0.12) {
        derivedRaw += 0.3;
        reasons.push(`Degrado elevato (${slope.toFixed(3)} s/giro)`);
      } else if (slope > 0.06) {
        derivedRaw += 0.15;
        reasons.push(`Degrado moderato (${slope.toFixed(3)} s/giro)`);
      }
    }
  } else {
    if (confidence !== "LOW") confidence = "MEDIUM";
  }

  if (paceLossResult) {
    sources.push("pace_loss");
    if (paceLossResult.pace_loss_status === "CLIFF_RISK") {
      derivedRaw += 0.35;
      reasons.push("Rischio cliff rilevato dal pace loss");
    } else if (paceLossResult.pace_loss_status === "HIGH_LOSS") {
      derivedRaw += 0.2;
      reasons.push("Perdita di passo elevata");
    } else if (paceLossResult.pace_loss_status === "UNRELIABLE") {
      contaminated.push("pace loss inaffidabile");
      if (confidence === "HIGH") confidence = "MEDIUM";
    }
  }

  if (battleContext && battleContext.battle_laps.has(currentLap)) {
    observationalRaw += 0.1;
    reasons.push("Battaglia attiva: stress addizionale da guida aggressiva");
    sources.push("battle_context");
  }

  const currentWeather = weatherMap.get(currentLap);
  if (currentWeather === "MIXED") {
    observationalRaw += 0.1;
    reasons.push("Meteo misto: stress termico da variazione aderenza");
    sources.push("weather");
    if (confidence === "HIGH") confidence = "MEDIUM";
  }

  const currentTrackStatus = trackStatusMap.get(currentLap);
  let justRestarted = false;
  for (let l = Math.max(1, currentLap - 2); l < currentLap; l++) {
    const ts = trackStatusMap.get(l);
    if ((ts === "SC" || ts === "VSC") && (currentTrackStatus === "GREEN" || !currentTrackStatus)) {
      justRestarted = true;
      break;
    }
  }
  if (justRestarted) {
    observationalRaw += 0.1;
    reasons.push("Restart recente: stress da riscaldamento rapido");
    sources.push("track_status");
  }

  const totalRaw = observationalRaw + derivedRaw;
  let stressScore = Math.min(1, Math.max(0, totalRaw));

  // Ripartizione delle quote esposte come sotto-punteggi: se il clamp riduce
  // il totale, riscaliamo proporzionalmente osservazionale e derivato in modo
  // che observational_score + derived_score === stressScore esattamente
  // (prima dell'arrotondamento per esposizione).
  const scale = totalRaw > 0 ? stressScore / totalRaw : 0;
  const observationalScoreExact = observationalRaw * scale;
  const derivedScoreExact = derivedRaw * scale;

  let label: TyreStressLabel;
  if (contaminated.length >= 2 || (confidence === "LOW" && stressScore < 0.3)) {
    label = "UNKNOWN";
    confidence = "LOW";
    if (reasons.length === 0) reasons.push("Dati insufficienti per stimare lo stress gomma");
  } else if (stressScore >= 0.7) {
    if (reasons.length >= 3) {
      label = "CRITICAL";
    } else {
      label = "HIGH";
      confidence = confidence === "HIGH" ? "MEDIUM" : confidence;
    }
  } else if (stressScore >= 0.4) {
    label = "HIGH";
  } else if (stressScore >= 0.2) {
    label = "MODERATE";
  } else {
    label = "LOW";
  }

  // Arrotondamento delle quote garantendo comunque la coerenza numerica con
  // score: derived_score = score - observational_score arrotondati, così il
  // test di equivalenza somma == score è sempre soddisfatto.
  const scoreRounded = stressScore > 0 ? Math.round(stressScore * 100) / 100 : 0;
  const observationalRounded = Math.round(observationalScoreExact * 100) / 100;
  const derivedRounded = Math.round((scoreRounded - observationalRounded) * 100) / 100;

  return {
    label,
    score: stressScore > 0 ? scoreRounded : null,
    confidence,
    reasons: reasons.length > 0 ? reasons : ["Nessun segnale di stress rilevato"],
    contaminated_by: contaminated.length > 0 ? contaminated : undefined,
    source_signals: sources,
    observational_score: observationalRounded,
    derived_score: derivedRounded,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * TRACK GRIP STATE (single lap)
 * ══════════════════════════════════════════════════════════════════ */

export function estimateTrackGripState(
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  currentLap: number,
  totalLaps: number,
): TrackGripSensor {
  const reasons: string[] = [];
  const sources: string[] = [];
  let confidence = "HIGH" as SoftSensorConfidence;

  const windowSize = Math.min(5, currentLap);
  const recentWeather: WeatherCondition[] = [];
  for (let l = Math.max(1, currentLap - windowSize + 1); l <= currentLap; l++) {
    const w = weatherMap.get(l);
    if (w) recentWeather.push(w);
  }

  if (recentWeather.length === 0) {
    return { label: "UNKNOWN", score: null, confidence: "LOW", reasons: ["Nessun dato meteo disponibile"], source_signals: ["weather"] };
  }

  sources.push("weather");

  const wetCount = recentWeather.filter(w => w === "WET").length;
  const mixedCount = recentWeather.filter(w => w === "MIXED").length;
  const dryCount = recentWeather.filter(w => w === "DRY").length;

  let neutralizedInWindow = 0;
  for (let l = Math.max(1, currentLap - windowSize + 1); l <= currentLap; l++) {
    const ts = trackStatusMap.get(l);
    if (ts && ts !== "GREEN") neutralizedInWindow++;
  }
  if (neutralizedInWindow > 0) {
    sources.push("track_status");
  }

  // La finestra "earlier" deve contenere solo giri STRETTAMENTE precedenti
  // all'inizio della finestra "recent" (altrimenti nei primi giri le due
  // finestre si sovrappongono e gli stessi giri vengono contati due volte).
  const recentStart = Math.max(1, currentLap - windowSize + 1);
  const earlierEnd = recentStart - 1;
  const earlierStart = Math.max(1, earlierEnd - windowSize + 1);
  const earlierWeather: WeatherCondition[] = [];
  if (earlierEnd >= earlierStart && earlierEnd >= 1) {
    for (let l = earlierStart; l <= earlierEnd; l++) {
      const w = weatherMap.get(l);
      if (w) earlierWeather.push(w);
    }
  }
  const earlierWet = earlierWeather.filter(w => w === "WET").length;
  const hasEarlierWindow = earlierWeather.length > 0;

  let label: TrackGripLabel;
  let score: number | null = null;

  if (wetCount === recentWeather.length) {
    label = "LOW_GRIP";
    score = 0.2;
    reasons.push("Tutti i giri recenti in condizioni di bagnato");
  } else if (wetCount > 0 && dryCount > 0) {
    label = "MIXED";
    score = 0.4;
    reasons.push("Condizioni miste nella finestra recente: segnali contrastanti");
    confidence = "MEDIUM";
  } else if (mixedCount > recentWeather.length / 2) {
    label = "MIXED";
    score = 0.45;
    reasons.push("Prevalenza di condizioni miste nella finestra recente");
    confidence = "MEDIUM";
  } else if (hasEarlierWindow && earlierWet > 0 && wetCount === 0 && dryCount > 0) {
    // Richiede una finestra earlier realmente disponibile: senza giri
    // precedenti sufficienti la transizione bagnato→asciutto non è valutabile.
    label = "IMPROVING";
    score = 0.55;
    reasons.push("Transizione da bagnato ad asciutto: pista in fase di asciugatura");
    sources.push("weather_transition");
    confidence = "MEDIUM";
  } else if (dryCount === recentWeather.length) {
    if (neutralizedInWindow > 2) {
      label = "MIXED";
      score = 0.5;
      reasons.push("Condizioni asciutte ma neutralizzazioni frequenti alterano la lettura del grip");
      confidence = "MEDIUM";
    } else if (currentLap > totalLaps * 0.3) {
      label = "STABLE";
      score = 0.7;
      reasons.push("Condizioni asciutte costanti: grip stimato stabile");
    } else {
      label = "IMPROVING";
      score = 0.55;
      reasons.push("Fase iniziale gara su asciutto: pista in fase di gommatura (assunzione di evoluzione tipica della pista, non verificata sui tempi)");
      confidence = "MEDIUM";
    }
  } else {
    label = "UNKNOWN";
    reasons.push("Segnali insufficienti per determinare lo stato grip");
    confidence = "LOW";
  }

  return {
    label,
    score,
    confidence,
    reasons,
    source_signals: sources,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * BACKWARD-COMPATIBLE SUMMARY (from snapshot)
 * ══════════════════════════════════════════════════════════════════ */

function worstConfidence(...confs: SoftSensorConfidence[]): SoftSensorConfidence {
  const order: SoftSensorConfidence[] = ["LOW", "MEDIUM", "HIGH"];
  const minIdx = Math.min(...confs.map(c => order.indexOf(c)));
  return order[minIdx];
}

export function computeSoftSensors(
  stints: StintAnalysis[],
  pitStops: PitStopAnalysis[],
  degradationValidations: DegradationValidationResult[],
  paceLossResults: StintPaceLossResult[],
  battleContext: BattleContext | null,
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  totalLaps: number,
): SoftSensorsContext {
  const currentStint = stints.length > 0 ? stints[stints.length - 1] : null;
  const currentLap = currentStint ? currentStint.lap_end : totalLaps;

  const currentStintValidation = currentStint
    ? degradationValidations.find(v => v.original.stint === currentStint.stint_number) ?? null
    : null;

  const currentPaceLoss = currentStint
    ? paceLossResults.find(r => r.stint_number === currentStint.stint_number) ?? null
    : null;

  const thermal = estimateTyreThermalState(
    currentStint, currentLap, pitStops, weatherMap, trackStatusMap, battleContext,
  );

  const stress = estimateTyreStressState(
    currentStint, currentStintValidation, currentPaceLoss,
    battleContext, currentLap, weatherMap, trackStatusMap,
  );

  const grip = estimateTrackGripState(weatherMap, trackStatusMap, currentLap, totalLaps);

  const overallConfidence = worstConfidence(thermal.confidence, stress.confidence, grip.confidence);

  const reliabilityNotes: string[] = [];
  if (thermal.contaminated_by?.length) reliabilityNotes.push(`Stato termico contaminato da: ${thermal.contaminated_by.join(", ")}`);
  if (stress.contaminated_by?.length) reliabilityNotes.push(`Stress gomma contaminato da: ${stress.contaminated_by.join(", ")}`);
  if (thermal.label === "UNKNOWN") reliabilityNotes.push("Stato termico non determinabile: lettura a bassa affidabilità");
  if (stress.label === "UNKNOWN") reliabilityNotes.push("Stress gomma non determinabile: dati insufficienti");
  if (grip.label === "UNKNOWN") reliabilityNotes.push("Stato grip pista non determinabile");

  return {
    tyre_thermal: thermal,
    tyre_stress: stress,
    track_grip: grip,
    overall_confidence: overallConfidence,
    reliability_notes: reliabilityNotes,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * LAP-BY-LAP TIMELINE
 * ══════════════════════════════════════════════════════════════════ */

function findStintForLap(stints: StintAnalysis[], lap: number): StintAnalysis | null {
  return stints.find(s => lap >= s.lap_start && lap <= s.lap_end) ?? null;
}

/**
 * Confidence complessiva della timeline: aggregato distributivo su TUTTI i
 * giri (non solo l'ultimo, che rendeva il gate dipendente da un singolo giro
 * e bloccava lo scoring per gare finite sotto SC o con pioggia finale).
 * Soglie:
 *  - LOW    se > 40% dei giri ha overall_confidence LOW
 *  - MEDIUM se > 30% dei giri ha confidence diversa da HIGH
 *  - HIGH   altrimenti
 * Timeline vuota → LOW.
 */
export function aggregateTimelineConfidence(byLap: SoftSensorsLapState[]): SoftSensorConfidence {
  const total = byLap.length;
  if (total === 0) return "LOW";
  const lowCount = byLap.filter(l => l.overall_confidence === "LOW").length;
  const nonHighCount = byLap.filter(l => l.overall_confidence !== "HIGH").length;
  if (lowCount / total > 0.4) return "LOW";
  if (nonHighCount / total > 0.3) return "MEDIUM";
  return "HIGH";
}

export function computeSoftSensorsTimeline(
  stints: StintAnalysis[],
  pitStops: PitStopAnalysis[],
  degradationValidations: DegradationValidationResult[],
  paceLossResults: StintPaceLossResult[],
  battleContext: BattleContext | null,
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  totalLaps: number,
): SoftSensorsTimeline {
  const byLap: SoftSensorsLapState[] = [];

  let firstHighStressLap: number | null = null;
  let firstCriticalStressLap: number | null = null;
  const warmupLapsByStint = new Map<number, number>();
  const gripTransitions: GripTransition[] = [];
  let prevGripLabel: TrackGripLabel | null = null;

  for (let lap = 1; lap <= totalLaps; lap++) {
    const stint = findStintForLap(stints, lap);
    const stintNumber = stint?.stint_number ?? 0;

    const stintValidation = stint
      ? degradationValidations.find(v => v.original.stint === stint.stint_number) ?? null
      : null;

    const stintPaceLoss = stint
      ? paceLossResults.find(r => r.stint_number === stint.stint_number) ?? null
      : null;

    const thermal = estimateTyreThermalState(stint, lap, pitStops, weatherMap, trackStatusMap, battleContext);
    const stress = estimateTyreStressState(stint, stintValidation, stintPaceLoss, battleContext, lap, weatherMap, trackStatusMap);
    const grip = estimateTrackGripState(weatherMap, trackStatusMap, lap, totalLaps);

    const overall = worstConfidence(thermal.confidence, stress.confidence, grip.confidence);

    const notes: string[] = [];
    if (thermal.label === "UNKNOWN" || stress.label === "UNKNOWN" || grip.label === "UNKNOWN") {
      notes.push("Uno o più sensori non determinabili su questo giro");
    }

    byLap.push({
      lap_number: lap,
      stint_number: stintNumber,
      tyre_thermal: thermal,
      tyre_stress: stress,
      track_grip: grip,
      overall_confidence: overall,
      reliability_notes: notes,
    });

    // Track summary metrics
    if (stress.label === "HIGH" && firstHighStressLap == null) firstHighStressLap = lap;
    if (stress.label === "CRITICAL" && firstCriticalStressLap == null) firstCriticalStressLap = lap;

    if (thermal.label === "COLD" || thermal.label === "WARMING_UP") {
      warmupLapsByStint.set(stintNumber, (warmupLapsByStint.get(stintNumber) ?? 0) + 1);
    }

    if (prevGripLabel != null && grip.label !== prevGripLabel && grip.label !== "UNKNOWN" && prevGripLabel !== "UNKNOWN") {
      gripTransitions.push({ lap, from: prevGripLabel, to: grip.label });
    }
    prevGripLabel = grip.label;
  }

  const latestState = byLap.length > 0 ? byLap[byLap.length - 1] : null;

  const overallConf = aggregateTimelineConfidence(byLap);
  const totalLapsSeen = byLap.length;
  const lowCount = byLap.filter(l => l.overall_confidence === "LOW").length;
  const nonHighCount = byLap.filter(l => l.overall_confidence !== "HIGH").length;

  const summaryNotes: string[] = [];
  if (totalLapsSeen > 0) {
    summaryNotes.push(`Distribuzione confidence: ${lowCount}/${totalLapsSeen} giri LOW, ${nonHighCount - lowCount}/${totalLapsSeen} giri MEDIUM`);
  }
  if (firstCriticalStressLap != null) summaryNotes.push(`Primo stress critico al giro ${firstCriticalStressLap}`);
  if (gripTransitions.length > 0) summaryNotes.push(`${gripTransitions.length} transizione/i grip rilevate`);

  return {
    by_lap: byLap,
    summary: {
      latest_state: latestState,
      first_high_stress_lap: firstHighStressLap,
      first_critical_stress_lap: firstCriticalStressLap,
      warmup_laps_by_stint: warmupLapsByStint,
      grip_transitions: gripTransitions,
      overall_confidence: overallConf,
      reliability_notes: summaryNotes,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════
 * SUPPORT LAYER 1: WARMUP INTERPRETATION
 *
 * Uses timeline to explain warmup behavior per stint.
 * Does NOT change computeTyreWarmupPenalty — only interprets.
 * ══════════════════════════════════════════════════════════════════ */

export function computeWarmupInterpretation(
  timeline: SoftSensorsTimeline,
  stints: StintAnalysis[],
): WarmupInterpretation {
  const observedByStint = new Map<number, number>(timeline.summary.warmup_laps_by_stint);
  const anomalies: WarmupAnomaly[] = [];
  const notes: string[] = [];

  for (const stint of stints) {
    const compound = (stint.compound ?? "").toUpperCase();
    const warmupConfig = TYRE_WARMUP_CONFIG[compound];
    const expectedLaps = warmupConfig?.laps_affected ?? 3;
    const observedLaps = observedByStint.get(stint.stint_number) ?? 0;

    // Skip first stint (no pit stop warmup)
    if (stint.stint_number === 1) continue;

    if (observedLaps === 0) {
      // No warmup detected — could be missing data
      notes.push(`Stint ${stint.stint_number}: nessun giro di riscaldamento rilevato (dati potenzialmente incompleti)`);
      continue;
    }

    const diff = observedLaps - expectedLaps;
    if (diff <= -2) {
      anomalies.push({
        stint_number: stint.stint_number,
        type: "FASTER_THAN_EXPECTED",
        expected_laps: expectedLaps,
        observed_laps: observedLaps,
        detail: `Stint ${stint.stint_number} (${compound}): warmup completato in ${observedLaps} giri vs ${expectedLaps} previsti — riscaldamento più rapido del modello`,
      });
    } else if (diff >= 2) {
      anomalies.push({
        stint_number: stint.stint_number,
        type: "SLOWER_THAN_EXPECTED",
        expected_laps: expectedLaps,
        observed_laps: observedLaps,
        detail: `Stint ${stint.stint_number} (${compound}): warmup persistente per ${observedLaps} giri vs ${expectedLaps} previsti — riscaldamento più lento del modello`,
      });
    }
  }

  return {
    warmup_observed_laps_by_stint: observedByStint,
    warmup_anomalies: anomalies,
    reliability_notes: notes,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * SUPPORT LAYER 2: DEGRADATION VALIDATION CONTEXT
 *
 * Enriches degradation validation interpretation using timeline
 * stress + grip signals. Does NOT change validateAllDegradationEstimates.
 * ══════════════════════════════════════════════════════════════════ */

export function computeDegradationValidationContext(
  timeline: SoftSensorsTimeline,
  stints: StintAnalysis[],
  degradationValidations: DegradationValidationResult[],
  paceLossResults?: StintPaceLossResult[],
  weatherMap?: Map<number, WeatherCondition>,
  trackStatusMap?: Map<number, TrackStatus>,
): DegradationValidationContext {
  const byStint: StintValidationContext[] = [];

  for (const dv of degradationValidations) {
    const stint = stints.find(s => s.stint_number === dv.original.stint);
    if (!stint) continue;

    const stintLaps = timeline.by_lap.filter(l => l.stint_number === stint.stint_number);

    if (stintLaps.length === 0) {
      byStint.push(emptyStintValidation(stint.stint_number));
      continue;
    }

    // ── 1. THERMAL CONSISTENCY ──
    const thermalResult = analyzeThermalConsistency(stintLaps, stint);

    // ── 2. STRESS CONSISTENCY ──
    const stressResult = analyzeStressConsistency(stintLaps, dv, paceLossResults?.find(r => r.stint_number === stint.stint_number));

    // ── 3. GRIP CONTAMINATION ──
    const gripResult = analyzeGripContamination(stintLaps, dv, trackStatusMap);

    // ── AGGREGATION ──
    // I singoli analyzer classificano ogni nota alla fonte come "support" o
    // "contradiction"; qui aggreghiamo direttamente senza più filtrare per
    // substring del testo (che era fragile e perdeva note come "grip in calo").
    const supportSignals: string[] = [
      ...thermalResult.support_notes,
      ...stressResult.support_notes,
      ...gripResult.support_notes,
    ];
    const contradictionSignals: string[] = [
      ...thermalResult.contradiction_notes,
      ...stressResult.contradiction_notes,
      ...gripResult.contradiction_notes,
    ];
    const notes: string[] = [
      ...thermalResult.notes,
      ...stressResult.notes,
      ...gripResult.notes,
    ];

    // Low confidence laps
    const lowConfLaps = stintLaps.filter(l => l.overall_confidence === "LOW");
    if (lowConfLaps.length > stintLaps.length * 0.5) {
      notes.push("Oltre metà dei giri con confidence bassa: contesto interpretativo debole");
    }

    // Weighted support_score (0–1)
    const rawSupport = (thermalResult.support * 0.25) + (stressResult.support * 0.45) + (gripResult.support * 0.30);
    const supportScore = Math.max(0, Math.min(1, rawSupport));

    // Weighted contamination_score (0–1)
    const rawContamination = (thermalResult.contamination * 0.30) + (stressResult.contamination * 0.25) + (gripResult.contamination * 0.45);
    const contaminationScore = Math.max(0, Math.min(1, rawContamination));

    // Support level: STRONG needs ≥2 axes supporting + low contamination
    const axesSupporting = [thermalResult.support > 0.5, stressResult.support > 0.5, gripResult.support > 0.5].filter(Boolean).length;
    const supportLevel: ValidationSupportLevel =
      axesSupporting >= 2 && contaminationScore < 0.3 && supportScore >= 0.5 ? "STRONG"
      : contradictionSignals.length > supportSignals.length || contaminationScore > 0.6 ? "WEAK"
      : "PARTIAL";

    const adjustedConfidence: SoftSensorConfidence =
      supportLevel === "STRONG" && contaminationScore < 0.2 ? "HIGH"
      : supportLevel === "WEAK" || contaminationScore > 0.5 ? "LOW"
      : "MEDIUM";

    byStint.push({
      stint_number: stint.stint_number,
      support_level: supportLevel,
      support_score: Math.round(supportScore * 100) / 100,
      contamination_score: Math.round(contaminationScore * 100) / 100,
      support_signals: supportSignals.slice(0, 4),
      contradiction_signals: contradictionSignals.slice(0, 4),
      notes: notes.slice(0, 5),
      adjusted_confidence: adjustedConfidence,
      thermal_support_score: Math.round(thermalResult.support * 100) / 100,
      thermal_contamination_flag: thermalResult.contamination > 0.4,
      thermal_notes: thermalResult.notes,
      stress_support_score: Math.round(stressResult.support * 100) / 100,
      stress_inconsistency_flag: stressResult.contamination > 0.3,
      stress_notes: stressResult.notes,
      grip_contamination_score: Math.round(gripResult.contamination * 100) / 100,
      grip_support_score: Math.round(gripResult.support * 100) / 100,
      grip_notes: gripResult.notes,
      inconsistencies: contradictionSignals.slice(0, 4),
    });
  }

  const overallSupport: ValidationSupportLevel = byStint.length === 0
    ? "WEAK"
    : byStint.every(s => s.support_level === "STRONG") ? "STRONG"
    : byStint.some(s => s.support_level === "WEAK") ? "WEAK"
    : "PARTIAL";

  const reliabilityNotes: string[] = [];
  const weakStints = byStint.filter(s => s.support_level === "WEAK");
  if (weakStints.length > 0) reliabilityNotes.push(`${weakStints.length} stint con supporto debole dai soft sensors`);
  const highContam = byStint.filter(s => s.contamination_score > 0.5);
  if (highContam.length > 0) reliabilityNotes.push(`${highContam.length} stint con possibile contaminazione della lettura del degrado`);

  return { by_stint: byStint, overall_support: overallSupport, reliability_notes: reliabilityNotes };
}

/* ── Helpers for validation support ── */

function emptyStintValidation(stintNumber: number): StintValidationContext {
  return {
    stint_number: stintNumber,
    support_level: "WEAK",
    support_score: 0,
    contamination_score: 0,
    support_signals: [],
    contradiction_signals: [],
    notes: ["Nessun dato soft sensor disponibile per questo stint"],
    adjusted_confidence: "LOW",
    thermal_support_score: 0,
    thermal_contamination_flag: false,
    thermal_notes: [],
    stress_support_score: 0,
    stress_inconsistency_flag: false,
    stress_notes: [],
    grip_contamination_score: 0,
    grip_support_score: 0,
    grip_notes: [],
    inconsistencies: [],
  };
}

/**
 * Ogni analyzer di asse classifica le note direttamente alla fonte come
 * `support_notes` o `contradiction_notes`, evitando la fragile riclassificazione
 * per substring nell'aggregazione. `notes` è mantenuto per compatibilità con
 * `thermal_notes`/`stress_notes`/`grip_notes` di StintValidationContext e
 * conserva l'ordine originale in cui le note sono state prodotte.
 */
interface AxisResult {
  support: number;
  contamination: number;
  notes: string[];
  support_notes: string[];
  contradiction_notes: string[];
}

function pushSupport(res: { notes: string[]; support_notes: string[] }, note: string): void {
  res.notes.push(note);
  res.support_notes.push(note);
}

function pushContradiction(res: { notes: string[]; contradiction_notes: string[] }, note: string): void {
  res.notes.push(note);
  res.contradiction_notes.push(note);
}

function analyzeThermalConsistency(stintLaps: SoftSensorsLapState[], stint: StintAnalysis): AxisResult {
  const res = { notes: [] as string[], support_notes: [] as string[], contradiction_notes: [] as string[] };
  let support = 0.5; // neutral baseline
  let contamination = 0;

  const warmupConfig = TYRE_WARMUP_CONFIG[(stint.compound ?? "").toUpperCase()];
  const expectedWarmup = warmupConfig?.laps_affected ?? 3;

  // Count warmup laps (COLD/WARMING_UP at start)
  let warmupCount = 0;
  for (const l of stintLaps) {
    if (l.tyre_thermal.label === "COLD" || l.tyre_thermal.label === "WARMING_UP") {
      warmupCount++;
    } else break;
  }

  if (warmupCount > expectedWarmup + 2) {
    contamination += 0.4;
    pushContradiction(res, `Warmup prolungato (${warmupCount} giri vs ${expectedWarmup} previsti): primi giri possibilmente contaminati`);
  } else if (warmupCount > 0 && warmupCount <= expectedWarmup) {
    support += 0.15;
    pushSupport(res, `Warmup coerente con il modello (${warmupCount}/${expectedWarmup} giri)`);
  }

  // Check for rapid IN_WINDOW entry
  const firstInWindow = stintLaps.findIndex(l => l.tyre_thermal.label === "IN_WINDOW");
  if (firstInWindow >= 0 && firstInWindow < expectedWarmup - 1) {
    support += 0.1;
    pushSupport(res, "Ingresso rapido in finestra termica: buon supporto per la parte centrale dello stint");
  }

  // Thermal instability check
  const thermalLabels = new Set(stintLaps.map(l => l.tyre_thermal.label));
  if (thermalLabels.size >= 4) {
    contamination += 0.3;
    pushContradiction(res, "Stato termico instabile durante lo stint: ridotta affidabilità della lettura");
  }

  // NOTA: OVERHEATED è riservata e attualmente mai emessa (vedi commento sul
  // tipo TyreThermalLabel); il ramo è mantenuto in modo difensivo.
  const earlyHot = stintLaps.slice(0, Math.min(5, stintLaps.length))
    .filter(l => l.tyre_thermal.label === "HOT" || l.tyre_thermal.label === "OVERHEATED");
  if (earlyHot.length >= 2) {
    contamination += 0.2;
    pushContradiction(res, "Stato termico elevato nei primi giri: possibile instabilità, non necessariamente degrado");
  }

  return {
    support: Math.min(1, Math.max(0, support)),
    contamination: Math.min(1, contamination),
    notes: res.notes,
    support_notes: res.support_notes,
    contradiction_notes: res.contradiction_notes,
  };
}

function analyzeStressConsistency(
  stintLaps: SoftSensorsLapState[],
  dv: DegradationValidationResult,
  paceLoss?: StintPaceLossResult,
): AxisResult {
  const res = { notes: [] as string[], support_notes: [] as string[], contradiction_notes: [] as string[] };
  let support = 0.4;
  let contamination = 0;
  const hasHighSlope = dv.effective_slope > 0.06;

  // Corroborazione indipendente dal fit: usiamo ESCLUSIVAMENTE la componente
  // osservazionale dello stress (età gomma, battaglia, restart, meteo misto),
  // che per costruzione NON contiene contributi dalla effective_slope o dal
  // pace_loss. Senza questa separazione la corroborazione sarebbe circolare
  // (slope alta → stress alto → "conferma" della slope).
  //
  // Soglie:
  //  - 0.3: coincide con la soglia MODERATE del sensore di stress totale;
  //    identifica un giro con almeno un contributo osservazionale robusto
  //    (es. ageRatio > 0.8) oppure due contributi minori sommati.
  //  - 0.15: soglia "basso stress osservazionale", coerente col vecchio
  //    concetto di label LOW (< 0.2 sullo score totale) traslato sulla
  //    componente osservazionale.
  const OBS_HIGH = 0.3;
  const OBS_LOW = 0.15;
  const obsOf = (l: SoftSensorsLapState): number => l.tyre_stress.observational_score ?? 0;

  const highObsLaps = stintLaps.filter(l => obsOf(l) >= OBS_HIGH);
  const lowObsLaps = stintLaps.filter(l => obsOf(l) < OBS_LOW);
  const unknownStress = stintLaps.filter(l => l.tyre_stress.label === "UNKNOWN");

  const secondHalf = stintLaps.slice(Math.floor(stintLaps.length / 2));
  const secondHalfHighObs = secondHalf.filter(l => obsOf(l) >= OBS_HIGH);

  if (dv.status === "VALID") {
    if (highObsLaps.length > stintLaps.length * 0.4) {
      support += 0.3;
      pushSupport(res, "Stress osservazionale elevato in oltre il 40% dello stint validato: corroborazione da segnali indipendenti dal fit (età gomma, battaglie, restart)");
    } else if (secondHalfHighObs.length > secondHalf.length * 0.5) {
      support += 0.2;
      pushSupport(res, "Stress osservazionale concentrato nella seconda metà dello stint validato: pattern indipendente dal fit coerente con degrado progressivo");
    }
  }

  // Contraddizione stress osservazionale basso ↔ slope elevata: ora è un vero
  // rilevatore di incoerenza, perché lo stress osservazionale non include la
  // slope stessa (nel vecchio criterio slope alta gonfiava direttamente lo
  // stress totale, rendendo questa contraddizione quasi irraggiungibile).
  if (lowObsLaps.length > stintLaps.length * 0.7 && hasHighSlope) {
    contamination += 0.4;
    pushContradiction(res, "Stress osservazionale basso nonostante slope elevata: incoerenza tra segnali indipendenti dal fit e degrado stimato");
  }

  if (unknownStress.length > stintLaps.length * 0.4) {
    contamination += 0.2;
    pushContradiction(res, "Troppi giri con stress non determinabile: segnale debole");
  }

  // Il bonus di supporto "pace loss CLIFF_RISK + stress elevato" è stato
  // rimosso: era doppio conteggio, perché il pace_loss è già input della
  // componente derivata dello stress e non è indipendente dalla validazione.
  // Manteniamo la sola contaminazione da pace loss UNRELIABLE.
  if (paceLoss && paceLoss.pace_loss_status === "UNRELIABLE") {
    contamination += 0.1;
  }

  return {
    support: Math.min(1, Math.max(0, support)),
    contamination: Math.min(1, contamination),
    notes: res.notes,
    support_notes: res.support_notes,
    contradiction_notes: res.contradiction_notes,
  };
}

function analyzeGripContamination(
  stintLaps: SoftSensorsLapState[],
  dv: DegradationValidationResult,
  trackStatusMap?: Map<number, TrackStatus>,
): AxisResult {
  const res = { notes: [] as string[], support_notes: [] as string[], contradiction_notes: [] as string[] };
  let support = 0.5;
  let contamination = 0;

  const mixedGripLaps = stintLaps.filter(l => l.track_grip.label === "MIXED" || l.track_grip.label === "LOW_GRIP");
  const fallingGripLaps = stintLaps.filter(l => l.track_grip.label === "FALLING");
  const stableGripLaps = stintLaps.filter(l => l.track_grip.label === "STABLE");
  const improvingGripLaps = stintLaps.filter(l => l.track_grip.label === "IMPROVING");

  if (stableGripLaps.length > stintLaps.length * 0.6) {
    support += 0.3;
    pushSupport(res, "Condizioni pista stabili: contesto favorevole a una stima affidabile del degrado");
  } else if (improvingGripLaps.length > stintLaps.length * 0.4 && dv.effective_slope > 0.03) {
    contamination += 0.2;
    pushContradiction(res, "Grip in miglioramento durante stint con slope positiva: parte del trend potrebbe essere pista, non gomma");
  }

  if (mixedGripLaps.length > stintLaps.length * 0.3) {
    contamination += 0.35;
    pushContradiction(res, "Grip pista instabile durante lo stint: lettura del degrado potenzialmente contaminata");
  }

  if (fallingGripLaps.length > stintLaps.length * 0.3) {
    contamination += 0.25;
    pushContradiction(res, "Grip in calo: degrado stimato potrebbe includere effetto pista");
  }

  if (trackStatusMap) {
    let neutLaps = 0;
    for (const l of stintLaps) {
      const ts = trackStatusMap.get(l.lap_number);
      if (ts && ts !== "GREEN") neutLaps++;
    }
    if (neutLaps > stintLaps.length * 0.2) {
      contamination += 0.15;
      pushContradiction(res, "Neutralizzazioni durante lo stint: ridotta affidabilità della lettura del degrado");
    }
  }

  return {
    support: Math.min(1, Math.max(0, support)),
    contamination: Math.min(1, contamination),
    notes: res.notes,
    support_notes: res.support_notes,
    contradiction_notes: res.contradiction_notes,
  };
}


/* ══════════════════════════════════════════════════════════════════
 * SUPPORT LAYER 3: ENHANCED NARRATIVE INSIGHTS
 *
 * Extracts narrative-ready insights from timeline.
 * Each insight is traceable to a specific lap and sensor label.
 * ══════════════════════════════════════════════════════════════════ */

export function extractSoftSensorNarrativeInsights(
  timeline: SoftSensorsTimeline,
  stints: StintAnalysis[],
): string[] {
  if (timeline.by_lap.length === 0) return [];

  const insights: string[] = [];

  // 1. Warmup anomalies
  const warmupInterp = computeWarmupInterpretation(timeline, stints);
  for (const anomaly of warmupInterp.warmup_anomalies.slice(0, 2)) {
    if (anomaly.type === "SLOWER_THAN_EXPECTED") {
      insights.push(`Warmup più lungo del previsto nello stint ${anomaly.stint_number} (thermal WARMING_UP fino al giro ${anomaly.observed_laps} vs ${anomaly.expected_laps} previsti)`);
    } else {
      insights.push(`Warmup più rapido del previsto nello stint ${anomaly.stint_number} (${anomaly.observed_laps} giri vs ${anomaly.expected_laps} previsti)`);
    }
  }

  // 2. First high/critical stress entry
  if (timeline.summary.first_high_stress_lap != null) {
    const stintAtStress = stints.find(s =>
      timeline.summary.first_high_stress_lap! >= s.lap_start &&
      timeline.summary.first_high_stress_lap! <= s.lap_end
    );
    const stintInfo = stintAtStress ? ` (stint ${stintAtStress.stint_number}, ${stintAtStress.compound})` : "";
    insights.push(`Stress gomma elevato a partire dal giro ${timeline.summary.first_high_stress_lap}${stintInfo}`);
  }

  if (timeline.summary.first_critical_stress_lap != null) {
    insights.push(`Stress critico rilevato dal giro ${timeline.summary.first_critical_stress_lap} — segnale convergente con degrado avanzato`);
  }

  // 3. Grip transitions
  for (const gt of timeline.summary.grip_transitions.slice(0, 2)) {
    const fromText = gt.from === "LOW_GRIP" ? "basso grip" : gt.from === "IMPROVING" ? "in miglioramento" : gt.from === "FALLING" ? "in calo" : gt.from.toLowerCase();
    const toText = gt.to === "LOW_GRIP" ? "basso grip" : gt.to === "IMPROVING" ? "in miglioramento" : gt.to === "FALLING" ? "in calo" : gt.to === "STABLE" ? "stabile" : gt.to.toLowerCase();
    insights.push(`Grip pista: transizione da ${fromText} a ${toText} al giro ${gt.lap}`);
  }

  // 4. Combined critical states
  const criticalCombos = timeline.by_lap.filter(
    l => (l.tyre_stress.label === "CRITICAL" || l.tyre_stress.label === "HIGH") &&
         (l.tyre_thermal.label === "HOT" || l.tyre_thermal.label === "OVERHEATED") &&
         l.overall_confidence !== "LOW"
  );
  if (criticalCombos.length >= 2 && insights.length < 5) {
    const firstLap = criticalCombos[0].lap_number;
    insights.push(`Combinazione stress elevato + stato termico caldo osservata per ${criticalCombos.length} giri (dal giro ${firstLap}) — indicazione di pressione operativa sulla gomma`);
  }

  return insights.slice(0, 6);
}

/* ══════════════════════════════════════════════════════════════════
 * SUPPORT LAYER 4: DECISION POINT SOFT SENSOR CONTEXT
 *
 * Aggregates sensor states over a decision window (1–3 laps)
 * for use in Key Decision Moments.
 * ══════════════════════════════════════════════════════════════════ */

export function buildDecisionSoftSensorContext(
  timeline: SoftSensorsTimeline,
  windowStart: number,
  windowEnd: number,
): DecisionSoftSensorContext | null {
  if (timeline.by_lap.length === 0) return null;

  const windowLaps = timeline.by_lap.filter(
    l => l.lap_number >= windowStart && l.lap_number <= windowEnd
  );

  if (windowLaps.length === 0) return null;

  // Aggregate thermal
  const thermalLabels = windowLaps.map(l => l.tyre_thermal.label);
  const thermalDominant = mostFrequent(thermalLabels);
  const thermalSummary = thermalDominant === "COLD" ? "Gomme fredde"
    : thermalDominant === "WARMING_UP" ? "Gomme in fase di riscaldamento"
    : thermalDominant === "IN_WINDOW" ? "Gomme in finestra operativa"
    : thermalDominant === "HOT" ? "Gomme calde"
    : thermalDominant === "OVERHEATED" ? "Gomme surriscaldate"
    : "Stato termico non determinabile";

  // Aggregate stress
  const stressLabels = windowLaps.map(l => l.tyre_stress.label);
  const stressDominant = mostFrequent(stressLabels);
  const stressSummary = stressDominant === "LOW" ? "Stress basso"
    : stressDominant === "MODERATE" ? "Stress moderato"
    : stressDominant === "HIGH" ? "Stress elevato"
    : stressDominant === "CRITICAL" ? "Stress critico"
    : "Stress non determinabile";

  // Aggregate grip
  const gripLabels = windowLaps.map(l => l.track_grip.label);
  const gripDominant = mostFrequent(gripLabels);
  const gripSummary = gripDominant === "LOW_GRIP" ? "Grip pista basso"
    : gripDominant === "IMPROVING" ? "Grip in miglioramento"
    : gripDominant === "STABLE" ? "Grip stabile"
    : gripDominant === "FALLING" ? "Grip in calo"
    : gripDominant === "MIXED" ? "Grip misto"
    : "Grip non determinabile";

  // Consistency: do all laps agree?
  const notes: string[] = [];
  const thermalSet = new Set(thermalLabels.filter(l => l !== "UNKNOWN"));
  const stressSet = new Set(stressLabels.filter(l => l !== "UNKNOWN"));
  const gripSet = new Set(gripLabels.filter(l => l !== "UNKNOWN"));

  let consistency: SoftSensorConfidence = "HIGH";
  if (thermalSet.size > 1 || stressSet.size > 1 || gripSet.size > 1) {
    consistency = "MEDIUM";
    notes.push("Segnali non uniformi nella finestra decisionale");
  }

  const lowConfLaps = windowLaps.filter(l => l.overall_confidence === "LOW");
  if (lowConfLaps.length > windowLaps.length * 0.5) {
    consistency = "LOW";
    notes.push("Confidence bassa nella maggioranza dei giri della finestra");
  }

  // Contextual notes for decision-making
  if (stressDominant === "HIGH" || stressDominant === "CRITICAL") {
    notes.push("Stress elevato: segnale coerente con pressione verso il pit");
  }
  if (thermalDominant === "WARMING_UP" || thermalDominant === "COLD") {
    notes.push("Gomme non ancora in finestra: undercut immediato penalizzato dal warmup");
  }
  if (gripDominant === "IMPROVING") {
    notes.push("Grip in miglioramento: possibile riduzione dell'urgenza pit");
  }
  if (gripDominant === "LOW_GRIP" || gripDominant === "FALLING") {
    notes.push("Grip basso/in calo: incertezza aggiuntiva sulla permanenza in pista");
  }

  return {
    thermal_state_summary: thermalSummary,
    stress_state_summary: stressSummary,
    grip_state_summary: gripSummary,
    consistency,
    notes,
  };
}

function mostFrequent<T>(arr: T[]): T {
  const counts = new Map<T, number>();
  for (const item of arr) counts.set(item, (counts.get(item) ?? 0) + 1);
  let best = arr[0];
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) { best = item; bestCount = count; }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════
 * STRATEGY REFINEMENT
 *
 * Applies small, traceable adjustments to simulated strategy costs.
 * Anti-double-counting:
 * - thermal: modulates existing warmup, not a second warmup
 * - stress: marginal adjustment on late-stint laps, not new degradation
 * - grip: light context modifier, not a weather model
 * ══════════════════════════════════════════════════════════════════ */

/** Per-lap adjustment caps (seconds) */
const REFINEMENT_CAPS = {
  thermal_per_lap: 0.15,   // max ±0.15s per lap
  stress_per_lap: 0.10,    // max ±0.10s per lap
  grip_per_lap: 0.08,      // max ±0.08s per lap
  total_max: 3.0,          // max total adjustment across all laps
} as const;

/**
 * Compute soft sensor adjustment for a simulated strategy.
 * Uses the observed race timeline to infer sensor states for simulated laps.
 */
export function computeStrategySoftSensorAdjustment(
  pitLaps: number[],
  compounds: string[],
  totalLaps: number,
  timeline: SoftSensorsTimeline,
  realStints: StintAnalysis[] = [],
): StrategySoftSensorAdjustment {
  if (timeline.by_lap.length === 0) {
    return {
      thermal_adjustment_total: 0,
      stress_adjustment_total: 0,
      // Il grip è per costruzione invariante rispetto alla strategia comparata
      // (si applica agli stessi giri assoluti per ogni strategia) e appartiene
      // al contesto narrativo, non allo scoring comparativo. Manteniamo il
      // campo nell'interfaccia per compatibilità ma vale sempre 0.
      grip_adjustment_total: 0,
      total_soft_sensor_adjustment: 0,
      adjustment_reasons: ["Timeline non disponibile"],
      confidence: "LOW",
    };
  }

  // Build stint bounds for this strategy
  const stintBounds: { start: number; end: number; compound: string; isFirst: boolean }[] = [];
  let cursor = 1;
  for (let i = 0; i < pitLaps.length; i++) {
    stintBounds.push({ start: cursor, end: pitLaps[i], compound: compounds[i] || compounds[0], isFirst: i === 0 });
    cursor = pitLaps[i] + 1;
  }
  stintBounds.push({ start: cursor, end: totalLaps, compound: compounds[compounds.length - 1] || compounds[0], isFirst: pitLaps.length === 0 });

  // Build index of observed sensor states keyed by (compound, tyre life).
  // In caso di più stint reali sullo stesso compound, si preferisce quello più
  // lungo (più giri = più copertura di vite gomma osservate).
  const observedIndex = new Map<string, Map<number, SoftSensorsLapState>>();
  const chosenStintLen = new Map<string, number>();
  for (const rs of realStints) {
    const cKey = (rs.compound ?? "").toUpperCase();
    if (!cKey) continue;
    const stintLen = rs.lap_end - rs.lap_start + 1;
    const prev = chosenStintLen.get(cKey) ?? -1;
    if (stintLen <= prev) continue;
    chosenStintLen.set(cKey, stintLen);
    const inner = new Map<number, SoftSensorsLapState>();
    for (let lap = rs.lap_start; lap <= rs.lap_end; lap++) {
      const idx = lap - 1;
      if (idx < 0 || idx >= timeline.by_lap.length) continue;
      const state = timeline.by_lap[idx];
      if (!state) continue;
      const tyreLife = lap - rs.lap_start;
      inner.set(tyreLife, state);
    }
    observedIndex.set(cKey, inner);
  }

  let thermalTotal = 0;
  let stressTotal = 0;
  const reasons: string[] = [];
  let lowConfCount = 0;
  let unmatchedCount = 0;
  let totalLapCount = 0;

  for (const sb of stintBounds) {
    for (let lap = sb.start; lap <= sb.end; lap++) {
      const tyreLife = lap - sb.start;
      totalLapCount++;

      // Lookup observed sensor state by (simulated compound, simulated tyre life).
      // Se non esiste alcun giro reale con lo stesso compound e la stessa vita
      // gomma, si salta l'aggiustamento senza inventare nulla e si conta il giro
      // come non affidabile ai fini del rapporto di confidence.
      const cKey = (sb.compound ?? "").toUpperCase();
      const observed = observedIndex.get(cKey)?.get(tyreLife) ?? null;
      if (!observed) {
        unmatchedCount++;
        continue;
      }
      if (observed.overall_confidence === "LOW") {
        lowConfCount++;
        continue;
      }

      // 1. Thermal refinement — modulate warmup, not duplicate it
      if (!sb.isFirst && tyreLife < 5) {
        const thermalLabel = observed.tyre_thermal.label;
        let thermalAdj = 0;

        const warmupConfig = TYRE_WARMUP_CONFIG[(sb.compound ?? "").toUpperCase()];
        const simLapsAffected = warmupConfig?.laps_affected ?? 3;

        if (thermalLabel === "COLD" && tyreLife < simLapsAffected) {
          thermalAdj = 0.05;
        } else if (thermalLabel === "WARMING_UP" && tyreLife >= simLapsAffected) {
          thermalAdj = 0.08;
        }

        thermalAdj = Math.min(thermalAdj, REFINEMENT_CAPS.thermal_per_lap);
        thermalTotal += thermalAdj;
      }

      // 2. Stress refinement — marginal late-stint adjustment
      {
        const stressLabel = observed.tyre_stress.label;
        let stressAdj = 0;
        const stintLength = sb.end - sb.start + 1;
        const stintProgress = stintLength > 0 ? tyreLife / stintLength : 0;

        if (stressLabel === "CRITICAL" && observed.tyre_stress.confidence !== "LOW" && stintProgress > 0.7) {
          stressAdj = 0.08;
        } else if (stressLabel === "HIGH" && stintProgress > 0.6) {
          stressAdj = 0.04;
        }

        stressAdj = Math.min(stressAdj, REFINEMENT_CAPS.stress_per_lap);
        stressTotal += stressAdj;
      }

      // 3. Grip refinement DISABILITATO nello scoring comparativo:
      // il grip è funzione del giro assoluto e non della strategia, quindi
      // trasla tutti i punteggi ugualmente. Resta nel contesto narrativo.
    }
  }

  // Clamp totals
  thermalTotal = Math.min(thermalTotal, REFINEMENT_CAPS.total_max * 0.4);
  stressTotal = Math.min(stressTotal, REFINEMENT_CAPS.total_max * 0.4);

  let total = thermalTotal + stressTotal;
  total = Math.max(-REFINEMENT_CAPS.total_max, Math.min(total, REFINEMENT_CAPS.total_max));

  // Round
  thermalTotal = Math.round(thermalTotal * 100) / 100;
  stressTotal = Math.round(stressTotal * 100) / 100;
  total = Math.round(total * 100) / 100;

  // Build reasons
  if (Math.abs(thermalTotal) > 0.01) reasons.push(`Warmup modulato: +${thermalTotal.toFixed(2)}s`);
  if (Math.abs(stressTotal) > 0.01) reasons.push(`Stress gomma tardivo: +${stressTotal.toFixed(2)}s`);
  if (reasons.length > 0) {
    reasons.push("Stati osservati mappati per vita gomma a parità di mescola");
  } else {
    reasons.push("Nessun aggiustamento significativo dai soft sensors");
  }

  // Confidence: pesano sia i giri LOW che quelli senza osservazioni comparabili
  const unreliable = lowConfCount + unmatchedCount;
  const confRatio = totalLapCount > 0 ? unreliable / totalLapCount : 1;
  let confidence: SoftSensorConfidence = "HIGH";
  if (confRatio > 0.5) confidence = "LOW";
  else if (confRatio > 0.2) confidence = "MEDIUM";
  if (Math.abs(total) < 0.05) confidence = "HIGH";

  return {
    thermal_adjustment_total: thermalTotal,
    stress_adjustment_total: stressTotal,
    grip_adjustment_total: 0,
    total_soft_sensor_adjustment: total,
    adjustment_reasons: reasons,
    confidence,
  };
}
