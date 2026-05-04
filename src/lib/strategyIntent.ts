import type { CompetitorContext } from "./strategyAnalysis";

export type StrategyIntent = "attack" | "defense" | "optimal" | "neutral";

const ATTACK_THRESHOLD = 0.5;
const DEFENSE_THRESHOLD = 0.5;
const BALANCE_TOLERANCE = 0.1;

/**
 * Classifies the inferred intent of a pit strategy based on the competitor
 * context at pit time. NOT a certainty: drivers may pit for radio calls,
 * tyre management, errors, or team orders that are not in our data.
 *
 * Convention:
 * - "attack": opportunity to undercut a car ahead is significantly higher
 *   than risk of being undercut from behind
 * - "defense": risk of being undercut is significantly higher than
 *   opportunity to undercut someone ahead
 * - "optimal": neither pressure dominates — likely a pure pace decision
 * - "neutral": competitor_context not available (no inference possible)
 */
export interface IntentClassification {
  intent: StrategyIntent;
  rationale: string; // human-readable explanation, italiano
  opportunity: number; // 0-1, undercut_opportunity at pit time
  risk: number; // 0-1, undercut_risk at pit time
}

export function classifyStrategyIntent(
  ctx: CompetitorContext | null | undefined,
): IntentClassification {
  if (!ctx) {
    return {
      intent: "neutral",
      rationale: "Contesto competitivo non disponibile per inferire l'intento",
      opportunity: 0,
      risk: 0,
    };
  }

  const opp = ctx.undercut_opportunity;
  const risk = ctx.undercut_risk;

  // Both above threshold: dominant signal wins, but if very close → neutral
  if (opp >= ATTACK_THRESHOLD && risk >= DEFENSE_THRESHOLD) {
    if (Math.abs(opp - risk) < BALANCE_TOLERANCE) {
      return {
        intent: "neutral",
        rationale: `Pressione bilanciata: opportunità ${opp.toFixed(2)} ≈ rischio ${risk.toFixed(2)}`,
        opportunity: opp,
        risk,
      };
    }
    if (opp > risk) {
      return {
        intent: "attack",
        rationale: `Opportunità undercut elevata (${opp.toFixed(2)}), rischio inferiore (${risk.toFixed(2)}): tentativo di sorpasso strategico`,
        opportunity: opp,
        risk,
      };
    }
    return {
      intent: "defense",
      rationale: `Rischio undercut elevato (${risk.toFixed(2)}), opportunità minore (${opp.toFixed(2)}): probabile copertura della posizione`,
      opportunity: opp,
      risk,
    };
  }

  if (opp >= ATTACK_THRESHOLD) {
    return {
      intent: "attack",
      rationale: `Opportunità undercut elevata (${opp.toFixed(2)}): tentativo di sorpasso strategico`,
      opportunity: opp,
      risk,
    };
  }

  if (risk >= DEFENSE_THRESHOLD) {
    return {
      intent: "defense",
      rationale: `Rischio undercut elevato (${risk.toFixed(2)}): probabile copertura della posizione`,
      opportunity: opp,
      risk,
    };
  }

  return {
    intent: "optimal",
    rationale: `Né opportunità (${opp.toFixed(2)}) né rischio (${risk.toFixed(2)}) significativi: scelta verosimilmente di passo puro`,
    opportunity: opp,
    risk,
  };
}
