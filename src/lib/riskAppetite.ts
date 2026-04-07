import type { StrategyBreakdown } from "./strategyBreakdown";

/** Neutral weight adjustments passed to scoring functions */
export interface PhaseAdjustments {
  degradation_weight: number;
  traffic_weight: number;
  track_position_weight: number;
  risk_penalty_weight: number;
  neutralization_opportunity_weight: number;
}

export const NEUTRAL_PHASE_ADJUSTMENTS: PhaseAdjustments = {
  degradation_weight: 1.0,
  traffic_weight: 1.0,
  track_position_weight: 1.0,
  risk_penalty_weight: 1.0,
  neutralization_opportunity_weight: 1.0,
};

/* ── Types ── */

export type RiskMode = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";

export interface RiskModeInfo {
  mode: RiskMode;
  label: string;
  description: string;
}

export const RISK_MODES: Record<RiskMode, RiskModeInfo> = {
  CONSERVATIVE: {
    mode: "CONSERVATIVE",
    label: "Conservative",
    description: "Minimizza rischio, privilegia robustezza e track position",
  },
  BALANCED: {
    mode: "BALANCED",
    label: "Balanced",
    description: "Compromesso equilibrato tra rischio e guadagno atteso",
  },
  AGGRESSIVE: {
    mode: "AGGRESSIVE",
    label: "Aggressive",
    description: "Massimizza upside strategico, accetta più rischio",
  },
};

/* ── Per-strategy risk context ──
 * Optional metadata from strategyAnalysis that enriches scoring
 * beyond the raw breakdown. All fields optional — if absent, no adjustment.
 * Anti-hallucination: only populate from real analysis outputs.
 */

export interface StrategyRiskContext {
  /** ROBUST / MEDIUM / FRAGILE from robustness analysis */
  robustness_label?: "ROBUST" | "MEDIUM" | "FRAGILE";
  /** 0–1 robustness score */
  robustness_score?: number;
  /** 0–1 cliff risk if extending stints */
  cliff_risk?: number;
  /** CLEAR / TRAFFIC / PACK from traffic predictor */
  release_classification?: string;
  /** 0–1 traffic risk after pit */
  traffic_risk_after_pit?: number;
  /** Expected laps stuck in traffic */
  expected_laps_stuck?: number;
  /** Whether rejoin lands inside a compressed pack */
  rejoin_in_pack?: boolean;
  /** Sensitivity: delta seconds if degradation +20% */
  sensitivity_to_degradation?: number;
  /** Sensitivity: delta seconds if traffic +50% */
  sensitivity_to_traffic?: number;
  /** Sensitivity: delta seconds if pit loss +2s */
  sensitivity_to_pit_loss?: number;
  /** 0–1 confidence in degradation data (1 = all VALID, 0 = all INVALID) */
  degradation_confidence?: number;
}

/* ── Risk profile configuration ── */

interface RiskProfile {
  /** Weight on tyre degradation cost penalty */
  degradation_w: number;
  /** Weight on traffic loss penalty */
  traffic_w: number;
  /** Weight on warmup cost penalty */
  warmup_w: number;
  /** Weight on pit loss penalty (above baseline) */
  pit_loss_w: number;
  /** Upside multiplier for positive deltas */
  upside_base: number;
  /** Max upside dampening from execution costs (0 = no cap, 1 = full cap) */
  upside_dampen_cap: number;
  /** Confidence penalty weight (unused fields → more neutral) */
  confidence_penalty_w: number;

  /* ── Context-aware weights (applied to StrategyRiskContext signals) ── */

  /** Robustness: bonus for ROBUST, penalty for FRAGILE (seconds) */
  robustness_bonus: number;
  robustness_penalty: number;
  /** Cliff risk weight: penalty = cliff_risk * cliff_w (seconds) */
  cliff_w: number;
  /** Pack rejoin penalty (seconds) */
  pack_rejoin_penalty: number;
  /** Traffic risk weight: penalty = traffic_risk_after_pit * traffic_context_w */
  traffic_context_w: number;
  /** Laps stuck threshold and penalty per lap above it */
  laps_stuck_threshold: number;
  laps_stuck_penalty_per_lap: number;
  /** Sensitivity weight: how much to penalize high sensitivity strategies */
  sensitivity_w: number;
  /** Degradation confidence: penalty multiplier for low confidence */
  degradation_confidence_w: number;
}

