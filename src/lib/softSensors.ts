/**
 * Soft Sensors — Latent State Estimation Layer
 *
 * Estimates qualitative/semi-quantitative latent states useful for strategy
 * interpretation. Does NOT measure physical values — only infers observable
 * patterns from data already computed by upstream modules.
 *
 * Anti-hallucination:
 * - No real temperatures, pressures or physical telemetry
 * - UNKNOWN when evidence is insufficient
 * - Every label accompanied by confidence and reasons
 * - Extreme states require multiple converging signals
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

export interface SoftSensorsContext {
  tyre_thermal: TyreThermalSensor;
  tyre_stress: TyreStressSensor;
  track_grip: TrackGripSensor;
  overall_confidence: SoftSensorConfidence;
  reliability_notes: string[];
}

/* ══════════════════════════════════════════════════════════════════
 * TYRE THERMAL STATE
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
  let confidence: SoftSensorConfidence = "HIGH";

  // Check if within warmup window
  const lapsAffected = warmupConfig?.laps_affected ?? 3;
  const isInWarmup = tyreAge < lapsAffected;

  // Check weather contamination
  const currentWeather = weatherMap.get(currentLap);
  if (currentWeather === "WET" || currentWeather === "MIXED") {
    contaminated.push("meteo non dry");
    confidence = "LOW";
    sources.push("weather");
  }

  // Check neutralization contamination
  const currentTrackStatus = trackStatusMap.get(currentLap);
  if (currentTrackStatus && currentTrackStatus !== "GREEN") {
    contaminated.push(`neutralizzazione: ${currentTrackStatus}`);
    if (confidence !== "LOW") confidence = "MEDIUM";
    sources.push("track_status");
  }

  // Check recent neutralization (SC/VSC cool tyres)
  let recentNeutralization = false;
  for (let l = Math.max(1, currentLap - 3); l < currentLap; l++) {
    const ts = trackStatusMap.get(l);
    if (ts === "SC" || ts === "VSC") {
      recentNeutralization = true;
      break;
    }
  }

  // Check battle contamination (battle heats tyres)
  const inBattle = battleContext?.battle_laps.has(currentLap) ?? false;
  if (inBattle) {
    sources.push("battle_context");
  }

  // Determine label
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
 * TYRE STRESS STATE
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

  // Factor 1: Tyre age relative to stint length
  const ageRatio = stintLength > 0 ? tyreAge / stintLength : 0;
  if (ageRatio > 0.8) {
    stressScore += 0.3;
    reasons.push(`Gomma a ${Math.round(ageRatio * 100)}% della lunghezza stint`);
  } else if (ageRatio > 0.5) {
    stressScore += 0.15;
  }

  // Factor 2: Degradation validation
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

  // Factor 3: Pace loss status
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

  // Factor 4: Battle context
  if (battleContext && battleContext.battle_laps.has(currentLap)) {
    stressScore += 0.1;
    reasons.push("Battaglia attiva: stress addizionale da guida aggressiva");
    sources.push("battle_context");
  }

  // Factor 5: Weather mixed
  const currentWeather = weatherMap.get(currentLap);
  if (currentWeather === "MIXED") {
    stressScore += 0.1;
    reasons.push("Meteo misto: stress termico da variazione aderenza");
    sources.push("weather");
    if (confidence === "HIGH") confidence = "MEDIUM";
  }

  // Factor 6: Neutralization restart
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

  // Clamp
  stressScore = Math.min(1, Math.max(0, stressScore));

  // Determine label
  let label: TyreStressLabel;
  if (contaminated.length >= 2 || (confidence === "LOW" && stressScore < 0.3)) {
    label = "UNKNOWN";
    confidence = "LOW";
    if (reasons.length === 0) reasons.push("Dati insufficienti per stimare lo stress gomma");
  } else if (stressScore >= 0.7) {
    // CRITICAL only with multiple converging signals
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
 * TRACK GRIP STATE
 * ══════════════════════════════════════════════════════════════════ */

export function estimateTrackGripState(
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  currentLap: number,
  totalLaps: number,
): TrackGripSensor {
  const reasons: string[] = [];
  const sources: string[] = [];
  let confidence: SoftSensorConfidence = "HIGH";

  // Collect recent weather window (last 5 laps)
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

  // Check neutralizations in window
  let neutralizedInWindow = 0;
  for (let l = Math.max(1, currentLap - windowSize + 1); l <= currentLap; l++) {
    const ts = trackStatusMap.get(l);
    if (ts && ts !== "GREEN") neutralizedInWindow++;
  }
  if (neutralizedInWindow > 0) {
    sources.push("track_status");
  }

  // Earlier weather for transition detection
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
    // Transition from wet to dry → improving
    label = "IMPROVING";
    score = 0.55;
    reasons.push("Transizione da bagnato ad asciutto: pista in fase di asciugatura");
    sources.push("weather_transition");
    confidence = "MEDIUM";
  } else if (dryCount === recentWeather.length) {
    // All dry
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
      // Early race, rubber not yet laid
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
 * ORCHESTRATOR
 * ══════════════════════════════════════════════════════════════════ */

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
  // Use the last stint and its final lap as "current" state
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

  // Overall confidence: worst of the three
  const confOrder: SoftSensorConfidence[] = ["LOW", "MEDIUM", "HIGH"];
  const minConf = Math.min(
    confOrder.indexOf(thermal.confidence),
    confOrder.indexOf(stress.confidence),
    confOrder.indexOf(grip.confidence),
  );
  const overallConfidence = confOrder[minConf];

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
