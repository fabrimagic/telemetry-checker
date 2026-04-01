import type { TrafficPrediction } from "./trafficPredictor";
import type { TrackStatus } from "./trackStatusClassification";
import type { WeatherCondition } from "./weatherClassification";
import type { PitStopAnalysis, StintAnalysis } from "./virtualRaceEngineer";

/* ── Types ── */

export interface StrategyBreakdown {
  base_stint_time: number | null;
  tyre_degradation_cost: number | null;
  pit_loss: number | null;
  traffic_loss: number | null;
  weather_adjustment: number | null;
  neutralization_adjustment: number | null;
  total_estimated: number | null;
}

export type BreakdownImpact = "favorable" | "neutral" | "penalizing";

export interface BreakdownRow {
  label: string;
  value: number | null;
  impact: BreakdownImpact;
  note: string;
}

/* ── Computation ── */

/**
 * Compute strategy breakdown for a simulated strategy.
 *
 * Avoids double counting:
 * - base_stint_time = sum of intercept (base pace) per lap across all stints
 * - tyre_degradation_cost = sum of (slope * tyreLife) per lap across all stints
 * - pit_loss = number of pit stops * pit loss duration
 * - traffic_loss = sum from traffic predictions
 * - weather_adjustment = estimated from excluded wet/mixed laps (null if none)
 * - neutralization_adjustment = estimated from SC/VSC laps and pit-under-neutralization benefit
 */
export function computeStrategyBreakdown(
  pitLaps: number[],
  compounds: string[],
  totalLaps: number,
  compoundModels: Map<string, { slope: number; intercept: number; source: string }>,
  pitLossPerStop: number,
  trafficPredictions: TrafficPrediction[],
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  pitStopAnalyses: PitStopAnalysis[],
): StrategyBreakdown {
  // Build stint bounds
  const stintBounds: { start: number; end: number; compound: string }[] = [];
  let start = 1;
  for (let i = 0; i < pitLaps.length; i++) {
    stintBounds.push({ start, end: pitLaps[i], compound: compounds[i] || compounds[0] });
    start = pitLaps[i] + 1;
  }
  stintBounds.push({ start, end: totalLaps, compound: compounds[compounds.length - 1] || compounds[0] });

  let baseTime = 0;
  let degCost = 0;
  let hasModel = true;

  for (const sb of stintBounds) {
    const model = compoundModels.get(sb.compound);
    if (!model) { hasModel = false; break; }
    for (let lap = sb.start; lap <= sb.end; lap++) {
      const tyreLife = lap - sb.start;
      baseTime += model.intercept;
      degCost += model.slope * tyreLife;
    }
  }

  if (!hasModel) {
    return {
      base_stint_time: null,
      tyre_degradation_cost: null,
      pit_loss: pitLaps.length > 0 ? round1(pitLaps.length * pitLossPerStop) : null,
      traffic_loss: null,
      weather_adjustment: null,
      neutralization_adjustment: null,
      total_estimated: null,
    };
  }

  const pitLossTotal = pitLaps.length * pitLossPerStop;

  // Traffic loss
  const trafficLoss = trafficPredictions.length > 0
    ? trafficPredictions.reduce((sum, t) => sum + t.estimated_traffic_time_loss, 0)
    : null;

  // Weather adjustment: count wet/mixed laps — these are excluded from the model,
  // so we can't compute precise cost. Estimate based on typical wet lap penalty.
  const wetLapCount = [...weatherMap.values()].filter(w => w === "WET" || w === "MIXED").length;
  const weatherAdj = wetLapCount > 0 ? round1(wetLapCount * 2.0) : null; // ~2s average wet penalty estimate

  // Neutralization: SC laps are ~15-20s slower, VSC ~8-10s slower.
  // If pit was done under neutralization, estimate a benefit of ~10-15s saved pit loss.
  const scLaps = [...trackStatusMap.entries()].filter(([, s]) => s === "SC").length;
  const vscLaps = [...trackStatusMap.entries()].filter(([, s]) => s === "VSC").length;
  const pitsUnderNeutral = pitStopAnalyses.filter(p => p.under_neutralisation).length;

  let neutralAdj: number | null = null;
  if (scLaps > 0 || vscLaps > 0 || pitsUnderNeutral > 0) {
    // Benefit from pitting under neutralization: reduced relative pit loss
    // Under SC the field is bunched, effective pit loss is reduced by ~10-12s
    const pitBenefit = pitsUnderNeutral * -10;
    neutralAdj = round1(pitBenefit);
  }

  const totalEstimated = round1(
    baseTime + degCost + pitLossTotal +
    (trafficLoss ?? 0) +
    (weatherAdj ?? 0) +
    (neutralAdj ?? 0)
  );

  return {
    base_stint_time: round1(baseTime),
    tyre_degradation_cost: round1(degCost),
    pit_loss: round1(pitLossTotal),
    traffic_loss: trafficLoss != null ? round1(trafficLoss) : null,
    weather_adjustment: weatherAdj,
    neutralization_adjustment: neutralAdj,
    total_estimated: totalEstimated,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/* ── Format for UI ── */

export function breakdownToRows(b: StrategyBreakdown): BreakdownRow[] {
  const rows: BreakdownRow[] = [];

  if (b.base_stint_time != null) {
    rows.push({
      label: "Tempo base stint",
      value: b.base_stint_time,
      impact: "neutral",
      note: "Tempo stimato senza degrado gomme",
    });
  }

  if (b.tyre_degradation_cost != null) {
    rows.push({
      label: "Degrado gomme",
      value: b.tyre_degradation_cost,
      impact: b.tyre_degradation_cost > 3 ? "penalizing" : b.tyre_degradation_cost > 1 ? "neutral" : "favorable",
      note: b.tyre_degradation_cost > 5 ? "Stint troppo esteso" : "Perdita da usura pneumatici",
    });
  }

  if (b.pit_loss != null) {
    rows.push({
      label: "Tempo perso ai box",
      value: b.pit_loss,
      impact: "neutral",
      note: "Pit stop standard",
    });
  }

  if (b.traffic_loss != null) {
    rows.push({
      label: "Tempo perso nel traffico",
      value: b.traffic_loss,
      impact: b.traffic_loss > 2 ? "penalizing" : b.traffic_loss > 0 ? "neutral" : "favorable",
      note: b.traffic_loss > 2 ? "Rientro in traffico pesante" : b.traffic_loss > 0 ? "Rientro in traffico leggero" : "Rientro in aria pulita",
    });
  }

  if (b.weather_adjustment != null) {
    rows.push({
      label: "Impatto meteo",
      value: b.weather_adjustment,
      impact: b.weather_adjustment > 0 ? "penalizing" : b.weather_adjustment < 0 ? "favorable" : "neutral",
      note: b.weather_adjustment > 0 ? "Giri in condizioni bagnate/miste" : "Condizioni favorevoli",
    });
  }

  if (b.neutralization_adjustment != null) {
    rows.push({
      label: "Effetto neutralizzazione",
      value: b.neutralization_adjustment,
      impact: b.neutralization_adjustment < 0 ? "favorable" : b.neutralization_adjustment > 0 ? "penalizing" : "neutral",
      note: b.neutralization_adjustment < 0 ? "Pit durante SC/VSC (vantaggio)" : "Impatto neutralizzazione",
    });
  }

  return rows;
}
