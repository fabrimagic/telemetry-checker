import type { ComparisonResult } from "./headToHeadComparison";
import type { AlternativeStrategy } from "./virtualRaceEngineer";

export type DuelInsightVariant = "offensive_chance" | "defensive_warning" | null;

export interface DuelInsight {
  variant: DuelInsightVariant;
  message: string | null;
  rationale: string | null;
  driver_focus_acronym: string;
}

const OPPORTUNITY_THRESHOLD = 0.5;
const RISK_THRESHOLD = 0.5;

/**
 * Pure narrative classifier for the H2H Compare card.
 * Point of view = driver A (asymmetric option γ).
 */
export function computeDuelInsight(
  comparison: ComparisonResult,
  driverAAcronym: string,
  driverBAcronym: string,
): DuelInsight {
  const verdict = comparison.head_to_head_verdict;
  const altA = comparison.alternative_a;
  const result: DuelInsight = {
    variant: null,
    message: null,
    rationale: null,
    driver_focus_acronym: driverAAcronym,
  };

  if (verdict.faster_driver === "TIE") return result;
  if (!altA) return result;

  if (verdict.faster_driver === "B") {
    const alts = altA.alternative_strategies ?? [];
    let bestOpp: { alt: AlternativeStrategy; opp: number } | null = null;
    for (const a of alts) {
      const opp = a.analysis?.competitor_context?.undercut_opportunity ?? 0;
      if (opp >= OPPORTUNITY_THRESHOLD && (!bestOpp || opp > bestOpp.opp)) {
        bestOpp = { alt: a, opp };
      }
    }
    if (bestOpp) {
      const recommendedPits = altA.recommended_strategy.pit_windows.map(w => w.ideal_lap);
      const altPits = bestOpp.alt.pit_laps;
      const isDifferent =
        altPits.length > 0 &&
        (recommendedPits.length === 0 || Math.abs(altPits[0] - recommendedPits[0]) >= 1);
      if (isDifferent) {
        const altPitLap = altPits[0];
        const oppPct = Math.round(bestOpp.opp * 100);
        const timeDelta = bestOpp.alt.time_delta_vs_actual;
        const timeDeltaStr =
          timeDelta != null && Number.isFinite(timeDelta)
            ? `${timeDelta >= 0 ? "+" : ""}${timeDelta.toFixed(1)}s sul tempo gara`
            : "delta tempo n/d";
        result.variant = "offensive_chance";
        result.message = `${driverAAcronym} avrebbe potuto tentare un undercut su ${driverBAcronym} pittando al giro ${altPitLap} (opportunità ${oppPct}%, costo ${timeDeltaStr}).`;
        result.rationale =
          "La strategia ottimale di A è calcolata per minimizzare il tempo gara assoluto, non per massimizzare la posizione finale rispetto a B. In un duello stretto, anticipare il pit può convertire perdita di tempo puro in guadagno di posizione.";
      }
    }
    return result;
  }

  // faster_driver === "A"
  const ctxA = altA.recommended_strategy.analysis?.competitor_context;
  const risk = ctxA?.undercut_risk ?? 0;
  if (risk >= RISK_THRESHOLD) {
    const riskPct = Math.round(risk * 100);
    result.variant = "defensive_warning";
    result.message = `${driverBAcronym} aveva possibilità di undercuttare ${driverAAcronym} (rischio ${riskPct}%). La strategia ottimale di ${driverAAcronym} non considera esplicitamente la risposta a una mossa di ${driverBAcronym}.`;
    result.rationale =
      "La strategia ottimale è calcolata in isolamento. In un duello stretto, un pit reattivo (anticipato per coprire) può perdere tempo puro ma proteggere la posizione.";
  }

  return result;
}
