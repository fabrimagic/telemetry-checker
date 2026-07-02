import type {
  Lap, StintData, PitData, WeatherData, RaceControlMessage,
  IntervalData, PositionData, Driver,
} from "./openf1";
import { classifyLapsWeather, type WeatherCondition } from "./weatherClassification";
import { classifyLapsTrackStatus, type TrackStatus } from "./trackStatusClassification";
import { calculateTyreDegradation, type DegradationResult } from "./tyreDegradation";
import { calculateCorrectedTyreDegradation, type CorrectedDegradationResult } from "./correctedDegradation";
import type { LapWorkEstimate } from "./fuelEstimator";
import { validateAllDegradationEstimates, resolveDegradationForStrategy, type DegradationValidationResult, type DegradationStatus, DEFAULT_VALIDATION_CONFIG } from "./degradationValidation";
import { predictTrafficForPitLaps, type TrafficPrediction, type TrafficLevel } from "./trafficPredictor";
import { computeStrategyBreakdown, type StrategyBreakdown } from "./strategyBreakdown";
import { scoreStrategies, NEUTRAL_PHASE_ADJUSTMENTS, type RiskMode, type ScoredStrategy, type StrategyRiskContext } from "./riskAppetite";
import { buildIntegratedContext, enrichIntegratedContext, buildBattleContext, type IntegratedStrategyContext, type TrafficSummary, type DegradationValidationSummary, type PaceLossSummary } from "./vreContext";
import type { DiaryEvent } from "./raceDiary";
import type { CumulativeDeviationResult, DriverCumulativeDeviation } from "./cumulativeDeviation";
import { type ScenarioId, SCENARIO_DEFINITIONS, NEUTRALIZATION_PIT_LOSS, isSimulatedScenario, applyScenarioToPhaseAdjustments, buildTimedScenarioModifiers, validateScenarioActivationLap, computeScenarioWindow } from "./scenarioContext";
import { computeAllStintPaceLoss, paceLossDegradationAdjustment, paceLossCliffMultiplier, paceLossPitUrgencyShift, type StintPaceLossResult } from "./stintPaceLoss";
import { detectLappedTraffic, type LappedTrafficResult } from "./lappedTraffic";
import { computeTyreWarmupPenalty, computeStintWarmupCost, computeStartWarmupTempFactor, computeStartTractionPenalty, START_WARMUP_FRACTION } from "./tyreWarmup";
import { enrichStrategyAnalysis, type EnrichedStrategyAnalysis } from "./strategyAnalysis";
import { classifyStrategyIntent, type IntentClassification } from "./strategyIntent";
import { computeSoftSensors, computeSoftSensorsTimeline, computeStrategySoftSensorAdjustment, computeWarmupInterpretation, computeDegradationValidationContext, extractSoftSensorNarrativeInsights, validateSoftSensorScoringGate, computeSoftSensorScoringDelta, type SoftSensorsContext, type SoftSensorsTimeline, type StrategySoftSensorAdjustment, type WarmupInterpretation, type DegradationValidationContext, type SoftSensorScoringGate } from "./softSensors";
import { NarrativeCollector } from "./narrative/collector";
import { renderNarrative } from "./narrative/renderer";
import type { NarrativeChapter } from "./narrative/types";
import { detectRaceControlPenalties, penaltiesForDriver, type DetectedPenalty } from "./raceControlPenalties";

export type AnalysisMode = "RACE_ENGINEER" | "POST_RACE";

/**
 * Hierarchical selection of the best compound model when multiple stints
 * use the same compound. Replaces the previous "first-stint wins" rule.
 * Order of precedence:
 *   1. status: VALID > NEUTRAL > INVALID
 *   2. rSquared: higher wins
 *   3. lapsUsed: higher wins
 *   4. tiebreaker: caller's iteration order (first wins)
 */
export interface CompoundModelCandidate {
  status: "VALID" | "NEUTRAL" | "INVALID";
  rSquared: number;
  lapsUsed: number;
}

export function isBetterCompoundModel(
  candidate: CompoundModelCandidate,
  incumbent: CompoundModelCandidate,
): boolean {
  const statusRank = { VALID: 3, NEUTRAL: 2, INVALID: 1 } as const;
  if (statusRank[candidate.status] !== statusRank[incumbent.status]) {
    return statusRank[candidate.status] > statusRank[incumbent.status];
  }
  if (candidate.rSquared !== incumbent.rSquared) {
    return candidate.rSquared > incumbent.rSquared;
  }
  return candidate.lapsUsed > incumbent.lapsUsed;
}

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
  analysis?: EnrichedStrategyAnalysis;
  intent?: IntentClassification;
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
  intent?: IntentClassification;
  position_score_adjustment?: number;
  /**
   * Estimated absolute ranking time in seconds — LOWER = BETTER.
   * = (actual reference time − estimated_gain_seconds) + position_score_adjustment.
   * NOTE: NOT the same convention as `ScoredStrategy.adjusted_score` from
   * `riskAppetite.ts`, which is a delta-score where HIGHER = BETTER.
   * Pure-pace fields are NEVER mutated by the position-aware adjustment.
   */
  ranking_time_estimate?: number;
  /**
   * Presentation-only fields, mirror of `AlternativeStrategy.delta_clamped` /
   * `raw_delta_vs_actual`. When the recommended gain has been capped to the
   * plausibility ceiling (MAX_PLAUSIBLE_DELTA = pitLoss × 2.5) — either at
   * the bestDelta search or at the presentation clamp of a promoted alt —
   * `delta_clamped` is true and `raw_gain_seconds` preserves the pre-clamp
   * value. Informational only: NEVER consumed by ranking or promotion.
   */
  delta_clamped?: boolean;
  raw_gain_seconds?: number;
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
  intent?: IntentClassification;
  /**
   * Position-aware ranking adjustment, in seconds.
   * Negative = strategy made more attractive by a net position-gain
   * opportunity (attack). Positive = strategy penalized by exposed
   * defensive position (risk of being undercut). 0 when no
   * competitor_context is available (e.g. empty intervals/positions).
   */
  position_score_adjustment?: number;
  /**
   * Estimated absolute ranking time in seconds — LOWER = BETTER.
   * = (actual reference time − estimated_delta_vs_actual) + position_score_adjustment.
   * NOTE: NOT the same convention as `ScoredStrategy.adjusted_score` from
   * `riskAppetite.ts`, which is a delta-score where HIGHER = BETTER.
   * estimated_delta_vs_actual and time_delta_vs_actual remain pure-pace
   * deltas (unchanged) and are still consumed by UI/tests.
   */
  ranking_time_estimate?: number;
  /**
   * Standard deviation (±, seconds) on `estimated_delta_vs_actual` obtained by
   * analytical propagation of per-compound slope uncertainties through the
   * stint sum. Includes both the statistical slopeStdError and the systematic
   * TRACK_EVOLUTION_SLOPE_UNCERTAINTY term. Independence between stints and
   * between strategies is assumed (approximation, documented).
   */
  delta_uncertainty_std?: number;
  /**
   * True when |estimated_delta_vs_actual| < DELTA_SIGNIFICANCE_K *
   * delta_uncertainty_std — i.e. the pace delta vs the actual strategy is
   * within the propagated uncertainty band of the degradation model. UI and
   * narrative can use this to mark the comparison as "within margin".
   * Informative only — does NOT change the sort order.
   */
  indistinguishable_from_actual?: boolean;
  /**
   * Presentation-only fields. When the displayed delta has been capped to the
   * same plausibility ceiling used for the recommended strategy
   * (MAX_PLAUSIBLE_DELTA = pitLoss × 2.5), `delta_clamped` is true and
   * `raw_delta_vs_actual` preserves the original pre-clamp value for
   * diagnostics. Scoring, uncertainty and the promotion check ALWAYS run on
   * the raw value (the clamp is applied AFTER those phases); these fields are
   * informational only and must not be consumed by ranking logic.
   */
  delta_clamped?: boolean;
  raw_delta_vs_actual?: number;
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
  narrative_chapters: NarrativeChapter[];
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
  /**
   * Penalties detected from race control messages for THIS driver.
   * Informational only — strategic calculations (pace, pit-loss, counterfactuals,
   * verdicts) do NOT account for penalties. See raceControlPenalties.ts.
   */
  detected_penalties: DetectedPenalty[];
  /**
   * Lapped-traffic cost analysis (optional). Present only when the caller
   * passes `allSessionLaps`. INFORMATIONAL: the estimated cost is NOT
   * applied to any strategic score, penalty, or counterfactual simulation
   * — projecting future encounters with backmarkers would be speculative.
   * It IS used to contaminate stint pace-loss laps (same treatment as
   * battle / weather / neutralization).
   */
  lapped_traffic?: LappedTrafficResult;
}

/* ── Helpers ── */

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function estimatePitLoss(pitStops: PitData[]): number {
  if (!pitStops.length) return 22; // default F1 pit loss ~22s
  // Esclude i transiti in pit-lane sotto Safety Car / procedure di fine gara:
  // hanno stop_duration null e non sono pit stop strategici. Includerli abbassa
  // artificialmente la mediana del pit loss (misurato: 18.9s invece di ~23.4s reali).
  const realStops = pitStops.filter(p => p.stop_duration != null);
  const source = realStops.length > 0 ? realStops : pitStops;
  const durations = source.map(p => p.lane_duration).filter(d => d > 0);
  if (!durations.length) return 22;
  return median(durations);
}

/**
 * Ultimo giro VERDE effettivo. Quando i giri finali di una gara sono corsi in
 * regime di SC/VSC/RED (es. SC uscita nel finale), quei giri neutralizzati hanno
 * tempi da transito in pit-lane e non sono giri di corsa reali: vanno esclusi da
 * totalLaps / lunghezza stint / cliff penalty.
 */