const RISK_PROFILES: Record<RiskMode, RiskProfile> = {
  CONSERVATIVE: {
    degradation_w: 0.15,
    traffic_w: 0.30,
    warmup_w: 0.20,
    pit_loss_w: 0.10,
    upside_base: 0.85,
    upside_dampen_cap: 0.6,
    confidence_penalty_w: 1.4,
    // Context-aware: conservative penalizes risk heavily
    robustness_bonus: 0.5,
    robustness_penalty: -0.8,
    cliff_w: 1.0,
    pack_rejoin_penalty: -0.6,
    traffic_context_w: 0.5,
    laps_stuck_threshold: 3,
    laps_stuck_penalty_per_lap: -0.15,
    sensitivity_w: 0.3,
    degradation_confidence_w: 0.20,
  },
  BALANCED: {
    degradation_w: 0.0,
    traffic_w: 0.0,
    warmup_w: 0.0,
    pit_loss_w: 0.0,
    upside_base: 1.0,
    upside_dampen_cap: 0.3,
    confidence_penalty_w: 1.0,
    // Context-aware: balanced applies moderate context adjustments
    robustness_bonus: 0.3,
    robustness_penalty: -0.5,
    cliff_w: 0.8,
    pack_rejoin_penalty: -0.4,
    traffic_context_w: 0.3,
    laps_stuck_threshold: 4,
    laps_stuck_penalty_per_lap: -0.1,
    sensitivity_w: 0.15,
    degradation_confidence_w: 0.15,
  },
  AGGRESSIVE: {
    degradation_w: -0.08,
    traffic_w: -0.20,
    warmup_w: -0.10,
    pit_loss_w: 0.0,
    upside_base: 1.25,
    upside_dampen_cap: 0.15,
    confidence_penalty_w: 0.6,
    // Context-aware: aggressive tolerates more risk, cares less about robustness
    robustness_bonus: 0.1,
    robustness_penalty: -0.2,
    cliff_w: 0.4,
    pack_rejoin_penalty: -0.15,
    traffic_context_w: 0.1,
    laps_stuck_threshold: 6,
    laps_stuck_penalty_per_lap: -0.05,
    sensitivity_w: 0.05,
    degradation_confidence_w: 0.05,
  },
};

/* ── Scoring ── */

export interface ScoredStrategy {
  index: number;
  name: string;
  raw_delta: number;
  adjusted_score: number;
  adjustment_reason: string;
  /** Per-strategy context penalty/bonus from risk context (0 if no context) */
  context_adjustment: number;
  /** Soft sensor scoring delta (weak input, 0 if gate closed or N/A) */
  soft_sensor_scoring_delta: number;
  /** Score without soft sensor contribution */
  scoring_without_soft_sensors: number;
  /** Score with soft sensor contribution */
  scoring_with_soft_sensors: number;
}

/**
 * Score and rank strategies considering phase adjustments, risk appetite,
 * and per-strategy risk context.
 *
 * Evaluation layers:
 *   1. Risk penalty      – traffic + degradation weighted by risk profile
 *   2. Execution penalty  – warmup + pit loss overhead weighted by risk profile
 *   3. Neutralization     – SC/VSC opportunity bonus
 *   4. Reward component   – upside modulated by execution quality
 *   5. Context penalty    – per-strategy risk from robustness, cliff, traffic context,
 *                           sensitivity and degradation confidence
 *
 * A higher adjusted_score = better strategy (more time saved).
 */
