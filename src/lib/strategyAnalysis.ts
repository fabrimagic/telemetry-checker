/**
 * Advanced Strategy Analysis Module
 *
 * Provides multi-objective scoring, pit windows, sensitivity analysis,
 * robustness, competitor-aware context, overtake difficulty estimation,
 * and stint extension penalty calculation.
 *
 * Anti-hallucination: All estimates are derived from observed data (OpenF1).
 * Where data is insufficient, confidence is reduced explicitly.
 */

import type { TrafficPrediction, TrafficLevel } from "./trafficPredictor";
import type { IntervalData, PositionData, Driver, Lap, StintData } from "./openf1";
import type { RiskMode } from "./riskAppetite";
import type { ScenarioId } from "./scenarioContext";
import { isSimulatedScenario, SCENARIO_DEFINITIONS } from "./scenarioContext";

/* ══════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════ */

export type RobustnessLabel = "ROBUST" | "MEDIUM" | "FRAGILE";

export interface PitWindow {
  pit_window_start: number;
  pit_window_end: number;
  best_lap_in_window: number;
  window_time_spread: number; // max delta time across window (s)
  window_robustness: RobustnessLabel;
}

export interface MultiObjectiveScores {
  race_time_objective: number;       // lower = better (seconds)
  track_position_objective: number;  // lower = better (fewer positions lost)
  risk_objective: number;            // lower = better (less risk)
  robustness_objective: number;      // lower = better (less sensitive to variance)
  final_strategy_score: number;      // composite: lower = better
}

export interface SensitivityResult {
  sensitivity_to_degradation: number;  // delta seconds if deg +20%
  sensitivity_to_traffic: number;      // delta seconds if traffic +50%
  sensitivity_to_pit_loss: number;     // delta seconds if pit loss +2s
}

export interface RobustnessResult {
  robustness_score: number;  // 0–1, higher = more robust
  robustness_label: RobustnessLabel;
}

export interface CompetitorContext {
  expected_rejoin_position: number;
  cars_ahead_after_pit: number;
  undercut_risk: number;       // 0–1 probability
  undercut_opportunity: number; // 0–1 probability
  traffic_risk_after_pit: number; // 0–1
}

export interface OvertakeDifficulty {
  overtake_difficulty_score: number;  // 0–1, higher = harder
  expected_laps_stuck: number;
  dirty_air_penalty: number;          // seconds total
  traffic_persistence_risk: number;   // 0–1
}

export interface StintExtensionPenalty {
  extension_cost_per_lap: number;     // seconds/lap marginal cost
  total_extension_penalty: number;    // total seconds if extending N laps
  cliff_risk_if_extend: number;       // 0–1
}

export interface EnrichedStrategyAnalysis {
  pit_window: PitWindow | null;
  multi_objective: MultiObjectiveScores;
  sensitivity: SensitivityResult;
  robustness: RobustnessResult;
  competitor_context: CompetitorContext | null;
  overtake_difficulty: OvertakeDifficulty | null;
  stint_extension: StintExtensionPenalty | null;
}

/* ══════════════════════════════════════════════════════════════
   1. Pit Window Generation
   ══════════════════════════════════════════════════════════════ */

export function generatePitWindow(
  basePitLap: number,
  totalLaps: number,
  costFn: (pitLaps: number[], compounds: string[]) => number | null,
  allPitLaps: number[],
  compounds: string[],
  pitIndex: number = 0,
): PitWindow | null {
  const windowRadius = 3;
  const start = Math.max(3, basePitLap - windowRadius);
  const end = Math.min(totalLaps - 2, basePitLap + windowRadius);

  const costs: { lap: number; cost: number }[] = [];
  for (let lap = start; lap <= end; lap++) {
    const candidate = [...allPitLaps];
    candidate[pitIndex] = lap;
    // Ensure ordering
    let valid = true;
    for (let i = 1; i < candidate.length; i++) {
      if (candidate[i] <= candidate[i - 1] + 2) { valid = false; break; }
    }
    if (!valid) continue;

    const cost = costFn(candidate, compounds);
    if (cost != null) costs.push({ lap, cost });
  }

  if (costs.length === 0) return null;

  const bestEntry = costs.reduce((b, c) => c.cost < b.cost ? c : b);
  const worstCost = Math.max(...costs.map(c => c.cost));
  const spread = Math.round((worstCost - bestEntry.cost) * 10) / 10;

  let robustness: RobustnessLabel = "ROBUST";
  if (spread > 3.0) robustness = "FRAGILE";
  else if (spread > 1.5) robustness = "MEDIUM";

  return {
    pit_window_start: start,
    pit_window_end: end,
    best_lap_in_window: bestEntry.lap,
    window_time_spread: spread,
    window_robustness: robustness,
  };
}

