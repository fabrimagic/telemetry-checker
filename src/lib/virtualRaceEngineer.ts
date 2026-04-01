import type {
  Lap, StintData, PitData, WeatherData, RaceControlMessage,
  IntervalData, PositionData, Driver,
} from "./openf1";
import { classifyLapsWeather, type WeatherCondition } from "./weatherClassification";
import { classifyLapsTrackStatus, type TrackStatus } from "./trackStatusClassification";
import { calculateTyreDegradation, type DegradationResult } from "./tyreDegradation";
import { predictTrafficForPitLaps, type TrafficPrediction, type TrafficLevel } from "./trafficPredictor";
import { computeStrategyBreakdown, type StrategyBreakdown } from "./strategyBreakdown";

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
): VirtualRaceEngineerResult | null {
  if (!stints.length || !laps.length) return null;

  const weatherMap = classifyLapsWeather(laps, weather);
  const trackStatusMap = classifyLapsTrackStatus(laps, raceControl);

  const pitLoss = estimatePitLoss(pitStops);
  const totalLaps = Math.max(...laps.map(l => l.lap_number));

  // ── 1. Actual strategy ──
  const stintAnalyses: StintAnalysis[] = [];
  const degradationModels = new Map<number, { slope: number; intercept: number }>();

  const degResults = calculateTyreDegradation(
    driverNumber, driverAcronym, "ffffff", laps, stints
  );
  for (const dr of degResults) {
    degradationModels.set(dr.stint, { slope: dr.slopeSecPerLap, intercept: dr.intercept });
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

    stintAnalyses.push({
      stint_number: stint.stint_number,
      compound: stint.compound,
      lap_start: stint.lap_start,
      lap_end: stint.lap_end,
      laps_count: stint.lap_end - stint.lap_start + 1,
      tyre_age_at_start: stint.tyre_age_at_start ?? 0,
      avg_lap_time: avgTime ? Math.round(avgTime * 1000) / 1000 : null,
      degradation_slope: model ? model.slope : null,
      r_squared: degResults.find(d => d.stint === stint.stint_number)?.rSquared ?? null,
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

  // Estimate total time for a given strategy
  function simulateTime(pitLaps: number[], compounds: string[]): number | null {
    // Enforce mandatory 2-compound rule
    if (!hasMinTwoCompounds(compounds)) return null;
    let total = 0;
    const stintBounds: { start: number; end: number; compound: string }[] = [];
    let start = 1;
    for (let i = 0; i < pitLaps.length; i++) {
      stintBounds.push({ start, end: pitLaps[i], compound: compounds[i] || compounds[0] });
      start = pitLaps[i] + 1;
    }
    stintBounds.push({ start, end: totalLaps, compound: compounds[compounds.length - 1] || compounds[0] });

    for (const sb of stintBounds) {
      const model = compoundModels.get(sb.compound);
      if (!model) return null;
      for (let lap = sb.start; lap <= sb.end; lap++) {
        const tyreLife = lap - sb.start;
        total += predictLapTime(model.slope, model.intercept, tyreLife);
      }
    }
    total += pitLaps.length * pitLoss;
    return total;
  }

  const actualCompounds = stints.map(s => s.compound);
  const actualPitLaps = pitStops.map(p => p.lap_number);
  const actualSimTime = simulateTime(actualPitLaps, actualCompounds);

  // ── 3. Find optimal pit window ──
  const recommendedWindows: RecommendedStrategy["pit_windows"] = [];
  let bestDelta = 0;
  let bestPitLaps = actualPitLaps;
  let bestCompounds = actualCompounds;
  let bestReason = "Strategia reale già vicina all'ottimale";

  // Try shifts of ±5 laps for each pit stop AND different compound combinations
  if (actualPitLaps.length > 0 && actualSimTime != null) {
    let bestTime = actualSimTime;

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

    const shifts = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
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

          const t = simulateTime(candidatePits, compounds);
          if (t != null && t < bestTime) {
            bestTime = t;
            bestPitLaps = candidatePits;
            bestCompounds = compounds;
            bestDelta = actualSimTime - t;
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

  if (actualPitLaps.length > 0 && actualSimTime != null) {
    // Undercut
    const undercutPits = actualPitLaps.map((p, i) => i === 0 ? Math.max(3, p - 3) : p);
    const undercutTime = simulateTime(undercutPits, actualCompounds);
    if (undercutTime != null) {
      alternatives.push({
        name: "Undercut anticipato",
        description: `Pit al giro ${undercutPits[0]} invece di ${actualPitLaps[0]}`,
        pit_laps: undercutPits,
        compounds: actualCompounds,
        estimated_delta_vs_actual: Math.round((actualSimTime - undercutTime) * 10) / 10,
        pros: ["Riduce esposizione al degrado", "Potenziale vantaggio in aria pulita"],
        cons: ["Stint successivo più lungo", "Rischio di perdere posizione se undercut non riuscito"],
      });
    }

    // Overcut
    const overcutPits = actualPitLaps.map((p, i) => i === 0 ? Math.min(totalLaps - 3, p + 3) : p);
    const overcutTime = simulateTime(overcutPits, actualCompounds);
    if (overcutTime != null) {
      alternatives.push({
        name: "Overcut / estensione stint",
        description: `Pit al giro ${overcutPits[0]} invece di ${actualPitLaps[0]}`,
        pit_laps: overcutPits,
        compounds: actualCompounds,
        estimated_delta_vs_actual: Math.round((actualSimTime - overcutTime) * 10) / 10,
        pros: ["Stint più corto su gomme fresche", "Potenziale track position"],
        cons: ["Maggiore degrado sulle gomme vecchie", "Rischio di perdere tempo nel traffico"],
      });
    }

    // Opposite compound if available (race compounds)
    const availableCompounds = [...new Set(actualCompounds)];
    if (availableCompounds.length >= 2) {
      const reversed = [...actualCompounds].reverse();
      const reversedTime = simulateTime(actualPitLaps, reversed);
      if (reversedTime != null) {
        alternatives.push({
          name: "Strategia compound invertiti",
          description: `Ordine mescole invertito: ${reversed.join(" → ")}`,
          pit_laps: actualPitLaps,
          compounds: reversed,
          estimated_delta_vs_actual: Math.round((actualSimTime - reversedTime) * 10) / 10,
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
        const altTime = simulateTime(actualPitLaps, altCompounds);
        if (altTime != null) {
          alternatives.push({
            name: `Stint finale su ${practiceCompound}`,
            description: `Ultimo stint con ${practiceCompound} (dati da Practice) invece di ${actualCompounds[actualCompounds.length - 1]}`,
            pit_laps: actualPitLaps,
            compounds: altCompounds,
            estimated_delta_vs_actual: Math.round((actualSimTime - altTime) * 10) / 10,
            pros: [`Degrado ${practiceCompound} stimato dalle prove libere`, "Compound alternativo non usato in gara"],
            cons: ["Stima basata su dati Practice (passo diverso dalla gara)", "Condizioni pista differenti tra prove e gara"],
          });
        }
      }

      // Try substituting the first stint compound
      if (actualCompounds.length >= 2) {
        const altCompounds = [...actualCompounds];
        altCompounds[0] = practiceCompound;
        const altTime = simulateTime(actualPitLaps, altCompounds);
        if (altTime != null) {
          alternatives.push({
            name: `Stint iniziale su ${practiceCompound}`,
            description: `Primo stint con ${practiceCompound} (dati da Practice) invece di ${actualCompounds[0]}`,
            pit_laps: actualPitLaps,
            compounds: altCompounds,
            estimated_delta_vs_actual: Math.round((actualSimTime - altTime) * 10) / 10,
            pros: [`Degrado ${practiceCompound} stimato dalle prove libere`, "Scelta strategica diversa all'inizio"],
            cons: ["Stima basata su dati Practice", "Condizioni pista e carburante differenti"],
          });
        }
      }
    }
  }

  // ── 4b. Traffic Release Predictor ──
  // Build allLaps map (only selected driver's laps available; predictor handles missing data)
  const allLapsMap = new Map<number, Lap[]>();
  allLapsMap.set(driverNumber, laps);

  // Generate candidate pit laps for traffic analysis (around actual pit laps ± 4)
  const candidatePitLaps: number[] = [];
  const actualFirstPit = actualPitLaps[0] ?? Math.floor(totalLaps / 2);
  for (let offset = -4; offset <= 4; offset += 2) {
    const candidate = actualFirstPit + offset;
    if (candidate >= 2 && candidate <= totalLaps - 2) {
      candidatePitLaps.push(candidate);
    }
  }

  const trafficAnalysis = predictTrafficForPitLaps(
    driverNumber,
    candidatePitLaps,
    pitLoss,
    totalLaps,
    allLapsMap,
    positions,
    intervals,
    allDrivers,
  );

  // Add traffic predictions to each alternative strategy
  for (const alt of alternatives) {
    if (alt.pit_laps.length > 0) {
      const altTraffic = predictTrafficForPitLaps(
        driverNumber,
        alt.pit_laps,
        pitLoss,
        totalLaps,
        allLapsMap,
        positions,
        intervals,
        allDrivers,
      );
      alt.traffic_predictions = altTraffic;

      // Adjust estimated delta with traffic loss
      const trafficLoss = altTraffic.reduce((sum, t) => sum + t.estimated_traffic_time_loss, 0);
      if (trafficLoss > 0) {
        alt.estimated_delta_vs_actual = Math.round((alt.estimated_delta_vs_actual - trafficLoss) * 10) / 10;
      }

      // Enrich pros/cons based on traffic
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

  // ── 5. Confidence ──
  const confidenceFactors: string[] = [];
  let confScore = 0;

  const validStints = stintAnalyses.filter(s => s.degradation_slope != null);
  if (validStints.length === stints.length) { confScore += 3; confidenceFactors.push("Modello di degrado disponibile per tutti gli stint"); }
  else if (validStints.length > 0) { confScore += 1; confidenceFactors.push(`Modello di degrado disponibile per ${validStints.length}/${stints.length} stint`); }
  else { confidenceFactors.push("Modello di degrado non disponibile"); }

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

  // ── 7. Verdict ──
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

  // Adjust confidence for practice data
  if (practiceCompoundsUsed.length > 0) {
    confScore += 1;
    confidenceFactors.push(`Degrado da Practice disponibile per: ${practiceCompoundsUsed.join(", ")}`);
  }

  return {
    driver_number: driverNumber,
    driver_acronym: driverAcronym,
    session_key: sessionKey,
    actual_strategy: actualStrategy,
    recommended_strategy: recommendedStrategy,
    alternative_strategies: alternatives,
    verdict: { label: verdictLabel, summary: verdictSummary, delta_seconds: bestDelta > 0.1 ? Math.round(bestDelta * 10) / 10 : null, confidence },
    confidence,
    confidence_factors: confidenceFactors,
    weather_impact: weatherImpact,
    neutralisation_impact: neutralisationImpact,
    practice_compounds_used: practiceCompoundsUsed,
    traffic_analysis: trafficAnalysis,
  };
}