export function scoreStrategies(
  strategies: {
    name: string;
    delta: number;
    breakdown: StrategyBreakdown | undefined;
    isRecommended?: boolean;
    /** Optional per-strategy risk context from analysis modules */
    riskContext?: StrategyRiskContext;
    /** Optional soft sensor scoring delta (pre-validated through gate) */
    softSensorScoringDelta?: number;
  }[],
  phaseAdj: PhaseAdjustments,
  riskMode: RiskMode,
): ScoredStrategy[] {
  const profile = RISK_PROFILES[riskMode];

  return strategies.map((s, i) => {
    const reasons: string[] = [];

    /* ── 1. Risk penalty (traffic + degradation) ── */
    const riskPen = computeRiskPenalty(s.breakdown, phaseAdj, profile, reasons);

    /* ── 2. Execution penalty (warmup + pit loss) ── */
    const execPen = computeExecutionPenalty(s.breakdown, phaseAdj, profile, reasons);

    /* ── 3. Neutralization opportunity ── */
    const neutralBonus = computeNeutralizationBonus(s.breakdown, phaseAdj, reasons);

    /* ── 4. Reward component (upside on positive delta) ── */
    const baseDelta = s.delta - riskPen - execPen + neutralBonus;
    const reward = computeRewardComponent(baseDelta, s.breakdown, profile, reasons);

    /* ── 5. Context penalty from per-strategy risk signals ── */
    const ctxAdj = computeContextAdjustment(s.riskContext, profile, reasons);

    const scoreWithoutSS = Math.round((reward + ctxAdj) * 10) / 10;

    /* ── 6. Soft sensor weak input (validated through gate) ── */
    const ssDelta = s.softSensorScoringDelta ?? 0;
    if (Math.abs(ssDelta) > 0.01) {
      reasons.push(`soft sensors: ${ssDelta > 0 ? "+" : ""}${ssDelta.toFixed(2)}s`);
    }

    const adjustedScore = Math.round((scoreWithoutSS + ssDelta) * 10) / 10;

    return {
      index: s.isRecommended ? -2 : i,
      name: s.name,
      raw_delta: s.delta,
      adjusted_score: adjustedScore,
      adjustment_reason: buildAdjustmentReason(reasons),
      context_adjustment: Math.round(ctxAdj * 10) / 10,
      soft_sensor_scoring_delta: Math.round(ssDelta * 100) / 100,
      scoring_without_soft_sensors: scoreWithoutSS,
      scoring_with_soft_sensors: adjustedScore,
    };
  }).sort((a, b) => b.adjusted_score - a.adjusted_score);
}

/* ── Internal helpers ── */

/**
 * Risk penalty from traffic loss and tyre degradation cost.
 * Phase adjustments modulate the base cost; risk profile adds mode-specific weight.
 */
function computeRiskPenalty(
  bd: StrategyBreakdown | undefined,
  phaseAdj: PhaseAdjustments,
  profile: RiskProfile,
  reasons: string[],
): number {
  if (!bd) return 0;
  let penalty = 0;

  // Traffic
  const trafficCost = bd.traffic_loss ?? 0;
  if (Math.abs(trafficCost) > 0.05) {
    const trafficAdj = trafficCost * (phaseAdj.traffic_weight * (1 + profile.traffic_w) - 1);
    if (Math.abs(trafficAdj) > 0.1) {
      penalty += trafficAdj;
      reasons.push(
        trafficAdj > 0
          ? `traffico penalizzato: -${trafficAdj.toFixed(1)}s`
          : `traffico ridotto: +${Math.abs(trafficAdj).toFixed(1)}s`
      );
    }
  }

  // Degradation
  const degCost = bd.tyre_degradation_cost ?? 0;
  if (Math.abs(degCost) > 0.05) {
    const degAdj = degCost * (phaseAdj.degradation_weight * (1 + profile.degradation_w) - 1);
    if (Math.abs(degAdj) > 0.1) {
      penalty += degAdj;
      reasons.push(
        degAdj > 0
          ? `degrado penalizzato: -${degAdj.toFixed(1)}s`
          : `degrado ridotto: +${Math.abs(degAdj).toFixed(1)}s`
      );
    }
  }

  return penalty;
}

/**
 * Execution penalty from warmup cost and pit loss overhead.
 * These represent "hard" costs of executing the strategy.
 */
