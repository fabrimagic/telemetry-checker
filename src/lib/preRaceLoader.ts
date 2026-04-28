import {
  getSessionsByMeetingKey,
  getLaps,
  getStints,
  getPitStops,
  getSessionResult,
  type Driver,
  type SessionInfo,
  type SessionResult,
} from "./openf1";
import {
  detectWeekendFormat,
  getDataSourcesForFormat,
  type WeekendFormat,
} from "./weekendFormat";
import {
  aggregatePreRaceLongRuns,
  type DriverSessionData,
  type PreRaceAnalysisResult,
} from "./practiceLongRunAggregator";
import {
  buildQualifyingFingerprint,
  type QualifyingInput,
  type QualifyingFingerprintResult,
} from "./qualifyingFingerprint";
import {
  buildPreRaceNarrative,
  type PreRaceNarrativeResult,
} from "./preRaceNarrativeBuilder";

const BATCH_SIZE = 5;

export interface PreRaceLoaderInput {
  meetingKey: number;
  /** Drivers list — already fetched by the page (from the Race session). */
  drivers: Driver[];
  /** Used as session_key for deterministic template selection in Fase 3 narrative.
   *  Pass the Race session_key, OR the most recent session's key. */
  narrativeSessionKey: number;
}

export interface PreRaceLoaderOutput {
  /** STANDARD or SPRINT. STANDARD as fallback if sessions list is empty. */
  weekendFormat: WeekendFormat;
  /** Sessions actually used for long-run extraction (chronological order). Empty if none available. */
  practiceSessionsUsed: SessionInfo[];
  /** Output of Fase 1. ranking=[] if no data. */
  preRaceAnalysis: PreRaceAnalysisResult;
  /** Output of Fase 2. qualifyingDataAvailable=false if Quali not yet held. */
  qualifyingFingerprint: QualifyingFingerprintResult;
  /** Output of Fase 3. All arrays empty if no insights produced. */
  narrative: PreRaceNarrativeResult;
  /** Soft errors that didn't block the load. UI may render them as warnings. */
  warnings: string[];
  /** Hard error that prevented loading. null on success. */
  error: string | null;
}

/** Splits an array into chunks of size n. */
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function loadDriverSessionData(
  driver: Driver,
  sessionInfo: SessionInfo,
): Promise<DriverSessionData | null> {
  try {
    const [laps, stints, pits] = await Promise.all([
      getLaps(sessionInfo.session_key, driver.driver_number),
      getStints(sessionInfo.session_key, driver.driver_number).catch(() => []),
      getPitStops(sessionInfo.session_key, driver.driver_number).catch(() => []),
    ]);
    if (!laps.length) return null;
    return { driver, sessionInfo, laps, stints, pits };
  } catch {
    return null;
  }
}

async function loadAllDriversForSession(
  drivers: Driver[],
  sessionInfo: SessionInfo,
): Promise<DriverSessionData[]> {
  const out: DriverSessionData[] = [];
  const batches = chunk(drivers, BATCH_SIZE);
  for (const batch of batches) {
    const results = await Promise.all(
      batch.map((d) => loadDriverSessionData(d, sessionInfo)),
    );
    for (const r of results) if (r) out.push(r);
  }
  return out;
}

function extractBestQualiTime(duration: number | number[] | null): number | null {
  if (duration == null) return null;
  if (typeof duration === "number") return duration > 0 ? duration : null;
  if (Array.isArray(duration)) {
    const valid = duration.filter((d): d is number => typeof d === "number" && d > 0);
    return valid.length ? Math.min(...valid) : null;
  }
  return null;
}

function buildQualifyingInput(sessionResults: SessionResult[]): QualifyingInput[] {
  return sessionResults.map((r) => ({
    driverNumber: r.driver_number,
    qualifyingPosition: r.dnf || r.dns || r.dsq ? null : (r.position ?? null),
    qualifyingTime: extractBestQualiTime(r.duration),
  }));
}

/**
 * Main entry point. Orchestrates fetch + compute for the pre-race analysis.
 */
export async function loadPreRaceAnalysis(
  input: PreRaceLoaderInput,
): Promise<PreRaceLoaderOutput> {
  const { meetingKey, drivers, narrativeSessionKey } = input;
  const warnings: string[] = [];

  const emptyResult: PreRaceLoaderOutput = {
    weekendFormat: "STANDARD",
    practiceSessionsUsed: [],
    preRaceAnalysis: {
      ranking: [],
      compoundStress: [],
      watchList: [],
      totalDriversWithLongRun: 0,
      lowSampleCaveat: true,
    },
    qualifyingFingerprint: {
      entries: [],
      qualifyingDataAvailable: false,
      anomaliesCount: 0,
    },
    narrative: {
      compoundStressInsights: [],
      watchListInsights: [],
      qualiAnomalyInsights: [],
      totalInsights: 0,
    },
    warnings,
    error: null,
  };

  if (!drivers.length) {
    return { ...emptyResult, error: "Nessun pilota disponibile per il meeting selezionato" };
  }

  let sessions: SessionInfo[];
  try {
    sessions = await getSessionsByMeetingKey(meetingKey);
  } catch (e: any) {
    return { ...emptyResult, error: e?.message ?? "Errore caricamento sessioni del meeting" };
  }

  const weekendFormat = detectWeekendFormat(sessions);
  const practiceSessions = getDataSourcesForFormat(sessions, weekendFormat);

  if (!practiceSessions.length) {
    warnings.push("Nessuna sessione di pratica disponibile per questo meeting");
  }

  const driverSessions: DriverSessionData[] = [];
  for (const sess of practiceSessions) {
    const sessionData = await loadAllDriversForSession(drivers, sess);
    if (!sessionData.length) {
      warnings.push(`Sessione ${sess.session_name} senza dati utilizzabili`);
    }
    driverSessions.push(...sessionData);
  }

  const preRaceAnalysis = aggregatePreRaceLongRuns(driverSessions);

  const qualiSession = sessions.find((s) => s.session_name === "Qualifying") ?? null;
  let qualifyingInput: QualifyingInput[] = [];
  if (qualiSession) {
    try {
      const sessionResults = await getSessionResult(qualiSession.session_key);
      qualifyingInput = buildQualifyingInput(sessionResults);
    } catch (e: any) {
      warnings.push(`Quali results non disponibili: ${e?.message ?? "errore fetch"}`);
    }
  } else {
    warnings.push("Sessione di qualifica non trovata nel meeting");
  }

  const qualifyingFingerprint = buildQualifyingFingerprint(
    preRaceAnalysis.ranking,
    qualifyingInput,
  );

  const narrative = buildPreRaceNarrative(
    preRaceAnalysis,
    qualifyingFingerprint,
    narrativeSessionKey,
  );

  return {
    weekendFormat,
    practiceSessionsUsed: practiceSessions,
    preRaceAnalysis,
    qualifyingFingerprint,
    narrative,
    warnings,
    error: null,
  };
}
