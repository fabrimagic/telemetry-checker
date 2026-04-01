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

/* ── Risk weight multipliers ── */

interface RiskWeights {
  degradation_mult: number;
  traffic_mult: number;
  pit_loss_mult: number;
  upside_mult: number;
  confidence_penalty_mult: number;
}

const RISK_WEIGHTS: Record<RiskMode, RiskWeights> = {
  CONSERVATIVE: {
    degradation_mult: 1.15,
    traffic_mult: 1.3,
    pit_loss_mult: 1.0,
    upside_mult: 0.8,
    confidence_penalty_mult: 1.4,
  },
  BALANCED: {
    degradation_mult: 1.0,
    traffic_mult: 1.0,
    pit_loss_mult: 1.0,
    upside_mult: 1.0,
    confidence_penalty_mult: 1.0,
  },
  AGGRESSIVE: {
    degradation_mult: 0.9,
    traffic_mult: 0.7,
    pit_loss_mult: 1.0,
    upside_mult: 1.3,
    confidence_penalty_mult: 0.6,
  },
};

/* ── Scoring ── */

export interface ScoredStrategy {
  index: number; // index in alternatives array, or -1 for actual, -2 for recommended
  name: string;
  raw_delta: number; // original estimated_delta_vs_actual
  adjusted_score: number; // after phase + risk adjustments
  adjustment_reason: string;
}

/**
 * Score and rank strategies considering phase adjustments and risk appetite.
 * 
 * A higher adjusted_score = better strategy (more time saved).
 * The raw_delta is the original estimated gain vs actual.
 * Adjustments modify how much weight traffic, degradation, etc. carry.
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
  const rw = RISK_WEIGHTS[riskMode];

  return strategies.map((s, i) => {
    let adjustedDelta = s.delta;
    const reasons: string[] = [];

    if (s.breakdown) {
      // Apply phase + risk combined adjustments to breakdown components
      const trafficPenalty = (s.breakdown.traffic_loss ?? 0) *
        (phaseAdj.traffic_weight * rw.traffic_mult - 1);
      if (Math.abs(trafficPenalty) > 0.1) {
        adjustedDelta -= trafficPenalty; // more traffic penalty = worse score
        reasons.push(`traffico ${trafficPenalty > 0 ? "penalizzato" : "ridotto"}: ${trafficPenalty > 0 ? "-" : "+"}${Math.abs(trafficPenalty).toFixed(1)}s`);
      }

      const degPenalty = (s.breakdown.tyre_degradation_cost ?? 0) *
        (phaseAdj.degradation_weight * rw.degradation_mult - 1);
      if (Math.abs(degPenalty) > 0.1) {
        adjustedDelta -= degPenalty;
        reasons.push(`degrado ${degPenalty > 0 ? "penalizzato" : "ridotto"}: ${degPenalty > 0 ? "-" : "+"}${Math.abs(degPenalty).toFixed(1)}s`);
      }

      // Neutralization opportunity bonus
      const neutralBonus = (s.breakdown.neutralization_adjustment ?? 0) *
        (phaseAdj.neutralization_opportunity_weight - 1);
      if (Math.abs(neutralBonus) > 0.1) {
        adjustedDelta += neutralBonus; // negative neutralization = benefit, amplified
        reasons.push(`neutralizzazione: ${neutralBonus > 0 ? "+" : ""}${neutralBonus.toFixed(1)}s`);
      }
    }

    // Apply upside multiplier to positive deltas
    if (adjustedDelta > 0) {
      const upsideBoost = adjustedDelta * (rw.upside_mult - 1);
      if (Math.abs(upsideBoost) > 0.1) {
        adjustedDelta += upsideBoost;
        reasons.push(`upside ${rw.upside_mult > 1 ? "amplificato" : "ridotto"}`);
      }
    }

    return {
      index: s.isRecommended ? -2 : i,
      name: s.name,
      raw_delta: s.delta,
      adjusted_score: Math.round(adjustedDelta * 10) / 10,
      adjustment_reason: reasons.length > 0 ? reasons.join("; ") : "Nessun aggiustamento",
    };
  }).sort((a, b) => b.adjusted_score - a.adjusted_score);
}