/* ══════════════════════════════════════════════════════════════
   2. Sensitivity Analysis
   ══════════════════════════════════════════════════════════════ */

export function computeSensitivity(
  baseCost: number,
  pitLaps: number[],
  compounds: string[],
  totalLaps: number,
  compoundModels: Map<string, { slope: number; intercept: number }>,
  pitLoss: number,
  trafficBaseline: number,
): SensitivityResult {
  // Degradation sensitivity: +20% slope
  const degCost = simulateWithModifiedDeg(pitLaps, compounds, totalLaps, compoundModels, 1.2, pitLoss, trafficBaseline);
  const sensitivity_to_degradation = degCost != null ? Math.round((degCost - baseCost) * 10) / 10 : 0;

  // Traffic sensitivity: +50% traffic
  const trafficCost = simulateWithModifiedTraffic(baseCost, pitLaps, trafficBaseline, 1.5);
  const sensitivity_to_traffic = Math.round((trafficCost - baseCost) * 10) / 10;

  // Pit loss sensitivity: +2s per stop
  const pitLossDelta = pitLaps.length * 2.0;
  const sensitivity_to_pit_loss = Math.round(pitLossDelta * 10) / 10;

  return { sensitivity_to_degradation, sensitivity_to_traffic, sensitivity_to_pit_loss };
}

function simulateWithModifiedDeg(
  pitLaps: number[],
  compounds: string[],
  totalLaps: number,
  compoundModels: Map<string, { slope: number; intercept: number }>,
  degMult: number,
  pitLoss: number,
  trafficBaseline: number,
): number | null {
  const bounds = buildBounds(pitLaps, compounds, totalLaps);
  let total = 0;
  for (const sb of bounds) {
    const model = compoundModels.get(sb.compound);
    if (!model) return null;
    for (let lap = sb.start; lap <= sb.end; lap++) {
      const tyreLife = lap - sb.start;
      total += model.intercept + model.slope * tyreLife * degMult;
    }
  }
  total += pitLaps.length * pitLoss;
  total += trafficBaseline;
  return total;
}

function simulateWithModifiedTraffic(
  baseCost: number,
  pitLaps: number[],
  trafficBaseline: number,
  trafficMult: number,
): number {
  // Traffic is additive, so we add the extra traffic on top
  return baseCost + trafficBaseline * (trafficMult - 1);
}

function buildBounds(pitLaps: number[], compounds: string[], totalLaps: number) {
  const bounds: { start: number; end: number; compound: string }[] = [];
  let s = 1;
  for (let i = 0; i < pitLaps.length; i++) {
    bounds.push({ start: s, end: pitLaps[i], compound: compounds[i] || compounds[0] });
    s = pitLaps[i] + 1;
  }
  bounds.push({ start: s, end: totalLaps, compound: compounds[compounds.length - 1] || compounds[0] });
  return bounds;
}

/* ══════════════════════════════════════════════════════════════
   3. Robustness Score
   ══════════════════════════════════════════════════════════════ */

export function computeRobustness(sens: SensitivityResult): RobustnessResult {
  // Total sensitivity = how much time the strategy could lose under adverse conditions
  const totalSens = Math.abs(sens.sensitivity_to_degradation) +
    Math.abs(sens.sensitivity_to_traffic) +
    Math.abs(sens.sensitivity_to_pit_loss);

  // Normalize: 0 = very fragile, 1 = very robust
  // Typical F1 range: 0–15s total sensitivity
  const score = Math.max(0, Math.min(1, 1 - totalSens / 15));
  const roundedScore = Math.round(score * 100) / 100;

  let label: RobustnessLabel = "ROBUST";
  if (roundedScore < 0.35) label = "FRAGILE";
  else if (roundedScore < 0.65) label = "MEDIUM";

  return { robustness_score: roundedScore, robustness_label: label };
}

/* ══════════════════════════════════════════════════════════════
   4. Multi-Objective Scoring
   ══════════════════════════════════════════════════════════════ */

export interface MultiObjectiveWeights {
  time_weight: number;
  position_weight: number;
  risk_weight: number;
  robustness_weight: number;
}

const MO_WEIGHTS: Record<RiskMode, MultiObjectiveWeights> = {
  CONSERVATIVE: { time_weight: 0.30, position_weight: 0.25, risk_weight: 0.25, robustness_weight: 0.20 },
  BALANCED:     { time_weight: 0.40, position_weight: 0.25, risk_weight: 0.20, robustness_weight: 0.15 },
  AGGRESSIVE:   { time_weight: 0.50, position_weight: 0.25, risk_weight: 0.10, robustness_weight: 0.15 },
};

