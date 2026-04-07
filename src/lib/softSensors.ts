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
}

export interface TyreStressSensor extends SoftSensorResult {
  label: TyreStressLabel;
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
  inconsistencies: string[];
  notes: string[];
  adjusted_confidence: SoftSensorConfidence;
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
): TyreThermalSensor {
  if (!currentStint) {
    return { label: "UNKNOWN", score: null, confidence: "LOW", reasons: ["Nessuno stint attivo disponibile"] };
  }

  const compound = currentStint.compound.toUpperCase();
  const warmupConfig = TYRE_WARMUP_CONFIG[compound];
  const tyreAge = currentLap - currentStint.lap_start;
  const reasons: string[] = [];
  const contaminated: string[] = [];
  const sources: string[] = ["compound", "tyre_age", "warmup_model"];
  let confidence = "HIGH" as SoftSensorConfidence;

  const lapsAffected = warmupConfig?.laps_affected ?? 3;
  const isInWarmup = tyreAge < lapsAffected;

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
  } else if (isInWarmup && !inBattle) {
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
      score = 0.2 + (tyreAge / lapsAffected) * 0.4;
      reasons.push(`Giro ${tyreAge + 1} di ${lapsAffected} previsti per il riscaldamento (${compound})`);
    }
    if (recentNeutralization) {
      reasons.push("Neutralizzazione recente: gomme potenzialmente più fredde del previsto");
      if (score != null) score = Math.max(0.1, score - 0.15);
      confidence = "MEDIUM";
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
  } else if (tyreAge >= lapsAffected) {
    label = "IN_WINDOW";
    score = 0.65;
    reasons.push(`Gomme ${compound} a regime dopo ${lapsAffected} giri di riscaldamento`);
    if (currentWeather === "WET" || currentWeather === "MIXED") {
      confidence = "LOW";
    }
  } else {
    label = "UNKNOWN";
    reasons.push("Dati insufficienti per stimare lo stato termico");
    confidence = "LOW";
  }

  return {
    label,
    score,
    confidence,
    reasons,
    contaminated_by: contaminated.length > 0 ? contaminated : undefined,
    source_signals: sources,
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

  let stressScore = 0;

  const ageRatio = stintLength > 0 ? tyreAge / stintLength : 0;
  if (ageRatio > 0.8) {
    stressScore += 0.3;
    reasons.push(`Gomma a ${Math.round(ageRatio * 100)}% della lunghezza stint`);
  } else if (ageRatio > 0.5) {
    stressScore += 0.15;
  }

  if (degradationValidation) {
    sources.push("degradation_validation");
    if (degradationValidation.status === "INVALID") {
      contaminated.push("validazione degrado INVALID");
      confidence = "MEDIUM";
    } else if (degradationValidation.status === "VALID") {
      const slope = degradationValidation.effective_slope;
      if (slope > 0.12) {
        stressScore += 0.3;
        reasons.push(`Degrado elevato (${slope.toFixed(3)} s/giro)`);
      } else if (slope > 0.06) {
        stressScore += 0.15;
        reasons.push(`Degrado moderato (${slope.toFixed(3)} s/giro)`);
      }
    }
  } else {
    if (confidence !== "LOW") confidence = "MEDIUM";
  }

  if (paceLossResult) {
    sources.push("pace_loss");
    if (paceLossResult.pace_loss_status === "CLIFF_RISK") {
      stressScore += 0.35;
      reasons.push("Rischio cliff rilevato dal pace loss");
    } else if (paceLossResult.pace_loss_status === "HIGH_LOSS") {
      stressScore += 0.2;
      reasons.push("Perdita di passo elevata");
    } else if (paceLossResult.pace_loss_status === "UNRELIABLE") {
      contaminated.push("pace loss inaffidabile");
      if (confidence === "HIGH") confidence = "MEDIUM";
    }
  }

  if (battleContext && battleContext.battle_laps.has(currentLap)) {
    stressScore += 0.1;
    reasons.push("Battaglia attiva: stress addizionale da guida aggressiva");
    sources.push("battle_context");
  }

  const currentWeather = weatherMap.get(currentLap);
  if (currentWeather === "MIXED") {
    stressScore += 0.1;
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
    stressScore += 0.1;
    reasons.push("Restart recente: stress da riscaldamento rapido");
    sources.push("track_status");
  }

  stressScore = Math.min(1, Math.max(0, stressScore));

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

  return {
    label,
    score: stressScore > 0 ? Math.round(stressScore * 100) / 100 : null,
    confidence,
    reasons: reasons.length > 0 ? reasons : ["Nessun segnale di stress rilevato"],
    contaminated_by: contaminated.length > 0 ? contaminated : undefined,
    source_signals: sources,
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

  const earlierWeather: WeatherCondition[] = [];
  for (let l = Math.max(1, currentLap - windowSize * 2 + 1); l <= Math.max(1, currentLap - windowSize); l++) {
    const w = weatherMap.get(l);
    if (w) earlierWeather.push(w);
  }
  const earlierWet = earlierWeather.filter(w => w === "WET").length;

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
  } else if (earlierWet > 0 && wetCount === 0 && dryCount > 0) {
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
      reasons.push("Fase iniziale gara su asciutto: pista in fase di gommatura");
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
  const overallConf = latestState?.overall_confidence ?? "LOW";

  const summaryNotes: string[] = [];
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
    const compound = stint.compound.toUpperCase();
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
): DegradationValidationContext {
  const byStint: StintValidationContext[] = [];

  for (const dv of degradationValidations) {
    const stint = stints.find(s => s.stint_number === dv.original.stint);
    if (!stint) continue;

    const stintLaps = timeline.by_lap.filter(
      l => l.stint_number === stint.stint_number
    );

    if (stintLaps.length === 0) {
      byStint.push({
        stint_number: stint.stint_number,
        support_level: "WEAK",
        inconsistencies: [],
        notes: ["Nessun dato soft sensor disponibile per questo stint"],
        adjusted_confidence: "LOW",
      });
      continue;
    }

    const inconsistencies: string[] = [];
    const notes: string[] = [];
    let supportScore = 0;

    // Analyze stress pattern
    const highStressLaps = stintLaps.filter(l => l.tyre_stress.label === "HIGH" || l.tyre_stress.label === "CRITICAL");
    const lowStressLaps = stintLaps.filter(l => l.tyre_stress.label === "LOW");
    const hasHighSlope = dv.effective_slope > 0.06;

    if (highStressLaps.length > stintLaps.length * 0.4 && dv.status === "VALID") {
      supportScore += 2;
      notes.push("Stress elevato coerente con degrado validato");
    } else if (lowStressLaps.length > stintLaps.length * 0.7 && hasHighSlope) {
      inconsistencies.push("Stress basso nonostante slope elevata: possibile contaminazione del fit");
      supportScore -= 1;
    }

    // Analyze grip pattern
    const mixedGripLaps = stintLaps.filter(l => l.track_grip.label === "MIXED" || l.track_grip.label === "LOW_GRIP");
    if (mixedGripLaps.length > stintLaps.length * 0.3) {
      inconsistencies.push("Grip pista instabile durante lo stint: lettura del degrado potenzialmente contaminata");
      supportScore -= 1;
    } else if (stintLaps.every(l => l.track_grip.label === "STABLE" || l.track_grip.label === "IMPROVING")) {
      supportScore += 1;
      notes.push("Condizioni pista stabili: contesto favorevole a una stima affidabile");
    }

    // Thermal instability
    const thermalLabels = new Set(stintLaps.map(l => l.tyre_thermal.label));
    if (thermalLabels.size >= 3) {
      inconsistencies.push("Stato termico instabile durante lo stint: ridotta affidabilità della lettura");
      supportScore -= 1;
    }

    // Low confidence laps
    const lowConfLaps = stintLaps.filter(l => l.overall_confidence === "LOW");
    if (lowConfLaps.length > stintLaps.length * 0.5) {
      notes.push("Oltre metà dei giri con confidence bassa: contesto interpretativo debole");
      supportScore -= 1;
    }

    const supportLevel: ValidationSupportLevel =
      supportScore >= 2 ? "STRONG" : supportScore >= 0 ? "PARTIAL" : "WEAK";

    const adjustedConfidence: SoftSensorConfidence =
      supportLevel === "STRONG" ? "HIGH" : supportLevel === "PARTIAL" ? "MEDIUM" : "LOW";

    byStint.push({
      stint_number: stint.stint_number,
      support_level: supportLevel,
      inconsistencies,
      notes,
      adjusted_confidence: adjustedConfidence,
    });
  }

  const overallSupport: ValidationSupportLevel = byStint.length === 0
    ? "WEAK"
    : byStint.every(s => s.support_level === "STRONG") ? "STRONG"
    : byStint.some(s => s.support_level === "WEAK") ? "WEAK"
    : "PARTIAL";

  const reliabilityNotes: string[] = [];
  const weakStints = byStint.filter(s => s.support_level === "WEAK");
  if (weakStints.length > 0) {
    reliabilityNotes.push(`${weakStints.length} stint con supporto debole dai soft sensors`);
  }

  return { by_stint: byStint, overall_support: overallSupport, reliability_notes: reliabilityNotes };
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
): StrategySoftSensorAdjustment {
  if (timeline.by_lap.length === 0) {
    return {
      thermal_adjustment_total: 0,
      stress_adjustment_total: 0,
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

  let thermalTotal = 0;
  let stressTotal = 0;
  let gripTotal = 0;
  const reasons: string[] = [];
  let lowConfCount = 0;
  let totalLapCount = 0;

  for (const sb of stintBounds) {
    for (let lap = sb.start; lap <= sb.end; lap++) {
      const tyreLife = lap - sb.start;
      totalLapCount++;

      // Get observed sensor state for this lap (use timeline if available)
      const observed = lap <= timeline.by_lap.length ? timeline.by_lap[lap - 1] : null;
      if (!observed) continue;
      if (observed.overall_confidence === "LOW") {
        lowConfCount++;
        continue; // Skip low confidence laps
      }

      // 1. Thermal refinement — modulate warmup, not duplicate it
      if (!sb.isFirst && tyreLife < 5) {
        const thermalLabel = observed.tyre_thermal.label;
        let thermalAdj = 0;

        // We simulate using the strategy's compound, not the observed one
        const warmupConfig = TYRE_WARMUP_CONFIG[sb.compound.toUpperCase()];
        const simLapsAffected = warmupConfig?.laps_affected ?? 3;

        if (thermalLabel === "COLD" && tyreLife < simLapsAffected) {
          // COLD observed but warmup model already penalizes → small extra for mismatch
          thermalAdj = 0.05;
        } else if (thermalLabel === "WARMING_UP" && tyreLife >= simLapsAffected) {
          // Still warming up beyond model prediction → slight extra penalty
          thermalAdj = 0.08;
        }
        // IN_WINDOW → no adjustment (warmup model already handles it)

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
        // LOW/MODERATE → no adjustment (degradation model handles normal wear)

        stressAdj = Math.min(stressAdj, REFINEMENT_CAPS.stress_per_lap);
        stressTotal += stressAdj;
      }

      // 3. Grip refinement — light context modifier
      {
        const gripLabel = observed.track_grip.label;
        let gripAdj = 0;

        if (gripLabel === "LOW_GRIP" && observed.track_grip.confidence !== "LOW") {
          gripAdj = 0.05;
        } else if (gripLabel === "FALLING") {
          gripAdj = 0.03;
        } else if (gripLabel === "IMPROVING") {
          gripAdj = -0.03; // slight benefit
        }
        // STABLE/MIXED/UNKNOWN → no adjustment

        gripAdj = Math.max(-REFINEMENT_CAPS.grip_per_lap, Math.min(gripAdj, REFINEMENT_CAPS.grip_per_lap));
        gripTotal += gripAdj;
      }
    }
  }

  // Clamp totals
  thermalTotal = Math.min(thermalTotal, REFINEMENT_CAPS.total_max * 0.4);
  stressTotal = Math.min(stressTotal, REFINEMENT_CAPS.total_max * 0.4);
  gripTotal = Math.max(-REFINEMENT_CAPS.total_max * 0.2, Math.min(gripTotal, REFINEMENT_CAPS.total_max * 0.2));

  let total = thermalTotal + stressTotal + gripTotal;
  total = Math.max(-REFINEMENT_CAPS.total_max, Math.min(total, REFINEMENT_CAPS.total_max));

  // Round
  thermalTotal = Math.round(thermalTotal * 100) / 100;
  stressTotal = Math.round(stressTotal * 100) / 100;
  gripTotal = Math.round(gripTotal * 100) / 100;
  total = Math.round(total * 100) / 100;

  // Build reasons
  if (Math.abs(thermalTotal) > 0.01) reasons.push(`Warmup modulato: +${thermalTotal.toFixed(2)}s`);
  if (Math.abs(stressTotal) > 0.01) reasons.push(`Stress gomma tardivo: +${stressTotal.toFixed(2)}s`);
  if (Math.abs(gripTotal) > 0.01) reasons.push(`Contesto grip: ${gripTotal > 0 ? "+" : ""}${gripTotal.toFixed(2)}s`);
  if (reasons.length === 0) reasons.push("Nessun aggiustamento significativo dai soft sensors");

  // Confidence
  const confRatio = totalLapCount > 0 ? lowConfCount / totalLapCount : 1;
  let confidence: SoftSensorConfidence = "HIGH";
  if (confRatio > 0.5) confidence = "LOW";
  else if (confRatio > 0.2) confidence = "MEDIUM";
  if (Math.abs(total) < 0.05) confidence = "HIGH"; // trivial adjustment = confident it's trivial

  return {
    thermal_adjustment_total: thermalTotal,
    stress_adjustment_total: stressTotal,
    grip_adjustment_total: gripTotal,
    total_soft_sensor_adjustment: total,
    adjustment_reasons: reasons,
    confidence,
  };
}
