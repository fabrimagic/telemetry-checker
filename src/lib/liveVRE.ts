import {
  calculateCorrectedTyreDegradation,
  DEFAULT_CORRECTED_CONFIG,
  type CorrectedDegradationResult,
} from "./correctedDegradation";
import {
  adaptLapsToPostRace,
  adaptStintsToPostRace,
} from "./liveDataBridge";
import type {
  LiveLap,
  LiveStint,
  LivePit,
  LiveWeather,
} from "./livedataClient";

export type LiveAdviceConfidence = "high" | "medium" | "low";

export interface LiveStrategyAdvice {
  driver_number: number;
  acronym: string;
  stint_number: number;
  compound: string;
  tyre_age: number;
  cliff_lap_estimate: number | null;
  cliff_source: "live_model" | "practice_prior" | "compound_default" | "none";
  pit_window: { from: number; to: number } | null;
  confidence: LiveAdviceConfidence;
  rationale: string;
  caveats: string[];
}

export interface PracticePrior {
  byCompound: Record<string, { cliffLapEstimate: number; rSquared: number }>;
}

const MIN_RACE_LAPS_FOR_LIVE_MODEL = 6;
const PIT_WINDOW_BEFORE_CLIFF_LAPS = 3;
/**
 * Cliff threshold in seconds of accumulated pace loss beyond stint baseline.
 * Not currently exposed by tyreCompoundProfiles → kept local with rationale.
 */
const CLIFF_PACE_LOSS_THRESHOLD_S = 1.0;

/** Compound-default cliff estimates (tyre age in laps). Used when neither
 *  a live-fitted model nor a practice prior is available. */
const CANONICAL_CLIFF_FALLBACK: Record<string, number> = {
  SOFT: 18,
  MEDIUM: 30,
  HARD: 42,
};

export function computeLiveStrategyAdvice(input: {
  driverNumber: number;
  acronym: string;
  raceLaps: LiveLap[];
  raceStints: LiveStint[];
  racePits: LivePit[];
  raceWeather: LiveWeather[];
  totalSessionLaps: number;
  practicePrior?: PracticePrior;
  currentLap: number;
  sessionKey: number;
}): LiveStrategyAdvice {
  const {
    driverNumber, acronym, raceLaps, raceStints, racePits,
    totalSessionLaps, practicePrior, currentLap, sessionKey,
  } = input;

  const currentStint = [...raceStints]
    .sort((a, b) => b.stint_number - a.stint_number)[0];

  if (!currentStint) {
    return {
      driver_number: driverNumber,
      acronym,
      stint_number: 0,
      compound: "",
      tyre_age: 0,
      cliff_lap_estimate: null,
      cliff_source: "none",
      pit_window: null,
      confidence: "low",
      rationale: "Nessuno stint identificato per questo pilota.",
      caveats: ["Dati di stint non disponibili."],
    };
  }

  const tyreAge =
    currentStint.tyre_age_at_start +
    Math.max(0, currentLap - currentStint.lap_start);

  const adaptedLaps = adaptLapsToPostRace(raceLaps, racePits, sessionKey);
  const adaptedStints = adaptStintsToPostRace(raceStints, currentLap, sessionKey);

  let liveResultForCompound: CorrectedDegradationResult | null = null;
  try {
    const liveResults = calculateCorrectedTyreDegradation(
      driverNumber,
      acronym,
      "#FFFFFF",
      adaptedLaps,
      adaptedStints,
      [],
      totalSessionLaps,
    );
    liveResultForCompound =
      liveResults.find((r) => r.stint === currentStint.stint_number) ?? null;
  } catch {
    liveResultForCompound = null;
  }

  const validLiveLapsCount = adaptedLaps.filter(
    (l) =>
      l.lap_number >= currentStint.lap_start &&
      !l.is_pit_out_lap &&
      l.lap_duration != null &&
      l.lap_duration > 0,
  ).length;

  let cliffEstimate: number | null = null;
  let cliffSource: LiveStrategyAdvice["cliff_source"] = "none";

  if (
    liveResultForCompound &&
    liveResultForCompound.rSquared >= 0.5 &&
    validLiveLapsCount >= MIN_RACE_LAPS_FOR_LIVE_MODEL
  ) {
    cliffEstimate = estimateCliffFromModel(
      currentStint.tyre_age_at_start,
      liveResultForCompound,
    );
    if (cliffEstimate != null) cliffSource = "live_model";
  }

  if (cliffSource === "none" && practicePrior?.byCompound[currentStint.compound]) {
    cliffEstimate = practicePrior.byCompound[currentStint.compound].cliffLapEstimate;
    cliffSource = "practice_prior";
  }

  if (cliffSource === "none") {
    const fallback = CANONICAL_CLIFF_FALLBACK[currentStint.compound?.toUpperCase()];
    if (fallback != null) {
      cliffEstimate = fallback;
      cliffSource = "compound_default";
    }
  }

  const confidence: LiveAdviceConfidence =
    cliffSource === "live_model"
      ? "high"
      : cliffSource === "practice_prior"
        ? "medium"
        : "low";

  let pitWindow: { from: number; to: number } | null = null;
  if (cliffEstimate != null && cliffEstimate > tyreAge) {
    const lapsToCliff = cliffEstimate - tyreAge;
    const from = Math.max(0, lapsToCliff - PIT_WINDOW_BEFORE_CLIFF_LAPS);
    const to = lapsToCliff;
    pitWindow = { from, to };
  }

  const rationale = buildRationaleIT(
    currentStint.compound,
    tyreAge,
    cliffEstimate,
    cliffSource,
    pitWindow,
  );
  const caveats = buildCaveatsIT(cliffSource, validLiveLapsCount);

  return {
    driver_number: driverNumber,
    acronym,
    stint_number: currentStint.stint_number,
    compound: currentStint.compound,
    tyre_age: tyreAge,
    cliff_lap_estimate: cliffEstimate,
    cliff_source: cliffSource,
    pit_window: pitWindow,
    confidence,
    rationale,
    caveats,
  };
}