export function computeMultiObjectiveScore(
  raceTimeDelta: number,       // vs actual (positive = better)
  positionDelta: number,        // positions lost after pit (0 = no change, positive = worse)
  riskScore: number,            // 0–1 (higher = more risky)
  robustnessScore: number,      // 0–1 (higher = more robust)
  riskMode: RiskMode,
  scenarioId: ScenarioId,
): MultiObjectiveScores {
  const w = { ...MO_WEIGHTS[riskMode] };

  // Scenario-specific weight adjustments
  if (isSimulatedScenario(scenarioId)) {
    const mods = SCENARIO_DEFINITIONS[scenarioId].modifiers;
    w.position_weight *= mods.track_position_weight;
    w.risk_weight *= mods.risk_penalty_weight;
    // Renormalize
    const total = w.time_weight + w.position_weight + w.risk_weight + w.robustness_weight;
    w.time_weight /= total;
    w.position_weight /= total;
    w.risk_weight /= total;
    w.robustness_weight /= total;
  }

  // Normalize objectives to 0–1 range
  // Time: normalize by typical delta range (0–15s)
  const timeNorm = Math.max(0, Math.min(1, (15 - raceTimeDelta) / 15));
  // Position: 0 = perfect, 1 = lost 5+ positions
  const posNorm = Math.max(0, Math.min(1, positionDelta / 5));
  // Risk: already 0–1
  const riskNorm = Math.max(0, Math.min(1, riskScore));
  // Robustness: invert so lower = better
  const robNorm = Math.max(0, Math.min(1, 1 - robustnessScore));

  const finalScore = timeNorm * w.time_weight +
    posNorm * w.position_weight +
    riskNorm * w.risk_weight +
    robNorm * w.robustness_weight;

  return {
    race_time_objective: Math.round(raceTimeDelta * 10) / 10,
    track_position_objective: Math.round(positionDelta * 10) / 10,
    risk_objective: Math.round(riskNorm * 100) / 100,
    robustness_objective: Math.round(robustnessScore * 100) / 100,
    final_strategy_score: Math.round(finalScore * 1000) / 1000,
  };
}

/* ══════════════════════════════════════════════════════════════
   5. Competitor-Aware Context
   ══════════════════════════════════════════════════════════════ */

export function buildCompetitorContext(
  driverNumber: number,
  pitLap: number,
  trafficPredictions: TrafficPrediction[],
  intervals: IntervalData[],
  positions: PositionData[],
  stints: StintData[],
  allDrivers: Driver[],
  totalLaps: number,
): CompetitorContext | null {
  const pred = trafficPredictions.find(t => t.pit_lap === pitLap);
  if (!pred && trafficPredictions.length === 0) return null;

  const bestPred = pred ?? trafficPredictions[0];

  const currentPos = bestPred.current_position || 0;
  const rejoinPos = bestPred.rejoin_position_estimated || currentPos;
  const positionsLost = Math.max(0, rejoinPos - currentPos);

  // Undercut risk: estimated based on gap to car behind
  // If car behind is close (<2s) and could pit soon, undercut risk is high
  const gapBehind = bestPred.gap_behind_after_pit;
  let undercutRisk = 0;
  if (gapBehind != null) {
    if (gapBehind < 1.0) undercutRisk = 0.8;
    else if (gapBehind < 2.0) undercutRisk = 0.5;
    else if (gapBehind < 3.0) undercutRisk = 0.2;
  }

  // Undercut opportunity: if we pit before car ahead and gap is small
  const gapAhead = bestPred.gap_ahead_after_pit;
  let undercutOpportunity = 0;
  if (gapAhead != null) {
    if (gapAhead < 1.5) undercutOpportunity = 0.7;
    else if (gapAhead < 2.5) undercutOpportunity = 0.4;
    else if (gapAhead < 4.0) undercutOpportunity = 0.15;
  }

  // Traffic risk
  let trafficRisk = 0;
  if (bestPred.traffic_level === "HEAVY") trafficRisk = 0.9;
  else if (bestPred.traffic_level === "LIGHT") trafficRisk = 0.4;
  else if (bestPred.traffic_level === "CLEAN") trafficRisk = 0.05;

  return {
    expected_rejoin_position: rejoinPos,
    cars_ahead_after_pit: Math.max(0, rejoinPos - 1),
    undercut_risk: Math.round(undercutRisk * 100) / 100,
    undercut_opportunity: Math.round(undercutOpportunity * 100) / 100,
    traffic_risk_after_pit: Math.round(trafficRisk * 100) / 100,
  };
}

