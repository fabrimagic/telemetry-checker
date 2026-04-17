import type {
  Lap, StintData, PitData, WeatherData, RaceControlMessage,
  IntervalData, PositionData, Driver,
} from "./openf1";
import { classifyLapsWeather, type WeatherCondition } from "./weatherClassification";
import { classifyLapsTrackStatus, type TrackStatus } from "./trackStatusClassification";
import { calculateTyreDegradation, type DegradationResult } from "./tyreDegradation";
import { calculateCorrectedTyreDegradation, type CorrectedDegradationResult } from "./correctedDegradation";
import { validateAllDegradationEstimates, resolveDegradationForStrategy, type DegradationValidationResult, type DegradationStatus, DEFAULT_VALIDATION_CONFIG } from "./degradationValidation";
import { predictTrafficForPitLaps, type TrafficPrediction, type TrafficLevel } from "./trafficPredictor";
import { computeStrategyBreakdown, type StrategyBreakdown } from "./strategyBreakdown";
import { scoreStrategies, NEUTRAL_PHASE_ADJUSTMENTS, type RiskMode, type ScoredStrategy, type StrategyRiskContext } from "./riskAppetite";
import { buildIntegratedContext, enrichIntegratedContext, buildBattleContext, type IntegratedStrategyContext, type TrafficSummary, type DegradationValidationSummary, type PaceLossSummary } from "./vreContext";
import type { DiaryEvent } from "./raceDiary";
import type { CumulativeDeviationResult, DriverCumulativeDeviation } from "./cumulativeDeviation";
import { type ScenarioId, SCENARIO_DEFINITIONS, isSimulatedScenario, applyScenarioToPhaseAdjustments, buildTimedScenarioModifiers, validateScenarioActivationLap, computeScenarioWindow } from "./scenarioContext";
import { computeAllStintPaceLoss, paceLossDegradationAdjustment, paceLossCliffMultiplier, paceLossPitUrgencyShift, type StintPaceLossResult } from "./stintPaceLoss";
import { computeTyreWarmupPenalty, computeStintWarmupCost } from "./tyreWarmup";
import { enrichStrategyAnalysis, type EnrichedStrategyAnalysis } from "./strategyAnalysis";
import { computeSoftSensors, computeSoftSensorsTimeline, computeStrategySoftSensorAdjustment, computeWarmupInterpretation, computeDegradationValidationContext, extractSoftSensorNarrativeInsights, validateSoftSensorScoringGate, computeSoftSensorScoringDelta, type SoftSensorsContext, type SoftSensorsTimeline, type StrategySoftSensorAdjustment, type WarmupInterpretation, type DegradationValidationContext, type SoftSensorScoringGate } from "./softSensors";
import { NarrativeCollector } from "./narrative/collector";

export type AnalysisMode = "RACE_ENGINEER" | "POST_RACE";

/* ── Types ── */

export interface StintAnalysis {
  stint_number: number;
  compound: string;
  lap_start: number;
  lap_end: number;
  laps_count: number;
  tyre_age_at_start: number;
  avg_lap_time: number | null;
  degradation_slope: number | null;
  r_squared: number | null;
  excluded_laps: number;
}

export interface PitStopAnalysis {
  lap_number: number;
  lane_duration: number;
  stop_duration: number | null;
  compound_before: string | null;
  compound_after: string | null;
  under_neutralisation: boolean;
  neutralisation_type: string | null;
}

export interface ActualStrategy {
  pit_laps: number[];
  stints: StintAnalysis[];
  pit_stops: PitStopAnalysis[];
  total_race_time: number | null;
}

export interface RecommendedStrategy {
  pit_windows: { stint: number; ideal_lap: number; range: [number, number]; compound_after: string }[];
  compounds: string[]; // full compound sequence per stint
  estimated_gain_seconds: number;
  /** Motorsport convention: negative = faster than actual (mirrors estimated_gain_seconds) */
  time_delta_vs_actual: number;
  reason: string;
  breakdown?: StrategyBreakdown;
  description?: string;
  pros?: string[];
  cons?: string[];
  traffic_predictions?: TrafficPrediction[];
  analysis?: EnrichedStrategyAnalysis;
  soft_sensor_adjustment?: StrategySoftSensorAdjustment;
  soft_sensor_notes?: string[];
  scoring_without_soft_sensors?: number;
  scoring_with_soft_sensors?: number;
  scoring_delta_soft_sensors?: number;
}

