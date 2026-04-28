import type { Driver, Lap, StintData, PitData, SessionInfo } from "./openf1";
import { detectLongRuns, type LongRunResult } from "./longRunDetector";

const MIN_LAPS_PRE_RACE = 7;

/**
 * Per-driver dataset for one session. Provided by the caller (no fetch here).
 */
export interface DriverSessionData {
  driver: Driver;
  sessionInfo: SessionInfo;
  laps: Lap[];
  stints: StintData[];
  pits: PitData[];
}

export interface RankingEntry {
  driverNumber: number;
  acronym: string;
  teamColour: string;
  teamName: string;
  longRun: LongRunResult;
  sessionName: string;
  paceRank: number;
}

export interface CompoundStress {
  compound: string;
  driversCount: number;
  slopeMedian: number;
  slopeIQR: number;
  paceMedian: number;
  variability: "COERENTE" | "VARIABILE";
  sampleConfidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface WatchListEntry {
  driverNumber: number;
  acronym: string;
  reason: string;
  signal: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
}

export interface PreRaceAnalysisResult {
  ranking: RankingEntry[];
  compoundStress: CompoundStress[];
  watchList: WatchListEntry[];
  totalDriversWithLongRun: number;
  lowSampleCaveat: boolean;
}

/**
 * Pure aggregator. Given per-driver per-session data (already fetched by the
 * caller), produces the cross-driver pre-race analysis.
 *
 * Pipeline:
 *  1. For each (driver, session), call detectLongRuns with minLaps=7.
 *  2. For each driver, pick the most-recent session's best valid long run.
 *     "Most recent" follows the order in which sessions are passed: the LAST
 *     session in input that has a valid long run for that driver wins.
 *  3. Build ranking sorted by avgLapTime ASC.
 *  4. Build compound stress aggregating across drivers' best long runs.
 *  5. Build watch list applying simple heuristics on the aggregated data.
 */
export function aggregatePreRaceLongRuns(
  driverSessions: DriverSessionData[],
): PreRaceAnalysisResult {
  const bestByDriver = new Map<number, {
    longRun: LongRunResult;
    sessionInfo: SessionInfo;
    driver: Driver;
  }>();

  for (const ds of driverSessions) {
    const longRuns = detectLongRuns(
      ds.driver.driver_number,
      ds.driver.name_acronym,
      ds.driver.team_colour,
      ds.laps,
      ds.stints,
      ds.pits,
      MIN_LAPS_PRE_RACE,
    );

    const validRuns = longRuns.filter((lr) => lr.isValidLongRun);
    if (!validRuns.length) continue;

    const bestInSession = validRuns.reduce((best, lr) =>
      lr.lapsCount > best.lapsCount ? lr : best,
    );

    bestByDriver.set(ds.driver.driver_number, {
      longRun: bestInSession,
      sessionInfo: ds.sessionInfo,
      driver: ds.driver,
    });
  }

  const ranking: RankingEntry[] = Array.from(bestByDriver.values())
    .map((v) => ({
      driverNumber: v.driver.driver_number,
      acronym: v.driver.name_acronym,
      teamColour: v.driver.team_colour,
      teamName: v.driver.team_name,
      longRun: v.longRun,
      sessionName: v.sessionInfo.session_name,
      paceRank: 0,
    }))
    .sort((a, b) => a.longRun.avgLapTime - b.longRun.avgLapTime);

  ranking.forEach((entry, idx) => {
    entry.paceRank = idx + 1;
  });

  const compoundStress = computeCompoundStress(ranking);
  const watchList = computeWatchList(ranking, compoundStress);

  return {
    ranking,
    compoundStress,
    watchList,
    totalDriversWithLongRun: ranking.length,
    lowSampleCaveat: ranking.length < 8,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function computeCompoundStress(ranking: RankingEntry[]): CompoundStress[] {
  const byCompound = new Map<string, RankingEntry[]>();
  for (const entry of ranking) {
    const c = entry.longRun.compound;
    if (!byCompound.has(c)) byCompound.set(c, []);
    byCompound.get(c)!.push(entry);
  }

  const result: CompoundStress[] = [];
  for (const [compound, entries] of byCompound) {
    const slopes = entries.map((e) => e.longRun.degradationSlope).sort((a, b) => a - b);
    const paces = entries.map((e) => e.longRun.avgLapTime).sort((a, b) => a - b);

    const slopeMedian = median(slopes);
    const slopeIQR = percentile(slopes, 75) - percentile(slopes, 25);
    const paceMedian = median(paces);

    const variability: CompoundStress["variability"] =
      slopeIQR > 0.05 ? "VARIABILE" : "COERENTE";

    let sampleConfidence: CompoundStress["sampleConfidence"];
    if (entries.length >= 6) sampleConfidence = "HIGH";
    else if (entries.length >= 3) sampleConfidence = "MEDIUM";
    else sampleConfidence = "LOW";

    result.push({
      compound,
      driversCount: entries.length,
      slopeMedian: Math.round(slopeMedian * 1000) / 1000,
      slopeIQR: Math.round(slopeIQR * 1000) / 1000,
      paceMedian: Math.round(paceMedian * 1000) / 1000,
      variability,
      sampleConfidence,
    });
  }

  const order: Record<string, number> = { SOFT: 0, MEDIUM: 1, HARD: 2 };
  result.sort((a, b) => {
    const oa = order[a.compound] ?? 99;
    const ob = order[b.compound] ?? 99;
    if (oa !== ob) return oa - ob;
    return a.compound.localeCompare(b.compound);
  });

  return result;
}

function computeWatchList(
  ranking: RankingEntry[],
  compoundStress: CompoundStress[],
): WatchListEntry[] {
  const watch: WatchListEntry[] = [];
  if (ranking.length < 3) return watch;

  const stressByCompound = new Map(compoundStress.map((cs) => [cs.compound, cs]));

  for (const entry of ranking) {
    const stress = stressByCompound.get(entry.longRun.compound);
    if (!stress || stress.driversCount < 3) continue;
    const delta = stress.slopeMedian - entry.longRun.degradationSlope;
    if (delta > 0.03) {
      watch.push({
        driverNumber: entry.driverNumber,
        acronym: entry.acronym,
        reason: `Degrado significativamente migliore della mediana ${entry.longRun.compound} (${entry.longRun.degradationSlope.toFixed(3)} vs ${stress.slopeMedian.toFixed(3)} s/giro)`,
        signal: "POSITIVE",
      });
    } else if (delta < -0.03) {
      watch.push({
        driverNumber: entry.driverNumber,
        acronym: entry.acronym,
        reason: `Degrado peggiore della mediana ${entry.longRun.compound} (${entry.longRun.degradationSlope.toFixed(3)} vs ${stress.slopeMedian.toFixed(3)} s/giro)`,
        signal: "NEGATIVE",
      });
    }
  }

  const sortedByLength = [...ranking]
    .filter((e) => e.longRun.lapsCount >= 12)
    .sort((a, b) => b.longRun.lapsCount - a.longRun.lapsCount)
    .slice(0, 3);

  for (const entry of sortedByLength) {
    if (watch.some((w) => w.driverNumber === entry.driverNumber)) continue;
    watch.push({
      driverNumber: entry.driverNumber,
      acronym: entry.acronym,
      reason: `Long run particolarmente lungo (${entry.longRun.lapsCount} giri ${entry.longRun.compound}) con fit affidabile`,
      signal: "NEUTRAL",
    });
  }

  const signalOrder: Record<WatchListEntry["signal"], number> = {
    NEGATIVE: 0, POSITIVE: 1, NEUTRAL: 2,
  };
  watch.sort((a, b) => signalOrder[a.signal] - signalOrder[b.signal]);
  return watch.slice(0, 5);
}
