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
  getCarData,
  type Driver,
  type Lap,
  type StintData,
  type PitData,
  type WeatherData,
  type RaceControlMessage,
  type IntervalData,
  type PositionData,
  type SessionInfo,
  type CarData,
} from "./openf1";
import { estimateLapWork, estimateTotalWork, type LapWorkEstimate } from "./fuelEstimator";
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
import { calculateTyreDegradation } from "./tyreDegradation";
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
    const laps = await getLaps(sessionKey, driverNumber, { forceFresh: true });
    if (!laps.length) {
      out.error = "Nessun giro disponibile per il pilota";
      return out;
    }
    out.laps = laps;

    let stints: StintData[] = [];
    try { stints = await getStints(sessionKey, driverNumber, { forceFresh: true }); } catch { /* optional */ }
    out.stints = stints;

    let pits: PitData[] = [];
    try { pits = await getPitStops(sessionKey, driverNumber, { forceFresh: true }); } catch { /* optional */ }
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

    // Practice compound models from same meeting — fully delegated to the main
    // engine. detectLongRuns identifies the consecutive candidate sequence,
    // calculateTyreDegradation returns statistically validated parameters.
    // No inline regression here.
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

            const pitInLapsForPractice: PitData[] = pStints
              .slice(0, -1)
              .map((s) => ({ lap_number: s.lap_end } as PitData));
            const longRuns = detectLongRuns(
              driverNumber, driver.name_acronym, "ffffff",
              pLaps, pStints, pitInLapsForPractice,
              5,
            );
            const validRuns = longRuns.filter((lr) => lr.isValidLongRun);

            for (const lr of validRuns) {
              const originalStint = pStints.find((s) => s.stint_number === lr.stintNumber);
              if (!originalStint) continue;

              const virtualStint: StintData = {
                ...originalStint,
                lap_start: lr.lapStartLongRun,
                lap_end: lr.lapEndLongRun,
              };
              const runLaps = pLaps.filter(
                (l) => l.lap_number >= lr.lapStartLongRun && l.lap_number <= lr.lapEndLongRun,
              );

              const degResults = calculateTyreDegradation(
                driverNumber, driver.name_acronym, "ffffff",
                runLaps, [virtualStint],
              );
              if (!degResults.length) continue;
              const deg = degResults[0];

              const existingIdx = practiceModels.findIndex((m) => m.compound === lr.compound);
              if (existingIdx === -1) {
                practiceModels.push({
                  compound: lr.compound,
                  slope: deg.slopeSecPerLap,
                  intercept: deg.intercept,
                  rSquared: deg.rSquared,
                  source: ps.session_name,
                });
              } else if (deg.rSquared > practiceModels[existingIdx].rSquared) {
                practiceModels[existingIdx] = {
                  compound: lr.compound,
                  slope: deg.slopeSecPerLap,
                  intercept: deg.intercept,
                  rSquared: deg.rSquared,
                  source: ps.session_name,
                };
              }
            }
          } catch { /* skip individual practice errors */ }
        }
      } catch { /* optional */ }
    }

    // Cumulative deviation (winner-benchmark) — reuse precomputed value when provided
    // (head-to-head loads two drivers in parallel; fetching session-scoped data twice
    //  doubles 429 risk and can produce asymmetric "non disponibile" gaps).
    let cumDev: CumulativeDeviationResult | null = precomputedCumDev ?? null;
    if (cumDev == null) {
      try {
        const [sessionAllLaps, sessionResults] = await Promise.all([
          getAllLaps(sessionKey),
          getSessionResult(sessionKey),
        ]);
        if (sessionAllLaps.length && sessionResults.length) {
          cumDev = computeCumulativeDeviation(sessionKey, sessionAllLaps, sessionResults, allDrivers);
        }
      } catch { /* optional */ }
    }
    out.cumDevResult = cumDev;

    // ── Fuel proxy: throttle×rpm integral via CarData ──
    // Single getCarData call per driver/session (rate-limit friendly).
    // If it fails or coverage is insufficient, we fall back silently — the
    // primary degradation path uses the configured default proxy regardless.
    let lapWorkEstimates: LapWorkEstimate[] | undefined;
    let totalEstimatedWork: number | undefined;
    try {
      const lapDates = laps.map((l) => l.date_start).filter((d): d is string => !!d).sort();
      if (lapDates.length >= 2) {
        const sessionStart = lapDates[0];
        // Pad end by 5 minutes to capture the final lap's samples.
        const sessionEndMs = new Date(lapDates[lapDates.length - 1]).getTime() + 5 * 60 * 1000;
        const sessionEnd = new Date(sessionEndMs).toISOString();
        const carData: CarData[] = await getCarData(sessionKey, driverNumber, sessionStart, sessionEnd);
        if (carData.length) {
          lapWorkEstimates = estimateLapWork(laps, carData);
          const totalLapsForEstimate = Math.max(...laps.map((l) => l.lap_number));
          const total = estimateTotalWork(lapWorkEstimates, totalLapsForEstimate);
          if (total != null) totalEstimatedWork = total;
        }
      }
    } catch { /* optional — fuel proxy is best-effort */ }

    // VRE
    const vre = computeVirtualRaceEngineer(
      driverNumber, driver.name_acronym, sessionKey,
      laps, stints, pits,
      sessionWeather, raceControlMessages,
      intervals, positions, allDrivers, practiceModels, riskMode,
      diary, cumDev,
      "REAL_CONTEXT", null, null, null,
      analysisMode,
      lapWorkEstimates,
      totalEstimatedWork,
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
            lapWorkEstimates,
            totalEstimatedWork,
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