export function computeEffectiveLastLap(
  maxLapNumber: number,
  trackStatus: Map<number, TrackStatus>,
): number {
  let last = maxLapNumber;
  while (last > 1) {
    const st = trackStatus.get(last);
    if (st != null && st !== "GREEN") last--;
    else break;
  }
  return last;
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

/**
 * Position-aware ranking adjustment for an alternative strategy.
 *
 * Translates the competitor context at the pit lap (undercut_opportunity vs
 * undercut_risk, both 0–1) into a seconds-valued cost adjustment used to
 * re-rank strategies AFTER the pure-pace simulation.
 *
 * Convention (TIME-units, lower-is-better target):
 *  - opportunity > risk → NEGATIVE adjustment (attack: makes strategy more
 *    attractive, since it would gain a contested position)
 *  - risk > opportunity → POSITIVE adjustment (exposure: penalizes a
 *    strategy that fails to cover a defensive threat)
 *  - balanced or null → 0
 *
 * POSITION_VALUE_BASE represents the typical strategic value of one
 * contested track position over the remainder of a stint (seconds equivalent
 * of holding/losing a slot through pit cycles + dirty-air effects).
 *
 * The result is clamped to ±POSITION_ADJUSTMENT_MAX so it never overwhelms
 * the pure-pace term: it tips ties and breaks neutral ranks, not the law of
 * physics. Returns 0 when ctx is null (backward-compatible: empty
 * intervals/positions ⇒ no behavioral change).
 */
export const POSITION_VALUE_BASE = 8; // seconds — value of one contested position
export const POSITION_ADJUSTMENT_MAX = 12; // seconds — hard clamp

export function computePositionAdjustment(
  ctx: { undercut_opportunity: number; undercut_risk: number } | null | undefined,
  riskMode: RiskMode,
): number {
  if (!ctx) return 0;
  const opp = ctx.undercut_opportunity ?? 0;
  const risk = ctx.undercut_risk ?? 0;

  // Risk-mode weighting: AGGRESSIVE values opportunity more, CONSERVATIVE
  // values defense more. BALANCED treats them symmetrically.
  let oppWeight = 1;
  let riskWeight = 1;
  if (riskMode === "AGGRESSIVE") {
    oppWeight = 1.3;
    riskWeight = 0.8;
  } else if (riskMode === "CONSERVATIVE") {
    oppWeight = 0.8;
    riskWeight = 1.3;
  }

  // Negative when opportunity dominates (bonus), positive when risk dominates.
  const raw = -(opp * oppWeight - risk * riskWeight) * POSITION_VALUE_BASE;
  if (raw > POSITION_ADJUSTMENT_MAX) return POSITION_ADJUSTMENT_MAX;
  if (raw < -POSITION_ADJUSTMENT_MAX) return -POSITION_ADJUSTMENT_MAX;
  const rounded = Math.round(raw * 100) / 100;
  return rounded === 0 ? 0 : rounded; // normalize -0 → 0

}

/**
 * Reorder alternatives in-place by risk-aware adjusted_score (HIGHER=BETTER)
 * minus position_score_adjustment (LOWER=BETTER in seconds). A negative
 * position adjustment (attack bonus) pushes the alternative UP.
 *
 * Convention guarantee: the main branch reads `ScoredStrategy.adjusted_score`
 * (higher=better, see riskAppetite.ts:207). The fallback uses
 * `estimated_delta_vs_actual` which is `actualTime − altTime` (positive =
 * faster than actual = better) — SAME direction. A stable tiebreaker on
 * the original index preserves prior order when scores are equal, so a
 * missing altScores entry does not silently re-order siblings.
 */
export function sortAlternativesByPositionAwareScore<
  A extends { estimated_delta_vs_actual: number; position_score_adjustment?: number },
>(
  alternatives: A[],
  scoreByRef: Map<A, number | undefined>,
): void {
  // Snapshot original indices for stable tiebreaker.
  const originalIndex = new Map<A, number>();
  alternatives.forEach((a, i) => originalIndex.set(a, i));

  alternatives.sort((a, b) => {
    // Reference-based lookup (no name resolution → duplicate names are safe).
    // Both branches use higher=better convention (see jsdoc above).
    const baseA = scoreByRef.get(a) ?? a.estimated_delta_vs_actual;
    const baseB = scoreByRef.get(b) ?? b.estimated_delta_vs_actual;
    const scoreA = baseA - (a.position_score_adjustment ?? 0);
    const scoreB = baseB - (b.position_score_adjustment ?? 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
  });
}


/**
 * Systematic (non-statistical) component of the uncertainty on the tyre
 * degradation slope, in s/lap. Captures the track-evolution effect (the
 * rubbering-in that makes the surface faster as the race progresses): the
 * model does NOT correct for it because the per-circuit coefficient is
 * unknown, so we declare the resulting bias as an additional uncertainty
 * (added in quadrature to the regression slopeStdError). The true tyre
 * degradation is in general ≥ the estimated one — this constant gives an
 * indicative ±5 ms/lap envelope.
 */
export const TRACK_EVOLUTION_SLOPE_UNCERTAINTY = 0.005; // s/lap

/**
 * k-factor used to flag an alternative as statistically indistinguishable
 * from the actual strategy: |Δt| < K × delta_uncertainty_std. K = 1.0 ≈ 1σ
 * (≈ 68% confidence the difference is real). Raise to ~2.0 for a stricter
 * 95% test. The flag is informative only — it does not change the ranking.
 */
export const DELTA_SIGNIFICANCE_K = 1.0;

export interface StintBoundForUncertainty {
  start: number;
  end: number;
  compound: string;
}

/**
 * Analytically propagate the per-compound slope uncertainty through a full
 * strategy and return the standard deviation of the total stint time.
 *
 * For a stint of length T laps, lap time = slope × tyreLife + intercept, so
 *   stintTime  = Σ_{k=0..T-1} (slope × k + intercept)
 *   ∂stintTime/∂slope = Σ_{k=0..T-1} k = T(T−1)/2
 *   var(stintTime)    = (T(T−1)/2)² × σ_effective²
 * where σ_effective² = slopeStdError² + TRACK_EVOLUTION_SLOPE_UNCERTAINTY².
 *
 * Stint variances are summed under the assumption of independence across
 * stints (and across strategies, when propagating the delta uncertainty as
 * √(var_alt + var_actual)). This is a documented approximation: residual
 * correlation can exist (shared track conditions, shared regression noise),
 * but the band is meant as an indicative ± envelope, not a strict CI.
 *
 * When slopeStdError is null for a compound we still contribute the
 * track-evolution term and signal reduced reliability via `missingStdError`.
 */
export function computeStrategyDeltaUncertainty(
  stintBounds: StintBoundForUncertainty[],
  compoundModels: Map<string, { slopeStdError: number | null }>,
): { stdDev: number; missingStdError: boolean } {
  let variance = 0;
  let missing = false;
  const sysSq = TRACK_EVOLUTION_SLOPE_UNCERTAINTY * TRACK_EVOLUTION_SLOPE_UNCERTAINTY;
  for (const sb of stintBounds) {
    const T = Math.max(0, sb.end - sb.start + 1);
    if (T <= 1) continue;
    const sensitivity = (T * (T - 1)) / 2; // = Σ tyre_life over the stint
    const m = compoundModels.get(sb.compound);
    const stat = m?.slopeStdError;
    let statSq = 0;
    if (stat != null && Number.isFinite(stat) && stat > 0) {
      statSq = stat * stat;
    } else {
      missing = true;
    }
    const sigmaSq = statSq + sysSq;
    variance += sensitivity * sensitivity * sigmaSq;
  }
  return { stdDev: Math.sqrt(variance), missingStdError: missing };
}






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
  lapWorkEstimates?: LapWorkEstimate[],
  totalEstimatedWork?: number,
  allSessionLaps?: Lap[],
): VirtualRaceEngineerResult | null {
  if (!stints.length || !laps.length) {
    console.warn("[VRE] returning null:", "missing stints or laps");
    return null;
  }

  // Narrative collector — accumulates structured events for migrated categories.
  // Declared early because alt.* migrations (categories: traffic, neutralization,
  // warmup, robustness, ...) live in upstream blocks. Render is invoked at the
  // end of the pipeline. Dual-push approach: migrated sites push both to the
  // legacy array (narrativeInsights / alt.pros|cons) AND to the collector to
  // keep snapshot output bit-identical during the incremental refactor.
  const narrativeCollector = new NarrativeCollector();

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
  // Trim della coda neutralizzata di fine gara (vedi computeEffectiveLastLap):
  // evita che i giri sotto SC/VSC/RED finali gonfino lunghezza stint e degrado.
  const totalLaps = computeEffectiveLastLap(maxLapNumber, trackStatusMapRaw);

  // Representative track temperature at race start (used by the first-stint
  // tyre warmup model). Falls back to undefined if no valid sample exists,
  // which disables the temperature factor (neutral 1.0).
  const trackTempAtStart: number | undefined = (() => {
    for (const w of weather) {
      if (w && Number.isFinite(w.track_temperature)) return w.track_temperature;
    }
    return undefined;
  })();


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
    undefined,
    (lapWorkEstimates && totalEstimatedWork != null)
      ? { lapWorkEstimates, totalEstimatedWork }
      : undefined,
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

  // ── 1c. Lapped-traffic detection & cost estimate ──
  // Optional: only when the caller passes the full-session laps. When absent,
  // `lappedTrafficResult` stays undefined and behavior is bit-identical to the
  // pre-change baseline (no snapshot should move). INFORMATIONAL ONLY: the
  // cost is NOT applied to any strategic score or counterfactual — the only
  // strategic effect is excluding encounter laps from the pace-loss windows.
  let lappedTrafficResult: LappedTrafficResult | undefined;
  if (allSessionLaps && allSessionLaps.length > 0) {
    try {
      lappedTrafficResult = detectLappedTraffic({
        allSessionLaps,
        driverLaps: laps,
        driverNumber,
        stints,
        raceControl,
        weatherMap,
        trackStatusMap,
        battleContext: earlyBattleCtx,
      });
    } catch (err) {
      // best-effort — never break VRE, but keep diagnostics visible: silent
      // catches have masked root causes in the past.
      console.warn(`[VRE] detectLappedTraffic failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const lappedEncounterLapsForPaceLoss = lappedTrafficResult?.encounter_lap_numbers ?? null;

  const paceLossResults = computeAllStintPaceLoss(
    driverCumDev, stints, earlyBattleCtx, weatherMap, trackStatusMap,
    undefined, lappedEncounterLapsForPaceLoss,
  );
  const plDegAdj = paceLossDegradationAdjustment(paceLossResults);
  const plCliffMult = paceLossCliffMultiplier(paceLossResults);
  const plPitShift = paceLossPitUrgencyShift(paceLossResults);

  // ── 2. Simulate strategies ──

  // Build a simple lap time predictor per compound (race data first)
  const compoundModels = new Map<string, { slope: number; intercept: number; source: string; slopeStdError: number | null }>();
  const compoundCandidateBest = new Map<string, CompoundModelCandidate>();
  for (const sa of stintAnalyses) {
    const model = degradationModels.get(sa.stint_number);
    if (!model) continue;
    const dv = degradationValidations.find(v => v.original.stint === sa.stint_number);
    if (!dv) continue;
    const candidate: CompoundModelCandidate = {
      status: dv.status,
      rSquared: dv.original.rSquared,
      lapsUsed: dv.original.lapsUsed,
    };
    const existing = compoundCandidateBest.get(sa.compound);
    if (!existing || isBetterCompoundModel(candidate, existing)) {
      // Resolve slopeStdError from the underlying DegradationResult, preferring
      // the corrected stage-B std error when available (matches the convention
      // used by degradationValidation.ts for t-stat computation).
      const orig = dv.original as DegradationResult & { slope_corrected_std_error?: number | null };
      const corrSe = orig.slope_corrected_std_error;
      const rawSe = orig.slopeStdError;
      const resolvedSe =
        (corrSe != null && Number.isFinite(corrSe) && corrSe > 0) ? corrSe :
        (rawSe != null && Number.isFinite(rawSe) && rawSe > 0) ? rawSe :
        null;
      compoundModels.set(sa.compound, { ...model, source: "race", slopeStdError: resolvedSe });
      compoundCandidateBest.set(sa.compound, candidate);
    }
  }

  // Enrich with practice compound models (only add compounds not already from race).
  // SLOPE-ONLY SEMANTICS: memorizziamo il modello practice con il suo intercept
  // GREZZO (nessun rebase al passo gara). L'intercept grezzo NON viene mai usato
  // dalle simulazioni: quando una strategia candidata usa un compound practice,
  // il chiamante costruisce un `interceptOverrideByStint` che àncora il passo
  // base al compound di gara realmente usato in quella posizione della strategia
  // reale, e passa l'override a `simulateStrategyCost` / `simulateTimeRaw`.
  // In questo modo si conserva SOLO la differenza di degrado (slope) stimata
  // dalle prove libere, eliminando la dipendenza arbitraria dal primo modello
  // race nell'ordine di inserzione della Map.
  const practiceCompoundsUsed: string[] = [];
  // Slope di degrado minimo plausibile (s/giro) perche' un modello derivato dalle
  // prove libere sia usabile come estrapolazione di uno stint di gara. I long-run
  // di Practice sono corti e contaminati dal warmup gomma (i primi giri a gomma
  // fredda sembrano "in miglioramento"), quindi la regressione lineare puo'
  // produrre uno slope NEGATIVO o quasi-nullo — implausibile come degrado di gara.
  // Esteso su un intero stint, un tale modello rende il compound apparentemente
  // imbattibile e genera un delta strategico assurdo (poi tagliato dal cap).
  const MIN_PRACTICE_DEG_SLOPE = 0.04; // s/giro
  for (const pm of practiceModels) {
    if (!compoundModels.has(pm.compound) && pm.rSquared > 0.3 && pm.slope >= MIN_PRACTICE_DEG_SLOPE) {
      compoundModels.set(pm.compound, {
        slope: pm.slope,
        intercept: pm.intercept, // raw — never used without override (see above)
        source: pm.source,
        // Practice models do not currently expose a slope std error → null.
        // Uncertainty propagation falls back to the systematic
        // TRACK_EVOLUTION_SLOPE_UNCERTAINTY term only.
        slopeStdError: null,
      });
      practiceCompoundsUsed.push(pm.compound);
    }
  }


  // F1 regulation: at least 2 different compounds must be used during a dry race
  function hasMinTwoCompounds(compounds: string[]): boolean {
    const valid = compounds.filter(c => c && c !== "UNKNOWN");
    return new Set(valid).size >= 2;
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
  // Values are read from the shared NEUTRALIZATION_PIT_LOSS constant
  // (single source of truth, also used by SCENARIO_DEFINITIONS).

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
    if (status === "SC") return NEUTRALIZATION_PIT_LOSS.SC;
    if (status === "VSC") return NEUTRALIZATION_PIT_LOSS.VSC;
    if (status === "MIXED") return NEUTRALIZATION_PIT_LOSS.MIXED;
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
    const CLIFF_PENALTY_MAX = 25; // tetto (s): oltre il cliff il pilota rallenta o si ferma, non perde tempo all'infinito
    const raw = excessLaps * excessLaps * riskBase.cliff_penalty * plCliffMult; // pace loss cliff multiplier
    return Math.min(raw, CLIFF_PENALTY_MAX);
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

  // Full cost function: simulates total adjusted race time.
  // `interceptOverrideByStint` (optional): allineato posizionalmente a
  // `stintBounds`. Quando presente e non-null per lo stint `si`, il valore
  // sostituisce `model.intercept` come passo base di quello stint. Slope,
  // warmup, cliff, pit costs e ogni altro contributo restano invariati. Con
  // parametro assente il comportamento e' bit-identico alla versione precedente
  // (usato dalla slope-only semantics per i compound derivati dalle prove libere).
  function simulateStrategyCost(
    pitLapsArr: number[],
    compoundsArr: string[],
    interceptOverrideByStint?: (number | null)[],
  ): number | null {
    if (!hasMinTwoCompounds(compoundsArr)) {
      console.warn("[VRE] returning null:", "simulateStrategyCost requires at least two compounds");
      return null;
    }
    const stintBounds = buildStintBounds(pitLapsArr, compoundsArr);

    let totalCost = 0;

    for (let si = 0; si < stintBounds.length; si++) {
      const sb = stintBounds[si];
      const model = compoundModels.get(sb.compound);
      if (!model) {
        console.warn("[VRE] returning null:", `simulateStrategyCost missing model for ${sb.compound}`);
        return null;
      }
      const interceptOverride = interceptOverrideByStint?.[si];
      const stintLength = sb.end - sb.start + 1;
      const isFirstStint = si === 0;
      for (let lap = sb.start; lap <= sb.end; lap++) {
        const tyreLife = lap - sb.start;
        const baseLap = (interceptOverride != null && Number.isFinite(interceptOverride)) ? interceptOverride : model.intercept;
        // Clamp della perdita di degrado per-giro: le gomme reali plateauano,
        // non degradano linearmente all'infinito. Evita che slope ripidi
        // (spesso contaminati da battaglie/traffico) gonfino stint lunghi.
        const MAX_DEG_LOSS_PER_LAP = 3.5; // s/giro sopra il passo base
        const rawDegLap = model.slope * tyreLife * lapDegradationMult(lap);
        const degLap = Math.min(rawDegLap, MAX_DEG_LOSS_PER_LAP);
        // Tyre warmup penalty: temporary time loss in first laps after pit.
        // First stint uses a reduced "start warmup" (formation lap pre-heats
        // the tyres but cold tracks/Hard still cost time).
        const warmupPenalty = isFirstStint
          ? computeTyreWarmupPenalty(sb.compound, tyreLife) * START_WARMUP_FRACTION * computeStartWarmupTempFactor(trackTempAtStart)
          : computeTyreWarmupPenalty(sb.compound, tyreLife);

        totalCost += baseLap + degLap + warmupPenalty;
      }
      // Start traction/launch penalty: applied ONCE to the first stint. Harder
      // starting compounds lose time off the line / lap 1 (distinct from thermal
      // warmup), amplified on cold tracks. SOFT = reference (0).
      if (isFirstStint) {
        totalCost += computeStartTractionPenalty(sb.compound, trackTempAtStart);
      }
      // Cliff risk for this stint
      totalCost += cliffPenalty(stintLength, sb.compound);
    }

    // Pit costs with per-lap scenario modifier
    for (const pl of pitLapsArr) {
      totalCost += effectivePitLoss(pl);
      totalCost += estimateTrafficCost(pl);

      // ── Scenario neutralization/opportunity bonus ──────────────────
      // When a simulated neutralization scenario (SC/VSC/RAIN/etc.) is
      // active AND the pit falls inside the scenario window, reward the
      // candidate with a strategic bonus that scales with how much the
      // scenario's neutralization_weight / opportunity_weight exceed 1.0.
      // This is the strategic reason a pit under SC is attractive — without
      // it, simulateStrategyCost only saw the pit_loss_multiplier (already
      // applied inside effectivePitLoss) and underweighted SC scenarios.
      //
      // Bonus is SUBTRACTED from totalCost (not multiplied into pit loss)
      // to avoid double-counting with effectivePitLoss.
      // Realistic order of magnitude: an opportunistic SC pit is worth
      // ~5-15s of strategic advantage → base ~8s × sum(weight − 1), clamped.
      if (isSimulatedScenario(effectiveScenarioId) && isInScenarioWindow(pl)) {
        const NEUTRALIZATION_PIT_BONUS_BASE = 8.0; // seconds per (weight − 1) unit
        const NEUTRALIZATION_PIT_BONUS_MAX = 15.0; // hard clamp (s)
        const neutExcess = Math.max(0, scenarioMods.neutralization_weight - 1.0);
        const oppExcess = Math.max(0, scenarioMods.opportunity_weight - 1.0);
        const bonus = Math.min(
          NEUTRALIZATION_PIT_BONUS_MAX,
          NEUTRALIZATION_PIT_BONUS_BASE * (neutExcess + oppExcess),
        );
        totalCost -= bonus;
      }
    }

    // Opportunity modifier for aggressive mode: bonus for fewer pit stops
    if (riskBase.opportunity > 1.0 && pitLapsArr.length < actualPitLaps.length) {
      totalCost -= (actualPitLaps.length - pitLapsArr.length) * 2.0 * (riskBase.opportunity - 1.0);
    }

    return totalCost;
  }

  // Simple raw time (with observed neutralisation-aware pit loss) for delta calculation baseline
  function simulateTimeRaw(
    pitLapsArr: number[],
    compoundsArr: string[],
    forActualStrategy: boolean = false,
    interceptOverrideByStint?: (number | null)[],
  ): number | null {
    if (!hasMinTwoCompounds(compoundsArr)) {
      console.warn("[VRE] returning null:", "simulateTimeRaw requires at least two compounds");
      return null;
    }
    const stintBounds = buildStintBounds(pitLapsArr, compoundsArr);
    let total = 0;
    for (let si = 0; si < stintBounds.length; si++) {
      const sb = stintBounds[si];
      const model = compoundModels.get(sb.compound);
      if (!model) {
        console.warn("[VRE] returning null:", `simulateTimeRaw missing model for ${sb.compound}`);
        return null;
      }
      const interceptOverride = interceptOverrideByStint?.[si];
      const baseIntercept = (interceptOverride != null && Number.isFinite(interceptOverride)) ? interceptOverride : model.intercept;
      const isFirstStint = si === 0;
      for (let lap = sb.start; lap <= sb.end; lap++) {
        const tyreLife = lap - sb.start;
        const warmupPenalty = isFirstStint
          ? computeTyreWarmupPenalty(sb.compound, tyreLife) * START_WARMUP_FRACTION * computeStartWarmupTempFactor(trackTempAtStart)
          : computeTyreWarmupPenalty(sb.compound, tyreLife);

        const MAX_DEG_LOSS_PER_LAP = 3.5;
        const degRaw = model.slope * tyreLife;
        const degClamped = Math.min(degRaw, MAX_DEG_LOSS_PER_LAP);
        total += baseIntercept + degClamped + warmupPenalty;
      }
      if (isFirstStint) {
        total += computeStartTractionPenalty(sb.compound, trackTempAtStart);
      }
    }
    // Use neutralisation-aware pit loss for each pit lap
    for (const pl of pitLapsArr) {
      total += pitLoss * getObservedPitLossMultiplier(pl, forActualStrategy);
    }
    return total;
  }

  const actualCompounds = stints.map(s => s.compound ?? "UNKNOWN");
  const actualPitLaps = pitStops.map(p => p.lap_number);
  const actualSimTime = simulateTimeRaw(actualPitLaps, actualCompounds, true);
  const actualAdjustedTime = simulateStrategyCost(actualPitLaps, actualCompounds);

  // SLOPE-ONLY OVERRIDE HELPER — see the "Enrich with practice compound models"
  // block for the semantic rationale. For each stint of the candidate strategy
  // whose compound has a non-race model source (i.e. Practice), we override the
  // simulation intercept with the intercept of the RACE model of the compound
  // realmente usato in quella posizione della strategia reale. Stint aggiuntivo
  // (ramo N+1) → intercept del compound dello stint che e' stato diviso. Race
  // compounds → nessun override. Ritorna undefined quando nessun compound
  // candidato e' practice, mantenendo bit-identico il percorso race-only.
  const PRACTICE_ASSUMPTION_CON =
    "Passo base della mescola practice assunto pari alla mescola sostituita: mancano dati di passo gara per questo compound, il delta riflette solo la differenza di degrado stimata dalle prove libere.";
  const buildInterceptOverride = (
    candidateCompounds: string[],
    splitCompound?: string,
  ): (number | null)[] | undefined => {
    let hasPractice = false;
    const out: (number | null)[] = candidateCompounds.map((c, i) => {
      const m = compoundModels.get(c);
      if (!m || m.source === "race") return null;
      hasPractice = true;
      const anchorCompound = i < actualCompounds.length ? actualCompounds[i] : splitCompound;
      if (!anchorCompound) return null;
      const raceModel = compoundModels.get(anchorCompound);
      if (!raceModel || raceModel.source !== "race") return null;
      return raceModel.intercept;
    });
    return hasPractice ? out : undefined;
  };
  const candidateUsesPractice = (candidateCompounds: string[]): boolean =>
    candidateCompounds.some(c => {
      const m = compoundModels.get(c);
      return !!m && m.source !== "race";
    });

  // Diagnose why the alternative-strategies engine cannot run when actual
  // simulation times are null. Distinguishes (a) actual strategy violating the
  // two-compound rule from (b) missing degradation models for actual compounds.
  // The message is later surfaced via confidence_factors AND narrative_insights.
  let alternativesUnavailableReason: string | null = null;
  if (actualAdjustedTime == null || actualSimTime == null) {
    if (!hasMinTwoCompounds(actualCompounds)) {
      alternativesUnavailableReason =
        "la strategia reale non soddisfa la regola dei due compound validi, quindi nessuna alternativa può essere simulata coerentemente.";
    } else {
      const missing = [...new Set(actualCompounds.filter(c => !compoundModels.has(c)))];
      if (missing.length > 0) {
        alternativesUnavailableReason =
          `nessun modello di degrado affidabile è disponibile per la mescola ${missing.join(", ")} usata dalla strategia reale (stint troppo corti o contaminati), quindi non è possibile simulare strategie alternative.`;
      } else {
        alternativesUnavailableReason =
          "il modello di simulazione della strategia reale non è disponibile, quindi non è possibile confrontare alternative.";
      }
    }
  }

  // ── 3. Find optimal pit window (using risk-adjusted scoring) ──
  const recommendedWindows: RecommendedStrategy["pit_windows"] = [];
  let bestDelta = 0;
  let bestPitLaps = actualPitLaps;
  let bestCompounds = actualCompounds;
  let bestReason = "Strategia reale già vicina all'ottimale";
  let recommendedInitialClampRaw: number | null = null;

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

          const t = simulateStrategyCost(candidatePits, compounds, buildInterceptOverride(compounds));
          if (t != null && t < bestTime) {
            bestTime = t;
            bestPitLaps = candidatePits;
            bestCompounds = compounds;
            bestDelta = actualAdjustedTime! - t;
          }
        }
      }
    }

    // Clamp di plausibilita': un guadagno strategico realistico su una gara
    // intera e' nell'ordine di ~2.5x il pit loss (rimpiazzare un timing di pit
    // sub-ottimale), non centinaia di secondi. Delta superiori indicano
    // estrapolazione di modelli di degrado contaminati, non una strategia reale.
    const MAX_PLAUSIBLE_DELTA = pitLoss * 2.5;
    if (bestDelta > MAX_PLAUSIBLE_DELTA) {
      recommendedInitialClampRaw = bestDelta;
      bestDelta = MAX_PLAUSIBLE_DELTA;
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
  if (recommendedInitialClampRaw != null) {
    recommendedStrategy.delta_clamped = true;
    recommendedStrategy.raw_gain_seconds = Math.round(recommendedInitialClampRaw * 10) / 10;
  }
  // NOTE: PRACTICE_ASSUMPTION_CON is added later, in the enrichment block that
  // assigns `recommendedStrategy.cons = recCons`, and re-evaluated again AFTER
  // the multi-criteria promotion, since a promotion overwrites both compounds
  // and cons. See the two dedicated hooks below.

  // ── 4. Alternative strategies ──
  const alternatives: AlternativeStrategy[] = [];

  // Local helper: validate a candidate pit sequence with the same rules used by
  // the recommended-strategy search — strictly increasing, minimum spacing of
  // 3 laps, first pit ≥ 3, last pit ≤ totalLaps − 3. Prevents the undercut /
  // overcut / N+1 branches from producing duplicate or non-monotonic pits when
  // actual pits are close together.
  const isValidPitSequence = (pits: number[]): boolean => {
    if (pits.length === 0) return true;
    if (pits[0] < 3) return false;
    if (pits[pits.length - 1] > totalLaps - 3) return false;
    for (let i = 1; i < pits.length; i++) {
      if (pits[i] - pits[i - 1] < 3) return false;
    }
    return true;
  };

  if (actualPitLaps.length > 0 && actualSimTime != null && actualAdjustedTime != null) {
    // Undercut
    const undercutPits = actualPitLaps.map((p, i) => i === 0 ? Math.max(3, p - 3) : p);
    if (isValidPitSequence(undercutPits)) {
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
    }

    // Overcut
    const overcutPits = actualPitLaps.map((p, i) => i === 0 ? Math.min(totalLaps - 3, p + 3) : p);
    if (isValidPitSequence(overcutPits)) {
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
    }

    // Opposite compound if available (race compounds)
    const availableCompounds = [...new Set(actualCompounds)];
    if (availableCompounds.length >= 2) {
      const reversed = [...actualCompounds].reverse();
      // BUGFIX: skip when the reversed sequence coincides with the real one
      // (palindromic compounds → alternative identical to actual, delta ≈ 0).
      if (reversed.join(",") !== actualCompounds.join(",")) {
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
    }

    // Practice-derived compound alternatives
    for (const practiceCompound of practiceCompoundsUsed) {
      const raceCompoundsSet = new Set(actualCompounds);
      if (raceCompoundsSet.has(practiceCompound)) continue;

      // Try substituting the last stint compound with the practice compound
      if (actualCompounds.length >= 2) {
        const altCompounds = [...actualCompounds];
        altCompounds[altCompounds.length - 1] = practiceCompound;
        const altTime = simulateStrategyCost(actualPitLaps, altCompounds, buildInterceptOverride(altCompounds));
        if (altTime != null) {
          alternatives.push({
            name: `Stint finale su ${practiceCompound}`,
            description: `Ultimo stint con ${practiceCompound} (dati da Practice) invece di ${actualCompounds[actualCompounds.length - 1]}`,
            pit_laps: actualPitLaps,
            compounds: altCompounds,
            estimated_delta_vs_actual: Math.round((actualAdjustedTime - altTime) * 10) / 10,
            time_delta_vs_actual: -Math.round((actualAdjustedTime - altTime) * 10) / 10,
            pros: [`Degrado ${practiceCompound} stimato dalle prove libere`, "Compound alternativo non usato in gara"],
            cons: [PRACTICE_ASSUMPTION_CON, "Condizioni pista differenti tra prove e gara"],
          });
        }
      }

      // Try substituting the first stint compound
      if (actualCompounds.length >= 2) {
        const altCompounds = [...actualCompounds];
        altCompounds[0] = practiceCompound;
        const altTime2 = simulateStrategyCost(actualPitLaps, altCompounds, buildInterceptOverride(altCompounds));
        if (altTime2 != null) {
          alternatives.push({
            name: `Stint iniziale su ${practiceCompound}`,
            description: `Primo stint con ${practiceCompound} (dati da Practice) invece di ${actualCompounds[0]}`,
            pit_laps: actualPitLaps,
            compounds: altCompounds,
            estimated_delta_vs_actual: Math.round((actualAdjustedTime - altTime2) * 10) / 10,
            time_delta_vs_actual: -Math.round((actualAdjustedTime - altTime2) * 10) / 10,
            pros: [`Degrado ${practiceCompound} stimato dalle prove libere`, "Scelta strategica diversa all'inizio"],
            cons: [PRACTICE_ASSUMPTION_CON, "Condizioni pista e carburante differenti"],
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
        // BUGFIX: validate the resulting sequence (strictly increasing, ≥3 laps
        // spacing) — skip the whole N+1 branch if the extra split collides with
        // real pits, otherwise we would emit non-monotonic pit sequences.
        if (isValidPitSequence(extraPits)) {
          for (const extraCompound of [...compoundModels.keys()]) {
            const extraCompounds: string[] = [];
            for (let si = 0; si <= extraPits.length; si++) {
              if (si < actualCompounds.length) extraCompounds.push(actualCompounds[si]);
              else extraCompounds.push(extraCompound);
            }
            while (extraCompounds.length > extraPits.length + 1) extraCompounds.pop();
            if (!hasMinTwoCompounds(extraCompounds)) continue;
            const extraOverride = buildInterceptOverride(extraCompounds, longestStint.compound);
            const extraTime = simulateStrategyCost(extraPits, extraCompounds, extraOverride);
            if (extraTime != null) {
              const extraCons = ["Pit stop aggiuntivo", "Maggiore esposizione al traffico"];
              if (candidateUsesPractice(extraCompounds)) extraCons.push(PRACTICE_ASSUMPTION_CON);
              alternatives.push({
                // BUGFIX: include the added compound in the name so the N+1
                // siblings are distinguishable (name collisions previously
                // caused scoring lookup collisions in the ranking).
                name: `${extraPits.length}-stop (${extraCompound})`,
                description: `Pit ai giri ${extraPits.join(", ")} (${extraCompounds.join(" → ")})`,
                pit_laps: extraPits,
                compounds: extraCompounds,
                estimated_delta_vs_actual: Math.round((actualAdjustedTime - extraTime) * 10) / 10,
                time_delta_vs_actual: -Math.round((actualAdjustedTime - extraTime) * 10) / 10,
                pros: ["Stint più corti = meno degrado", "Vantaggio se pit loss ridotto (SC)"],
                cons: extraCons,
              });
            }
          }
        }
      }
    }

    // ── 4a-extra-bis. Reduced-stops strategies (N-1, down to legal minimum) ──
    // Generates counterfactuals with FEWER stops than actual. Always preserves the
    // two-compound rule; relies on the existing simulateStrategyCost (which applies
    // MAX_DEG_LOSS_PER_LAP clamp + capped cliffPenalty) and on the downstream
    // uncertainty pipeline (stdDev grows with stint length → reduced-stop band
    // widens automatically). No new heuristics introduced.
    if (actualPitLaps.length >= 2 && actualAdjustedTime != null) {
      // Observed max stint length per compound (real race) → extrapolation distance.
      const observedMaxByCompound = new Map<string, number>();
      for (const s of stintAnalyses) {
        const cur = observedMaxByCompound.get(s.compound) ?? 0;
        if (s.laps_count > cur) observedMaxByCompound.set(s.compound, s.laps_count);
      }

      type RedCand = { pits: number[]; comps: string[]; time: number; mergedLen: number; mergedCompound: string };

      const reduceOnce = (pits: number[], comps: string[]): RedCand | null => {
        let best: RedCand | null = null;
        for (let k = 0; k < pits.length; k++) {
          const newPits = pits.filter((_, i) => i !== k);
          // For the fused stint we evaluate both adjacent compounds and keep the
          // best legal time. Drop comps[k+1] → fused stint uses comps[k]; drop
          // comps[k] → fused stint uses comps[k+1].
          const candComps: string[][] = [comps.filter((_, i) => i !== k + 1)];
          if (comps[k] !== comps[k + 1]) candComps.push(comps.filter((_, i) => i !== k));
          for (const newComps of candComps) {
            if (!hasMinTwoCompounds(newComps)) continue;
            const t = simulateStrategyCost(newPits, newComps);
            if (t == null) continue;
            if (!best || t < best.time) {
              const prevPit = k === 0 ? 0 : pits[k - 1];
              const nextPit = k + 1 < pits.length ? pits[k + 1] : totalLaps;
              const mergedLen = nextPit - prevPit;
              const mergedCompound = newComps[k];
              best = { pits: newPits, comps: newComps, time: t, mergedLen, mergedCompound };
            }
          }
        }
        return best;
      };

      const reducedCandidates: RedCand[] = [];
      const nMinus1 = reduceOnce(actualPitLaps, actualCompounds);
      if (nMinus1) reducedCandidates.push(nMinus1);

      // Iterate down to legal minimum (1 stop, still 2 compounds) if we started with ≥3.
      if (actualPitLaps.length >= 3 && nMinus1) {
        let cur = nMinus1;
        while (cur.pits.length > 1) {
          const next = reduceOnce(cur.pits, cur.comps);
          if (!next) break;
          cur = next;
        }
        if (cur.pits.length < nMinus1.pits.length) reducedCandidates.push(cur);
      }

      for (const cand of reducedCandidates) {
        const observedMax = observedMaxByCompound.get(cand.mergedCompound) ?? 0;
        const overLaps = Math.max(0, cand.mergedLen - observedMax);
        const cliffThreshold = CLIFF_THRESHOLDS[cand.mergedCompound] ?? CLIFF_THRESHOLD_DEFAULT;
        const cliffRisk = cand.mergedLen > cliffThreshold;

        const cons: string[] = [
          "Una sosta in meno: lo stint risultante è più lungo di qualunque stint realmente percorso in gara",
        ];
        if (overLaps > 0) {
          cons.push(`Stint esteso di ${overLaps} giri oltre il massimo osservato (${observedMax} giri su ${cand.mergedCompound}): stima del degrado in estrapolazione, meno affidabile`);
        } else {
          cons.push("Stima del degrado nel finale del long stint meno affidabile (estrapolazione del modello oltre il range osservato)");
        }
        if (cliffRisk) {
          cons.push(`Rischio cliff/degrado non lineare: stint da ${cand.mergedLen} giri su ${cand.mergedCompound} oltre la soglia di cliff (~${cliffThreshold} giri)`);
        }

        const pros: string[] = [
          `Una sosta in meno: risparmio di un pit loss completo (~${pitLoss.toFixed(1)}s) ed esposizione ridotta al traffico ai box`,
        ];

        const desc = `Pit ai giri ${cand.pits.join(", ")} (${cand.comps.join(" → ")})`;

        alternatives.push({
          name: `${cand.pits.length}-stop`,
          description: desc,
          pit_laps: cand.pits,
          compounds: cand.comps,
          estimated_delta_vs_actual: Math.round((actualAdjustedTime - cand.time) * 10) / 10,
          time_delta_vs_actual: -Math.round((actualAdjustedTime - cand.time) * 10) / 10,
          pros,
          cons,
        });
      }
    }
  }

  // ── 4b. Traffic Release Predictor ──
  const allLapsMap = allLapsMapEarly;

  // Attach traffic predictions and warmup analysis to alternatives
  for (let altIdx = 0; altIdx < alternatives.length; altIdx++) {
    const alt = alternatives[altIdx];
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
        const text = `Rientro in traffico pesante (−${trafficLoss.toFixed(1)}s stimati)`;
        narrativeCollector.add({ id: `traffic_heavy_alt${altIdx}`, category: "traffic", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { traffic_loss: trafficLoss, level: "HEAVY" }, prerendered_text: text });
      } else if (worstTraffic === "LIGHT") {
        const text = `Rientro in traffico leggero (−${trafficLoss.toFixed(1)}s stimati)`;
        narrativeCollector.add({ id: `traffic_light_alt${altIdx}`, category: "traffic", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { traffic_loss: trafficLoss, level: "LIGHT" }, prerendered_text: text });
      } else if (worstTraffic === "CLEAN") {
        const text = "Rientro in aria pulita";
        narrativeCollector.add({ id: `traffic_clean_alt${altIdx}`, category: "traffic", priority: "supporting", target: "alternative", target_index: altIdx, side: "pro", data: { level: "CLEAN" }, prerendered_text: text });
      }

      // Traffic metadata enrichment: release classification, pack risk, persistence
      for (const tp of altTraffic) {
        // Release classification (CLEAN / TRAFFIC / PACK)
        if (tp.release_classification === "PACK") {
          const text = `Rientro dentro un pack al giro ${tp.pit_lap} (${tp.pack_size_ahead ?? "?"} vetture davanti, ${tp.pack_size_behind ?? "?"} dietro)`;
          narrativeCollector.add({ id: `traffic_pack_alt${altIdx}_lap${tp.pit_lap}`, category: "traffic", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", lap: tp.pit_lap, data: { pit_lap: tp.pit_lap, pack_size_ahead: tp.pack_size_ahead, pack_size_behind: tp.pack_size_behind, release_classification: "PACK" }, prerendered_text: text });
          break;
        }
        if (tp.release_classification === "TRAFFIC") {
          if (tp.release_quality === "POOR" || tp.release_quality === "MARGINAL") {
            const text = `Qualità release al giro ${tp.pit_lap}: ${tp.release_quality === "POOR" ? "scarsa" : "marginale"}${tp.compressed_train_risk === "HIGH" ? " — rischio trenino compresso" : ""}`;
            narrativeCollector.add({ id: `traffic_release_alt${altIdx}_lap${tp.pit_lap}`, category: "traffic", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", lap: tp.pit_lap, data: { pit_lap: tp.pit_lap, release_quality: tp.release_quality, compressed_train_risk: tp.compressed_train_risk }, prerendered_text: text });
            break;
          }
        }
        // Traffic persistence
        const persistLaps = tp.traffic_persistence_laps ?? tp.estimated_traffic_laps;
        if (persistLaps > 3) {
          const text = `Traffico persistente: ~${persistLaps} giri bloccato in aria sporca dopo il pit al giro ${tp.pit_lap}`;
          narrativeCollector.add({ id: `traffic_persist_alt${altIdx}_lap${tp.pit_lap}`, category: "traffic", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", lap: tp.pit_lap, data: { pit_lap: tp.pit_lap, persist_laps: persistLaps }, prerendered_text: text });
          break;
        }
        // Stuck risk
        if ((tp.stuck_risk_score ?? 0) > 0.7) {
          const text = `Rischio elevato di restare bloccato dopo il pit al giro ${tp.pit_lap} (stuck score: ${((tp.stuck_risk_score ?? 0) * 100).toFixed(0)}%)`;
          narrativeCollector.add({ id: `traffic_stuck_alt${altIdx}_lap${tp.pit_lap}`, category: "traffic", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", lap: tp.pit_lap, data: { pit_lap: tp.pit_lap, stuck_risk_score: tp.stuck_risk_score ?? 0 }, prerendered_text: text });
          break;
        }
      }

      // Prediction confidence warning
      const lowConfTraffic = altTraffic.filter(tp => tp.prediction_confidence === "LOW");
      if (lowConfTraffic.length > 0) {
        const text = "Previsione traffico a bassa confidenza — dati posizione/intervalli insufficienti";
        narrativeCollector.add({ id: `traffic_low_conf_alt${altIdx}`, category: "traffic", priority: "context", target: "alternative", target_index: altIdx, side: "con", data: { low_conf_count: lowConfTraffic.length }, prerendered_text: text });
      }
    }

    // Warmup cost analysis per alternative (simulated only)
    const altStintBounds = buildStintBounds(alt.pit_laps, alt.compounds);
    let altWarmupTotal = 0;
    for (let si = 0; si < altStintBounds.length; si++) {
      altWarmupTotal += computeStintWarmupCost(altStintBounds[si].compound, si === 0, trackTempAtStart);
    }
    if (altWarmupTotal > 2.5) {
      const text = `Warmup elevato: ${altWarmupTotal.toFixed(1)}s persi per riscaldamento gomme`;
      narrativeCollector.add({ id: `warmup_high_alt${altIdx}`, category: "warmup", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { warmup_total: altWarmupTotal }, prerendered_text: text });
    }
    const hasHard = alt.compounds.some(c => (c ?? "").toUpperCase() === "HARD");
    if (hasHard && altWarmupTotal > 1.5) {
      const text = "Mescola Hard: warmup lento riduce efficacia undercut";
      narrativeCollector.add({ id: `warmup_hard_undercut_alt${altIdx}`, category: "warmup", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { warmup_total: altWarmupTotal, has_hard: true }, prerendered_text: text });
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
      true, trackTempAtStart,
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
      true, trackTempAtStart,
    );

  }


  // ── 4d. Enrich alternatives with advanced analysis ──
  const driverAvgPace = (() => {
    const validLaps = laps.filter(l => l.lap_duration != null && l.lap_duration > 0 && !l.is_pit_out_lap);
    if (validLaps.length === 0) {
      console.warn("[VRE] returning null:", "no valid laps for driver average pace");
      return null;
    }
    return validLaps.reduce((s, l) => s + l.lap_duration!, 0) / validLaps.length;
  })();

  for (let altIdx = 0; altIdx < alternatives.length; altIdx++) {
    const alt = alternatives[altIdx];
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
      const text = "Strategia fragile — sensibile a variazioni di degrado/traffico";
      narrativeCollector.add({ id: `robustness_fragile_alt${altIdx}`, category: "robustness", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { robustness_label: "FRAGILE" }, prerendered_text: text });
    } else if (alt.analysis.robustness.robustness_label === "ROBUST") {
      const text = "Strategia robusta — poco sensibile a variazioni";
      narrativeCollector.add({ id: `robustness_robust_alt${altIdx}`, category: "robustness", priority: "supporting", target: "alternative", target_index: altIdx, side: "pro", data: { robustness_label: "ROBUST" }, prerendered_text: text });
    }

    if (alt.analysis.competitor_context) {
      const cc = alt.analysis.competitor_context;
      if (cc.undercut_opportunity > 0.5) {
        const text = "Opportunità undercut significativa";
        narrativeCollector.add({ id: `competitor_undercut_opp_alt${altIdx}`, category: "competitor", priority: "supporting", target: "alternative", target_index: altIdx, side: "pro", data: { undercut_opportunity: cc.undercut_opportunity }, prerendered_text: text });
      }
      if (cc.undercut_risk > 0.5) {
        const text = "Rischio undercut da rivali";
        narrativeCollector.add({ id: `competitor_undercut_risk_alt${altIdx}`, category: "competitor", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { undercut_risk: cc.undercut_risk }, prerendered_text: text });
      }
      // Release classification-based insights
      if (cc.release_classification === "PACK" && cc.rejoin_in_pack) {
        const text = `Rientro strutturalmente dentro un pack — sorpasso multiplo necessario`;
        narrativeCollector.add({ id: `competitor_pack_rejoin_alt${altIdx}`, category: "competitor", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { release_classification: "PACK", rejoin_in_pack: true }, prerendered_text: text });
      }
      if ((cc.traffic_persistence_laps ?? 0) > 4) {
        const text = `Traffico persistente stimato: ~${cc.traffic_persistence_laps} giri prima di sbloccarsi`;
        narrativeCollector.add({ id: `competitor_traffic_persist_alt${altIdx}`, category: "competitor", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { traffic_persistence_laps: cc.traffic_persistence_laps }, prerendered_text: text });
      }
    }

    if (alt.analysis.overtake_difficulty && alt.analysis.overtake_difficulty.expected_laps_stuck > 3) {
      const text = `Difficoltà sorpasso: ~${alt.analysis.overtake_difficulty.expected_laps_stuck} giri bloccato in aria sporca (dirty air: −${alt.analysis.overtake_difficulty.dirty_air_penalty.toFixed(1)}s)`;
      narrativeCollector.add({ id: `overtake_diff_alt${altIdx}`, category: "overtake_difficulty", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { expected_laps_stuck: alt.analysis.overtake_difficulty.expected_laps_stuck, dirty_air_penalty: alt.analysis.overtake_difficulty.dirty_air_penalty }, prerendered_text: text });
    }

    if (alt.analysis.stint_extension && alt.analysis.stint_extension.cliff_risk_if_extend > 0.5) {
      const text = `Rischio cliff se si estende lo stint (${Math.round(alt.analysis.stint_extension.cliff_risk_if_extend * 100)}%)`;
      narrativeCollector.add({ id: `cliff_alt${altIdx}`, category: "cliff", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { cliff_risk_if_extend: alt.analysis.stint_extension.cliff_risk_if_extend }, prerendered_text: text, because_of: ["pace_loss_cliff_risk"] });
    }

    if (alt.analysis.pit_window && alt.analysis.pit_window.window_robustness === "FRAGILE") {
      const text = "Finestra pit fragile — il giro esatto è critico";
      narrativeCollector.add({ id: `pit_window_alt${altIdx}`, category: "pit_window", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { window_robustness: "FRAGILE" }, prerendered_text: text });
    }

    // Strategy intent (inferential, never blocks)
    alt.intent = classifyStrategyIntent(alt.analysis.competitor_context);

    // Position-aware ranking adjustment. Falls back to 0 when no competitor
    // context (empty intervals/positions) → no behavior change. Pure-pace
    // delta fields are intentionally NOT mutated.
    const posAdj = computePositionAdjustment(alt.analysis.competitor_context, riskMode);
    alt.position_score_adjustment = posAdj;
    const refTime = actualAdjustedTime ?? 0;
    alt.ranking_time_estimate = (refTime - alt.estimated_delta_vs_actual) + posAdj;
  }

  // ── 4d-bis. Propagate degradation-slope uncertainty into a ± band on the
  // alternative-vs-actual delta. Additive, informative — does NOT change
  // ranking or pure-pace fields. Approximations: stints inside a strategy
  // are treated as independent, and the alt and actual variances are added
  // as if independent (var(Δ) = var_alt + var_actual). See JSDoc on
  // computeStrategyDeltaUncertainty for the linear-propagation derivation
  // and the role of TRACK_EVOLUTION_SLOPE_UNCERTAINTY.
  const actualUnc = computeStrategyDeltaUncertainty(
    buildStintBounds(actualPitLaps, actualCompounds),
    compoundModels,
  );
  for (const alt of alternatives) {
    const altUnc = computeStrategyDeltaUncertainty(
      buildStintBounds(alt.pit_laps, alt.compounds),
      compoundModels,
    );
    const deltaStd = Math.sqrt(altUnc.stdDev * altUnc.stdDev + actualUnc.stdDev * actualUnc.stdDev);
    alt.delta_uncertainty_std = Math.round(deltaStd * 100) / 100;
    alt.indistinguishable_from_actual =
      Math.abs(alt.estimated_delta_vs_actual) < DELTA_SIGNIFICANCE_K * deltaStd;
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

    // Strategy intent for recommended (inferential)
    recommendedStrategy.intent = classifyStrategyIntent(recommendedStrategy.analysis.competitor_context);

    // Position-aware ranking adjustment for recommended (diagnostic; does not
    // mutate time_delta_vs_actual / estimated_gain_seconds).
    const recPosAdj = computePositionAdjustment(recommendedStrategy.analysis.competitor_context, riskMode);
    recommendedStrategy.position_score_adjustment = recPosAdj;
    const recRefTime = actualAdjustedTime ?? 0;
    recommendedStrategy.ranking_time_estimate = (recRefTime - recommendedStrategy.estimated_gain_seconds) + recPosAdj;

    // Enrich actual strategy with the same analysis layer to classify its intent.
    if (actualPitLaps.length > 0 && actualAdjustedTime != null) {
      const actualEnriched = enrichStrategyAnalysis(
        actualPitLaps, actualCompounds, 0,
        totalLaps, compoundModels as Map<string, { slope: number; intercept: number }>,
        pitLoss, trafficAvgBaseline, [],
        riskMode, effectiveScenarioId,
        intervals, positions, stints, allDrivers, driverNumber,
        simulateStrategyCost, driverAvgPace, actualPitLaps,
      );
      actualStrategy.analysis = actualEnriched;
      actualStrategy.intent = classifyStrategyIntent(actualEnriched.competitor_context);
    } else {
      actualStrategy.intent = classifyStrategyIntent(null);
    }

    // Pros / Cons
    const recPros: string[] = [];
    const recCons: string[] = [];

    // Robustness
    if (recommendedStrategy.analysis.robustness.robustness_label === "ROBUST") {
      const text = "Strategia robusta — poco sensibile a variazioni";
      narrativeCollector.add({ id: "robustness_robust_rec", category: "robustness", priority: "supporting", target: "recommended", side: "pro", data: { robustness_label: "ROBUST" }, prerendered_text: text });
    } else if (recommendedStrategy.analysis.robustness.robustness_label === "FRAGILE") {
      const text = "Strategia fragile — sensibile a variazioni di degrado/traffico";
      narrativeCollector.add({ id: "robustness_fragile_rec", category: "robustness", priority: "supporting", target: "recommended", side: "con", data: { robustness_label: "FRAGILE" }, prerendered_text: text });
    }

    // Competitor context
    if (recommendedStrategy.analysis.competitor_context) {
      const cc = recommendedStrategy.analysis.competitor_context;
      if (cc.undercut_opportunity > 0.5) {
        const text = "Opportunità undercut significativa";
        narrativeCollector.add({ id: "competitor_undercut_opp_rec", category: "competitor", priority: "supporting", target: "recommended", side: "pro", data: { undercut_opportunity: cc.undercut_opportunity }, prerendered_text: text });
      }
      if (cc.undercut_risk > 0.5) {
        const text = "Rischio undercut da rivali";
        narrativeCollector.add({ id: "competitor_undercut_risk_rec", category: "competitor", priority: "supporting", target: "recommended", side: "con", data: { undercut_risk: cc.undercut_risk }, prerendered_text: text });
      }
      if (cc.release_classification === "PACK" && cc.rejoin_in_pack) {
        const text = "Rientro strutturalmente dentro un pack — sorpasso multiplo necessario";
        narrativeCollector.add({ id: "competitor_pack_rejoin_rec", category: "competitor", priority: "supporting", target: "recommended", side: "con", data: { release_classification: "PACK", rejoin_in_pack: true }, prerendered_text: text });
      }
      if ((cc.traffic_persistence_laps ?? 0) > 4) {
        const text = `Traffico persistente stimato: ~${cc.traffic_persistence_laps} giri prima di sbloccarsi`;
        narrativeCollector.add({ id: "competitor_traffic_persist_rec", category: "competitor", priority: "supporting", target: "recommended", side: "con", data: { traffic_persistence_laps: cc.traffic_persistence_laps }, prerendered_text: text });
      }
    }

    // Overtake difficulty
    if (recommendedStrategy.analysis.overtake_difficulty && recommendedStrategy.analysis.overtake_difficulty.expected_laps_stuck > 3) {
      const text = `Difficoltà sorpasso: ~${recommendedStrategy.analysis.overtake_difficulty.expected_laps_stuck} giri bloccato in aria sporca (dirty air: −${recommendedStrategy.analysis.overtake_difficulty.dirty_air_penalty.toFixed(1)}s)`;
      narrativeCollector.add({ id: "overtake_diff_rec", category: "overtake_difficulty", priority: "supporting", target: "recommended", side: "con", data: { expected_laps_stuck: recommendedStrategy.analysis.overtake_difficulty.expected_laps_stuck, dirty_air_penalty: recommendedStrategy.analysis.overtake_difficulty.dirty_air_penalty }, prerendered_text: text });
    }

    // Stint extension / cliff
    if (recommendedStrategy.analysis.stint_extension && recommendedStrategy.analysis.stint_extension.cliff_risk_if_extend > 0.5) {
      const text = `Rischio cliff se si estende lo stint (${Math.round(recommendedStrategy.analysis.stint_extension.cliff_risk_if_extend * 100)}%)`;
      narrativeCollector.add({ id: "cliff_rec", category: "cliff", priority: "supporting", target: "recommended", side: "con", data: { cliff_risk_if_extend: recommendedStrategy.analysis.stint_extension.cliff_risk_if_extend }, prerendered_text: text, because_of: ["pace_loss_cliff_risk"] });
    }

    // Pit window robustness
    if (recommendedStrategy.analysis.pit_window && recommendedStrategy.analysis.pit_window.window_robustness === "FRAGILE") {
      const text = "Finestra pit fragile — il giro esatto è critico";
      narrativeCollector.add({ id: "pit_window_rec", category: "pit_window", priority: "supporting", target: "recommended", side: "con", data: { window_robustness: "FRAGILE" }, prerendered_text: text });
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
        const text = `Rientro in traffico pesante (−${trafficLoss.toFixed(1)}s stimati)`;
        narrativeCollector.add({ id: "traffic_heavy_rec", category: "traffic", priority: "supporting", target: "recommended", side: "con", data: { traffic_loss: trafficLoss, level: "HEAVY" }, prerendered_text: text });
      } else if (worstTraffic === "LIGHT") {
        const text = `Rientro in traffico leggero (−${trafficLoss.toFixed(1)}s stimati)`;
        narrativeCollector.add({ id: "traffic_light_rec", category: "traffic", priority: "supporting", target: "recommended", side: "con", data: { traffic_loss: trafficLoss, level: "LIGHT" }, prerendered_text: text });
      } else if (worstTraffic === "CLEAN") {
        const text = "Rientro in aria pulita";
        narrativeCollector.add({ id: "traffic_clean_rec", category: "traffic", priority: "supporting", target: "recommended", side: "pro", data: { level: "CLEAN" }, prerendered_text: text });
      }

      // Traffic metadata enrichment
      for (const tp of recTraffic) {
        if (tp.release_classification === "PACK") {
          const text = `Rientro dentro un pack al giro ${tp.pit_lap} (${tp.pack_size_ahead ?? "?"} vetture davanti, ${tp.pack_size_behind ?? "?"} dietro)`;
          narrativeCollector.add({ id: `traffic_pack_rec_lap${tp.pit_lap}`, category: "traffic", priority: "supporting", target: "recommended", side: "con", lap: tp.pit_lap, data: { pit_lap: tp.pit_lap, pack_size_ahead: tp.pack_size_ahead, pack_size_behind: tp.pack_size_behind, release_classification: "PACK" }, prerendered_text: text });
          break;
        }
        if (tp.release_classification === "TRAFFIC") {
          if (tp.release_quality === "POOR" || tp.release_quality === "MARGINAL") {
            const text = `Qualità release al giro ${tp.pit_lap}: ${tp.release_quality === "POOR" ? "scarsa" : "marginale"}${tp.compressed_train_risk === "HIGH" ? " — rischio trenino compresso" : ""}`;
            narrativeCollector.add({ id: `traffic_release_rec_lap${tp.pit_lap}`, category: "traffic", priority: "supporting", target: "recommended", side: "con", lap: tp.pit_lap, data: { pit_lap: tp.pit_lap, release_quality: tp.release_quality, compressed_train_risk: tp.compressed_train_risk }, prerendered_text: text });
            break;
          }
        }
        const persistLaps = tp.traffic_persistence_laps ?? tp.estimated_traffic_laps;
        if (persistLaps > 3) {
          const text = `Traffico persistente: ~${persistLaps} giri bloccato in aria sporca dopo il pit al giro ${tp.pit_lap}`;
          narrativeCollector.add({ id: `traffic_persist_rec_lap${tp.pit_lap}`, category: "traffic", priority: "supporting", target: "recommended", side: "con", lap: tp.pit_lap, data: { pit_lap: tp.pit_lap, persist_laps: persistLaps }, prerendered_text: text });
          break;
        }
        if ((tp.stuck_risk_score ?? 0) > 0.7) {
          const text = `Rischio elevato di restare bloccato dopo il pit al giro ${tp.pit_lap} (stuck score: ${((tp.stuck_risk_score ?? 0) * 100).toFixed(0)}%)`;
          narrativeCollector.add({ id: `traffic_stuck_rec_lap${tp.pit_lap}`, category: "traffic", priority: "supporting", target: "recommended", side: "con", lap: tp.pit_lap, data: { pit_lap: tp.pit_lap, stuck_risk_score: tp.stuck_risk_score ?? 0 }, prerendered_text: text });
          break;
        }
      }

      const lowConfTraffic = recTraffic.filter(tp => tp.prediction_confidence === "LOW");
      if (lowConfTraffic.length > 0) {
        const text = "Previsione traffico a bassa confidenza — dati posizione/intervalli insufficienti";
        narrativeCollector.add({ id: "traffic_low_conf_rec", category: "traffic", priority: "context", target: "recommended", side: "con", data: { low_conf_count: lowConfTraffic.length }, prerendered_text: text });
      }
    }

    // Warmup pros/cons
    const recStintBoundsForPC = buildStintBounds(bestPitLaps, bestCompounds);
    let recWarmupForPC = 0;
    for (let si = 0; si < recStintBoundsForPC.length; si++) {
      recWarmupForPC += computeStintWarmupCost(recStintBoundsForPC[si].compound, si === 0, trackTempAtStart);
    }
    if (recWarmupForPC > 2.5) {
      const text = `Warmup elevato: ${recWarmupForPC.toFixed(1)}s persi per riscaldamento gomme`;
      narrativeCollector.add({ id: "warmup_high_rec", category: "warmup", priority: "supporting", target: "recommended", side: "con", data: { warmup_total: recWarmupForPC }, prerendered_text: text });
    }
    const recHasHardPC = bestCompounds.some(c => (c ?? "").toUpperCase() === "HARD");
    if (recHasHardPC && recWarmupForPC > 1.5) {
      const text = "Mescola Hard: warmup lento riduce efficacia undercut";
      narrativeCollector.add({ id: "warmup_hard_rec", category: "warmup", priority: "supporting", target: "recommended", side: "con", data: { warmup_total: recWarmupForPC, has_hard: true }, prerendered_text: text });
    }

    // Breakdown-derived pros
    if (recommendedStrategy.breakdown) {
      const bd = recommendedStrategy.breakdown;
      if (bd.traffic_loss != null && bd.traffic_loss < 0.5) {
        const text = "Impatto traffico minimo nella simulazione";
        narrativeCollector.add({ id: "breakdown_traffic_low_rec", category: "traffic", priority: "supporting", target: "recommended", side: "pro", data: { breakdown_traffic_loss: bd.traffic_loss }, prerendered_text: text });
      }
      if (bd.warmup_cost != null && bd.warmup_cost < 1.0 && bestPitLaps.length > 0) {
        const text = "Warmup contenuto";
        narrativeCollector.add({ id: "breakdown_warmup_low_rec", category: "warmup", priority: "supporting", target: "recommended", side: "pro", data: { breakdown_warmup_cost: bd.warmup_cost }, prerendered_text: text });
      }
    }

    recommendedStrategy.pros = recPros;
    recommendedStrategy.cons = recCons;
    if (recommendedStrategy.delta_clamped) {
      const _cap = pitLoss * 2.5;
      recommendedStrategy.cons.push(
        `Guadagno nominale limitato al massimo plausibile (~${_cap.toFixed(1)}s, pari a 2.5× il pit loss): un delta superiore deriverebbe dall'estrapolazione del modello di degrado oltre il range osservato e non rappresenta un vantaggio realistico.`,
      );
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
  let integratedContext = buildIntegratedContext(
    diaryEvents, weatherMap, trackStatusMap, cumDevResult, driverNumber, actualPitLaps,
  );

  const narrativeInsights: string[] = [];


  // Analysis mode narrative
  if (isRaceEngineerMode) {
    const text = "🏁 Modalità Race Engineer (ex-ante): le strategie simulate non utilizzano conoscenza di eventi futuri (SC, VSC, meteo). Le decisioni sono valutate con le sole informazioni disponibili al momento.";
    narrativeCollector.add({ id: "mode_race_engineer", category: "mode_context", priority: "context", target: "global", data: { mode: "RACE_ENGINEER" }, prerendered_text: text });
  } else {
    const text = "📊 Modalità Post-Race Analysis (ex-post): le strategie utilizzano la timeline completa della gara, inclusi tutti gli eventi reali.";
    narrativeCollector.add({ id: "mode_post_race", category: "mode_context", priority: "context", target: "global", data: { mode: "POST_RACE" }, prerendered_text: text });
  }

  // ── 7.pre Degradation validation insights ──
  for (const dv of degradationValidations) {
    if (dv.status === "INVALID") {
      const corrNote = dv.model_corrected
        ? ` Il modello ha corretto per fuel proxy${dv.weather_correction_used ? " e temperatura" : ""} (slope grezza: ${dv.slope_raw.toFixed(3)}, corretta: ${dv.slope_corrected.toFixed(3)}), ma la stima resta non attendibile.`
        : "";
      const text = `La stima di degrado per lo stint ${dv.original.stint} (${dv.original.compound}) è stata classificata come non attendibile e non è stata usata nel modello strategico.${corrNote} ${dv.fallback_description ?? ""}`;
      narrativeCollector.add({ id: `deg_quality_invalid_stint${dv.original.stint}`, category: "degradation_quality", priority: "critical", target: "global", data: { stint: dv.original.stint, compound: dv.original.compound, status: "INVALID", model_corrected: dv.model_corrected, slope_raw: dv.slope_raw, slope_corrected: dv.slope_corrected, weather_correction_used: dv.weather_correction_used, fallback_description: dv.fallback_description ?? null }, prerendered_text: text, because_of: ["weather_change_detected"] });
    } else if (dv.model_corrected && dv.slope_raw < 0 && dv.slope_corrected > 0 && dv.status === "VALID") {
      const text = `Stint ${dv.original.stint} (${dv.original.compound}): la slope grezza era negativa (${dv.slope_raw.toFixed(3)}) ma dopo correzione per fuel proxy${dv.weather_correction_used ? " e temperatura" : ""} il degrado stimato è diventato positivo (${dv.slope_corrected.toFixed(3)} sec/giro). Il modello usa il valore corretto.`;
      narrativeCollector.add({ id: `deg_quality_neg_to_pos_stint${dv.original.stint}`, category: "degradation_quality", priority: "supporting", target: "global", data: { stint: dv.original.stint, compound: dv.original.compound, slope_raw: dv.slope_raw, slope_corrected: dv.slope_corrected, weather_correction_used: dv.weather_correction_used }, prerendered_text: text });
    } else if (dv.status === "NEUTRAL" && dv.fallback_applied) {
      const text = `Lo stint ${dv.original.stint} (${dv.original.compound}) presenta un degrado troppo debole per essere significativo (slope${dv.model_corrected ? " corretta" : ""}: ${dv.slope_corrected.toFixed(3)}). Usato con cautela nel modello.`;
      narrativeCollector.add({ id: `deg_quality_neutral_stint${dv.original.stint}`, category: "degradation_quality", priority: "supporting", target: "global", data: { stint: dv.original.stint, compound: dv.original.compound, status: "NEUTRAL", model_corrected: dv.model_corrected, slope_corrected: dv.slope_corrected }, prerendered_text: text });
    }
  }
  if (invalidDegCount > 0 && validDegCount === 0 && neutralDegCount === 0) {
    const text = "⚠️ Nessuna stima di degrado attendibile disponibile. Il modello strategico usa fallback conservativi — i risultati hanno confidenza ridotta.";
    narrativeCollector.add({ id: "deg_quality_no_reliable", category: "degradation_quality", priority: "critical", target: "global", data: { invalid_count: invalidDegCount, valid_count: validDegCount, neutral_count: neutralDegCount }, prerendered_text: text });
  }

  // ── 7.pre2 Raw vs Corrected degradation comparison ──
  {
    const lowAgreementStints = rawVsCorrected.filter(r => r.agreement === "LOW");
    const highAgreementStints = rawVsCorrected.filter(r => r.agreement === "HIGH");

    if (lowAgreementStints.length > 0) {
      for (const la of lowAgreementStints) {
        const text = `Stint ${la.stint} (${la.compound}): divergenza significativa tra degrado grezzo (${la.rawSlope.toFixed(3)} s/giro) e corretto (${la.corrSlope.toFixed(3)} s/giro). La correzione per effetti non-tyre è ampia — confidenza ridotta sulla stima.`;
        narrativeCollector.add({ id: `raw_vs_corrected_low_stint${la.stint}`, category: "raw_vs_corrected", priority: "supporting", target: "global", data: { stint: la.stint, compound: la.compound, raw_slope: la.rawSlope, corr_slope: la.corrSlope, agreement: "LOW" }, prerendered_text: text });
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
          narrativeCollector.add({ id: "battle_near_rec_pit", category: "battle_context", priority: "supporting", target: "global", lap: recPitLap, data: { rec_pit_lap: recPitLap }, prerendered_text: text });
        }
      }

      if (bc.defending_episodes > 0 && bc.longest_episode) {
        const text = `Fase difensiva rilevata (${bc.defending_episodes} episodi, il più lungo: ${Math.round(bc.longest_episode.durationSeconds)}s vs ${bc.longest_episode.opponent}). La strategia potrebbe aver risentito della pressione.`;
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
      narrativeCollector.add({ id: "cum_dev_loss_trend_start", category: "cumulative_deviation", priority: "supporting", target: "global", lap: cd.loss_trend_start_lap, data: { loss_trend_start_lap: cd.loss_trend_start_lap, winner_code: cd.winner_code ?? "P1" }, prerendered_text: text });
      
      // Check if pit was before or after the loss trend started
      if (actualPitLaps.length > 0 && actualPitLaps[0] > cd.loss_trend_start_lap) {
        const text2 = `Il pit reale (giro ${actualPitLaps[0]}) è avvenuto dopo l'inizio della perdita cumulativa (giro ${cd.loss_trend_start_lap}): un pit anticipato avrebbe potuto mitigare la perdita.`;
        narrativeCollector.add({ id: "cum_dev_pit_after_loss", category: "cumulative_deviation", priority: "supporting", target: "global", lap: actualPitLaps[0], data: { actual_pit_lap: actualPitLaps[0], loss_trend_start_lap: cd.loss_trend_start_lap }, prerendered_text: text2, because_of: ["cum_dev_loss_trend_start"] });
      }
    }

    if (cd.max_deviation != null && cd.max_deviation > 5) {
      const text = `Deviazione cumulativa massima osservata: +${cd.max_deviation.toFixed(1)}s al giro ${cd.max_deviation_lap}.`;
      narrativeCollector.add({ id: "cum_dev_max", category: "cumulative_deviation", priority: "supporting", target: "global", lap: cd.max_deviation_lap ?? undefined, data: { max_deviation: cd.max_deviation, max_deviation_lap: cd.max_deviation_lap }, prerendered_text: text, because_of: ["deg_quality_invalid_stint1", "deg_quality_invalid_stint2", "deg_quality_invalid_stint3"] });
    }

    if (cd.driver_final_delta != null && cd.driver_final_delta > 10) {
      const text = `Al termine della gara, il pilota ha accumulato +${cd.driver_final_delta.toFixed(1)}s rispetto al benchmark del vincitore.`;
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
        narrativeCollector.add({ id: "pace_loss_cliff_risk", category: "pace_loss", priority: "critical", target: "global", data: { stint: worstPL.stint_number, rate: worstPL.stint_pace_loss_rate, status: "CLIFF_RISK" }, prerendered_text: text });
      } else if (worstPL.pace_loss_status === "HIGH_LOSS") {
        const text = `Perdita di passo significativa nello stint ${worstPL.stint_number} (${worstPL.stint_pace_loss_rate.toFixed(3)} s/giro): il modello ha aumentato il peso del degrado nella simulazione strategica.`;
        narrativeCollector.add({ id: "pace_loss_high", category: "pace_loss", priority: "supporting", target: "global", data: { stint: worstPL.stint_number, rate: worstPL.stint_pace_loss_rate, status: "HIGH_LOSS" }, prerendered_text: text });
      } else if (worstPL.pace_loss_status === "NORMAL_LOSS") {
        const text = `Perdita di passo moderata nello stint ${worstPL.stint_number} (${worstPL.stint_pace_loss_rate.toFixed(3)} s/giro), coerente con un degrado normale.`;
        narrativeCollector.add({ id: "pace_loss_normal", category: "pace_loss", priority: "context", target: "global", data: { stint: worstPL.stint_number, rate: worstPL.stint_pace_loss_rate, status: "NORMAL_LOSS" }, prerendered_text: text });
      }
    }

    // Check coherence between degradation model and pace loss
    for (const pl of usablePL) {
      const dv = degradationValidations.find(v => v.original.stint === pl.stint_number);
      if (dv && pl.stint_pace_loss_rate != null) {
        if (dv.effective_slope < 0.02 && pl.pace_loss_status === "HIGH_LOSS") {
          const text = `Stint ${pl.stint_number}: il degrado stimato è basso (${dv.effective_slope.toFixed(3)} s/giro) ma la perdita di passo osservata è alta (${pl.stint_pace_loss_rate.toFixed(3)}). Possibile incoerenza — il verdetto è stato reso più prudente.`;
          narrativeCollector.add({ id: "pace_loss_incoherence_low_deg_high_loss", category: "pace_loss", priority: "supporting", target: "global", data: { stint: pl.stint_number, effective_slope: dv.effective_slope, rate: pl.stint_pace_loss_rate }, prerendered_text: text });
          confScore -= 1;
        } else if (dv.effective_slope > 0.06 && pl.pace_loss_status === "STABLE") {
          const text = `Stint ${pl.stint_number}: il degrado stimato è elevato (${dv.effective_slope.toFixed(3)} s/giro) ma il passo osservato è stabile. Il degrado potrebbe essere sovrastimato.`;
          narrativeCollector.add({ id: "pace_loss_incoherence_high_deg_stable", category: "pace_loss", priority: "supporting", target: "global", data: { stint: pl.stint_number, effective_slope: dv.effective_slope }, prerendered_text: text });
        }
      }
    }

    // Unreliable pace loss: note for transparency
    const unreliablePL = paceLossResults.filter(r => r.pace_loss_status === "UNRELIABLE" && r.pace_loss_contamination_flags.battle);
    if (unreliablePL.length > 0) {
      const text = `La metrica di pace loss per ${unreliablePL.length} stint è stata ridimensionata a causa di traffico e battaglie ravvicinate. Non è stata usata come driver strategico.`;
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

  // ── 7b-bis. Lapped-traffic insight & confidence factor (informational) ──
  if (lappedTrafficResult) {
    const lt = lappedTrafficResult;
    if (lt.encounter_lap_count === 0) {
      confidenceFactors.push("Analisi doppiaggi disponibile: nessun incontro rilevato");
    } else {
      confidenceFactors.push(
        `Analisi doppiaggi disponibile: ${lt.encounter_lap_count} giri con doppiaggi (${lt.total_lapped_count} vetture), confidenza ${lt.confidence}`
      );
      const bfRatio = Math.round(lt.blue_flag_corroboration_ratio * 100);
      const parts: string[] = [];
      parts.push(`Traffico doppiati: ${lt.total_lapped_count} vetture doppiate in ${lt.encounter_lap_count} giri`);
      if (lt.cost_distinguishable_from_noise && lt.median_cost_seconds != null && lt.total_time_lost_seconds != null) {
        parts.push(`costo mediano ~${lt.median_cost_seconds.toFixed(2)}s/giro, totale stimato ~${lt.total_time_lost_seconds.toFixed(1)}s (confidenza ${lt.confidence}${bfRatio > 0 ? `, ${bfRatio}% corroborati da bandiera blu` : ""})`);
      } else {
        parts.push(`costo non distinguibile dal rumore (confidenza ${lt.confidence})`);
      }
      let text = parts.join(" — ") + ".";
      if (lt.confidence === "LOW" || !lt.cost_distinguishable_from_noise) {
        text += " Dato indicativo: pochi delta validi o mediana non positiva.";
      }
      text += " " + lt.method_declaration;
      narrativeInsights.push(text);
    }
  }



  // ── 7c. Diary context insights ──
  if (integratedContext.diary_context) {
    const dc = integratedContext.diary_context;
    if (dc.strategy_relevant_events.length > 0) {
      for (const ev of dc.strategy_relevant_events.slice(0, 3)) {
        const text = `Giro ${ev.lap}: ${ev.description}`;
        narrativeCollector.add({ id: `diary_event_lap${ev.lap}`, category: "diary", priority: "context", target: "global", lap: ev.lap, data: { lap: ev.lap, description: ev.description }, prerendered_text: text });
      }
    }
    if (dc.overtakes_received > dc.overtakes_done && dc.overtakes_received >= 3) {
      const text = `Il pilota ha subito più sorpassi (${dc.overtakes_received}) di quanti ne ha effettuati (${dc.overtakes_done}), indicando una possibile strategia difensiva o ritmo insufficiente.`;
      narrativeCollector.add({ id: "diary_defensive_pattern", category: "diary", priority: "supporting", target: "global", data: { overtakes_received: dc.overtakes_received, overtakes_done: dc.overtakes_done }, prerendered_text: text });
    }
  }

  // ── 7d. Weather context enrichment ──
  if (integratedContext.weather_context?.had_weather_change) {
    const wc = integratedContext.weather_context;
    confScore -= 1; // Weather change reduces confidence
    if (wc.first_non_dry_lap != null) {
      const text = `Condizioni meteo variabili rilevate dal giro ${wc.first_non_dry_lap} (${wc.wet_laps} giri bagnati, ${wc.mixed_laps} misti). Il modello di degrado esclude questi giri.`;
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
        narrativeCollector.add({ id: "neutral_pit_under_sc", category: "neutralization", priority: "supporting", target: "global", data: { type: "SC" }, prerendered_text: text });
      } else if (ts.neutralized_laps.some(nl => {
        // Check if SC was near recommended window
        return recommendedWindows.some(w => Math.abs(nl - w.ideal_lap) <= 3);
      })) {
        const text = "Una Safety Car è apparsa vicino alla finestra pit consigliata: un pit sotto neutralizzazione avrebbe offerto un vantaggio di ~10s.";
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
        narrativeCollector.add({ id: "neutral_actual_benefit", category: "neutralization", priority: "supporting", target: "global", data: { types, benefit_seconds: totalNeutralBenefit }, prerendered_text: text, because_of: ["neutral_pit_under_sc"] });
      }

      // Check each alternative: does it pit on a neutralised lap or in green?
      for (let altIdx = 0; altIdx < alternatives.length; altIdx++) {
        const alt = alternatives[altIdx];
        const altNeutralBenefit = alt.pit_laps.reduce((sum, pl) => {
          const mult = getObservedPitLossMultiplier(pl);
          return sum + pitLoss * (1.0 - mult);
        }, 0);

        if (altNeutralBenefit < totalNeutralBenefit * 0.5) {
          // Alternative pits mostly in green while actual benefited from neutralisation
          const greenPits = alt.pit_laps.filter(pl => getObservedPitLossMultiplier(pl) >= 1.0);
          if (greenPits.length > 0) {
            const text = `Pit in green (giro ${greenPits.join(", ")}): +${(totalNeutralBenefit - altNeutralBenefit).toFixed(1)}s di pit loss rispetto alla strategia reale sotto neutralizzazione`;
            narrativeCollector.add({ id: `neutral_alt${altIdx}_green_penalty`, category: "neutralization", priority: "supporting", target: "alternative", target_index: altIdx, side: "con", data: { green_pits: greenPits, penalty_seconds: totalNeutralBenefit - altNeutralBenefit }, prerendered_text: text });
          }
        } else if (altNeutralBenefit > totalNeutralBenefit + 1.0) {
          // Alternative benefits MORE from neutralisation than actual
          const text = `Pit su neutralizzazione reale (beneficio stimato: −${altNeutralBenefit.toFixed(1)}s di pit loss)`;
          narrativeCollector.add({ id: `neutral_alt${altIdx}_extra_benefit`, category: "neutralization", priority: "supporting", target: "alternative", target_index: altIdx, side: "pro", data: { benefit_seconds: altNeutralBenefit }, prerendered_text: text });
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
      recWarmupFromModel += computeStintWarmupCost(recStintBounds[si].compound, si === 0, trackTempAtStart);
    }
    // Use model-computed warmup (more precise) or breakdown warmup as fallback
    const recWarmup = recWarmupFromModel > 0 ? recWarmupFromModel : (recommendedStrategy.breakdown?.warmup_cost ?? 0);

    // Check if recommended strategy has significant warmup cost
    if (recWarmup > 2.0) {
      const text = `La strategia raccomandata include ${recWarmup.toFixed(1)}s di tempo perso per riscaldamento gomme (tyre warmup). Strategie con più soste o gomme Hard subiscono una penalità termica maggiore.`;
      narrativeCollector.add({ id: "warmup_rec_significant", category: "warmup", priority: "supporting", target: "global", data: { rec_warmup: recWarmup }, prerendered_text: text });
    }

    // Compare warmup across alternatives using computeStintWarmupCost
    const altWarmups = alternatives.map(a => {
      const aBounds = buildStintBounds(a.pit_laps, a.compounds);
      let wTotal = 0;
      for (let si = 0; si < aBounds.length; si++) {
        wTotal += computeStintWarmupCost(aBounds[si].compound, si === 0, trackTempAtStart);
      }
      return { name: a.name, warmup: wTotal, compounds: a.compounds };
    }).filter(a => a.warmup > 0);

    if (altWarmups.length > 0) {
      const maxWarmupAlt = altWarmups.reduce((a, b) => a.warmup > b.warmup ? a : b);
      const minWarmupAlt = altWarmups.reduce((a, b) => a.warmup < b.warmup ? a : b);
      const warmupSpread = maxWarmupAlt.warmup - minWarmupAlt.warmup;

      if (warmupSpread > 1.5) {
        const text = `Differenza warmup tra strategie: ${warmupSpread.toFixed(1)}s (${maxWarmupAlt.name}: ${maxWarmupAlt.warmup.toFixed(1)}s vs ${minWarmupAlt.name}: ${minWarmupAlt.warmup.toFixed(1)}s). Strategie con meno soste o mescole morbide sono favorite dal warmup.`;
        narrativeCollector.add({ id: "warmup_spread", category: "warmup", priority: "supporting", target: "global", data: { spread: warmupSpread, max_name: maxWarmupAlt.name, max_warmup: maxWarmupAlt.warmup, min_name: minWarmupAlt.name, min_warmup: minWarmupAlt.warmup }, prerendered_text: text });
      }
    }

    // Hard compound warmup penalty warning
    const recHasHard = bestCompounds.some(c => (c ?? "").toUpperCase() === "HARD");
    if (recHasHard && recWarmup > 1.5) {
      const text = `La strategia raccomandata include gomme Hard: il warmup lento (+1.4s base) rende l'undercut meno efficace e penalizza stint corti su questa mescola.`;
      narrativeCollector.add({ id: "warmup_rec_hard", category: "warmup", priority: "supporting", target: "global", data: { rec_warmup: recWarmup, has_hard: true }, prerendered_text: text });
    }

    // Multi-stop warmup accumulation
    if (bestPitLaps.length >= 2 && recWarmup > 3.0) {
      const text = `Strategia a ${bestPitLaps.length} soste: il warmup cumulato (${recWarmup.toFixed(1)}s) è significativo. Ogni pit stop aggiuntivo introduce una fase di riscaldamento che riduce il vantaggio netto della sosta.`;
      narrativeCollector.add({ id: "warmup_multi_stop", category: "warmup", priority: "supporting", target: "global", data: { num_stops: bestPitLaps.length, rec_warmup: recWarmup }, prerendered_text: text });
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
      const text = `⚠️ ${scenarioActivationWarning}`;
      narrativeCollector.add({ id: "scenario_activation_warning", category: "scenario", priority: "critical", target: "global", data: { warning: scenarioActivationWarning }, prerendered_text: text });
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
  for (let __ssi = 0; __ssi < sensorNarrativeInsights.length; __ssi++) {
    const insight = sensorNarrativeInsights[__ssi];
    narrativeCollector.add({
      id: `soft_sensor_scoring_narrative_${__ssi}`,
      category: "soft_sensor_scoring",
      priority: "supporting",
      target: "global",
      data: { source: "extractSoftSensorNarrativeInsights", index: __ssi },
      prerendered_text: insight,
    });
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

    // Attach scoring fields to alternatives.
    // BUGFIX: scoringInput has the recommended at position 0 and alternatives at
    // positions ai+1, so the scored index for alternatives[ai] is exactly ai+1.
    // Resolving by name would collide when N+1 branch produced same-name entries.
    for (let ai = 0; ai < alternatives.length; ai++) {
      const scored = altScores.get(ai + 1);
      if (scored) {
        alternatives[ai].scoring_without_soft_sensors = scored.scoring_without_soft_sensors;
        alternatives[ai].scoring_with_soft_sensors = scored.scoring_with_soft_sensors;
        alternatives[ai].scoring_delta_soft_sensors = scored.soft_sensor_scoring_delta;
      }
    }

    // ── Narrative cutover Phase 2: populate alt.pros/cons & rec.pros/cons from renderer ──
    // Must happen BEFORE alternatives.sort (target_index uses original positions)
    // and BEFORE the promotion check (which reassigns recommendedStrategy.pros/cons
    // to promoAlt.pros/cons — that array is now populated by this render).
    // The battle-context inline push at L1390 already executed and stays inline (TODO).
    {
      const __renderedAltRec = renderNarrative(narrativeCollector.getAll(), { totalLaps, actualPitLaps, session_key: sessionKey });
      for (let __i = 0; __i < alternatives.length; __i++) {
        const __bucket = __renderedAltRec.alternatives.get(__i);
        if (__bucket) {
          alternatives[__i].pros.push(...__bucket.pros);
          alternatives[__i].cons.push(...__bucket.cons);
        }
      }
      recommendedStrategy.pros.push(...__renderedAltRec.recommended_pros);
      recommendedStrategy.cons.push(...__renderedAltRec.recommended_cons);
    }

    // BUGFIX: snapshot alternatives BEFORE the in-place sort so the promotion
    // logic can resolve the promoted alternative by its ORIGINAL index
    // (bestAltScored.index - 1 refers to the pre-sort position).
    const alternativesSnapshot = [...alternatives];

    // Build a reference→adjusted_score map (reference-based, immune to
    // duplicate names in the N+1 branch).
    const scoreByRef = new Map<AlternativeStrategy, number | undefined>();
    for (let ai = 0; ai < alternatives.length; ai++) {
      scoreByRef.set(alternatives[ai], altScores.get(ai + 1)?.adjusted_score);
    }

    // Reorder alternatives by risk-aware adjusted_score (higher=better),
    // then subtract the position-aware adjustment (lower=better in time-units)
    // so a NEGATIVE adjustment (attack bonus) pushes the strategy UP.
    sortAlternativesByPositionAwareScore(alternatives, scoreByRef);


    // ── Promotion check: if the top alternative is robustly better than recommended,
    // promote it. Threshold is conservative (>1.0s advantage after all adjustments)
    // to avoid noisy swaps.
    const bestAltScored = riskScored
      .filter(s => s.index >= 0)
      .sort((a, b) => b.adjusted_score - a.adjusted_score)[0];

    if (recScored && bestAltScored && bestAltScored.adjusted_score > recScored.adjusted_score + 1.0) {
      // BUGFIX: use the pre-sort snapshot; bestAltScored.index maps to
      // scoringInput position (rec=0, alts=ai+1), i.e. the ORIGINAL
      // alternatives array position.
      const promoAltIdx = bestAltScored.index - 1;
      const promoAlt = alternativesSnapshot[promoAltIdx];
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

          {
            const __text = `Strategia raccomandata aggiornata: "${promoAlt.name}" promossa dal ranking multi-criterio (${riskMode}). Score risk-adjusted: ${bestAltScored.adjusted_score.toFixed(1)} vs ${recScored.adjusted_score.toFixed(1)} della precedente raccomandata. ${bestAltScored.adjustment_reason !== "Nessun aggiustamento" ? bestAltScored.adjustment_reason : ""}`;
            narrativeCollector.add({
              id: "risk_scoring_promotion",
              category: "risk_scoring",
              priority: "critical",
              target: "global",
              data: {
                promoted_name: promoAlt.name,
                risk_mode: riskMode,
                best_alt_adjusted_score: bestAltScored.adjusted_score,
                rec_adjusted_score: recScored.adjusted_score,
                adjustment_reason: bestAltScored.adjustment_reason,
              },
              prerendered_text: __text,
            });
          }
        }
      }
    } else if (recScored && bestAltScored && bestAltScored.adjusted_score > recScored.adjusted_score + 0.5) {
      {
        const __text = `Risk scoring (${riskMode}): "${bestAltScored.name}" ha un punteggio risk-adjusted migliore della raccomandata di ${(bestAltScored.adjusted_score - recScored.adjusted_score).toFixed(1)}s. ${bestAltScored.adjustment_reason !== "Nessun aggiustamento" ? `(${bestAltScored.adjustment_reason})` : ""}`.trim();
        narrativeCollector.add({
          id: "risk_scoring_alt_better",
          category: "risk_scoring",
          priority: "supporting",
          target: "global",
          data: {
            best_alt_name: bestAltScored.name,
            risk_mode: riskMode,
            score_delta: bestAltScored.adjusted_score - recScored.adjusted_score,
            adjustment_reason: bestAltScored.adjustment_reason,
          },
          prerendered_text: __text,
        });
      }
    }

    if (recScored && recScored.adjustment_reason !== "Nessun aggiustamento") {
      confidenceFactors.push(`Risk scoring (${riskMode}): ${recScored.adjustment_reason}`);
    }

    // Uncertainty band check: if the recommended strategy was promoted from an
    // alternative whose pace delta vs actual is within the propagated
    // degradation-slope band, flag it as "within margin" so the UI/narrative
    // can warn the user. Pure-pace fields and ranking remain unchanged.
    {
      const matchedAlt = alternatives.find(a =>
        a.pit_laps.length === recommendedStrategy.pit_windows.length &&
        a.pit_laps.every((p, i) => p === recommendedStrategy.pit_windows[i]?.ideal_lap) &&
        a.compounds.join(",") === recommendedStrategy.compounds.join(",")
      );
      if (matchedAlt && matchedAlt.indistinguishable_from_actual) {
        confidenceFactors.push(
          `Il vantaggio stimato (${matchedAlt.estimated_delta_vs_actual.toFixed(1)}s) rientra nel margine di incertezza del modello di degrado (±${(matchedAlt.delta_uncertainty_std ?? 0).toFixed(1)}s)`,
        );
      }
    }

    // ── Presentation-only plausibility clamp on alternatives ──
    // Mirrors the cap applied to bestDelta in section 3 (MAX_PLAUSIBLE_DELTA =
    // pitLoss × 2.5) so the gains shown for recommended and alternatives are
    // on the SAME scale and visually comparable. CRITICAL: applied AFTER
    // scoring, uncertainty propagation and the promotion check have all run
    // on raw values, so this clamp NEVER influences ranking or robustness
    // classification. Raw values are preserved on `raw_delta_vs_actual`.
    {
      const MAX_PLAUSIBLE_DELTA_DISPLAY = pitLoss * 2.5;
      // Also clamp the recommended gain in case it was overwritten by a
      // promoted alternative whose raw delta exceeded the cap.
      if (recommendedStrategy.estimated_gain_seconds > MAX_PLAUSIBLE_DELTA_DISPLAY) {
        // Only capture the pre-clamp raw if not already captured by the
        // initial bestDelta clamp (which stored the true pre-clamp value).
        if (!recommendedStrategy.delta_clamped) {
          recommendedStrategy.raw_gain_seconds =
            Math.round(recommendedStrategy.estimated_gain_seconds * 10) / 10;
          recommendedStrategy.delta_clamped = true;
          if (recommendedStrategy.cons) {
            recommendedStrategy.cons.push(
              `Guadagno nominale limitato al massimo plausibile (~${MAX_PLAUSIBLE_DELTA_DISPLAY.toFixed(1)}s, pari a 2.5× il pit loss): un delta superiore deriverebbe dall'estrapolazione del modello di degrado oltre il range osservato e non rappresenta un vantaggio realistico.`,
            );
          }
        }
        recommendedStrategy.estimated_gain_seconds =
          Math.round(MAX_PLAUSIBLE_DELTA_DISPLAY * 10) / 10;
        recommendedStrategy.time_delta_vs_actual =
          -recommendedStrategy.estimated_gain_seconds;
      }
      for (const alt of alternatives) {
        if (alt.estimated_delta_vs_actual > MAX_PLAUSIBLE_DELTA_DISPLAY) {
          alt.raw_delta_vs_actual = alt.estimated_delta_vs_actual;
          alt.delta_clamped = true;
          alt.estimated_delta_vs_actual =
            Math.round(MAX_PLAUSIBLE_DELTA_DISPLAY * 10) / 10;
          alt.time_delta_vs_actual = -alt.estimated_delta_vs_actual;
          alt.cons.push(
            `Guadagno nominale limitato al massimo plausibile (~${MAX_PLAUSIBLE_DELTA_DISPLAY.toFixed(1)}s, pari a 2.5× il pit loss): un delta superiore deriverebbe dall'estrapolazione del modello di degrado oltre il range osservato e non rappresenta un vantaggio realistico.`,
          );
        } else if (alt.estimated_delta_vs_actual < -MAX_PLAUSIBLE_DELTA_DISPLAY) {
          alt.raw_delta_vs_actual = alt.estimated_delta_vs_actual;
          alt.delta_clamped = true;
          alt.estimated_delta_vs_actual =
            -Math.round(MAX_PLAUSIBLE_DELTA_DISPLAY * 10) / 10;
          alt.time_delta_vs_actual = -alt.estimated_delta_vs_actual;
          alt.cons.push(
            `Svantaggio nominale limitato al massimo plausibile (~${MAX_PLAUSIBLE_DELTA_DISPLAY.toFixed(1)}s, pari a 2.5× il pit loss): un delta inferiore deriverebbe dall'estrapolazione del modello di degrado oltre il range osservato e non rappresenta una perdita realistica.`,
          );
        }
      }
    }

    // ── Explainability: why an alternative with a larger shown delta was
    // NOT promoted to recommended. Uses already-computed robustness,
    // uncertainty and clamp flags; never invents numbers.
    {
      const recGain = recommendedStrategy.estimated_gain_seconds;
      const altsAbove = alternatives
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a.estimated_delta_vs_actual > recGain + 0.05);
      if (altsAbove.length > 0) {
        const top = altsAbove[0].a;
        const reasons: string[] = [];
        const robust = top.analysis?.robustness.robustness_label;
        if (robust === "FRAGILE") reasons.push("classificata FRAGILE");
        if (top.delta_clamped) reasons.push("guadagno fortemente estrapolato oltre il range osservato (clamp di plausibilità)");
        if (top.indistinguishable_from_actual) {
          const std = top.delta_uncertainty_std ?? 0;
          reasons.push(`vantaggio entro la banda di incertezza del modello di degrado (±${std.toFixed(1)}s)`);
        }
        if (reasons.length === 0) {
          reasons.push("differenza risk-adjusted sotto la soglia di promozione (1.0s)");
        }
        const text = `"${top.name}" mostra un guadagno nominale superiore alla raccomandata (${top.estimated_delta_vs_actual.toFixed(1)}s vs ${recGain.toFixed(1)}s) ma non è stata promossa: ${reasons.join("; ")}. Su base risk-adjusted la raccomandata resta preferibile.`;
        narrativeCollector.add({
          id: "alt_shown_delta_exceeds_rec_unpromoted",
          category: "risk_scoring",
          priority: "supporting",
          target: "global",
          data: {
            alt_name: top.name,
            alt_shown_delta: top.estimated_delta_vs_actual,
            rec_gain: recGain,
            robustness_label: robust,
            delta_clamped: !!top.delta_clamped,
            indistinguishable_from_actual: !!top.indistinguishable_from_actual,
            delta_uncertainty_std: top.delta_uncertainty_std,
          },
          prerendered_text: text,
        });
      }
    }




    // Soft sensor scoring narrative
    if (softSensorScoringGate.soft_sensor_scoring_enabled) {
      const anySSEffect = recSSScoringDelta !== 0 || altSSScoringDeltas.some(d => d !== 0);
      if (anySSEffect) {
        narrativeCollector.add({
          id: "soft_sensor_scoring_enabled",
          category: "soft_sensor_scoring",
          priority: "supporting",
          target: "global",
          data: { gate_enabled: true, max_effect_seconds: 1.0 },
          prerendered_text: `Soft sensors integrati nello scoring strategico come input debole (gate: attivo). Effetto massimo limitato a ±1.0s per strategia.`,
        });
      }
    } else if (softSensorScoringGate.soft_sensor_block_reason) {
      narrativeCollector.add({
        id: "soft_sensor_scoring_blocked",
        category: "soft_sensor_scoring",
        priority: "supporting",
        target: "global",
        data: { gate_enabled: false, block_reason: softSensorScoringGate.soft_sensor_block_reason },
        prerendered_text: `Soft sensors esclusi dallo scoring: ${softSensorScoringGate.soft_sensor_block_reason}`,
      });
    }
  }

  // ── Narrative cutover (Phase 1: global insights only) ──
  // Render structured collector events into the legacy narrativeInsights array.
  // Placed AFTER all global push sites (including risk_scoring & soft_sensor_scoring)
  // so the renderer captures the full set. alt.pros/cons and recommended pros/cons
  // remain legacy (Phases 2-3).
  let __narrativeChapters: NarrativeChapter[] = [];
  {
    const __rendered = renderNarrative(narrativeCollector.getAll(), { totalLaps, actualPitLaps, session_key: sessionKey });
    narrativeInsights.push(...__rendered.insights);
    __narrativeChapters = __rendered.chapters;
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

  // Declare — via confidence_factors + narrative_insights — WHY the
  // alternative-strategies engine produced nothing. Silence here would leave
  // the user with an unexplained empty section.
  if (alternativesUnavailableReason && alternatives.length === 0) {
    const msg = `Strategie alternative non calcolate: ${alternativesUnavailableReason}`;
    confidenceFactors.push(`⚠️ ${msg}`);
    narrativeInsights.push(`⚠️ ${msg}`);
  }

  if (recommendedUsesPractice) {
    confidenceFactors.push(
      `ℹ️ Strategia raccomandata usa un compound derivato dalle Practice: passo base assunto pari alla mescola sostituita, solo lo slope di degrado proviene dalle prove libere.`,
    );
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
    risk_mode: riskMode,
    integrated_context: integratedContext,
    narrative_insights: narrativeInsights,
    narrative_chapters: __narrativeChapters,
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
    detected_penalties: penaltiesForDriver(detectRaceControlPenalties(raceControl), driverNumber),
    ...(lappedTrafficResult ? { lapped_traffic: lappedTrafficResult } : {}),
  };
}