export interface AlternativeStrategy {
  name: string;
  description: string;
  pit_laps: number[];
  compounds: string[];
  estimated_delta_vs_actual: number;
  /** Motorsport convention: negative = faster than actual (mirrors estimated_delta_vs_actual) */
  time_delta_vs_actual: number;
  pros: string[];
  cons: string[];
  traffic_predictions?: TrafficPrediction[];
  breakdown?: StrategyBreakdown;
  analysis?: EnrichedStrategyAnalysis;
  soft_sensor_adjustment?: StrategySoftSensorAdjustment;
  soft_sensor_notes?: string[];
  scoring_without_soft_sensors?: number;
  scoring_with_soft_sensors?: number;
  scoring_delta_soft_sensors?: number;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface Verdict {
  label: string;
  summary: string;
  delta_seconds: number | null;
  confidence: Confidence;
}

export interface PracticeCompoundModel {
  compound: string;
  slope: number;
  intercept: number;
  rSquared: number;
  source: string; // e.g. "Practice 1"
}

export interface VirtualRaceEngineerResult {
  driver_number: number;
  driver_acronym: string;
  session_key: number;
  actual_strategy: ActualStrategy;
  recommended_strategy: RecommendedStrategy;
  alternative_strategies: AlternativeStrategy[];
  verdict: Verdict;
  confidence: Confidence;
  confidence_factors: string[];
  weather_impact: string | null;
  neutralisation_impact: string | null;
  practice_compounds_used: string[];
  traffic_analysis: TrafficPrediction[];
  actual_breakdown?: StrategyBreakdown;
  risk_mode: RiskMode;
  integrated_context?: IntegratedStrategyContext;
  narrative_insights: string[];
  scenario_id: ScenarioId;
  scenario_is_simulated: boolean;
  scenario_label: string;
  scenario_description: string;
  scenario_modifiers_applied: Record<string, number>;
  scenario_activation_lap: number | null;
  scenario_duration_laps: number | null;
  scenario_window: { start: number; end: number } | null;
  scenario_activation_warning: string | null;
  degradation_validations: DegradationValidationResult[];
  pace_loss_results: StintPaceLossResult[];
  custom_degradation_override: Record<string, number> | null;
  soft_sensors?: SoftSensorsContext;
  soft_sensors_timeline?: SoftSensorsTimeline;
  warmup_interpretation?: WarmupInterpretation;
  degradation_validation_context?: DegradationValidationContext;
  soft_sensor_scoring_gate?: SoftSensorScoringGate;
  analysis_mode: AnalysisMode;
}

/* ── Helpers ── */

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function estimatePitLoss(pitStops: PitData[]): number {
  if (!pitStops.length) return 22; // default F1 pit loss ~22s
  const durations = pitStops.map(p => p.lane_duration).filter(d => d > 0);
  if (!durations.length) return 22;
  return median(durations);
}

function cleanLapsForStint(
  laps: Lap[],
  stint: StintData,
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  isLastStint: boolean
): Lap[] {
  return laps.filter(l => {
    if (l.lap_number < stint.lap_start || l.lap_number > stint.lap_end) return false;
    if (l.lap_duration == null || l.lap_duration <= 0) return false;
    if (l.is_pit_out_lap) return false;
    // Exclude in-lap (last lap of non-final stint)
    if (!isLastStint && l.lap_number === stint.lap_end) return false;
    // Exclude wet/mixed laps
    const wc = weatherMap.get(l.lap_number);
    if (wc === "WET" || wc === "MIXED") return false;
    // Exclude neutralised laps
    const ts = trackStatusMap.get(l.lap_number);
    if (ts && ts !== "GREEN") return false;
    return true;
  });
}

function predictLapTime(slope: number, intercept: number, tyreLife: number): number {
  return slope * tyreLife + intercept;
}

/* ── Main engine ── */

export function computeVirtualRaceEngineer(
  driverNumber: number,
  driverAcronym: string,
  sessionKey: number,
  laps: Lap[],
  stints: StintData[],
  pitStops: PitData[],
  weather: WeatherData[],
  raceControl: RaceControlMessage[],
  intervals: IntervalData[],
  positions: PositionData[],
  allDrivers: Driver[],
  practiceModels: PracticeCompoundModel[] = [],
  riskMode: RiskMode = "BALANCED",
  diaryEvents: DiaryEvent[] | null = null,
  cumDevResult: CumulativeDeviationResult | null = null,
  scenarioId: ScenarioId = "REAL_CONTEXT",
  scenarioActivationLap: number | null = null,
  scenarioDurationLaps: number | null = null,
  customDegradationOverride: Record<string, number> | null = null,
  analysisMode: AnalysisMode = "POST_RACE",
): VirtualRaceEngineerResult | null {
  if (!stints.length || !laps.length) return null;

  // RACE_ENGINEER mode forces REAL_CONTEXT
  const effectiveScenarioId: ScenarioId = analysisMode === "RACE_ENGINEER" ? "REAL_CONTEXT" : scenarioId;
  const isRaceEngineerMode = analysisMode === "RACE_ENGINEER";

  const weatherMap = classifyLapsWeather(laps, weather);
  const trackStatusMapRaw = classifyLapsTrackStatus(laps, raceControl);
  // Red flag on the very last lap = race ended, not a neutralization
  const trackStatusMap = new Map(trackStatusMapRaw);
  const maxLapNumber = Math.max(...laps.map(l => l.lap_number));
  if (trackStatusMap.get(maxLapNumber) === "RED") {
    trackStatusMap.delete(maxLapNumber);
  }

  const pitLoss = estimatePitLoss(pitStops);
  const totalLaps = maxLapNumber;

  // ── 1. Actual strategy ──
  const stintAnalyses: StintAnalysis[] = [];
  const degradationModels = new Map<number, { slope: number; intercept: number }>();

  // Raw baseline degradation (simple linear regression, no corrections)
  const rawDegResults: DegradationResult[] = calculateTyreDegradation(
    driverNumber, driverAcronym, "ffffff", laps, stints,
  );

  // Corrected multivariate model (fuel proxy + temperature)
  const degResults: DegradationResult[] = calculateCorrectedTyreDegradation(
    driverNumber, driverAcronym, "ffffff", laps, stints,
    weather, totalLaps, weatherMap, trackStatusMap,
  );

  // ── Raw vs Corrected comparison (used for confidence/narrative) ──
  const rawVsCorrected: { stint: number; compound: string; rawSlope: number; corrSlope: number; delta: number; agreement: "HIGH" | "MEDIUM" | "LOW" }[] = [];
  for (const corrRes of degResults) {
    const rawRes = rawDegResults.find(r => r.stint === corrRes.stint);
    if (rawRes && rawRes.slopeSecPerLap != null && corrRes.slopeSecPerLap != null) {
      const delta = Math.abs(corrRes.slopeSecPerLap - rawRes.slopeSecPerLap);
      const agreement: "HIGH" | "MEDIUM" | "LOW" = delta < 0.02 ? "HIGH" : delta < 0.06 ? "MEDIUM" : "LOW";
      rawVsCorrected.push({
        stint: corrRes.stint,
        compound: corrRes.compound,
        rawSlope: rawRes.slopeSecPerLap,
        corrSlope: corrRes.slopeSecPerLap,
        delta,
        agreement,
      });
    }
  }

  // ── Degradation validation (based on corrected slope) ──
  const rawValidated = validateAllDegradationEstimates(degResults);
  const degradationValidations = resolveDegradationForStrategy(rawValidated);

  for (const dv of degradationValidations) {
    // If user provided a per-compound custom override and this stint is INVALID, use it
    const compoundKey = dv.original.compound;
    const compoundOverride = customDegradationOverride != null ? customDegradationOverride[compoundKey] ?? null : null;
    const useCustomOverride = compoundOverride != null && dv.status === "INVALID";
    const effectiveSlope = useCustomOverride ? compoundOverride : dv.effective_slope;
    
    if (useCustomOverride) {
      // Update the validation result to reflect user override
      dv.effective_slope = compoundOverride;
      dv.fallback_applied = true;
      dv.fallback_description = `Override utente applicato per ${compoundKey} (${compoundOverride.toFixed(3)} s/giro)`;
    }
    
    degradationModels.set(dv.original.stint, {
      slope: effectiveSlope,
      intercept: dv.original.intercept,
    });
  }

  for (let i = 0; i < stints.length; i++) {
    const stint = stints[i];
    const isLast = i === stints.length - 1;
    const cleanLaps = cleanLapsForStint(laps, stint, weatherMap, trackStatusMap, isLast);
    const allStintLaps = laps.filter(l =>
      l.lap_number >= stint.lap_start && l.lap_number <= stint.lap_end &&
      l.lap_duration != null && l.lap_duration > 0
    );

    const validDurations = cleanLaps.map(l => l.lap_duration!);
    const avgTime = validDurations.length ? validDurations.reduce((a, b) => a + b, 0) / validDurations.length : null;

    const model = degradationModels.get(stint.stint_number);
    const validation = degradationValidations.find(v => v.original.stint === stint.stint_number);

    stintAnalyses.push({
      stint_number: stint.stint_number,
      compound: stint.compound,
      lap_start: stint.lap_start,
      lap_end: stint.lap_end,
      laps_count: stint.lap_end - stint.lap_start + 1,
      tyre_age_at_start: stint.tyre_age_at_start ?? 0,
      avg_lap_time: avgTime ? Math.round(avgTime * 1000) / 1000 : null,
      degradation_slope: model ? model.slope : null,
      r_squared: validation?.original.rSquared ?? degResults.find(d => d.stint === stint.stint_number)?.rSquared ?? null,
      excluded_laps: allStintLaps.length - cleanLaps.length,
    });
  }

  // Pit stop analysis
  const pitStopAnalyses: PitStopAnalysis[] = pitStops.map(p => {
    const ts = trackStatusMap.get(p.lap_number);
    const stintBefore = stints.find(s => s.lap_end >= p.lap_number - 1 && s.lap_start <= p.lap_number);
    const stintAfter = stints.find(s => s.lap_start <= p.lap_number + 1 && s.lap_end >= p.lap_number);
    const nextStint = stints.find(s => s.lap_start > p.lap_number);
    return {
      lap_number: p.lap_number,
      lane_duration: p.lane_duration,
      stop_duration: p.stop_duration,
      compound_before: stintBefore?.compound ?? null,
      compound_after: nextStint?.compound ?? stintAfter?.compound ?? null,
      under_neutralisation: ts != null && ts !== "GREEN",
      neutralisation_type: ts && ts !== "GREEN" ? ts : null,
    };
  });

  const totalTime = laps
    .filter(l => l.lap_duration != null && l.lap_duration > 0)
    .reduce((s, l) => s + l.lap_duration!, 0);

  const actualStrategy: ActualStrategy = {
    pit_laps: pitStops.map(p => p.lap_number),
    stints: stintAnalyses,
    pit_stops: pitStopAnalyses,
    total_race_time: totalTime > 0 ? Math.round(totalTime * 1000) / 1000 : null,
  };

  // ── 1b. Pace Loss from Cumulative Deviation (auxiliary) ──
  const driverCumDev: DriverCumulativeDeviation | null = cumDevResult?.drivers.find(d => d.driver_number === driverNumber) ?? null;
  // Battle context built early just for pace loss contamination check
  const earlyBattleCtx = diaryEvents ? buildBattleContext(diaryEvents) : null;
  const paceLossResults = computeAllStintPaceLoss(driverCumDev, stints, earlyBattleCtx, weatherMap, trackStatusMap);
  const plDegAdj = paceLossDegradationAdjustment(paceLossResults);
  const plCliffMult = paceLossCliffMultiplier(paceLossResults);
  const plPitShift = paceLossPitUrgencyShift(paceLossResults);

  // ── 2. Simulate strategies ──

  // Build a simple lap time predictor per compound (race data first)
  const compoundModels = new Map<string, { slope: number; intercept: number; source: string }>();
  for (const sa of stintAnalyses) {
    const model = degradationModels.get(sa.stint_number);
    if (model && !compoundModels.has(sa.compound)) {
      compoundModels.set(sa.compound, { ...model, source: "race" });
    }
  }

  // Enrich with practice compound models (only add compounds not already from race)
  const practiceCompoundsUsed: string[] = [];
  for (const pm of practiceModels) {
    if (!compoundModels.has(pm.compound) && pm.rSquared > 0.3) {
      // Adjust practice intercept to race pace: use median race lap time as baseline
      const raceModels = [...compoundModels.values()].filter(m => m.source === "race");
      let paceOffset = 0;
      if (raceModels.length > 0) {
        // Estimate offset between practice and race pace at tyre life = 5
        const raceBasePace = raceModels[0].intercept + raceModels[0].slope * 5;
        const practiceBasePace = pm.intercept + pm.slope * 5;
        paceOffset = raceBasePace - practiceBasePace;
      }
      compoundModels.set(pm.compound, {
        slope: pm.slope,
        intercept: pm.intercept + paceOffset,
        source: pm.source,
      });
      practiceCompoundsUsed.push(pm.compound);
    }
  }

  // F1 regulation: at least 2 different compounds must be used during a dry race
  function hasMinTwoCompounds(compounds: string[]): boolean {
    return new Set(compounds).size >= 2;
  }

  const scenarioDef = SCENARIO_DEFINITIONS[effectiveScenarioId];
  const scenarioMods = buildTimedScenarioModifiers(effectiveScenarioId, scenarioActivationLap, totalLaps, scenarioDurationLaps);
  const scenarioActivationWarning = validateScenarioActivationLap(effectiveScenarioId, scenarioActivationLap, totalLaps, scenarioDurationLaps);
  const scenarioWindow = isSimulatedScenario(effectiveScenarioId) ? computeScenarioWindow(scenarioActivationLap, scenarioDurationLaps, totalLaps) : null;

  // ── Risk mode base weights ──
  const RISK_BASE = {
    CONSERVATIVE: { degradation: 1.15, traffic: 1.3, pitLoss: 1.0, cliff_penalty: 0.12, opportunity: 0.8 },
    BALANCED:     { degradation: 1.0,  traffic: 1.0, pitLoss: 1.0, cliff_penalty: 0.06, opportunity: 1.0 },
    AGGRESSIVE:   { degradation: 0.85, traffic: 0.7, pitLoss: 1.0, cliff_penalty: 0.02, opportunity: 1.3 },
  } as const;
  const riskBase = RISK_BASE[riskMode];

  // ── Observed neutralisation pit loss multiplier ──
  // SC/VSC reduce effective pit loss because the field is bunched/slowed.
  // These multipliers are applied to both actual and simulated strategies
  // based on the REAL track status at the pit lap.
  const SC_PIT_LOSS_MULT = 0.62;   // ~38% reduction under full SC
  const VSC_PIT_LOSS_MULT = 0.78;  // ~22% reduction under VSC

  /**
   * Returns the pit loss multiplier based on observed (real) track status at a given lap.
   * Only uses trackStatusMap (real data), never scenario-simulated neutralisations.
   * In RACE_ENGINEER mode, returns 1.0 for simulated strategies (no future knowledge).
   * Use forActualStrategy=true to always use real data (for actual strategy breakdown).
   */
  function getObservedPitLossMultiplier(pitLap: number, forActualStrategy: boolean = false): number {
    // In RACE_ENGINEER mode, simulated strategies don't benefit from SC/VSC knowledge
    if (isRaceEngineerMode && !forActualStrategy) return 1.0;
    const status = trackStatusMap.get(pitLap);
    if (status === "SC") return SC_PIT_LOSS_MULT;
    if (status === "VSC") return VSC_PIT_LOSS_MULT;
    // MIXED could partially benefit, use a conservative partial discount
    if (status === "MIXED") return 0.90;
    return 1.0; // GREEN or no status
  }

  // Helper: check if a lap is inside the scenario window
  function isInScenarioWindow(lap: number): boolean {
    if (!scenarioWindow) return isSimulatedScenario(effectiveScenarioId); // no window = full race
    return lap >= scenarioWindow.start && lap <= scenarioWindow.end;
  }

  // Per-lap modifier for degradation based on scenario
  function lapDegradationMult(lap: number): number {
    const base = isSimulatedScenario(effectiveScenarioId) && isInScenarioWindow(lap)
      ? riskBase.degradation * scenarioMods.degradation_weight
      : riskBase.degradation;
    return base * plDegAdj; // pace loss adjustment
  }

  /**
   * Effective pit loss for a pit at a given lap.
   * Hierarchy: observed neutralisation first, then scenario modifier (no double-counting).
   */
  function effectivePitLoss(pitLap: number): number {
    const baseMult = riskBase.pitLoss;
    const observedMult = getObservedPitLossMultiplier(pitLap);

    // If real neutralisation applies, use it (observed data takes priority)
    if (observedMult < 1.0) {
      // No scenario modifier on top — observed neutralisation already accounts for the benefit
      return pitLoss * baseMult * observedMult;
    }

    // No real neutralisation: apply scenario modifier if active
    if (isSimulatedScenario(effectiveScenarioId) && isInScenarioWindow(pitLap)) {
      return pitLoss * baseMult * scenarioMods.pit_loss_multiplier;
    }

    return pitLoss * baseMult;
  }

  // Pre-compute traffic analysis for cost function
  const allLapsMapEarly = new Map<number, Lap[]>();
  allLapsMapEarly.set(driverNumber, laps);
  const earlyPitCandidates: number[] = [];
  const earlyFirstPit = pitStops.length > 0 ? pitStops[0].lap_number : Math.floor(totalLaps / 2);
  for (let offset = -6; offset <= 6; offset++) {
    const c = earlyFirstPit + offset;
    if (c >= 2 && c <= totalLaps - 2) earlyPitCandidates.push(c);
  }
  const trafficAnalysis = predictTrafficForPitLaps(
    driverNumber, earlyPitCandidates, pitLoss, totalLaps,
    allLapsMapEarly, positions, intervals, allDrivers,
  );
  const trafficAvgBaseline = trafficAnalysis.length > 0
    ? trafficAnalysis.reduce((s, t) => s + t.estimated_traffic_time_loss, 0) / trafficAnalysis.length
    : 1.0;

  // Tyre cliff risk penalty: penalizes stint length beyond a per-compound threshold
  // Soft cliffa prima (~14 giri), Hard regge molto più a lungo (~28 giri)
  const CLIFF_THRESHOLDS: Record<string, number> = { SOFT: 14, MEDIUM: 20, HARD: 28 };
  const CLIFF_THRESHOLD_DEFAULT = 18;
  function cliffPenalty(stintLength: number, compound: string): number {
    const key = (compound ?? "").toUpperCase();
    const threshold = CLIFF_THRESHOLDS[key] ?? CLIFF_THRESHOLD_DEFAULT;
    if (stintLength <= threshold) return 0;
    const excessLaps = stintLength - threshold;
    return excessLaps * excessLaps * riskBase.cliff_penalty * plCliffMult; // pace loss cliff multiplier
  }

  // Driver position lookup for traffic estimation
  const driverPositionAtLap = new Map<number, number>();
  for (const pos of positions) {
    if (pos.driver_number === driverNumber) {
      const lapMatch = laps.find(l =>
        l.date_start && pos.date &&
        Math.abs(new Date(l.date_start).getTime() - new Date(pos.date).getTime()) < 120000
      );
      if (lapMatch) driverPositionAtLap.set(lapMatch.lap_number, pos.position);
    }
  }

  // Estimate traffic cost for a pit at given lap
  function estimateTrafficCost(pitLap: number): number {
    // Check if we have a precise prediction for this lap
    const precise = trafficAnalysis.find(t => t.pit_lap === pitLap);
    const baseCost = precise ? precise.estimated_traffic_time_loss : trafficAvgBaseline;

    // Adjust by position: mid-pack = more traffic, front/back = less
    const pos = driverPositionAtLap.get(pitLap) ?? driverPositionAtLap.get(pitLap - 1) ?? 10;
    const positionFactor = precise ? 1.0 : (pos <= 3 ? 0.3 : pos <= 6 ? 0.7 : pos <= 14 ? 1.0 : 0.5);

    const trafficMult = isSimulatedScenario(effectiveScenarioId) && isInScenarioWindow(pitLap)
      ? riskBase.traffic * scenarioMods.traffic_weight
      : riskBase.traffic;

    return baseCost * positionFactor * trafficMult;
  }

  // Build stint bounds helper
  function buildStintBounds(pitLapsArr: number[], compoundsArr: string[]) {
    const bounds: { start: number; end: number; compound: string }[] = [];
    let s = 1;
    for (let i = 0; i < pitLapsArr.length; i++) {
      bounds.push({ start: s, end: pitLapsArr[i], compound: compoundsArr[i] || compoundsArr[0] });
      s = pitLapsArr[i] + 1;
    }
    bounds.push({ start: s, end: totalLaps, compound: compoundsArr[compoundsArr.length - 1] || compoundsArr[0] });
    return bounds;
  }

  // Full cost function: simulates total adjusted race time
  function simulateStrategyCost(pitLapsArr: number[], compoundsArr: string[]): number | null {
    if (!hasMinTwoCompounds(compoundsArr)) return null;
    const stintBounds = buildStintBounds(pitLapsArr, compoundsArr);

    let totalCost = 0;

    for (let si = 0; si < stintBounds.length; si++) {
      const sb = stintBounds[si];
      const model = compoundModels.get(sb.compound);
      if (!model) return null;
      const stintLength = sb.end - sb.start + 1;
      const isFirstStint = si === 0;
      for (let lap = sb.start; lap <= sb.end; lap++) {
        const tyreLife = lap - sb.start;
        const baseLap = model.intercept;
        const degLap = model.slope * tyreLife * lapDegradationMult(lap);
        // Tyre warmup penalty: temporary time loss in first laps after pit
        const warmupPenalty = isFirstStint ? 0 : computeTyreWarmupPenalty(sb.compound, tyreLife);
        totalCost += baseLap + degLap + warmupPenalty;
      }
      // Cliff risk for this stint
      totalCost += cliffPenalty(stintLength, sb.compound);
    }

    // Pit costs with per-lap scenario modifier
    for (const pl of pitLapsArr) {
      totalCost += effectivePitLoss(pl);
      totalCost += estimateTrafficCost(pl);
    }

    // Opportunity modifier for aggressive mode: bonus for fewer pit stops
    if (riskBase.opportunity > 1.0 && pitLapsArr.length < actualPitLaps.length) {
      totalCost -= (actualPitLaps.length - pitLapsArr.length) * 2.0 * (riskBase.opportunity - 1.0);
    }

    return totalCost;
  }

  // Simple raw time (with observed neutralisation-aware pit loss) for delta calculation baseline
  function simulateTimeRaw(pitLapsArr: number[], compoundsArr: string[], forActualStrategy: boolean = false): number | null {
    if (!hasMinTwoCompounds(compoundsArr)) return null;
    const stintBounds = buildStintBounds(pitLapsArr, compoundsArr);
    let total = 0;
    for (let si = 0; si < stintBounds.length; si++) {
      const sb = stintBounds[si];
      const model = compoundModels.get(sb.compound);
      if (!model) return null;
      const isFirstStint = si === 0;
      for (let lap = sb.start; lap <= sb.end; lap++) {
        const tyreLife = lap - sb.start;
        const warmupPenalty = isFirstStint ? 0 : computeTyreWarmupPenalty(sb.compound, tyreLife);
        total += predictLapTime(model.slope, model.intercept, tyreLife) + warmupPenalty;
      }
    }
    // Use neutralisation-aware pit loss for each pit lap
    for (const pl of pitLapsArr) {
      total += pitLoss * getObservedPitLossMultiplier(pl, forActualStrategy);
    }
    return total;
  }

  const actualCompounds = stints.map(s => s.compound);
  const actualPitLaps = pitStops.map(p => p.lap_number);
  const actualSimTime = simulateTimeRaw(actualPitLaps, actualCompounds, true);
  const actualAdjustedTime = simulateStrategyCost(actualPitLaps, actualCompounds);

  // ── 3. Find optimal pit window (using risk-adjusted scoring) ──
  const recommendedWindows: RecommendedStrategy["pit_windows"] = [];
  let bestDelta = 0;
  let bestPitLaps = actualPitLaps;
  let bestCompounds = actualCompounds;
  let bestReason = "Strategia reale già vicina all'ottimale";

  // Try shifts of ±5 laps for each pit stop AND different compound combinations
  if (actualPitLaps.length > 0 && actualAdjustedTime != null && actualSimTime != null) {
    let bestTime = actualAdjustedTime;

    // Generate compound combos: actual + all permutations using available compounds
    const allAvailableCompounds = [...compoundModels.keys()];
    const compoundCombos: string[][] = [];
    // Only include actual compounds if they satisfy the 2-compound rule
    if (hasMinTwoCompounds(actualCompounds)) compoundCombos.push(actualCompounds);

    if (actualCompounds.length === 2) {
      for (const c1 of allAvailableCompounds) {
        for (const c2 of allAvailableCompounds) {
          const combo = [c1, c2];
          if (!hasMinTwoCompounds(combo)) continue;
          if (combo.join(",") !== actualCompounds.join(",")) compoundCombos.push(combo);
        }
      }
    } else if (actualCompounds.length === 3) {
      for (const c1 of allAvailableCompounds) {
        for (const c2 of allAvailableCompounds) {
          for (const c3 of allAvailableCompounds) {
            const combo = [c1, c2, c3];
            if (!hasMinTwoCompounds(combo)) continue;
            if (combo.join(",") !== actualCompounds.join(",")) compoundCombos.push(combo);
          }
        }
      }
    }

    // Extend search range with pace loss pit urgency shift
    const baseShifts = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
    const urgencyShifts = plPitShift !== 0
      ? [...new Set([...baseShifts, ...baseShifts.map(s => s + plPitShift)])].sort((a, b) => a - b)
      : baseShifts;
    const shifts = urgencyShifts;
    const shift2Range = actualPitLaps.length >= 2 ? shifts : [0];

    for (const compounds of compoundCombos) {
      for (const shift1 of shifts) {
        for (const shift2 of shift2Range) {
          const candidatePits = actualPitLaps.map((p, i) => {
            const s = i === 0 ? shift1 : i === 1 ? shift2 : 0;
            return Math.max(3, Math.min(totalLaps - 3, p + s));
          });

          let valid = true;
          for (let i = 1; i < candidatePits.length; i++) {
            if (candidatePits[i] <= candidatePits[i - 1] + 2) { valid = false; break; }
          }
          if (candidatePits[0] < 2) valid = false;
          if (!valid) continue;

          const t = simulateStrategyCost(candidatePits, compounds);
          if (t != null && t < bestTime) {
            bestTime = t;
            bestPitLaps = candidatePits;
            bestCompounds = compounds;
            bestDelta = actualAdjustedTime! - t;
          }
        }
      }
    }

    // Build recommended windows
    for (let i = 0; i < bestPitLaps.length; i++) {
      const idealLap = bestPitLaps[i];
      recommendedWindows.push({
        stint: i + 1,
        ideal_lap: idealLap,
        range: [Math.max(1, idealLap - 1), Math.min(totalLaps, idealLap + 1)],
        compound_after: bestCompounds[i + 1] || bestCompounds[i],
      });
    }

    if (bestDelta > 1) {
      const diff = bestPitLaps[0] - actualPitLaps[0];
      const compoundsChanged = bestCompounds.join(",") !== actualCompounds.join(",");
      if (compoundsChanged) {
        bestReason = `Compound ottimale stimato: ${bestCompounds.join(" → ")}` + (diff !== 0 ? ` con pit spostato di ${Math.abs(diff)} giri` : "");
      } else if (diff < 0) {
        bestReason = `Degrado elevato nello stint iniziale: pit consigliato ${Math.abs(diff)} giri prima`;
      } else if (diff > 0) {
        bestReason = `Stint iniziale estendibile: pit consigliato ${diff} giri dopo`;
      } else {
        bestReason = "Timing del pit reale vicino all'ottimale";
      }
    }
  }

  const recommendedStrategy: RecommendedStrategy = {
    pit_windows: recommendedWindows,
    compounds: [...bestCompounds],
    estimated_gain_seconds: Math.round(bestDelta * 10) / 10,
    time_delta_vs_actual: -Math.round(bestDelta * 10) / 10,
    reason: bestReason,
  };

  // ── 4. Alternative strategies ──
  const alternatives: AlternativeStrategy[] = [];

  if (actualPitLaps.length > 0 && actualSimTime != null && actualAdjustedTime != null) {
    // Undercut
    const undercutPits = actualPitLaps.map((p, i) => i === 0 ? Math.max(3, p - 3) : p);
    const undercutTime = simulateStrategyCost(undercutPits, actualCompounds);
    if (undercutTime != null) {
      alternatives.push({
        name: "Undercut anticipato",
        description: `Pit al giro ${undercutPits[0]} invece di ${actualPitLaps[0]}`,
        pit_laps: undercutPits,
        compounds: actualCompounds,
        estimated_delta_vs_actual: Math.round((actualAdjustedTime - undercutTime) * 10) / 10,
        time_delta_vs_actual: -Math.round((actualAdjustedTime - undercutTime) * 10) / 10,
        pros: ["Riduce esposizione al degrado", "Potenziale vantaggio in aria pulita"],
        cons: ["Stint successivo più lungo", "Rischio di perdere posizione se undercut non riuscito"],
      });
    }

    // Overcut
    const overcutPits = actualPitLaps.map((p, i) => i === 0 ? Math.min(totalLaps - 3, p + 3) : p);
    const overcutTime = simulateStrategyCost(overcutPits, actualCompounds);
    if (overcutTime != null) {
      alternatives.push({
        name: "Overcut / estensione stint",
        description: `Pit al giro ${overcutPits[0]} invece di ${actualPitLaps[0]}`,
        pit_laps: overcutPits,
        compounds: actualCompounds,
        estimated_delta_vs_actual: Math.round((actualAdjustedTime - overcutTime) * 10) / 10,
        time_delta_vs_actual: -Math.round((actualAdjustedTime - overcutTime) * 10) / 10,
        pros: ["Stint più corto su gomme fresche", "Potenziale track position"],
        cons: ["Maggiore degrado sulle gomme vecchie", "Rischio di perdere tempo nel traffico"],
      });
    }

    // Opposite compound if available (race compounds)
    const availableCompounds = [...new Set(actualCompounds)];
    if (availableCompounds.length >= 2) {
      const reversed = [...actualCompounds].reverse();
      const reversedTime = simulateStrategyCost(actualPitLaps, reversed);
      if (reversedTime != null) {
        alternatives.push({
          name: "Strategia compound invertiti",
          description: `Ordine mescole invertito: ${reversed.join(" → ")}`,
          pit_laps: actualPitLaps,
          compounds: reversed,
          estimated_delta_vs_actual: Math.round((actualAdjustedTime - reversedTime) * 10) / 10,
          time_delta_vs_actual: -Math.round((actualAdjustedTime - reversedTime) * 10) / 10,
          pros: ["Diversa gestione del degrado", "Potenziale vantaggio nel finale"],
          cons: ["Strategia meno convenzionale", "Rischio di passo non competitivo all'inizio"],
        });
      }
    }

    // Practice-derived compound alternatives
    for (const practiceCompound of practiceCompoundsUsed) {
      const raceCompoundsSet = new Set(actualCompounds);
      if (raceCompoundsSet.has(practiceCompound)) continue;

      // Try substituting the last stint compound with the practice compound
      if (actualCompounds.length >= 2) {
        const altCompounds = [...actualCompounds];
        altCompounds[altCompounds.length - 1] = practiceCompound;
        const altTime = simulateStrategyCost(actualPitLaps, altCompounds);
        if (altTime != null) {
          alternatives.push({
            name: `Stint finale su ${practiceCompound}`,
            description: `Ultimo stint con ${practiceCompound} (dati da Practice) invece di ${actualCompounds[actualCompounds.length - 1]}`,
            pit_laps: actualPitLaps,
            compounds: altCompounds,
            estimated_delta_vs_actual: Math.round((actualAdjustedTime - altTime) * 10) / 10,
            time_delta_vs_actual: -Math.round((actualAdjustedTime - altTime) * 10) / 10,
            pros: [`Degrado ${practiceCompound} stimato dalle prove libere`, "Compound alternativo non usato in gara"],
            cons: ["Stima basata su dati Practice (passo diverso dalla gara)", "Condizioni pista differenti tra prove e gara"],
          });
        }
      }

      // Try substituting the first stint compound
      if (actualCompounds.length >= 2) {
        const altCompounds = [...actualCompounds];
        altCompounds[0] = practiceCompound;
        const altTime2 = simulateStrategyCost(actualPitLaps, altCompounds);
        if (altTime2 != null) {
          alternatives.push({
            name: `Stint iniziale su ${practiceCompound}`,
            description: `Primo stint con ${practiceCompound} (dati da Practice) invece di ${actualCompounds[0]}`,
            pit_laps: actualPitLaps,
            compounds: altCompounds,
            estimated_delta_vs_actual: Math.round((actualAdjustedTime - altTime2) * 10) / 10,
            time_delta_vs_actual: -Math.round((actualAdjustedTime - altTime2) * 10) / 10,
            pros: [`Degrado ${practiceCompound} stimato dalle prove libere`, "Scelta strategica diversa all'inizio"],
            cons: ["Stima basata su dati Practice", "Condizioni pista e carburante differenti"],
          });
        }
      }
    }


    // ── 4a-extra. N+1 stop strategy (SC makes extra stop cheaper) ──
    if (actualPitLaps.length <= 2 && actualAdjustedTime != null) {
      const longestStintIdx = stintAnalyses.reduce((best, s, i) =>
        s.laps_count > (stintAnalyses[best]?.laps_count ?? 0) ? i : best, 0);
      const longestStint = stintAnalyses[longestStintIdx];
      if (longestStint && longestStint.laps_count > 10) {
        const splitLap = Math.round(longestStint.lap_start + longestStint.laps_count / 2);
        const extraPits = [...actualPitLaps, splitLap].sort((a, b) => a - b);
        for (const extraCompound of [...compoundModels.keys()]) {
          const extraCompounds: string[] = [];
          for (let si = 0; si <= extraPits.length; si++) {
            if (si < actualCompounds.length) extraCompounds.push(actualCompounds[si]);
            else extraCompounds.push(extraCompound);
          }
          while (extraCompounds.length > extraPits.length + 1) extraCompounds.pop();
          if (!hasMinTwoCompounds(extraCompounds)) continue;
          const extraTime = simulateStrategyCost(extraPits, extraCompounds);
          if (extraTime != null) {
            alternatives.push({
              name: `${extraPits.length}-stop`,
              description: `Pit ai giri ${extraPits.join(", ")} (${extraCompounds.join(" → ")})`,
              pit_laps: extraPits,
              compounds: extraCompounds,
              estimated_delta_vs_actual: Math.round((actualAdjustedTime - extraTime) * 10) / 10,
              time_delta_vs_actual: -Math.round((actualAdjustedTime - extraTime) * 10) / 10,
              pros: ["Stint più corti = meno degrado", "Vantaggio se pit loss ridotto (SC)"],
              cons: ["Pit stop aggiuntivo", "Maggiore esposizione al traffico"],
            });
          }
        }
      }
    }
  }

  // ── 4b. Traffic Release Predictor ──
  const allLapsMap = allLapsMapEarly;

  // Attach traffic predictions and warmup analysis to alternatives
  for (const alt of alternatives) {
    if (alt.pit_laps.length > 0) {
      const altTraffic = predictTrafficForPitLaps(
        driverNumber, alt.pit_laps, pitLoss, totalLaps,
        allLapsMap, positions, intervals, allDrivers,
      );
      alt.traffic_predictions = altTraffic;
      const trafficLoss = altTraffic.reduce((sum, t) => sum + (t.traffic_time_loss_total ?? t.estimated_traffic_time_loss), 0);
      const worstTraffic = altTraffic.reduce((worst, t) => {
        if (t.traffic_level === "HEAVY") return "HEAVY";
        if (t.traffic_level === "LIGHT" && worst !== "HEAVY") return "LIGHT";
        return worst;
      }, "CLEAN" as TrafficLevel);
      if (worstTraffic === "HEAVY") {
        alt.cons.push(`Rientro in traffico pesante (−${trafficLoss.toFixed(1)}s stimati)`);
      } else if (worstTraffic === "LIGHT") {
        alt.cons.push(`Rientro in traffico leggero (−${trafficLoss.toFixed(1)}s stimati)`);
      } else if (worstTraffic === "CLEAN") {
        alt.pros.push("Rientro in aria pulita");
      }

      // Traffic metadata enrichment: release classification, pack risk, persistence
      for (const tp of altTraffic) {
        // Release classification (CLEAN / TRAFFIC / PACK)
        if (tp.release_classification === "PACK") {
          alt.cons.push(`Rientro dentro un pack al giro ${tp.pit_lap} (${tp.pack_size_ahead ?? "?"} vetture davanti, ${tp.pack_size_behind ?? "?"} dietro)`);
          break;
        }
        if (tp.release_classification === "TRAFFIC") {
          if (tp.release_quality === "POOR" || tp.release_quality === "MARGINAL") {
            alt.cons.push(`Qualità release al giro ${tp.pit_lap}: ${tp.release_quality === "POOR" ? "scarsa" : "marginale"}${tp.compressed_train_risk === "HIGH" ? " — rischio trenino compresso" : ""}`);
            break;
          }
        }
        // Traffic persistence
        const persistLaps = tp.traffic_persistence_laps ?? tp.estimated_traffic_laps;
        if (persistLaps > 3) {
          alt.cons.push(`Traffico persistente: ~${persistLaps} giri bloccato in aria sporca dopo il pit al giro ${tp.pit_lap}`);
          break;
        }
        // Stuck risk
        if ((tp.stuck_risk_score ?? 0) > 0.7) {
          alt.cons.push(`Rischio elevato di restare bloccato dopo il pit al giro ${tp.pit_lap} (stuck score: ${((tp.stuck_risk_score ?? 0) * 100).toFixed(0)}%)`);
          break;
        }
      }

      // Prediction confidence warning
      const lowConfTraffic = altTraffic.filter(tp => tp.prediction_confidence === "LOW");
      if (lowConfTraffic.length > 0) {
        alt.cons.push("Previsione traffico a bassa confidenza — dati posizione/intervalli insufficienti");
      }
    }

    // Warmup cost analysis per alternative (simulated only)
    const altStintBounds = buildStintBounds(alt.pit_laps, alt.compounds);
    let altWarmupTotal = 0;
    for (let si = 0; si < altStintBounds.length; si++) {
      altWarmupTotal += computeStintWarmupCost(altStintBounds[si].compound, si === 0);
    }
    if (altWarmupTotal > 2.5) {
      alt.cons.push(`Warmup elevato: ${altWarmupTotal.toFixed(1)}s persi per riscaldamento gomme`);
    }
    const hasHard = alt.compounds.some(c => c.toUpperCase() === "HARD");
    if (hasHard && altWarmupTotal > 1.5) {
      alt.cons.push("Mescola Hard: warmup lento riduce efficacia undercut");
    }
  }

  // Also compute traffic for recommended strategy pit laps
  if (bestPitLaps.length > 0) {
    const recTraffic = predictTrafficForPitLaps(
      driverNumber,
      bestPitLaps,
      pitLoss,
      totalLaps,
      allLapsMap,
      positions,
      intervals,
      allDrivers,
    );
    recommendedStrategy.traffic_predictions = recTraffic;
    const recTrafficLoss = recTraffic.reduce((sum, t) => sum + (t.traffic_time_loss_total ?? t.estimated_traffic_time_loss), 0);
    if (recTrafficLoss > 0) {
      const worstRelease = recTraffic.reduce((w, t) => {
        const cls = t.release_classification ?? "CLEAN";
        if (cls === "PACK") return "PACK";
        if (cls === "TRAFFIC" && w !== "PACK") return "TRAFFIC";
        return w;
      }, "CLEAN" as string);
      const releaseNote = worstRelease === "PACK" ? " (rientro in pack)" : worstRelease === "TRAFFIC" ? " (traffico)" : "";
      recommendedStrategy.reason += ` (traffico stimato: −${recTrafficLoss.toFixed(1)}s${releaseNote})`;
    }
  } else {
    recommendedStrategy.traffic_predictions = [];
  }

  // ── 4c. Strategy Breakdowns (with scenario/risk modifiers) ──
  const breakdownMods: import("./strategyBreakdown").BreakdownModifiers = {
    degradation_mult: isSimulatedScenario(effectiveScenarioId) ? riskBase.degradation * scenarioMods.degradation_weight : riskBase.degradation,
    pit_loss_mult: isSimulatedScenario(effectiveScenarioId) ? riskBase.pitLoss * scenarioMods.pit_loss_multiplier : riskBase.pitLoss,
    traffic_mult: isSimulatedScenario(effectiveScenarioId) ? riskBase.traffic * scenarioMods.traffic_weight : riskBase.traffic,
    neutralization_mult: isSimulatedScenario(effectiveScenarioId) ? scenarioMods.neutralization_weight : 1.0,
  };

  const actualTraffic = predictTrafficForPitLaps(
    driverNumber, actualPitLaps, pitLoss, totalLaps, allLapsMap, positions, intervals, allDrivers,
  );
  const actualBreakdown = computeStrategyBreakdown(
    actualPitLaps, actualCompounds, totalLaps, compoundModels, pitLoss,
    actualTraffic, weatherMap, trackStatusMap, pitStopAnalyses, breakdownMods,
    false, // includeWarmup=false: actual strategy is historical, warmup is predictive only
  );

  // Recommended breakdown
  if (bestPitLaps.length > 0) {
    const recTrafficForBreakdown = recommendedStrategy.traffic_predictions ?? [];
    recommendedStrategy.breakdown = computeStrategyBreakdown(
      bestPitLaps, bestCompounds, totalLaps, compoundModels, pitLoss,
      recTrafficForBreakdown, weatherMap, trackStatusMap, pitStopAnalyses, breakdownMods,
    );
  }

  // Alternative breakdowns
  for (const alt of alternatives) {
    const altTrafficForBreakdown = alt.traffic_predictions ?? predictTrafficForPitLaps(
      driverNumber, alt.pit_laps, pitLoss, totalLaps, allLapsMap, positions, intervals, allDrivers,
    );
    alt.breakdown = computeStrategyBreakdown(
      alt.pit_laps, alt.compounds, totalLaps, compoundModels, pitLoss,
      altTrafficForBreakdown, weatherMap, trackStatusMap, pitStopAnalyses, breakdownMods,
    );
  }


  // ── 4d. Enrich alternatives with advanced analysis ──
  const driverAvgPace = (() => {
    const validLaps = laps.filter(l => l.lap_duration != null && l.lap_duration > 0 && !l.is_pit_out_lap);
    if (validLaps.length === 0) return null;
    return validLaps.reduce((s, l) => s + l.lap_duration!, 0) / validLaps.length;
  })();

  for (const alt of alternatives) {
    const altTraffic = alt.traffic_predictions ?? [];
    alt.analysis = enrichStrategyAnalysis(
      alt.pit_laps, alt.compounds, alt.estimated_delta_vs_actual,
      totalLaps, compoundModels as Map<string, { slope: number; intercept: number }>,
      pitLoss, trafficAvgBaseline, altTraffic,
      riskMode, effectiveScenarioId,
      intervals, positions, stints, allDrivers, driverNumber,
      simulateStrategyCost, driverAvgPace, actualPitLaps,
    );

    // Enrich pros/cons based on analysis
    if (alt.analysis.robustness.robustness_label === "FRAGILE") {
      alt.cons.push("Strategia fragile — sensibile a variazioni di degrado/traffico");
    } else if (alt.analysis.robustness.robustness_label === "ROBUST") {
      alt.pros.push("Strategia robusta — poco sensibile a variazioni");
    }

    if (alt.analysis.competitor_context) {
      const cc = alt.analysis.competitor_context;
      if (cc.undercut_opportunity > 0.5) {
        alt.pros.push("Opportunità undercut significativa");
      }
      if (cc.undercut_risk > 0.5) {
        alt.cons.push("Rischio undercut da rivali");
      }
      // Release classification-based insights
      if (cc.release_classification === "PACK" && cc.rejoin_in_pack) {
        alt.cons.push(`Rientro strutturalmente dentro un pack — sorpasso multiplo necessario`);
      }
      if ((cc.traffic_persistence_laps ?? 0) > 4) {
        alt.cons.push(`Traffico persistente stimato: ~${cc.traffic_persistence_laps} giri prima di sbloccarsi`);
      }
    }

    if (alt.analysis.overtake_difficulty && alt.analysis.overtake_difficulty.expected_laps_stuck > 3) {
      alt.cons.push(`Difficoltà sorpasso: ~${alt.analysis.overtake_difficulty.expected_laps_stuck} giri bloccato in aria sporca (dirty air: −${alt.analysis.overtake_difficulty.dirty_air_penalty.toFixed(1)}s)`);
    }

    if (alt.analysis.stint_extension && alt.analysis.stint_extension.cliff_risk_if_extend > 0.5) {
      alt.cons.push(`Rischio cliff se si estende lo stint (${Math.round(alt.analysis.stint_extension.cliff_risk_if_extend * 100)}%)`);
    }

    if (alt.analysis.pit_window && alt.analysis.pit_window.window_robustness === "FRAGILE") {
      alt.cons.push("Finestra pit fragile — il giro esatto è critico");
    }
  }

  // ── 4e. Enrich recommended strategy with same explanation layer as alternatives ──
  {
    // Description
    if (bestPitLaps.length > 0) {
      const pitDesc = bestPitLaps.length === 1
        ? `Pit al giro ${bestPitLaps[0]}`
        : `Pit ai giri ${bestPitLaps.join(", ")}`;
      recommendedStrategy.description = `${pitDesc} con sequenza ${bestCompounds.join(" → ")}`;
    } else {
      recommendedStrategy.description = `Nessun pit stop — sequenza ${bestCompounds.join(" → ")}`;
    }

    // Analysis
    const recTraffic = recommendedStrategy.traffic_predictions ?? [];
    recommendedStrategy.analysis = enrichStrategyAnalysis(
      bestPitLaps, bestCompounds, recommendedStrategy.estimated_gain_seconds,
      totalLaps, compoundModels as Map<string, { slope: number; intercept: number }>,
      pitLoss, trafficAvgBaseline, recTraffic,
      riskMode, effectiveScenarioId,
      intervals, positions, stints, allDrivers, driverNumber,
      simulateStrategyCost, driverAvgPace, actualPitLaps,
    );

    // Pros / Cons
    const recPros: string[] = [];
    const recCons: string[] = [];

    // Robustness
    if (recommendedStrategy.analysis.robustness.robustness_label === "ROBUST") {
      recPros.push("Strategia robusta — poco sensibile a variazioni");
    } else if (recommendedStrategy.analysis.robustness.robustness_label === "FRAGILE") {
      recCons.push("Strategia fragile — sensibile a variazioni di degrado/traffico");
    }

    // Competitor context
    if (recommendedStrategy.analysis.competitor_context) {
      const cc = recommendedStrategy.analysis.competitor_context;
      if (cc.undercut_opportunity > 0.5) recPros.push("Opportunità undercut significativa");
      if (cc.undercut_risk > 0.5) recCons.push("Rischio undercut da rivali");
      if (cc.release_classification === "PACK" && cc.rejoin_in_pack) {
        recCons.push("Rientro strutturalmente dentro un pack — sorpasso multiplo necessario");
      }
      if ((cc.traffic_persistence_laps ?? 0) > 4) {
        recCons.push(`Traffico persistente stimato: ~${cc.traffic_persistence_laps} giri prima di sbloccarsi`);
      }
    }

    // Overtake difficulty
    if (recommendedStrategy.analysis.overtake_difficulty && recommendedStrategy.analysis.overtake_difficulty.expected_laps_stuck > 3) {
      recCons.push(`Difficoltà sorpasso: ~${recommendedStrategy.analysis.overtake_difficulty.expected_laps_stuck} giri bloccato in aria sporca (dirty air: −${recommendedStrategy.analysis.overtake_difficulty.dirty_air_penalty.toFixed(1)}s)`);
    }

    // Stint extension / cliff
    if (recommendedStrategy.analysis.stint_extension && recommendedStrategy.analysis.stint_extension.cliff_risk_if_extend > 0.5) {
      recCons.push(`Rischio cliff se si estende lo stint (${Math.round(recommendedStrategy.analysis.stint_extension.cliff_risk_if_extend * 100)}%)`);
    }

    // Pit window robustness
    if (recommendedStrategy.analysis.pit_window && recommendedStrategy.analysis.pit_window.window_robustness === "FRAGILE") {
      recCons.push("Finestra pit fragile — il giro esatto è critico");
    }

    // Traffic predictions pros/cons
    if (recTraffic.length > 0) {
      const trafficLoss = recTraffic.reduce((sum, t) => sum + (t.traffic_time_loss_total ?? t.estimated_traffic_time_loss), 0);
      const worstTraffic = recTraffic.reduce((worst, t) => {
        if (t.traffic_level === "HEAVY") return "HEAVY";
        if (t.traffic_level === "LIGHT" && worst !== "HEAVY") return "LIGHT";
        return worst;
      }, "CLEAN" as TrafficLevel);

      if (worstTraffic === "HEAVY") {
        recCons.push(`Rientro in traffico pesante (−${trafficLoss.toFixed(1)}s stimati)`);
      } else if (worstTraffic === "LIGHT") {
        recCons.push(`Rientro in traffico leggero (−${trafficLoss.toFixed(1)}s stimati)`);
      } else if (worstTraffic === "CLEAN") {
        recPros.push("Rientro in aria pulita");
      }

      // Traffic metadata enrichment
      for (const tp of recTraffic) {
        if (tp.release_classification === "PACK") {
          recCons.push(`Rientro dentro un pack al giro ${tp.pit_lap} (${tp.pack_size_ahead ?? "?"} vetture davanti, ${tp.pack_size_behind ?? "?"} dietro)`);
          break;
        }
        if (tp.release_classification === "TRAFFIC") {
          if (tp.release_quality === "POOR" || tp.release_quality === "MARGINAL") {
            recCons.push(`Qualità release al giro ${tp.pit_lap}: ${tp.release_quality === "POOR" ? "scarsa" : "marginale"}${tp.compressed_train_risk === "HIGH" ? " — rischio trenino compresso" : ""}`);
            break;
          }
        }
        const persistLaps = tp.traffic_persistence_laps ?? tp.estimated_traffic_laps;
        if (persistLaps > 3) {
          recCons.push(`Traffico persistente: ~${persistLaps} giri bloccato in aria sporca dopo il pit al giro ${tp.pit_lap}`);
          break;
        }
        if ((tp.stuck_risk_score ?? 0) > 0.7) {
          recCons.push(`Rischio elevato di restare bloccato dopo il pit al giro ${tp.pit_lap} (stuck score: ${((tp.stuck_risk_score ?? 0) * 100).toFixed(0)}%)`);
          break;
        }
      }

      const lowConfTraffic = recTraffic.filter(tp => tp.prediction_confidence === "LOW");
      if (lowConfTraffic.length > 0) {
        recCons.push("Previsione traffico a bassa confidenza — dati posizione/intervalli insufficienti");
      }
    }

    // Warmup pros/cons
    const recStintBoundsForPC = buildStintBounds(bestPitLaps, bestCompounds);
    let recWarmupForPC = 0;
    for (let si = 0; si < recStintBoundsForPC.length; si++) {
      recWarmupForPC += computeStintWarmupCost(recStintBoundsForPC[si].compound, si === 0);
    }
    if (recWarmupForPC > 2.5) {
      recCons.push(`Warmup elevato: ${recWarmupForPC.toFixed(1)}s persi per riscaldamento gomme`);
    }
    const recHasHardPC = bestCompounds.some(c => c.toUpperCase() === "HARD");
    if (recHasHardPC && recWarmupForPC > 1.5) {
      recCons.push("Mescola Hard: warmup lento riduce efficacia undercut");
    }

    // Breakdown-derived pros
    if (recommendedStrategy.breakdown) {
      const bd = recommendedStrategy.breakdown;
      if (bd.traffic_loss != null && bd.traffic_loss < 0.5) {
        recPros.push("Impatto traffico minimo nella simulazione");
      }
      if (bd.warmup_cost != null && bd.warmup_cost < 1.0 && bestPitLaps.length > 0) {
        recPros.push("Warmup contenuto");
      }
    }

    recommendedStrategy.pros = recPros;
    recommendedStrategy.cons = recCons;
  }


  const confidenceFactors: string[] = [];
  let confScore = 0;

  // Degradation validation impact on confidence
  const validDegCount = degradationValidations.filter(v => v.status === "VALID").length;
  const neutralDegCount = degradationValidations.filter(v => v.status === "NEUTRAL").length;
  const invalidDegCount = degradationValidations.filter(v => v.status === "INVALID").length;

  if (invalidDegCount === 0 && validDegCount > 0) {
    confScore += 3;
    confidenceFactors.push(`Degrado gomme validato per tutti gli stint (${validDegCount} VALID${neutralDegCount > 0 ? `, ${neutralDegCount} NEUTRAL` : ""})`);
  } else if (validDegCount > 0) {
    confScore += 1;
    confidenceFactors.push(`Degrado gomme: ${validDegCount} VALID, ${neutralDegCount} NEUTRAL, ${invalidDegCount} INVALID — confidenza ridotta`);
  } else if (neutralDegCount > 0) {
    confScore += 0;
    confidenceFactors.push(`Degrado gomme: nessuna stima VALID (${neutralDegCount} NEUTRAL, ${invalidDegCount} INVALID) — stime deboli usate con cautela`);
  } else {
    confidenceFactors.push("Modello di degrado non disponibile o completamente non attendibile");
  }

  // Add specific degradation validation notes
  for (const dv of degradationValidations) {
    if (dv.status === "INVALID") {
      confidenceFactors.push(`⚠️ Stint ${dv.original.stint} (${dv.original.compound}): degrado INVALID — ${dv.reason}${dv.fallback_description ? `. ${dv.fallback_description}` : ""}`);
    } else if (dv.status === "NEUTRAL" && dv.fallback_applied) {
      confidenceFactors.push(`ℹ️ Stint ${dv.original.stint} (${dv.original.compound}): degrado NEUTRAL — ${dv.reason}`);
    }
  }

  if (pitStops.length > 0) { confScore += 2; confidenceFactors.push("Dati pit stop disponibili"); }
  else { confidenceFactors.push("Dati pit stop non disponibili"); }

  if (weather.length > 0) { confScore += 1; confidenceFactors.push("Dati meteo disponibili"); }
  else { confidenceFactors.push("Dati meteo non disponibili"); }

  const hasNeutralisations = [...trackStatusMap.values()].some(s => s !== "GREEN");
  if (hasNeutralisations) { confidenceFactors.push("Neutralizzazioni rilevate durante la gara"); }
  else { confScore += 1; }

  if (intervals.length > 0 || positions.length > 0) {
    confScore += 1;
    confidenceFactors.push("Dati posizione/intervalli disponibili per analisi traffico");
  } else {
    confidenceFactors.push("Dati posizione/intervalli non disponibili – analisi traffico limitata");
  }

  const confidence: Confidence = confScore >= 6 ? "HIGH" : confScore >= 3 ? "MEDIUM" : "LOW";

  // ── 6. Weather & neutralisation impact ──
  const wetLaps = [...weatherMap.values()].filter(w => w === "WET" || w === "MIXED").length;
  const weatherImpact = wetLaps > 0
    ? `${wetLaps} giri in condizioni bagnate/miste rilevati. Il modello ha escluso questi giri dal calcolo del degrado.`
    : null;

  const neutralLaps = [...trackStatusMap.values()].filter(s => s !== "GREEN");
  const scCount = neutralLaps.filter(s => s === "SC").length;
  const vscCount = neutralLaps.filter(s => s === "VSC").length;
  let neutralisationImpact: string | null = null;
  if (scCount > 0 || vscCount > 0) {
    const parts: string[] = [];
    if (scCount > 0) parts.push(`Safety Car (${scCount} giri)`);
    if (vscCount > 0) parts.push(`VSC (${vscCount} giri)`);
    neutralisationImpact = `Neutralizzazioni rilevate: ${parts.join(", ")}. `;
    const pitUnderNeutral = pitStopAnalyses.filter(p => p.under_neutralisation);
    if (pitUnderNeutral.length > 0) {
      neutralisationImpact += `Il pilota ha effettuato ${pitUnderNeutral.length} pit stop durante neutralizzazione (vantaggio stimato).`;
    }
  }

  // ── 7. Integrated Strategy Context ──
  let integratedContext = buildIntegratedContext(
    diaryEvents, weatherMap, trackStatusMap, cumDevResult, driverNumber, actualPitLaps,
  );

  const narrativeInsights: string[] = [];
  // Narrative collector — accumulates structured events for migrated categories.
  // During the incremental refactor, migrated sites push BOTH to narrativeInsights
  // (preserving exact output order) AND to the collector. Once all categories
  // are migrated, narrativeInsights will be replaced by renderNarrative output.
  const narrativeCollector = new NarrativeCollector();

  // Analysis mode narrative
  if (isRaceEngineerMode) {
    const text = "🏁 Modalità Race Engineer (ex-ante): le strategie simulate non utilizzano conoscenza di eventi futuri (SC, VSC, meteo). Le decisioni sono valutate con le sole informazioni disponibili al momento.";
    narrativeInsights.push(text);
    narrativeCollector.add({ id: "mode_race_engineer", category: "mode_context", priority: "context", target: "global", data: { mode: "RACE_ENGINEER" }, prerendered_text: text });
  } else {
    const text = "📊 Modalità Post-Race Analysis (ex-post): le strategie utilizzano la timeline completa della gara, inclusi tutti gli eventi reali.";
    narrativeInsights.push(text);
    narrativeCollector.add({ id: "mode_post_race", category: "mode_context", priority: "context", target: "global", data: { mode: "POST_RACE" }, prerendered_text: text });
  }

  // ── 7.pre Degradation validation insights ──
  for (const dv of degradationValidations) {
    if (dv.status === "INVALID") {
      const corrNote = dv.model_corrected
        ? ` Il modello ha corretto per fuel proxy${dv.weather_correction_used ? " e temperatura" : ""} (slope grezza: ${dv.slope_raw.toFixed(3)}, corretta: ${dv.slope_corrected.toFixed(3)}), ma la stima resta non attendibile.`
        : "";
      narrativeInsights.push(`La stima di degrado per lo stint ${dv.original.stint} (${dv.original.compound}) è stata classificata come non attendibile e non è stata usata nel modello strategico.${corrNote} ${dv.fallback_description ?? ""}`);
    } else if (dv.model_corrected && dv.slope_raw < 0 && dv.slope_corrected > 0 && dv.status === "VALID") {
      narrativeInsights.push(`Stint ${dv.original.stint} (${dv.original.compound}): la slope grezza era negativa (${dv.slope_raw.toFixed(3)}) ma dopo correzione per fuel proxy${dv.weather_correction_used ? " e temperatura" : ""} il degrado stimato è diventato positivo (${dv.slope_corrected.toFixed(3)} sec/giro). Il modello usa il valore corretto.`);
    } else if (dv.status === "NEUTRAL" && dv.fallback_applied) {
      narrativeInsights.push(`Lo stint ${dv.original.stint} (${dv.original.compound}) presenta un degrado troppo debole per essere significativo (slope${dv.model_corrected ? " corretta" : ""}: ${dv.slope_corrected.toFixed(3)}). Usato con cautela nel modello.`);
    }
  }
  if (invalidDegCount > 0 && validDegCount === 0 && neutralDegCount === 0) {
    narrativeInsights.push("⚠️ Nessuna stima di degrado attendibile disponibile. Il modello strategico usa fallback conservativi — i risultati hanno confidenza ridotta.");
  }

  // ── 7.pre2 Raw vs Corrected degradation comparison ──
  {
    const lowAgreementStints = rawVsCorrected.filter(r => r.agreement === "LOW");
    const highAgreementStints = rawVsCorrected.filter(r => r.agreement === "HIGH");

    if (lowAgreementStints.length > 0) {
      for (const la of lowAgreementStints) {
        narrativeInsights.push(`Stint ${la.stint} (${la.compound}): divergenza significativa tra degrado grezzo (${la.rawSlope.toFixed(3)} s/giro) e corretto (${la.corrSlope.toFixed(3)} s/giro). La correzione per effetti non-tyre è ampia — confidenza ridotta sulla stima.`);
      }
      confScore -= lowAgreementStints.length;
      confidenceFactors.push(`⚠️ Divergenza raw/corrected in ${lowAgreementStints.length} stint — correzione non-tyre molto ampia`);
    } else if (highAgreementStints.length === rawVsCorrected.length && rawVsCorrected.length > 0) {
      confScore += 1;
      confidenceFactors.push("Convergenza alta tra degrado grezzo e corretto — stima robusta");
    } else if (rawVsCorrected.length > 0) {
      confidenceFactors.push("Convergenza moderata tra degrado grezzo e corretto");
    }
  }


  if (integratedContext.battle_context) {
    const bc = integratedContext.battle_context;
    if (bc.total_battle_laps > 3) {
      confidenceFactors.push(`${bc.total_episodes} episodi di battaglia rilevati (${bc.total_battle_laps} giri)`);
      
      // Check if battles overlapped with recommended pit window
      if (recommendedWindows.length > 0) {
        const recPitLap = recommendedWindows[0].ideal_lap;
        const battleNearPit = bc.episodes.some(ep =>
          Math.abs(ep.startLap - recPitLap) <= 3 || Math.abs(ep.endLap - recPitLap) <= 3
        );
        if (battleNearPit) {
          const text = `Battaglia in corso vicino alla finestra pit consigliata (giro ${recPitLap}): il pit potrebbe essere stato condizionato dalla posizione in pista.`;
          narrativeInsights.push(text);
          narrativeCollector.add({ id: "battle_near_rec_pit", category: "battle_context", priority: "supporting", target: "global", lap: recPitLap, data: { rec_pit_lap: recPitLap }, prerendered_text: text });
        }
      }

      if (bc.defending_episodes > 0 && bc.longest_episode) {
        const text = `Fase difensiva rilevata (${bc.defending_episodes} episodi, il più lungo: ${Math.round(bc.longest_episode.durationSeconds)}s vs ${bc.longest_episode.opponent}). La strategia potrebbe aver risentito della pressione.`;
        narrativeInsights.push(text);
        narrativeCollector.add({ id: "battle_defending_phase", category: "battle_context", priority: "supporting", target: "global", data: { defending_episodes: bc.defending_episodes, longest_seconds: Math.round(bc.longest_episode.durationSeconds), opponent: bc.longest_episode.opponent }, prerendered_text: text });
      }

      // Penalize alternatives that pit during battle laps
      for (const alt of alternatives) {
        const pitDuringBattle = alt.pit_laps.some(pl => bc.battle_laps.has(pl));
        if (pitDuringBattle) {
          // TODO(narrative-refactor): side effect on alt.estimated_delta_vs_actual / alt.time_delta_vs_actual.
          // Keep inline until collector supports targeted side-effect events.
          alt.cons.push("Pit durante fase di battaglia — rischio di perdere posizione");
          alt.estimated_delta_vs_actual -= 0.5; // Small penalty
          alt.time_delta_vs_actual += 0.5;      // Keep in sync (opposite sign)
        }
      }
    }
  }

  // ── 7b. Cumulative deviation insights ──
  if (integratedContext.cumulative_deviation_context?.available) {
    const cd = integratedContext.cumulative_deviation_context;
    confScore += 1;
    confidenceFactors.push("Deviazione cumulativa disponibile come metrica di supporto");

    if (cd.loss_trend_start_lap != null) {
      const text = `La strategia reale ha iniziato a perdere terreno in modo cumulativo dal giro ${cd.loss_trend_start_lap} rispetto al benchmark del vincitore (${cd.winner_code ?? "P1"}).`;
      narrativeInsights.push(text);
      narrativeCollector.add({ id: "cum_dev_loss_trend_start", category: "cumulative_deviation", priority: "supporting", target: "global", lap: cd.loss_trend_start_lap, data: { loss_trend_start_lap: cd.loss_trend_start_lap, winner_code: cd.winner_code ?? "P1" }, prerendered_text: text });
      
      // Check if pit was before or after the loss trend started
      if (actualPitLaps.length > 0 && actualPitLaps[0] > cd.loss_trend_start_lap) {
        const text2 = `Il pit reale (giro ${actualPitLaps[0]}) è avvenuto dopo l'inizio della perdita cumulativa (giro ${cd.loss_trend_start_lap}): un pit anticipato avrebbe potuto mitigare la perdita.`;
        narrativeInsights.push(text2);
        narrativeCollector.add({ id: "cum_dev_pit_after_loss", category: "cumulative_deviation", priority: "supporting", target: "global", lap: actualPitLaps[0], data: { actual_pit_lap: actualPitLaps[0], loss_trend_start_lap: cd.loss_trend_start_lap }, prerendered_text: text2 });
      }
    }

    if (cd.max_deviation != null && cd.max_deviation > 5) {
      const text = `Deviazione cumulativa massima osservata: +${cd.max_deviation.toFixed(1)}s al giro ${cd.max_deviation_lap}.`;
      narrativeInsights.push(text);
      narrativeCollector.add({ id: "cum_dev_max", category: "cumulative_deviation", priority: "supporting", target: "global", lap: cd.max_deviation_lap ?? undefined, data: { max_deviation: cd.max_deviation, max_deviation_lap: cd.max_deviation_lap }, prerendered_text: text });
    }

    if (cd.driver_final_delta != null && cd.driver_final_delta > 10) {
      const text = `Al termine della gara, il pilota ha accumulato +${cd.driver_final_delta.toFixed(1)}s rispetto al benchmark del vincitore.`;
      narrativeInsights.push(text);
      narrativeCollector.add({ id: "cum_dev_final_delta", category: "cumulative_deviation", priority: "supporting", target: "global", data: { driver_final_delta: cd.driver_final_delta }, prerendered_text: text });
    }
  }

  // ── 7b2. Pace Loss insights (from cumulative deviation) ──
  {
    const usablePL = paceLossResults.filter(r => r.pace_loss_used_for_strategy);
    const worstPL = usablePL.reduce((w, r) => (r.stint_pace_loss_rate ?? 0) > (w?.stint_pace_loss_rate ?? 0) ? r : w, null as StintPaceLossResult | null);

    if (worstPL && worstPL.stint_pace_loss_rate != null) {
      if (worstPL.pace_loss_status === "CLIFF_RISK") {
        const text = `⚠️ Perdita di passo critica nello stint ${worstPL.stint_number} (${worstPL.stint_pace_loss_rate.toFixed(3)} s/giro): possibile segnale di tyre cliff. Il modello ha aumentato l'urgenza del pit e la penalità per stint lunghi.`;
        narrativeInsights.push(text);
        narrativeCollector.add({ id: "pace_loss_cliff_risk", category: "pace_loss", priority: "critical", target: "global", data: { stint: worstPL.stint_number, rate: worstPL.stint_pace_loss_rate, status: "CLIFF_RISK" }, prerendered_text: text });
      } else if (worstPL.pace_loss_status === "HIGH_LOSS") {
        const text = `Perdita di passo significativa nello stint ${worstPL.stint_number} (${worstPL.stint_pace_loss_rate.toFixed(3)} s/giro): il modello ha aumentato il peso del degrado nella simulazione strategica.`;
        narrativeInsights.push(text);
        narrativeCollector.add({ id: "pace_loss_high", category: "pace_loss", priority: "supporting", target: "global", data: { stint: worstPL.stint_number, rate: worstPL.stint_pace_loss_rate, status: "HIGH_LOSS" }, prerendered_text: text });
      } else if (worstPL.pace_loss_status === "NORMAL_LOSS") {
        const text = `Perdita di passo moderata nello stint ${worstPL.stint_number} (${worstPL.stint_pace_loss_rate.toFixed(3)} s/giro), coerente con un degrado normale.`;
        narrativeInsights.push(text);
        narrativeCollector.add({ id: "pace_loss_normal", category: "pace_loss", priority: "context", target: "global", data: { stint: worstPL.stint_number, rate: worstPL.stint_pace_loss_rate, status: "NORMAL_LOSS" }, prerendered_text: text });
      }
    }

    // Check coherence between degradation model and pace loss
    for (const pl of usablePL) {
      const dv = degradationValidations.find(v => v.original.stint === pl.stint_number);
      if (dv && pl.stint_pace_loss_rate != null) {
        if (dv.effective_slope < 0.02 && pl.pace_loss_status === "HIGH_LOSS") {
          const text = `Stint ${pl.stint_number}: il degrado stimato è basso (${dv.effective_slope.toFixed(3)} s/giro) ma la perdita di passo osservata è alta (${pl.stint_pace_loss_rate.toFixed(3)}). Possibile incoerenza — il verdetto è stato reso più prudente.`;
          narrativeInsights.push(text);
          narrativeCollector.add({ id: "pace_loss_incoherence_low_deg_high_loss", category: "pace_loss", priority: "supporting", target: "global", data: { stint: pl.stint_number, effective_slope: dv.effective_slope, rate: pl.stint_pace_loss_rate }, prerendered_text: text });
          confScore -= 1;
        } else if (dv.effective_slope > 0.06 && pl.pace_loss_status === "STABLE") {
          const text = `Stint ${pl.stint_number}: il degrado stimato è elevato (${dv.effective_slope.toFixed(3)} s/giro) ma il passo osservato è stabile. Il degrado potrebbe essere sovrastimato.`;
          narrativeInsights.push(text);
          narrativeCollector.add({ id: "pace_loss_incoherence_high_deg_stable", category: "pace_loss", priority: "supporting", target: "global", data: { stint: pl.stint_number, effective_slope: dv.effective_slope }, prerendered_text: text });
        }
      }
    }

    // Unreliable pace loss: note for transparency
    const unreliablePL = paceLossResults.filter(r => r.pace_loss_status === "UNRELIABLE" && r.pace_loss_contamination_flags.battle);
    if (unreliablePL.length > 0) {
      const text = `La metrica di pace loss per ${unreliablePL.length} stint è stata ridimensionata a causa di traffico e battaglie ravvicinate. Non è stata usata come driver strategico.`;
      narrativeInsights.push(text);
      narrativeCollector.add({ id: "pace_loss_unreliable", category: "pace_loss", priority: "context", target: "global", data: { count: unreliablePL.length }, prerendered_text: text });
    }

    // Confidence impact
    if (usablePL.length > 0) {
      confScore += 1;
      confidenceFactors.push(`Pace loss da deviazione cumulativa disponibile per ${usablePL.length} stint (metrica ausiliaria)`);
    }
    if (worstPL?.pace_loss_status === "CLIFF_RISK") {
      confidenceFactors.push(`⚠️ Segnale di tyre cliff risk da pace loss (stint ${worstPL.stint_number})`);
    }
  }

  // ── 7c. Diary context insights ──
  if (integratedContext.diary_context) {
    const dc = integratedContext.diary_context;
    if (dc.strategy_relevant_events.length > 0) {
      for (const ev of dc.strategy_relevant_events.slice(0, 3)) {
        narrativeInsights.push(`Giro ${ev.lap}: ${ev.description}`);
      }
    }
    if (dc.overtakes_received > dc.overtakes_done && dc.overtakes_received >= 3) {
      narrativeInsights.push(`Il pilota ha subito più sorpassi (${dc.overtakes_received}) di quanti ne ha effettuati (${dc.overtakes_done}), indicando una possibile strategia difensiva o ritmo insufficiente.`);
    }
  }

  // ── 7d. Weather context enrichment ──
  if (integratedContext.weather_context?.had_weather_change) {
    const wc = integratedContext.weather_context;
    confScore -= 1; // Weather change reduces confidence
    if (wc.first_non_dry_lap != null) {
      const text = `Condizioni meteo variabili rilevate dal giro ${wc.first_non_dry_lap} (${wc.wet_laps} giri bagnati, ${wc.mixed_laps} misti). Il modello di degrado esclude questi giri.`;
      narrativeInsights.push(text);
      narrativeCollector.add({ id: "weather_change_detected", category: "weather", priority: "supporting", target: "global", lap: wc.first_non_dry_lap, data: { first_non_dry_lap: wc.first_non_dry_lap, wet_laps: wc.wet_laps, mixed_laps: wc.mixed_laps }, prerendered_text: text });
    }
  }

  // ── 7e. Track status enrichment ──
  if (integratedContext.track_status_context) {
    const ts = integratedContext.track_status_context;
    if (ts.had_safety_car) {
      // Check if actual pit was during SC (advantage)
      const pitUnderSC = pitStopAnalyses.some(p => p.neutralisation_type === "SC");
      if (pitUnderSC) {
        const text = "Il pit stop durante Safety Car ha ridotto il pit loss effettivo, vantaggio strategico significativo.";
        narrativeInsights.push(text);
        narrativeCollector.add({ id: "neutral_pit_under_sc", category: "neutralization", priority: "supporting", target: "global", data: { type: "SC" }, prerendered_text: text });
      } else if (ts.neutralized_laps.some(nl => {
        // Check if SC was near recommended window
        return recommendedWindows.some(w => Math.abs(nl - w.ideal_lap) <= 3);
      })) {
        const text = "Una Safety Car è apparsa vicino alla finestra pit consigliata: un pit sotto neutralizzazione avrebbe offerto un vantaggio di ~10s.";
        narrativeInsights.push(text);
        narrativeCollector.add({ id: "neutral_sc_near_window", category: "neutralization", priority: "supporting", target: "global", data: { type: "SC", proximity: "near_window" }, prerendered_text: text });
      }
    }
  }

  // ── 7f. Neutralisation-aware pit loss comparison insights ──
  {
    // Identify actual pits under neutralisation and quantify the benefit
    const actualPitsUnderNeutral = pitStopAnalyses.filter(p => p.under_neutralisation);
    if (actualPitsUnderNeutral.length > 0) {
      const totalNeutralBenefit = actualPitsUnderNeutral.reduce((sum, p) => {
        const mult = getObservedPitLossMultiplier(p.lap_number);
        return sum + pitLoss * (1.0 - mult);
      }, 0);

      if (totalNeutralBenefit > 1.0) {
        const types = actualPitsUnderNeutral.map(p => `giro ${p.lap_number} (${p.neutralisation_type})`).join(", ");
        const text = `Strategia reale favorita da pit sotto neutralizzazione (${types}): pit loss ridotto di ~${totalNeutralBenefit.toFixed(1)}s rispetto a un pit in green.`;
        narrativeInsights.push(text);
        narrativeCollector.add({ id: "neutral_actual_benefit", category: "neutralization", priority: "supporting", target: "global", data: { types, benefit_seconds: totalNeutralBenefit }, prerendered_text: text });
      }

      // Check each alternative: does it pit on a neutralised lap or in green?
      for (const alt of alternatives) {
        const altNeutralBenefit = alt.pit_laps.reduce((sum, pl) => {
          const mult = getObservedPitLossMultiplier(pl);
          return sum + pitLoss * (1.0 - mult);
        }, 0);

        if (altNeutralBenefit < totalNeutralBenefit * 0.5) {
          // Alternative pits mostly in green while actual benefited from neutralisation
          const greenPits = alt.pit_laps.filter(pl => getObservedPitLossMultiplier(pl) >= 1.0);
          if (greenPits.length > 0) {
            alt.cons.push(
              `Pit in green (giro ${greenPits.join(", ")}): +${(totalNeutralBenefit - altNeutralBenefit).toFixed(1)}s di pit loss rispetto alla strategia reale sotto neutralizzazione`
            );
          }
        } else if (altNeutralBenefit > totalNeutralBenefit + 1.0) {
          // Alternative benefits MORE from neutralisation than actual
          alt.pros.push(
            `Pit su neutralizzazione reale (beneficio stimato: −${altNeutralBenefit.toFixed(1)}s di pit loss)`
          );
        }
      }
    }
  }

  // ── 7g. Tyre warmup narrative insights (simulated strategies only) ──
  {
    // Compute recommended strategy warmup using computeStintWarmupCost
    const recStintBounds = buildStintBounds(bestPitLaps, bestCompounds);
    let recWarmupFromModel = 0;
    for (let si = 0; si < recStintBounds.length; si++) {
      recWarmupFromModel += computeStintWarmupCost(recStintBounds[si].compound, si === 0);
    }
    // Use model-computed warmup (more precise) or breakdown warmup as fallback
    const recWarmup = recWarmupFromModel > 0 ? recWarmupFromModel : (recommendedStrategy.breakdown?.warmup_cost ?? 0);

    // Check if recommended strategy has significant warmup cost
    if (recWarmup > 2.0) {
      narrativeInsights.push(`La strategia raccomandata include ${recWarmup.toFixed(1)}s di tempo perso per riscaldamento gomme (tyre warmup). Strategie con più soste o gomme Hard subiscono una penalità termica maggiore.`);
    }

    // Compare warmup across alternatives using computeStintWarmupCost
    const altWarmups = alternatives.map(a => {
      const aBounds = buildStintBounds(a.pit_laps, a.compounds);
      let wTotal = 0;
      for (let si = 0; si < aBounds.length; si++) {
        wTotal += computeStintWarmupCost(aBounds[si].compound, si === 0);
      }
      return { name: a.name, warmup: wTotal, compounds: a.compounds };
    }).filter(a => a.warmup > 0);

    if (altWarmups.length > 0) {
      const maxWarmupAlt = altWarmups.reduce((a, b) => a.warmup > b.warmup ? a : b);
      const minWarmupAlt = altWarmups.reduce((a, b) => a.warmup < b.warmup ? a : b);
      const warmupSpread = maxWarmupAlt.warmup - minWarmupAlt.warmup;

      if (warmupSpread > 1.5) {
        narrativeInsights.push(`Differenza warmup tra strategie: ${warmupSpread.toFixed(1)}s (${maxWarmupAlt.name}: ${maxWarmupAlt.warmup.toFixed(1)}s vs ${minWarmupAlt.name}: ${minWarmupAlt.warmup.toFixed(1)}s). Strategie con meno soste o mescole morbide sono favorite dal warmup.`);
      }
    }

    // Hard compound warmup penalty warning
    const recHasHard = bestCompounds.some(c => c.toUpperCase() === "HARD");
    if (recHasHard && recWarmup > 1.5) {
      narrativeInsights.push(`La strategia raccomandata include gomme Hard: il warmup lento (+1.4s base) rende l'undercut meno efficace e penalizza stint corti su questa mescola.`);
    }

    // Multi-stop warmup accumulation
    if (bestPitLaps.length >= 2 && recWarmup > 3.0) {
      narrativeInsights.push(`Strategia a ${bestPitLaps.length} soste: il warmup cumulato (${recWarmup.toFixed(1)}s) è significativo. Ogni pit stop aggiuntivo introduce una fase di riscaldamento che riduce il vantaggio netto della sosta.`);
    }
  }


  for (const gap of integratedContext.data_gaps) {
    confidenceFactors.push(`⚠️ ${gap}`);
  }

  // Apply scenario confidence penalty
  confScore += scenarioMods.confidence_penalty;

  // Recalculate confidence after all adjustments
  const finalConfidence: Confidence = confScore >= 6 ? "HIGH" : confScore >= 3 ? "MEDIUM" : "LOW";

  // Add scenario note if simulated
  if (isSimulatedScenario(effectiveScenarioId)) {
    const lapNote = scenarioActivationLap != null ? ` dal giro ${scenarioActivationLap}` : "";
    const durNote = scenarioDurationLaps != null ? ` per ${scenarioDurationLaps} giri` : "";
    const windowNote = scenarioWindow ? ` (giri ${scenarioWindow.start}–${scenarioWindow.end})` : "";
    confidenceFactors.push(`🔮 Scenario simulato attivo: ${scenarioDef.label}${lapNote}${durNote}${windowNote} — ${scenarioDef.description}`);
    narrativeInsights.unshift(`⚠️ What-if scenario attivo: "${scenarioDef.label}"${lapNote}${durNote}. I risultati seguenti riflettono i modificatori dello scenario, non solo i dati osservati.`);
    if (scenarioActivationWarning) {
      narrativeInsights.push(`⚠️ ${scenarioActivationWarning}`);
    }
  }

  // ── 8. Verdict ──
  let verdictLabel: string;
  let verdictSummary: string;

  if (bestDelta < 0.5) {
    verdictLabel = "Strategia reale coerente con il modello";
    verdictSummary = "La strategia adottata è risultata vicina alla soluzione stimata ottimale.";
  } else if (bestDelta < 2) {
    verdictLabel = "Strategia reale marginalmente migliorabile";
    verdictSummary = `La strategia reale è stimata ${bestDelta.toFixed(1)}s più lenta della finestra ottimale.`;
  } else if (bestDelta < 5) {
    verdictLabel = "Pit stop leggermente fuori finestra ideale";
    verdictSummary = `Tempo potenzialmente recuperabile stimato: ${bestDelta.toFixed(1)}s.`;
  } else {
    verdictLabel = "Strategia reale penalizzata dal timing del pit";
    verdictSummary = `Delta significativo rispetto alla finestra ottimale: ${bestDelta.toFixed(1)}s.`;
  }

  // Adjust verdict for neutralisations
  const pitUnderNeutral = pitStopAnalyses.filter(p => p.under_neutralisation);
  if (pitUnderNeutral.length > 0 && bestDelta < 2) {
    verdictLabel = "Scelta reale favorita dalla neutralizzazione";
    verdictSummary = "Il pit stop effettuato durante una neutralizzazione ha reso la strategia reale competitiva.";
  }

  // Adjust verdict with battle context
  if (integratedContext.battle_context && integratedContext.battle_context.total_battle_laps > 5) {
    verdictSummary += ` La strategia è stata condizionata da ${integratedContext.battle_context.total_episodes} episodi di battaglia (${integratedContext.battle_context.total_battle_laps} giri).`;
  }

  // Adjust verdict with cumulative deviation
  if (integratedContext.cumulative_deviation_context?.available && integratedContext.cumulative_deviation_context.driver_final_delta != null) {
    const cd = integratedContext.cumulative_deviation_context;
    if (cd.driver_final_delta > 15) {
      verdictSummary += ` Deviazione cumulativa elevata (+${cd.driver_final_delta.toFixed(1)}s vs vincitore).`;
    }
  }

  // Adjust verdict with pace loss
  {
    const worstUsable = paceLossResults.filter(r => r.pace_loss_used_for_strategy);
    const hasCliff = worstUsable.some(r => r.pace_loss_status === "CLIFF_RISK");
    const hasHighLoss = worstUsable.some(r => r.pace_loss_status === "HIGH_LOSS");
    if (hasCliff) {
      verdictSummary += " Segnale di tyre cliff risk rilevato dalla perdita di passo nello stint — pit anticipato consigliato.";
    } else if (hasHighLoss && bestDelta > 1) {
      verdictSummary += " La perdita di passo progressiva supporta la raccomandazione di anticipare il pit.";
    }
  }
  // Adjust confidence for practice data
  if (practiceCompoundsUsed.length > 0) {
    confScore += 1;
    confidenceFactors.push(`Degrado da Practice disponibile per: ${practiceCompoundsUsed.join(", ")}`);
  }

  // ── 8a. Post-Race: missed neutralisation opportunity ──
  if (!isRaceEngineerMode) {
    const scVscLaps: { lap: number; status: TrackStatus }[] = [];
    trackStatusMap.forEach((status, lap) => {
      if (status === "SC" || status === "VSC" || status === "MIXED") {
        scVscLaps.push({ lap, status });
      }
    });

    if (scVscLaps.length > 0) {
      const driverPittedDuringNeutral = pitStopAnalyses.some(p => p.under_neutralisation);
      if (!driverPittedDuringNeutral) {
        // Find the neutralisation window
        const neutralStart = Math.min(...scVscLaps.map(s => s.lap));
        const neutralEnd = Math.max(...scVscLaps.map(s => s.lap));
        const neutralType = scVscLaps.some(s => s.status === "SC") ? "Safety Car" : "VSC";
        const windowDesc = neutralStart === neutralEnd
          ? `giro ${neutralStart}`
          : `giri ${neutralStart}-${neutralEnd}`;

        verdictSummary += ` In analisi post-gara: ${neutralType} rilevata (${windowDesc}). Il pilota non ha effettuato pit stop durante la neutralizzazione — un pit in quella finestra avrebbe comportato una perdita di tempo ridotta rispetto agli avversari.`;
        
        // If the driver pitted before the SC, note it
        const pitBeforeNeutral = actualPitLaps.filter(pl => pl < neutralStart);
        if (pitBeforeNeutral.length > 0) {
          verdictSummary += ` Il pit reale (giro ${pitBeforeNeutral[pitBeforeNeutral.length - 1]}) è avvenuto prima della neutralizzazione.`;
        }
      }
    }
  }

  // ── 9. Scenario-adjusted neutral phase adjustments for scoring ──
  const scenarioPhaseAdj = applyScenarioToPhaseAdjustments(effectiveScenarioId, NEUTRAL_PHASE_ADJUSTMENTS, scenarioActivationLap, totalLaps, scenarioDurationLaps);

  // ── 9a. Compute Soft Sensors Timeline early (needed for scoring gate) ──
  const softSensorsTimeline = computeSoftSensorsTimeline(
    stintAnalyses, pitStopAnalyses, degradationValidations, paceLossResults,
    earlyBattleCtx, weatherMap, trackStatusMap, totalLaps,
  );
  const softSensors: SoftSensorsContext | undefined = softSensorsTimeline.summary.latest_state
    ? {
        tyre_thermal: softSensorsTimeline.summary.latest_state.tyre_thermal,
        tyre_stress: softSensorsTimeline.summary.latest_state.tyre_stress,
        track_grip: softSensorsTimeline.summary.latest_state.track_grip,
        overall_confidence: softSensorsTimeline.summary.overall_confidence,
        reliability_notes: softSensorsTimeline.summary.reliability_notes,
      }
    : computeSoftSensors(
        stintAnalyses, pitStopAnalyses, degradationValidations, paceLossResults,
        earlyBattleCtx, weatherMap, trackStatusMap, totalLaps,
      );
  const warmupInterpretation = computeWarmupInterpretation(softSensorsTimeline, stintAnalyses);
  const degradationValidationContext = computeDegradationValidationContext(softSensorsTimeline, stintAnalyses, degradationValidations, paceLossResults, weatherMap, trackStatusMap);

  // Soft sensor refinement adjustments
  const recSSAdj = computeStrategySoftSensorAdjustment(bestPitLaps, bestCompounds, totalLaps, softSensorsTimeline);
  recommendedStrategy.soft_sensor_adjustment = recSSAdj;
  if (recSSAdj.total_soft_sensor_adjustment !== 0) {
    recommendedStrategy.soft_sensor_notes = recSSAdj.adjustment_reasons;
  }
  for (const alt of alternatives) {
    const altAdj = computeStrategySoftSensorAdjustment(alt.pit_laps, alt.compounds, totalLaps, softSensorsTimeline);
    alt.soft_sensor_adjustment = altAdj;
    if (altAdj.total_soft_sensor_adjustment !== 0) {
      alt.soft_sensor_notes = altAdj.adjustment_reasons;
    }
  }

  // Soft sensor scoring gate
  const softSensorScoringGate = validateSoftSensorScoringGate(softSensorsTimeline, degradationValidationContext);

  // Enhanced narrative insights from soft sensors
  const sensorNarrativeInsights = extractSoftSensorNarrativeInsights(softSensorsTimeline, stintAnalyses);
  for (const insight of sensorNarrativeInsights) {
    narrativeInsights.push(insight);
  }

  // ── 9b. Multi-criteria risk-aware ranking via riskAppetite.scoreStrategies ──
  // Per-strategy risk context is extracted from analysis and passed directly to
  // scoreStrategies, which applies mode-dependent context adjustments internally.
  {
    /** Extract StrategyRiskContext from EnrichedStrategyAnalysis + degradation quality */
    function buildRiskContext(analysis: EnrichedStrategyAnalysis | undefined, degConfidence?: number): StrategyRiskContext | undefined {
      if (!analysis) return degConfidence != null ? { degradation_confidence: degConfidence } : undefined;
      const ctx: StrategyRiskContext = {
        robustness_label: analysis.robustness.robustness_label,
        robustness_score: analysis.robustness.robustness_score,
        sensitivity_to_degradation: analysis.sensitivity.sensitivity_to_degradation,
        sensitivity_to_traffic: analysis.sensitivity.sensitivity_to_traffic,
        sensitivity_to_pit_loss: analysis.sensitivity.sensitivity_to_pit_loss,
      };
      if (analysis.stint_extension) {
        ctx.cliff_risk = analysis.stint_extension.cliff_risk_if_extend;
      }
      if (analysis.competitor_context) {
        ctx.release_classification = analysis.competitor_context.release_classification;
        ctx.traffic_risk_after_pit = analysis.competitor_context.traffic_risk_after_pit;
        ctx.rejoin_in_pack = analysis.competitor_context.rejoin_in_pack;
      }
      if (analysis.overtake_difficulty) {
        ctx.expected_laps_stuck = analysis.overtake_difficulty.expected_laps_stuck;
      }
      if (degConfidence != null) {
        ctx.degradation_confidence = degConfidence;
      }
      return ctx;
    }

    // Degradation confidence: ratio of VALID stints
    const totalStintCount = degradationValidations.length;
    const validStintCount = degradationValidations.filter(v => v.status === "VALID").length;
    const degConfidence = totalStintCount > 0 ? validStintCount / totalStintCount : undefined;

    // Compute SS scoring deltas using the gate
    const bestScoringDelta = recommendedStrategy.estimated_gain_seconds;
    const recSSScoringDelta = computeSoftSensorScoringDelta(
      recSSAdj, softSensorScoringGate, bestScoringDelta, bestScoringDelta,
    );

    const altSSScoringDeltas = alternatives.map(alt => {
      const adj = alt.soft_sensor_adjustment;
      if (!adj) return 0;
      return computeSoftSensorScoringDelta(adj, softSensorScoringGate, alt.estimated_delta_vs_actual, bestScoringDelta);
    });

    const scoringInput: { name: string; delta: number; breakdown: StrategyBreakdown | undefined; isRecommended?: boolean; riskContext?: StrategyRiskContext; softSensorScoringDelta?: number }[] = [];

    scoringInput.push({
      name: recommendedStrategy.description ?? "Strategia raccomandata",
      delta: recommendedStrategy.estimated_gain_seconds,
      breakdown: recommendedStrategy.breakdown,
      isRecommended: true,
      riskContext: buildRiskContext(recommendedStrategy.analysis, degConfidence),
      softSensorScoringDelta: recSSScoringDelta,
    });

    for (let ai = 0; ai < alternatives.length; ai++) {
      const alt = alternatives[ai];
      scoringInput.push({
        name: alt.name,
        delta: alt.estimated_delta_vs_actual,
        breakdown: alt.breakdown,
        riskContext: buildRiskContext(alt.analysis, degConfidence),
        softSensorScoringDelta: altSSScoringDeltas[ai],
      });
    }

    const riskScored = scoreStrategies(scoringInput, scenarioPhaseAdj, riskMode);

    const recScored = riskScored.find(s => s.index === -2);

    // Attach scoring fields to strategies
    if (recScored) {
      recommendedStrategy.scoring_without_soft_sensors = recScored.scoring_without_soft_sensors;
      recommendedStrategy.scoring_with_soft_sensors = recScored.scoring_with_soft_sensors;
      recommendedStrategy.scoring_delta_soft_sensors = recScored.soft_sensor_scoring_delta;
    }

    const altScores = new Map<number, ScoredStrategy>();
    for (const scored of riskScored) {
      if (scored.index >= 0) {
        altScores.set(scored.index, scored);
      }
    }

    // Attach scoring fields to alternatives
    for (let ai = 0; ai < alternatives.length; ai++) {
      const idxInInput = scoringInput.findIndex(s => s.name === alternatives[ai].name && !s.isRecommended);
      const scored = altScores.get(idxInInput);
      if (scored) {
        alternatives[ai].scoring_without_soft_sensors = scored.scoring_without_soft_sensors;
        alternatives[ai].scoring_with_soft_sensors = scored.scoring_with_soft_sensors;
        alternatives[ai].scoring_delta_soft_sensors = scored.soft_sensor_scoring_delta;
      }
    }

    // Reorder alternatives by risk-aware adjusted_score (descending)
    alternatives.sort((a, b) => {
      const idxA = scoringInput.findIndex(s => s.name === a.name && !s.isRecommended);
      const idxB = scoringInput.findIndex(s => s.name === b.name && !s.isRecommended);
      const scoreA = altScores.get(idxA)?.adjusted_score ?? a.estimated_delta_vs_actual;
      const scoreB = altScores.get(idxB)?.adjusted_score ?? b.estimated_delta_vs_actual;
      return scoreB - scoreA;
    });

    // ── Promotion check: if the top alternative is robustly better than recommended,
    // promote it. Threshold is conservative (>1.0s advantage after all adjustments)
    // to avoid noisy swaps.
    const bestAltScored = riskScored
      .filter(s => s.index >= 0)
      .sort((a, b) => b.adjusted_score - a.adjusted_score)[0];

    if (recScored && bestAltScored && bestAltScored.adjusted_score > recScored.adjusted_score + 1.0) {
      const promoAltIdx = bestAltScored.index - 1;
      const promoAlt = alternatives[promoAltIdx];
      if (promoAlt) {
        const promoRobust = promoAlt.analysis?.robustness.robustness_label;
        if (promoRobust !== "FRAGILE") {
          recommendedStrategy.pit_windows = promoAlt.pit_laps.map((pl, i) => ({
            stint: i + 1,
            ideal_lap: pl,
            range: [Math.max(1, pl - 1), Math.min(totalLaps, pl + 1)] as [number, number],
            compound_after: promoAlt.compounds[i + 1] || promoAlt.compounds[i],
          }));
          recommendedStrategy.compounds = [...promoAlt.compounds];
          recommendedStrategy.estimated_gain_seconds = promoAlt.estimated_delta_vs_actual;
          recommendedStrategy.time_delta_vs_actual = promoAlt.time_delta_vs_actual;
          recommendedStrategy.reason = `Promossa da scoring multi-criterio: ${promoAlt.name}`;
          recommendedStrategy.description = promoAlt.description;
          recommendedStrategy.breakdown = promoAlt.breakdown;
          recommendedStrategy.analysis = promoAlt.analysis;
          recommendedStrategy.traffic_predictions = promoAlt.traffic_predictions;
          recommendedStrategy.pros = promoAlt.pros;
          recommendedStrategy.cons = promoAlt.cons;

          narrativeInsights.push(
            `Strategia raccomandata aggiornata: "${promoAlt.name}" promossa dal ranking multi-criterio (${riskMode}). Score risk-adjusted: ${bestAltScored.adjusted_score.toFixed(1)} vs ${recScored.adjusted_score.toFixed(1)} della precedente raccomandata. ${bestAltScored.adjustment_reason !== "Nessun aggiustamento" ? bestAltScored.adjustment_reason : ""}`
          );
        }
      }
    } else if (recScored && bestAltScored && bestAltScored.adjusted_score > recScored.adjusted_score + 0.5) {
      narrativeInsights.push(
        `Risk scoring (${riskMode}): "${bestAltScored.name}" ha un punteggio risk-adjusted migliore della raccomandata di ${(bestAltScored.adjusted_score - recScored.adjusted_score).toFixed(1)}s. ${bestAltScored.adjustment_reason !== "Nessun aggiustamento" ? `(${bestAltScored.adjustment_reason})` : ""}`.trim()
      );
    }

    if (recScored && recScored.adjustment_reason !== "Nessun aggiustamento") {
      confidenceFactors.push(`Risk scoring (${riskMode}): ${recScored.adjustment_reason}`);
    }

    // Soft sensor scoring narrative
    if (softSensorScoringGate.soft_sensor_scoring_enabled) {
      const anySSEffect = recSSScoringDelta !== 0 || altSSScoringDeltas.some(d => d !== 0);
      if (anySSEffect) {
        narrativeInsights.push(`Soft sensors integrati nello scoring strategico come input debole (gate: attivo). Effetto massimo limitato a ±1.0s per strategia.`);
      }
    } else if (softSensorScoringGate.soft_sensor_block_reason) {
      narrativeInsights.push(`Soft sensors esclusi dallo scoring: ${softSensorScoringGate.soft_sensor_block_reason}`);
    }
  }

  // Reduce confidence if degradation is unreliable
  if (invalidDegCount > 0) {
    confScore -= invalidDegCount;
  }

  // ── 10. Enrich IntegratedStrategyContext with summaries from computed modules ──
  {
    // Traffic summary from pre-computed analysis
    const trafficSummary: TrafficSummary | null = trafficAnalysis.length > 0 ? {
      total_predictions: trafficAnalysis.length,
      worst_level: trafficAnalysis.reduce((w, t) => {
        if (t.traffic_level === "HEAVY") return "HEAVY";
        if (t.traffic_level === "LIGHT" && w !== "HEAVY") return "LIGHT";
        return w;
      }, "CLEAN" as TrafficLevel),
      avg_time_loss: trafficAvgBaseline,
      has_pack_risk: trafficAnalysis.some(t => t.release_classification === "PACK"),
      has_low_confidence: trafficAnalysis.some(t => t.prediction_confidence === "LOW"),
    } : null;

    // Degradation validation summary
    const degradationSummary: DegradationValidationSummary = {
      total_stints: degradationValidations.length,
      valid_count: validDegCount,
      neutral_count: neutralDegCount,
      invalid_count: invalidDegCount,
      overall_quality: invalidDegCount === 0 && validDegCount > 0 ? "GOOD"
        : validDegCount > 0 ? "MIXED" : "POOR",
      has_custom_override: customDegradationOverride != null && Object.keys(customDegradationOverride).length > 0,
    };

    // Pace loss summary
    const usablePLForSummary = paceLossResults.filter(r => r.pace_loss_used_for_strategy);
    const paceLossSummary: PaceLossSummary = {
      stints_analyzed: paceLossResults.length,
      stints_usable: usablePLForSummary.length,
      has_cliff_risk: usablePLForSummary.some(r => r.pace_loss_status === "CLIFF_RISK"),
      has_high_loss: usablePLForSummary.some(r => r.pace_loss_status === "HIGH_LOSS"),
      worst_status: usablePLForSummary.length > 0
        ? usablePLForSummary.reduce((w, r) => {
            const order = { CLIFF_RISK: 3, HIGH_LOSS: 2, NORMAL_LOSS: 1, STABLE: 0, UNRELIABLE: -1 };
            return (order[r.pace_loss_status as keyof typeof order] ?? -1) > (order[w as keyof typeof order] ?? -1) ? r.pace_loss_status : w;
          }, usablePLForSummary[0].pace_loss_status)
        : null,
    };

    integratedContext = enrichIntegratedContext(
      integratedContext,
      trafficSummary,
      degradationSummary,
      paceLossSummary,
      riskMode,
    );
  }

  // (Soft sensors computed earlier in section 9a for scoring integration)

  return {
    driver_number: driverNumber,
    driver_acronym: driverAcronym,
    session_key: sessionKey,
    actual_strategy: actualStrategy,
    recommended_strategy: recommendedStrategy,
    alternative_strategies: alternatives,
    verdict: { label: verdictLabel, summary: verdictSummary, delta_seconds: bestDelta > 0.1 ? Math.round(bestDelta * 10) / 10 : null, confidence: finalConfidence },
    confidence: finalConfidence,
    confidence_factors: confidenceFactors,
    weather_impact: weatherImpact,
    neutralisation_impact: neutralisationImpact,
    practice_compounds_used: practiceCompoundsUsed,
    traffic_analysis: trafficAnalysis,
    actual_breakdown: actualBreakdown,
    risk_mode: riskMode,
    integrated_context: integratedContext,
    narrative_insights: narrativeInsights,
    scenario_id: effectiveScenarioId,
    scenario_is_simulated: isSimulatedScenario(effectiveScenarioId),
    scenario_label: scenarioDef.label,
    scenario_description: (() => {
      if (!isSimulatedScenario(effectiveScenarioId)) return scenarioDef.description;
      const parts = [scenarioDef.description];
      if (scenarioActivationLap != null) parts.push(`dal giro ${scenarioActivationLap}`);
      if (scenarioDurationLaps != null) parts.push(`per ${scenarioDurationLaps} giri`);
      if (scenarioWindow) parts.push(`(finestra: giri ${scenarioWindow.start}–${scenarioWindow.end})`);
      return parts.join(" ");
    })(),
    scenario_modifiers_applied: Object.fromEntries(
      Object.entries(scenarioMods).filter(([, v]) => typeof v === "number" && v !== 1.0 && v !== 0)
    ) as Record<string, number>,
    scenario_activation_lap: isSimulatedScenario(effectiveScenarioId) ? scenarioActivationLap : null,
    scenario_duration_laps: isSimulatedScenario(effectiveScenarioId) ? scenarioDurationLaps : null,
    scenario_window: scenarioWindow,
    scenario_activation_warning: scenarioActivationWarning,
    degradation_validations: degradationValidations,
    pace_loss_results: paceLossResults,
    custom_degradation_override: customDegradationOverride,
    soft_sensors: softSensors,
    soft_sensors_timeline: softSensorsTimeline,
    warmup_interpretation: warmupInterpretation,
    degradation_validation_context: degradationValidationContext,
    soft_sensor_scoring_gate: softSensorScoringGate,
    analysis_mode: analysisMode,
  };
}
