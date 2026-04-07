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
