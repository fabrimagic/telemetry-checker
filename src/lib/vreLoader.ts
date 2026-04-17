/**
 * Reusable VRE orchestrator.
 *
 * Encapsulates the data-fetching + compute pipeline that builds a
 * `VirtualRaceEngineerResult` for a single driver in a Race/Sprint session.
 * Mirrors the inline orchestrator in `src/pages/Index.tsx` but can be invoked
 * in parallel for multiple drivers (e.g. head-to-head comparison).
 *
 * Anti-hallucination: this module ONLY consumes existing public APIs from
 * `openf1.ts`, `virtualRaceEngineer.ts`, `keyDecisionMoments.ts`,
 * `cumulativeDeviation.ts`, `raceDiary.ts`, `longRunDetector.ts`. No business
 * logic is invented or duplicated here — the function is a thin orchestrator.
 */

import {
  getLaps,
  getStints,
  getPitStops,
  getSessionsByMeetingKey,
  getOvertakes,
  getOvertakesReceived,
  getIntervals,
  getPositions,
  getAllLaps,
  getSessionResult,
  type Driver,
  type Lap,
  type StintData,
  type PitData,
  type WeatherData,
  type RaceControlMessage,
  type IntervalData,
  type PositionData,
  type SessionInfo,
} from "./openf1";
import {
  computeVirtualRaceEngineer,
  type VirtualRaceEngineerResult,
  type PracticeCompoundModel,
  type AnalysisMode,
} from "./virtualRaceEngineer";
import { computeKeyDecisionMoments, type KeyDecisionMomentsResult } from "./keyDecisionMoments";
import { computeCumulativeDeviation, type CumulativeDeviationResult } from "./cumulativeDeviation";
import { classifyLapsWeather } from "./weatherClassification";
import { classifyLapsTrackStatus } from "./trackStatusClassification";
import { buildRaceDiary, type DiaryEvent } from "./raceDiary";
import { detectLongRuns } from "./longRunDetector";
import type { RiskMode } from "./riskAppetite";

export interface VreLoaderInput {
  driverNumber: number;
  driver: Driver;
  sessionKey: number;
  meetingKey: number;
  sessionWeather: WeatherData[];
  raceControlMessages: RaceControlMessage[];
  allDrivers: Driver[];
  riskMode?: RiskMode;
  analysisMode?: AnalysisMode;
  /**
   * If true, computes a SECOND VRE pass with analysisMode="POST_RACE" + riskMode="BALANCED"
   * to expose the "ex-ante / balanced" alternative strategy without re-fetching any data.
   * The primary `vreResult` still uses the requested mode; the alternative is exposed via
   * `alternativeVreResult` and is intended ONLY for the head-to-head comparison.
   */
  computeAlternative?: boolean;
  /**
   * Optional precomputed cumulative-deviation result. When provided, the loader SKIPS
   * its internal `getAllLaps` + `getSessionResult` fetch + `computeCumulativeDeviation`
   * and reuses this value. Recommended for head-to-head where two drivers run in parallel:
   * the data is session-scoped, so fetching it twice doubles API pressure and is the
   * typical cause of 429-induced gaps where one driver's `cumulative_deviation_context`
   * becomes "non disponibile" while the other works.
   */
  precomputedCumDev?: CumulativeDeviationResult | null;
}

export interface VreLoaderOutput {
  driverNumber: number;
  vreResult: VirtualRaceEngineerResult | null;
  /** Optional second VRE pass in POST_RACE + BALANCED. Null when not requested or insufficient data. */
  alternativeVreResult: VirtualRaceEngineerResult | null;
  kdmResult: KeyDecisionMomentsResult | null;
  diaryEvents: DiaryEvent[];
  laps: Lap[];
  stints: StintData[];
  pits: PitData[];
  intervals: IntervalData[];
  positions: PositionData[];
  cumDevResult: CumulativeDeviationResult | null;
  error: string | null;
}

