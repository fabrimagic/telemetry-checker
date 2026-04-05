import type { PhaseAdjustments } from "./racePhase";
import type { StrategyBreakdown } from "./strategyBreakdown";

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
  },
  BALANCED: {
    degradation_w: 0.0,
    traffic_w: 0.0,
    warmup_w: 0.0,
    pit_loss_w: 0.0,
    upside_base: 1.0,
    upside_dampen_cap: 0.3,
    confidence_penalty_w: 1.0,
  },
  AGGRESSIVE: {
    degradation_w: -0.08,
    traffic_w: -0.20,
    warmup_w: -0.10,
    pit_loss_w: 0.0,
    upside_base: 1.25,
    upside_dampen_cap: 0.15,
    confidence_penalty_w: 0.6,
  },
};

/* ── Scoring ── */

export interface ScoredStrategy {
  index: number;
  name: string;
  raw_delta: number;
  adjusted_score: number;
  adjustment_reason: string;
}

/**
 * Score and rank strategies considering phase adjustments and risk appetite.
 *
 * Internally decomposes evaluation into:
 *   1. Reward component  – upside from raw delta, modulated by execution quality
 *   2. Risk penalty      – traffic + degradation weighted by risk profile
 *   3. Execution penalty  – warmup + pit loss overhead weighted by risk profile
 *
 * A higher adjusted_score = better strategy (more time saved).
 */
export function scoreStrategies(
  strategies: {
    name: string;
    delta: number;
    breakdown: StrategyBreakdown | undefined;
    isRecommended?: boolean;
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

    const adjustedScore = Math.round(reward * 10) / 10;

    return {
      index: s.isRecommended ? -2 : i,
      name: s.name,
      raw_delta: s.delta,
      adjusted_score: adjustedScore,
      adjustment_reason: buildAdjustmentReason(reasons),
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
 *
 * Logic:
 *   - Negative delta → returned as-is (no upside boost on losing strategies)
 *   - Positive delta with clean breakdown → full upside multiplier
 *   - Positive delta with high execution costs → dampened upside
 *
 * This prevents AGGRESSIVE mode from blindly boosting strategies that
 * gain time on paper but carry heavy traffic/warmup/degradation costs.
 */
function computeRewardComponent(
  baseDelta: number,
  bd: StrategyBreakdown | undefined,
  profile: RiskProfile,
  reasons: string[],
): number {
  if (baseDelta <= 0) return baseDelta;

  const upsideMult = profile.upside_base;

  // Compute execution burden as fraction of total estimated cost
  const executionBurden = computeExecutionBurden(bd);

  // Dampen upside proportionally to execution burden
  // dampenFactor: 1.0 = full upside, lower = dampened
  const dampenFactor = 1 - executionBurden * profile.upside_dampen_cap;
  const effectiveMult = upsideMult * Math.max(dampenFactor, 0.5); // floor at 50%

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
 * Higher = strategy has more overhead costs relative to total time.
 * Used to dampen upside for strategies that look good on paper
 * but carry significant execution risk.
 */
function computeExecutionBurden(bd: StrategyBreakdown | undefined): number {
  if (!bd || bd.total_estimated == null) return 0;

  const total = Math.abs(bd.total_estimated);
  if (total < 1) return 0;

  const costSum =
    Math.abs(bd.traffic_loss ?? 0) +
    Math.abs(bd.warmup_cost ?? 0) +
    Math.max(0, (bd.tyre_degradation_cost ?? 0));

  // Normalize: costSum / total, clamped to [0, 1]
  return Math.min(1, costSum / total);
}

/**
 * Build human-readable adjustment reason from collected factors.
 */
function buildAdjustmentReason(reasons: string[]): string {
  return reasons.length > 0 ? reasons.join("; ") : "Nessun aggiustamento";
}