function computeExecutionPenalty(
  bd: StrategyBreakdown | undefined,
  phaseAdj: PhaseAdjustments,
  profile: RiskProfile,
  reasons: string[],
): number {
  if (!bd) return 0;
  let penalty = 0;

  // Warmup cost
  const warmup = bd.warmup_cost ?? 0;
  if (warmup > 0.1 && Math.abs(profile.warmup_w) > 0.001) {
    const warmupAdj = warmup * profile.warmup_w;
    if (Math.abs(warmupAdj) > 0.1) {
      penalty += warmupAdj;
      reasons.push(
        warmupAdj > 0
          ? `warmup penalizzato: -${warmupAdj.toFixed(1)}s`
          : `warmup ridotto: +${Math.abs(warmupAdj).toFixed(1)}s`
      );
    }
  }

  // Pit loss — only penalize above a "standard" baseline (≈22s per stop)
  const pitLoss = bd.pit_loss ?? 0;
  if (pitLoss > 0.1 && Math.abs(profile.pit_loss_w) > 0.001) {
    const pitAdj = pitLoss * profile.pit_loss_w;
    if (Math.abs(pitAdj) > 0.1) {
      penalty += pitAdj;
      reasons.push(
        pitAdj > 0
          ? `pit loss penalizzato: -${pitAdj.toFixed(1)}s`
          : `pit loss ridotto: +${Math.abs(pitAdj).toFixed(1)}s`
      );
    }
  }

  return penalty;
}

/**
 * Neutralization opportunity bonus from SC/VSC pit windows.
 * Phase weight amplifies the benefit during neutralization phases.
 */
function computeNeutralizationBonus(
  bd: StrategyBreakdown | undefined,
  phaseAdj: PhaseAdjustments,
  reasons: string[],
): number {
  if (!bd) return 0;

  const neutralAdj = bd.neutralization_adjustment ?? 0;
  if (Math.abs(neutralAdj) < 0.1) return 0;

  const bonus = neutralAdj * (phaseAdj.neutralization_opportunity_weight - 1);
  if (Math.abs(bonus) > 0.1) {
    reasons.push(`neutralizzazione: ${bonus > 0 ? "+" : ""}${bonus.toFixed(1)}s`);
  }
  return bonus;
}

/**
 * Reward component — modulates the upside of a positive delta based on
 * execution quality (how "clean" the strategy is in terms of costs).
 */
function computeRewardComponent(
  baseDelta: number,
  bd: StrategyBreakdown | undefined,
  profile: RiskProfile,
  reasons: string[],
): number {
  if (baseDelta <= 0) return baseDelta;

  const upsideMult = profile.upside_base;
  const executionBurden = computeExecutionBurden(bd);
  const dampenFactor = 1 - executionBurden * profile.upside_dampen_cap;
  const effectiveMult = upsideMult * Math.max(dampenFactor, 0.5);

  const boosted = baseDelta * effectiveMult;
  const diff = boosted - baseDelta;

  if (Math.abs(diff) > 0.1) {
    if (diff > 0) {
      reasons.push(executionBurden > 0.3
        ? "upside amplificato (parziale, costi esecutivi)"
        : "upside amplificato"
      );
    } else {
      reasons.push(executionBurden > 0.3
        ? "upside ridotto (costi esecutivi elevati)"
        : "upside ridotto"
      );
    }
  }

  return boosted;
}

/**
 * Compute a 0–1 "execution burden" score from breakdown costs.
 */
function computeExecutionBurden(bd: StrategyBreakdown | undefined): number {
  if (!bd || bd.total_estimated == null) return 0;

  const total = Math.abs(bd.total_estimated);
  if (total < 1) return 0;

  const costSum =
    Math.abs(bd.traffic_loss ?? 0) +
    Math.abs(bd.warmup_cost ?? 0) +
    Math.max(0, (bd.tyre_degradation_cost ?? 0));

  return Math.min(1, costSum / total);
}

/**
 * Context adjustment — per-strategy risk signals from analysis modules.
 *
 * Integrates: robustness, cliff risk, pack rejoin, traffic persistence,
 * sensitivity and degradation data confidence.
 *
 * All signals are optional; absent fields contribute 0 adjustment.
 * Weights are risk-mode-dependent (conservative penalizes more, aggressive less).
 *
 * Anti-hallucination: only uses fields actually present in StrategyRiskContext.
 */