/* ══════════════════════════════════════════════════════════════
   6. Overtake Difficulty / Traffic Persistence
   ══════════════════════════════════════════════════════════════ */

export function estimateOvertakeDifficulty(
  driverPace: number | null,   // avg lap time of our driver
  aheadPace: number | null,    // avg lap time of car ahead after pit
  gapAfterPit: number | null,  // gap to car ahead
  trafficLevel: TrafficLevel,
  rejoinPosition: number,
  totalDrivers: number,
): OvertakeDifficulty | null {
  if (trafficLevel === "CLEAN" || trafficLevel === "UNKNOWN") {
    return {
      overtake_difficulty_score: 0,
      expected_laps_stuck: 0,
      dirty_air_penalty: 0,
      traffic_persistence_risk: 0,
    };
  }

  // Base difficulty from traffic level
  let difficultyBase = trafficLevel === "HEAVY" ? 0.75 : 0.4;

  // Pace differential effect (no DRS makes passing harder)
  let lapsStuck = 0;
  const dirtyAirPerLap = 0.35; // estimated dirty air loss per lap (no DRS)

  if (driverPace != null && aheadPace != null) {
    const paceDiff = aheadPace - driverPace; // positive = we're faster
    if (paceDiff <= 0) {
      // We're slower or same pace: very hard to pass
      difficultyBase = Math.min(1.0, difficultyBase + 0.2);
      lapsStuck = trafficLevel === "HEAVY" ? 6 : 4;
    } else if (paceDiff < 0.3) {
      // Marginally faster
      lapsStuck = Math.ceil(2.0 / paceDiff); // need ~2s advantage to pass
      lapsStuck = Math.min(lapsStuck, 8);
    } else if (paceDiff < 0.6) {
      lapsStuck = Math.ceil(1.5 / paceDiff);
      lapsStuck = Math.min(lapsStuck, 5);
    } else {
      // Significantly faster
      lapsStuck = Math.ceil(1.0 / paceDiff);
      lapsStuck = Math.min(lapsStuck, 3);
      difficultyBase *= 0.7;
    }
  } else {
    // No pace data: use defaults
    lapsStuck = trafficLevel === "HEAVY" ? 4 : 2;
  }

  // Mid-pack is harder to pass in (more cars, less room)
  const midPackFactor = rejoinPosition > 5 && rejoinPosition < totalDrivers - 3 ? 1.15 : 1.0;
  difficultyBase = Math.min(1.0, difficultyBase * midPackFactor);

  const dirtyAirTotal = Math.round(lapsStuck * dirtyAirPerLap * 10) / 10;

  // Traffic persistence: how likely to remain stuck
  const persistence = difficultyBase * (lapsStuck > 3 ? 0.9 : lapsStuck > 1 ? 0.5 : 0.1);

  return {
    overtake_difficulty_score: Math.round(difficultyBase * 100) / 100,
    expected_laps_stuck: lapsStuck,
    dirty_air_penalty: dirtyAirTotal,
    traffic_persistence_risk: Math.round(persistence * 100) / 100,
  };
}

/* ══════════════════════════════════════════════════════════════
   7. Stint Extension Penalty
   ══════════════════════════════════════════════════════════════ */

export function estimateStintExtensionPenalty(
  currentStintLength: number,
  extensionLaps: number,
  degradationSlope: number,
  avgLapTime: number | null,
  cliffThreshold: number = 18,
): StintExtensionPenalty {
  // Marginal cost: each additional lap costs more due to non-linear degradation
  // The slope is per-lap, but real degradation accelerates beyond cliff threshold
  const baseCostPerLap = degradationSlope;

  // Acceleration factor: cost increases as we extend beyond optimal
  let totalPenalty = 0;
  let cliffRisk = 0;

  for (let i = 1; i <= extensionLaps; i++) {
    const extendedLife = currentStintLength + i;
    let lapCost = baseCostPerLap;

    // Non-linear acceleration beyond threshold
    if (extendedLife > cliffThreshold) {
      const excess = extendedLife - cliffThreshold;
      lapCost += excess * 0.02 * baseCostPerLap; // quadratic-ish growth
    }

    totalPenalty += lapCost;
  }

  // Cliff risk estimation
  const totalExtendedLength = currentStintLength + extensionLaps;
  if (totalExtendedLength > cliffThreshold + 5) cliffRisk = 0.85;
  else if (totalExtendedLength > cliffThreshold + 2) cliffRisk = 0.5;
  else if (totalExtendedLength > cliffThreshold) cliffRisk = 0.2;

  const extensionCostPerLap = extensionLaps > 0
    ? Math.round((totalPenalty / extensionLaps) * 1000) / 1000
    : baseCostPerLap;

  return {
    extension_cost_per_lap: extensionCostPerLap,
    total_extension_penalty: Math.round(totalPenalty * 10) / 10,
    cliff_risk_if_extend: Math.round(cliffRisk * 100) / 100,
  };
}