/**
 * Fetch + compute VRE for a single driver. Safe to invoke in parallel via
 * `Promise.all([loadVreForDriver(a), loadVreForDriver(b)])` — the rate
 * limiter in `openf1.ts` (slot reservation on `nextAvailableTime`) handles
 * coordination between concurrent requests.
 */
export async function loadVreForDriver(input: VreLoaderInput): Promise<VreLoaderOutput> {
  const {
    driverNumber, driver, sessionKey, meetingKey,
    sessionWeather, raceControlMessages, allDrivers,
    riskMode = "BALANCED",
    analysisMode = "RACE_ENGINEER",
    computeAlternative = false,
    precomputedCumDev,
  } = input;

  const out: VreLoaderOutput = {
    driverNumber,
    vreResult: null,
    alternativeVreResult: null,
    kdmResult: null,
    diaryEvents: [],
    laps: [],
    stints: [],
    pits: [],
    intervals: [],
    positions: [],
    cumDevResult: null,
    error: null,
  };

  try {
    // Core driver data
    const laps = await getLaps(sessionKey, driverNumber);
    if (!laps.length) {
      out.error = "Nessun giro disponibile per il pilota";
      return out;
    }
    out.laps = laps;

    let stints: StintData[] = [];
    try { stints = await getStints(sessionKey, driverNumber); } catch { /* optional */ }
    out.stints = stints;

    let pits: PitData[] = [];
    try { pits = await getPitStops(sessionKey, driverNumber); } catch { /* optional */ }
    out.pits = pits;

    // Race-wide context (intervals/positions). These are session-scoped,
    // not driver-scoped — could be cached/shared upstream in future.
    let intervals: IntervalData[] = [];
    let positions: PositionData[] = [];
    try { intervals = await getIntervals(sessionKey); } catch { /* optional */ }
    try { positions = await getPositions(sessionKey); } catch { /* optional */ }
    out.intervals = intervals;
    out.positions = positions;

    // Race diary
    let diary: DiaryEvent[] = [];
    try {
      const [overtakes, overtakesReceived] = await Promise.all([
        getOvertakes(sessionKey, driverNumber).catch(() => []),
        getOvertakesReceived(sessionKey, driverNumber).catch(() => []),
      ]);
      diary = buildRaceDiary(
        driverNumber,
        overtakes,
        overtakesReceived,
        raceControlMessages,
        pits,
        stints,
        intervals,
        positions,
        allDrivers,
        laps,
      );
    } catch { /* optional */ }
    out.diaryEvents = diary;

    // Practice compound models from same meeting
    const practiceModels: PracticeCompoundModel[] = [];
    if (meetingKey) {
      try {
        const meetingSessions = await getSessionsByMeetingKey(meetingKey);
        const practiceSessions = meetingSessions.filter(
          (s: SessionInfo) => s.session_type === "Practice" && s.session_key !== sessionKey
        );

        for (const ps of practiceSessions) {
          try {
            const [pLaps, pStints] = await Promise.all([
              getLaps(ps.session_key, driverNumber),
              getStints(ps.session_key, driverNumber),
            ]);
            if (!pLaps.length || !pStints.length) continue;

            const pitInLaps: PitData[] = pStints
              .slice(0, -1)
              .map((s) => ({ lap_number: s.lap_end } as PitData));
            const longRuns = detectLongRuns(
              driverNumber, driver.name_acronym, "ffffff",
              pLaps, pStints, pitInLaps, 3
            );
            const validRuns = longRuns.filter((lr) => lr.isLongRun);

            for (const lr of validRuns) {
              const runLaps = pLaps.filter(
                (l) => l.lap_number >= lr.lapStartLongRun && l.lap_number <= lr.lapEndLongRun && l.lap_duration != null
              );
              if (runLaps.length < 3) continue;

              const originalStint = pStints.find((s) => s.stint_number === lr.stintNumber);
              if (!originalStint) continue;

              const xs = runLaps.map((l) => (originalStint.tyre_age_at_start ?? 0) + (l.lap_number - originalStint.lap_start));
              const ys = runLaps.map((l) => l.lap_duration!);
              const n = xs.length;
              let sx = 0, sy = 0, sxy = 0, sxx = 0;
              for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxy += xs[i] * ys[i]; sxx += xs[i] * xs[i]; }
              const d = n * sxx - sx * sx;
              if (d === 0) continue;
              const slope = (n * sxy - sx * sy) / d;
              const intercept = (sy - slope * sx) / n;
              const yMean = sy / n;
              let ssTot = 0, ssRes = 0;
              for (let i = 0; i < n; i++) {
                ssTot += (ys[i] - yMean) ** 2;
                ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;
              }
              const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

              const existingIdx = practiceModels.findIndex((m) => m.compound === lr.compound);
              if (existingIdx === -1) {
                practiceModels.push({ compound: lr.compound, slope, intercept, rSquared, source: ps.session_name });
              } else if (rSquared > practiceModels[existingIdx].rSquared) {
                practiceModels[existingIdx] = { compound: lr.compound, slope, intercept, rSquared, source: ps.session_name };
              }
            }
          } catch { /* skip individual practice errors */ }
        }
      } catch { /* optional */ }
    }

    // Cumulative deviation (winner-benchmark)
    let cumDev: CumulativeDeviationResult | null = null;
    try {
      const [sessionAllLaps, sessionResults] = await Promise.all([
        getAllLaps(sessionKey),
        getSessionResult(sessionKey),
      ]);
      if (sessionAllLaps.length && sessionResults.length) {
        cumDev = computeCumulativeDeviation(sessionKey, sessionAllLaps, sessionResults, allDrivers);
      }
    } catch { /* optional */ }
    out.cumDevResult = cumDev;

    // VRE
    const vre = computeVirtualRaceEngineer(
      driverNumber, driver.name_acronym, sessionKey,
      laps, stints, pits,
      sessionWeather, raceControlMessages,
      intervals, positions, allDrivers, practiceModels, riskMode,
      diary, cumDev,
      "REAL_CONTEXT", null, null, null,
      analysisMode,
    );
    out.vreResult = vre;

    // ── Optional: alternative VRE pass in POST_RACE + BALANCED ──
    // Re-uses every dataset already fetched above (no extra API calls).
    // Skipped if the primary pass is already POST_RACE+BALANCED, in which case
    // the recommended_strategy on `vre` is already the "ex-ante balanced" alternative.
    if (computeAlternative && vre) {
      const alreadyAlternative = analysisMode === "POST_RACE" && riskMode === "BALANCED";
      if (alreadyAlternative) {
        out.alternativeVreResult = vre;
      } else {
        try {
          const altVre = computeVirtualRaceEngineer(
            driverNumber, driver.name_acronym, sessionKey,
            laps, stints, pits,
            sessionWeather, raceControlMessages,
            intervals, positions, allDrivers, practiceModels, "BALANCED",
            diary, cumDev,
            "REAL_CONTEXT", null, null, null,
            "POST_RACE",
          );
          out.alternativeVreResult = altVre;
        } catch { /* optional — alternative is best-effort */ }
      }
    }

    // KDM
    if (vre) {
      try {
        const weatherMap = classifyLapsWeather(laps, sessionWeather);
        const trackStatusMap = classifyLapsTrackStatus(laps, raceControlMessages);
        const driverCumDev = cumDev?.drivers.find((d) => d.driver_number === driverNumber) ?? null;
        const totalLaps = Math.max(...laps.map((l) => l.lap_number));
        const kdm = computeKeyDecisionMoments({
          laps, stints, pitStops: pits,
          weatherMap, trackStatusMap,
          trafficAnalysis: vre.traffic_analysis,
          paceLossResults: vre.pace_loss_results,
          degradationValidations: vre.degradation_validations,
          diaryEvents: diary,
          driverCumDev,
          positions, intervals,
          driverNumber, driverAcronym: driver.name_acronym,
          sessionKey, totalLaps,
          softSensorsTimeline: vre.soft_sensors_timeline,
        });
        out.kdmResult = kdm;
      } catch { /* optional */ }
    }

    return out;
  } catch (e: any) {
    out.error = e?.message ?? "Errore caricamento analisi";
    return out;
  }
}