function estimateCliffFromModel(
  ageAtStart: number,
  model: CorrectedDegradationResult,
): number | null {
  if (!model.slope_corrected || model.slope_corrected <= 0) return null;
  const lapsFromStart = CLIFF_PACE_LOSS_THRESHOLD_S / model.slope_corrected;
  if (!Number.isFinite(lapsFromStart)) return null;
  return Math.round(ageAtStart + lapsFromStart);
}

function buildRationaleIT(
  compound: string,
  tyreAge: number,
  cliff: number | null,
  source: LiveStrategyAdvice["cliff_source"],
  pitWindow: { from: number; to: number } | null,
): string {
  if (cliff == null) {
    return `Stint ${compound} a ${tyreAge} giri. Dati insufficienti per una stima del cliff.`;
  }
  const sourceLabel = {
    live_model: "modello di degrado live",
    practice_prior: "dati di prove libere",
    compound_default: "profilo standard di mescola",
    none: "nessuna fonte affidabile",
  }[source];
  if (pitWindow == null || pitWindow.to <= 0) {
    return `Stint ${compound} a ${tyreAge} giri (cliff stimato a ${cliff}, fonte: ${sourceLabel}). La gomma è oltre la finestra di pit ottimale.`;
  }
  return `Stint ${compound} a ${tyreAge} giri. Finestra di pit suggerita tra ${pitWindow.from} e ${pitWindow.to} giri (cliff stimato a ${cliff}, fonte: ${sourceLabel}).`;
}

function buildCaveatsIT(
  source: LiveStrategyAdvice["cliff_source"],
  validLiveLaps: number,
): string[] {
  const caveats: string[] = [
    "Stima ex-ante: non considera Safety Car, pioggia o decisioni del team avversario.",
    "Latenza dei dati live ~5-30s rispetto alla pista.",
  ];
  if (source === "compound_default") {
    caveats.push("Stima basata su profilo standard di mescola, non calibrato sul circuito attuale.");
  }
  if (source === "practice_prior") {
    caveats.push("In prove libere i piloti non spingono come in gara: la stima può essere ottimistica.");
  }
  if (source === "live_model" && validLiveLaps < 10) {
    caveats.push(`Modello live fittato su ${validLiveLaps} giri: la stima si stabilizzerà con più giri.`);
  }
  return caveats;
}