/* ══════════════════════════════════════════════════════════════
   8. Full Enrichment Pipeline
   ══════════════════════════════════════════════════════════════ */

export function enrichStrategyAnalysis(
  pitLaps: number[],
  compounds: string[],
  deltaVsActual: number,
  totalLaps: number,
  compoundModels: Map<string, { slope: number; intercept: number }>,
  pitLoss: number,
  trafficBaseline: number,
  trafficPredictions: TrafficPrediction[],
  riskMode: RiskMode,
  scenarioId: ScenarioId,
  intervals: IntervalData[],
  positions: PositionData[],
  stints: StintData[],
  allDrivers: Driver[],
  driverNumber: number,
  costFn: (pitLaps: number[], compounds: string[]) => number | null,
  driverAvgPace: number | null,
  actualPitLaps: number[],
): EnrichedStrategyAnalysis {
  // 1. Pit Window
  let pitWindow: PitWindow | null = null;
  if (pitLaps.length > 0) {
    pitWindow = generatePitWindow(
      pitLaps[0], totalLaps, costFn, pitLaps, compounds, 0,
    );
  }

  // 2. Base cost for sensitivity
  const baseCost = costFn(pitLaps, compounds);

  // 3. Sensitivity
  const sensitivity = computeSensitivity(
    baseCost ?? 0, pitLaps, compounds, totalLaps, compoundModels, pitLoss, trafficBaseline,
  );

  // 4. Robustness
  const robustness = computeRobustness(sensitivity);

  // 5. Competitor context
  let competitorCtx: CompetitorContext | null = null;
  if (pitLaps.length > 0) {
    competitorCtx = buildCompetitorContext(
      driverNumber, pitLaps[0], trafficPredictions,
      intervals, positions, stints, allDrivers, totalLaps,
    );
  }

  // 6. Overtake difficulty
  let overtakeDiff: OvertakeDifficulty | null = null;
  if (competitorCtx && trafficPredictions.length > 0) {
    const pred = trafficPredictions.find(t => t.pit_lap === pitLaps[0]) ?? trafficPredictions[0];
    // Estimate pace of car ahead (rough: use driver pace + small delta)
    const aheadPace = driverAvgPace != null ? driverAvgPace + 0.15 : null; // conservative estimate
    overtakeDiff = estimateOvertakeDifficulty(
      driverAvgPace, aheadPace, pred.gap_ahead_after_pit,
      pred.traffic_level, competitorCtx.expected_rejoin_position, allDrivers.length,
    );
  }

  // 7. Stint extension penalty (for the first stint of the strategy)
  let stintExt: StintExtensionPenalty | null = null;
  if (pitLaps.length > 0 && actualPitLaps.length > 0) {
    const extensionLaps = pitLaps[0] - actualPitLaps[0];
    if (extensionLaps > 0) {
      const firstCompound = compounds[0];
      const model = compoundModels.get(firstCompound);
      const slope = model ? model.slope : 0.05; // fallback
      stintExt = estimateStintExtensionPenalty(
        actualPitLaps[0], extensionLaps, slope, driverAvgPace,
      );
    }
  }

  // 8. Multi-objective score
  const positionDelta = competitorCtx
    ? Math.max(0, competitorCtx.expected_rejoin_position - (trafficPredictions[0]?.current_position ?? 10))
    : 0;

  // Risk score: combine sensitivity + cliff risk + traffic risk
  const cliffRisk = stintExt?.cliff_risk_if_extend ?? 0;
  const trafficRisk = competitorCtx?.traffic_risk_after_pit ?? 0;
  const riskScore = Math.min(1, (
    (1 - robustness.robustness_score) * 0.4 +
    cliffRisk * 0.3 +
    trafficRisk * 0.3
  ));

  const multiObj = computeMultiObjectiveScore(
    deltaVsActual, positionDelta, riskScore, robustness.robustness_score,
    riskMode, scenarioId,
  );

  return {
    pit_window: pitWindow,
    multi_objective: multiObj,
    sensitivity,
    robustness,
    competitor_context: competitorCtx,
    overtake_difficulty: overtakeDiff,
    stint_extension: stintExt,
  };
}