function computeContextAdjustment(
  ctx: StrategyRiskContext | undefined,
  profile: RiskProfile,
  reasons: string[],
): number {
  if (!ctx) return 0;
  let adj = 0;

  /* ── Robustness ── */
  if (ctx.robustness_label === "ROBUST") {
    adj += profile.robustness_bonus;
    if (profile.robustness_bonus > 0.05) reasons.push(`robustezza: +${profile.robustness_bonus.toFixed(1)}s`);
  } else if (ctx.robustness_label === "FRAGILE") {
    adj += profile.robustness_penalty;
    if (Math.abs(profile.robustness_penalty) > 0.05) reasons.push(`fragilità: ${profile.robustness_penalty.toFixed(1)}s`);
  }

  /* ── Cliff risk ── */
  if (ctx.cliff_risk != null && ctx.cliff_risk > 0.3) {
    const cliffPen = -ctx.cliff_risk * profile.cliff_w;
    adj += cliffPen;
    if (Math.abs(cliffPen) > 0.05) reasons.push(`cliff risk: ${cliffPen.toFixed(1)}s`);
  }

  /* ── Pack rejoin ── */
  if (ctx.rejoin_in_pack && Math.abs(profile.pack_rejoin_penalty) > 0.01) {
    adj += profile.pack_rejoin_penalty;
    reasons.push(`rientro in pack: ${profile.pack_rejoin_penalty.toFixed(1)}s`);
  } else if (ctx.release_classification === "PACK" && Math.abs(profile.pack_rejoin_penalty) > 0.01) {
    adj += profile.pack_rejoin_penalty;
    reasons.push(`release in pack: ${profile.pack_rejoin_penalty.toFixed(1)}s`);
  }

  /* ── Traffic risk after pit ── */
  if (ctx.traffic_risk_after_pit != null && ctx.traffic_risk_after_pit > 0.4) {
    const trafficCtxPen = -ctx.traffic_risk_after_pit * profile.traffic_context_w;
    adj += trafficCtxPen;
    if (Math.abs(trafficCtxPen) > 0.05) reasons.push(`rischio traffico: ${trafficCtxPen.toFixed(1)}s`);
  }

  /* ── Laps stuck in traffic ── */
  if (ctx.expected_laps_stuck != null && ctx.expected_laps_stuck > profile.laps_stuck_threshold) {
    const excessLaps = ctx.expected_laps_stuck - profile.laps_stuck_threshold;
    const stuckPen = excessLaps * profile.laps_stuck_penalty_per_lap;
    adj += stuckPen;
    if (Math.abs(stuckPen) > 0.05) reasons.push(`giri in traffico: ${stuckPen.toFixed(1)}s`);
  }

  /* ── Sensitivity penalty: penalize strategies sensitive to variance ── */
  if (ctx.sensitivity_to_degradation != null || ctx.sensitivity_to_traffic != null || ctx.sensitivity_to_pit_loss != null) {
    const sensDeg = Math.abs(ctx.sensitivity_to_degradation ?? 0);
    const sensTraffic = Math.abs(ctx.sensitivity_to_traffic ?? 0);
    const sensPit = Math.abs(ctx.sensitivity_to_pit_loss ?? 0);
    // Combined sensitivity: weighted average of normalized deltas
    const combinedSens = (sensDeg + sensTraffic + sensPit) / 3;
    if (combinedSens > 0.5) {
      const sensPen = -combinedSens * profile.sensitivity_w;
      adj += sensPen;
      if (Math.abs(sensPen) > 0.05) reasons.push(`sensibilità: ${sensPen.toFixed(1)}s`);
    }
  }

  /* ── Degradation confidence: penalize strategies built on unreliable data ── */
  if (ctx.degradation_confidence != null && ctx.degradation_confidence < 0.7) {
    // Penalty scales inversely with confidence: 0.0 confidence → full penalty
    const confPen = -(1 - ctx.degradation_confidence) * profile.degradation_confidence_w;
    adj += confPen;
    if (Math.abs(confPen) > 0.05) reasons.push(`affidabilità degrado: ${confPen.toFixed(1)}s`);
  }

  return adj;
}

/**
 * Build human-readable adjustment reason from collected factors.
 */
function buildAdjustmentReason(reasons: string[]): string {
  return reasons.length > 0 ? reasons.join("; ") : "Nessun aggiustamento";
}
