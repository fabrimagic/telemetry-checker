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
import { detectRacePhase, type RacePhaseResult, type RacePhase } from "./racePhase";
import type { RiskMode } from "./riskAppetite";
import { buildIntegratedContext, buildBattleContext, type IntegratedStrategyContext } from "./vreContext";
import type { DiaryEvent } from "./raceDiary";
import type { CumulativeDeviationResult, DriverCumulativeDeviation } from "./cumulativeDeviation";
import { type ScenarioId, SCENARIO_DEFINITIONS, isSimulatedScenario, applyScenarioToPhaseAdjustments, buildTimedScenarioModifiers, validateScenarioActivationLap, computeScenarioWindow } from "./scenarioContext";
import { computeAllStintPaceLoss, paceLossDegradationAdjustment, paceLossCliffMultiplier, paceLossPitUrgencyShift, type StintPaceLossResult } from "./stintPaceLoss";
import { enrichStrategyAnalysis, type EnrichedStrategyAnalysis } from "./strategyAnalysis";

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
  reason: string;
  breakdown?: StrategyBreakdown;
}

export interface AlternativeStrategy {
  name: string;
  description: string;
  pit_laps: number[];
  compounds: string[];
  estimated_delta_vs_actual: number;
  pros: string[];
  cons: string[];
  traffic_predictions?: TrafficPrediction[];
  breakdown?: StrategyBreakdown;
  analysis?: EnrichedStrategyAnalysis;
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
  race_phase?: RacePhaseResult;
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
  customDegradationOverride: number | null = null,
): VirtualRaceEngineerResult | null {
  if (!stints.length || !laps.length) return null;

  const weatherMap = classifyLapsWeather(laps, weather);
  const trackStatusMap = classifyLapsTrackStatus(laps, raceControl);

  const pitLoss = estimatePitLoss(pitStops);
  const totalLaps = Math.max(...laps.map(l => l.lap_number));

  // ── 1. Actual strategy ──
  const stintAnalyses: StintAnalysis[] = [];
  const degradationModels = new Map<number, { slope: number; intercept: number }>();

  // Use corrected multivariate model (fuel proxy + temperature)
  const degResults: DegradationResult[] = calculateCorrectedTyreDegradation(
    driverNumber, driverAcronym, "ffffff", laps, stints,
    weather, totalLaps, weatherMap, trackStatusMap,
  );

  // ── Degradation validation (based on corrected slope) ──
  const rawValidated = validateAllDegradationEstimates(degResults);
  const degradationValidations = resolveDegradationForStrategy(rawValidated);

  for (const dv of degradationValidations) {
    // If user provided a custom override and this stint is INVALID, use it
    const useCustomOverride = customDegradationOverride != null && dv.status === "INVALID";
    const effectiveSlope = useCustomOverride ? customDegradationOverride : dv.effective_slope;
    
    if (useCustomOverride) {
      // Update the validation result to reflect user override
      dv.effective_slope = customDegradationOverride;
      dv.fallback_applied = true;
      dv.fallback_description = `Override utente applicato (${customDegradationOverride.toFixed(3)} s/giro)`;
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

  const scenarioDef = SCENARIO_DEFINITIONS[scenarioId];
  const scenarioMods = buildTimedScenarioModifiers(scenarioId, scenarioActivationLap, totalLaps, scenarioDurationLaps);
  const scenarioActivationWarning = validateScenarioActivationLap(scenarioId, scenarioActivationLap, totalLaps, scenarioDurationLaps);
  const scenarioWindow = isSimulatedScenario(scenarioId) ? computeScenarioWindow(scenarioActivationLap, scenarioDurationLaps, totalLaps) : null;

  // ── Risk mode base weights ──
  const RISK_BASE = {
    CONSERVATIVE: { degradation: 1.15, traffic: 1.3, pitLoss: 1.0, cliff_penalty: 0.12, opportunity: 0.8 },
    BALANCED:     { degradation: 1.0,  traffic: 1.0, pitLoss: 1.0, cliff_penalty: 0.06, opportunity: 1.0 },
    AGGRESSIVE:   { degradation: 0.85, traffic: 0.7, pitLoss: 1.0, cliff_penalty: 0.02, opportunity: 1.3 },
  } as const;
  const riskBase = RISK_BASE[riskMode];

  // Helper: check if a lap is inside the scenario window
  function isInScenarioWindow(lap: number): boolean {
    if (!scenarioWindow) return isSimulatedScenario(scenarioId); // no window = full race
    return lap >= scenarioWindow.start && lap <= scenarioWindow.end;
  }

  // Per-lap modifier for degradation based on scenario
  function lapDegradationMult(lap: number): number {
    const base = isSimulatedScenario(scenarioId) && isInScenarioWindow(lap)
      ? riskBase.degradation * scenarioMods.degradation_weight
      : riskBase.degradation;
    return base * plDegAdj; // pace loss adjustment
  }

  // Effective pit loss for a pit at a given lap
  function effectivePitLoss(pitLap: number): number {
    const baseMult = riskBase.pitLoss;
    if (!isSimulatedScenario(scenarioId)) return pitLoss * baseMult;
    if (!isInScenarioWindow(pitLap)) return pitLoss * baseMult;
    return pitLoss * baseMult * scenarioMods.pit_loss_multiplier;
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

  // Tyre cliff risk penalty: penalizes stint length beyond a threshold
  const CLIFF_THRESHOLD = 18;
  function cliffPenalty(stintLength: number): number {
    if (stintLength <= CLIFF_THRESHOLD) return 0;
    const excessLaps = stintLength - CLIFF_THRESHOLD;
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

    const trafficMult = isSimulatedScenario(scenarioId) && isInScenarioWindow(pitLap)
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

    for (const sb of stintBounds) {
      const model = compoundModels.get(sb.compound);
      if (!model) return null;
      const stintLength = sb.end - sb.start + 1;
      for (let lap = sb.start; lap <= sb.end; lap++) {
        const tyreLife = lap - sb.start;
        const baseLap = model.intercept;
        const degLap = model.slope * tyreLife * lapDegradationMult(lap);
        totalCost += baseLap + degLap;
      }
      // Cliff risk for this stint
      totalCost += cliffPenalty(stintLength);
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

  // Simple raw time (no adjustments) for delta calculation baseline
  function simulateTimeRaw(pitLapsArr: number[], compoundsArr: string[]): number | null {
    if (!hasMinTwoCompounds(compoundsArr)) return null;
    const stintBounds = buildStintBounds(pitLapsArr, compoundsArr);
    let total = 0;
    for (const sb of stintBounds) {
      const model = compoundModels.get(sb.compound);
      if (!model) return null;
      for (let lap = sb.start; lap <= sb.end; lap++) {
        total += predictLapTime(model.slope, model.intercept, lap - sb.start);
      }
    }
    total += pitLapsArr.length * pitLoss;
    return total;
  }

  const actualCompounds = stints.map(s => s.compound);
  const actualPitLaps = pitStops.map(p => p.lap_number);
  const actualSimTime = simulateTimeRaw(actualPitLaps, actualCompounds);
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

  // Attach traffic predictions to alternatives (display only, NOT for delta - already in cost)
  for (const alt of alternatives) {
    if (alt.pit_laps.length > 0) {
      const altTraffic = predictTrafficForPitLaps(
        driverNumber, alt.pit_laps, pitLoss, totalLaps,
        allLapsMap, positions, intervals, allDrivers,
      );
      alt.traffic_predictions = altTraffic;
      const trafficLoss = altTraffic.reduce((sum, t) => sum + t.estimated_traffic_time_loss, 0);
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
    const recTrafficLoss = recTraffic.reduce((sum, t) => sum + t.estimated_traffic_time_loss, 0);
    if (recTrafficLoss > 0) {
      recommendedStrategy.reason += ` (traffico stimato: −${recTrafficLoss.toFixed(1)}s)`;
    }
  }

  // ── 4c. Strategy Breakdowns (with scenario/risk modifiers) ──
  const breakdownMods: import("./strategyBreakdown").BreakdownModifiers = {
    degradation_mult: isSimulatedScenario(scenarioId) ? riskBase.degradation * scenarioMods.degradation_weight : riskBase.degradation,
    pit_loss_mult: isSimulatedScenario(scenarioId) ? riskBase.pitLoss * scenarioMods.pit_loss_multiplier : riskBase.pitLoss,
    traffic_mult: isSimulatedScenario(scenarioId) ? riskBase.traffic * scenarioMods.traffic_weight : riskBase.traffic,
    neutralization_mult: isSimulatedScenario(scenarioId) ? scenarioMods.neutralization_weight : 1.0,
  };

  const actualTraffic = predictTrafficForPitLaps(
    driverNumber, actualPitLaps, pitLoss, totalLaps, allLapsMap, positions, intervals, allDrivers,
  );
  const actualBreakdown = computeStrategyBreakdown(
    actualPitLaps, actualCompounds, totalLaps, compoundModels, pitLoss,
    actualTraffic, weatherMap, trackStatusMap, pitStopAnalyses, breakdownMods,
  );

  // Recommended breakdown
  if (bestPitLaps.length > 0) {
    const recTrafficForBreakdown = predictTrafficForPitLaps(
      driverNumber, bestPitLaps, pitLoss, totalLaps, allLapsMap, positions, intervals, allDrivers,
    );
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
      riskMode, scenarioId,
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
      if (alt.analysis.competitor_context.undercut_opportunity > 0.5) {
        alt.pros.push("Opportunità undercut significativa");
      }
      if (alt.analysis.competitor_context.undercut_risk > 0.5) {
        alt.cons.push("Rischio undercut da rivali");
      }
    }

    if (alt.analysis.overtake_difficulty && alt.analysis.overtake_difficulty.expected_laps_stuck > 3) {
      alt.cons.push(`Difficoltà sorpasso: ~${alt.analysis.overtake_difficulty.expected_laps_stuck} giri bloccato (no DRS)`);
    }

    if (alt.analysis.stint_extension && alt.analysis.stint_extension.cliff_risk_if_extend > 0.5) {
      alt.cons.push(`Rischio cliff se si estende lo stint (${Math.round(alt.analysis.stint_extension.cliff_risk_if_extend * 100)}%)`);
    }

    if (alt.analysis.pit_window && alt.analysis.pit_window.window_robustness === "FRAGILE") {
      alt.cons.push("Finestra pit fragile — il giro esatto è critico");
    }
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
  const integratedContext = buildIntegratedContext(
    diaryEvents, weatherMap, trackStatusMap, cumDevResult, driverNumber, actualPitLaps,
  );

  const narrativeInsights: string[] = [];

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

  // ── 7a. Battle impact on strategies ──
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
          narrativeInsights.push(`Battaglia in corso vicino alla finestra pit consigliata (giro ${recPitLap}): il pit potrebbe essere stato condizionato dalla posizione in pista.`);
        }
      }

      if (bc.defending_episodes > 0 && bc.longest_episode) {
        narrativeInsights.push(`Fase difensiva rilevata (${bc.defending_episodes} episodi, il più lungo: ${Math.round(bc.longest_episode.durationSeconds)}s vs ${bc.longest_episode.opponent}). La strategia potrebbe aver risentito della pressione.`);
      }

      // Penalize alternatives that pit during battle laps
      for (const alt of alternatives) {
        const pitDuringBattle = alt.pit_laps.some(pl => bc.battle_laps.has(pl));
        if (pitDuringBattle) {
          alt.cons.push("Pit durante fase di battaglia — rischio di perdere posizione");
          alt.estimated_delta_vs_actual -= 0.5; // Small penalty
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
      narrativeInsights.push(`La strategia reale ha iniziato a perdere terreno in modo cumulativo dal giro ${cd.loss_trend_start_lap} rispetto al benchmark del vincitore (${cd.winner_code ?? "P1"}).`);
      
      // Check if pit was before or after the loss trend started
      if (actualPitLaps.length > 0 && actualPitLaps[0] > cd.loss_trend_start_lap) {
        narrativeInsights.push(`Il pit reale (giro ${actualPitLaps[0]}) è avvenuto dopo l'inizio della perdita cumulativa (giro ${cd.loss_trend_start_lap}): un pit anticipato avrebbe potuto mitigare la perdita.`);
      }
    }

    if (cd.max_deviation != null && cd.max_deviation > 5) {
      narrativeInsights.push(`Deviazione cumulativa massima osservata: +${cd.max_deviation.toFixed(1)}s al giro ${cd.max_deviation_lap}.`);
    }

    if (cd.driver_final_delta != null && cd.driver_final_delta > 10) {
      narrativeInsights.push(`Al termine della gara, il pilota ha accumulato +${cd.driver_final_delta.toFixed(1)}s rispetto al benchmark del vincitore.`);
    }
  }

  // ── 7b2. Pace Loss insights (from cumulative deviation) ──
  {
    const usablePL = paceLossResults.filter(r => r.pace_loss_used_for_strategy);
    const worstPL = usablePL.reduce((w, r) => (r.stint_pace_loss_rate ?? 0) > (w?.stint_pace_loss_rate ?? 0) ? r : w, null as StintPaceLossResult | null);

    if (worstPL && worstPL.stint_pace_loss_rate != null) {
      if (worstPL.pace_loss_status === "CLIFF_RISK") {
        narrativeInsights.push(`⚠️ Perdita di passo critica nello stint ${worstPL.stint_number} (${worstPL.stint_pace_loss_rate.toFixed(3)} s/giro): possibile segnale di tyre cliff. Il modello ha aumentato l'urgenza del pit e la penalità per stint lunghi.`);
      } else if (worstPL.pace_loss_status === "HIGH_LOSS") {
        narrativeInsights.push(`Perdita di passo significativa nello stint ${worstPL.stint_number} (${worstPL.stint_pace_loss_rate.toFixed(3)} s/giro): il modello ha aumentato il peso del degrado nella simulazione strategica.`);
      } else if (worstPL.pace_loss_status === "NORMAL_LOSS") {
        narrativeInsights.push(`Perdita di passo moderata nello stint ${worstPL.stint_number} (${worstPL.stint_pace_loss_rate.toFixed(3)} s/giro), coerente con un degrado normale.`);
      }
    }

    // Check coherence between degradation model and pace loss
    for (const pl of usablePL) {
      const dv = degradationValidations.find(v => v.original.stint === pl.stint_number);
      if (dv && pl.stint_pace_loss_rate != null) {
        if (dv.effective_slope < 0.02 && pl.pace_loss_status === "HIGH_LOSS") {
          narrativeInsights.push(`Stint ${pl.stint_number}: il degrado stimato è basso (${dv.effective_slope.toFixed(3)} s/giro) ma la perdita di passo osservata è alta (${pl.stint_pace_loss_rate.toFixed(3)}). Possibile incoerenza — il verdetto è stato reso più prudente.`);
          confScore -= 1;
        } else if (dv.effective_slope > 0.06 && pl.pace_loss_status === "STABLE") {
          narrativeInsights.push(`Stint ${pl.stint_number}: il degrado stimato è elevato (${dv.effective_slope.toFixed(3)} s/giro) ma il passo osservato è stabile. Il degrado potrebbe essere sovrastimato.`);
        }
      }
    }

    // Unreliable pace loss: note for transparency
    const unreliablePL = paceLossResults.filter(r => r.pace_loss_status === "UNRELIABLE" && r.pace_loss_contamination_flags.battle);
    if (unreliablePL.length > 0) {
      narrativeInsights.push(`La metrica di pace loss per ${unreliablePL.length} stint è stata ridimensionata a causa di traffico e battaglie ravvicinate. Non è stata usata come driver strategico.`);
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
      narrativeInsights.push(`Condizioni meteo variabili rilevate dal giro ${wc.first_non_dry_lap} (${wc.wet_laps} giri bagnati, ${wc.mixed_laps} misti). Il modello di degrado esclude questi giri.`);
    }
  }

  // ── 7e. Track status enrichment ──
  if (integratedContext.track_status_context) {
    const ts = integratedContext.track_status_context;
    if (ts.had_safety_car) {
      // Check if actual pit was during SC (advantage)
      const pitUnderSC = pitStopAnalyses.some(p => p.neutralisation_type === "SC");
      if (pitUnderSC) {
        narrativeInsights.push("Il pit stop durante Safety Car ha ridotto il pit loss effettivo, vantaggio strategico significativo.");
      } else if (ts.neutralized_laps.some(nl => {
        // Check if SC was near recommended window
        return recommendedWindows.some(w => Math.abs(nl - w.ideal_lap) <= 3);
      })) {
        narrativeInsights.push("Una Safety Car è apparsa vicino alla finestra pit consigliata: un pit sotto neutralizzazione avrebbe offerto un vantaggio di ~10s.");
      }
    }
  }

  // ── 7f. Data gaps impact on confidence ──
  for (const gap of integratedContext.data_gaps) {
    confidenceFactors.push(`⚠️ ${gap}`);
  }

  // Apply scenario confidence penalty
  confScore += scenarioMods.confidence_penalty;

  // Recalculate confidence after all adjustments
  const finalConfidence: Confidence = confScore >= 6 ? "HIGH" : confScore >= 3 ? "MEDIUM" : "LOW";

  // Add scenario note if simulated
  if (isSimulatedScenario(scenarioId)) {
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

  // ── 9. Race Phase Detection ──
  const lastLap = Math.max(...laps.map(l => l.lap_number));
  const pitWindowStartLap = recommendedWindows.length > 0
    ? recommendedWindows[0].range[0]
    : actualPitLaps.length > 0 ? actualPitLaps[0] - 3 : null;
  const pitWindowEndLap = recommendedWindows.length > 0
    ? recommendedWindows[recommendedWindows.length - 1].range[1]
    : actualPitLaps.length > 0 ? actualPitLaps[actualPitLaps.length - 1] + 3 : null;

  const rawRacePhase = detectRacePhase(
    lastLap, totalLaps, pitWindowStartLap, pitWindowEndLap,
    actualPitLaps.length > 0, weatherMap, trackStatusMap,
  );
  // Apply scenario modifiers to phase adjustments (with timed scaling)
  const racePhase: RacePhaseResult = {
    ...rawRacePhase,
    phase_adjustments: applyScenarioToPhaseAdjustments(scenarioId, rawRacePhase.phase_adjustments, scenarioActivationLap, totalLaps, scenarioDurationLaps),
  };

  // Reduce confidence if degradation is unreliable
  if (invalidDegCount > 0) {
    confScore -= invalidDegCount;
  }

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
    race_phase: racePhase,
    risk_mode: riskMode,
    integrated_context: integratedContext,
    narrative_insights: narrativeInsights,
    scenario_id: scenarioId,
    scenario_is_simulated: isSimulatedScenario(scenarioId),
    scenario_label: scenarioDef.label,
    scenario_description: (() => {
      if (!isSimulatedScenario(scenarioId)) return scenarioDef.description;
      const parts = [scenarioDef.description];
      if (scenarioActivationLap != null) parts.push(`dal giro ${scenarioActivationLap}`);
      if (scenarioDurationLaps != null) parts.push(`per ${scenarioDurationLaps} giri`);
      if (scenarioWindow) parts.push(`(finestra: giri ${scenarioWindow.start}–${scenarioWindow.end})`);
      return parts.join(" ");
    })(),
    scenario_modifiers_applied: Object.fromEntries(
      Object.entries(scenarioMods).filter(([, v]) => typeof v === "number" && v !== 1.0 && v !== 0)
    ) as Record<string, number>,
    scenario_activation_lap: isSimulatedScenario(scenarioId) ? scenarioActivationLap : null,
    scenario_duration_laps: isSimulatedScenario(scenarioId) ? scenarioDurationLaps : null,
    scenario_window: scenarioWindow,
    scenario_activation_warning: scenarioActivationWarning,
    degradation_validations: degradationValidations,
    pace_loss_results: paceLossResults,
  };
}
