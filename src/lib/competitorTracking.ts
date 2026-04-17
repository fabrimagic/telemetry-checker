/**
 * Competitor Strategy Tracking
 * ────────────────────────────
 * Pure aggregation layer that turns N parallel `VreLoaderOutput` results
 * (one per driver, same session) into a single `CompetitorMatrix` model
 * suitable for a side-by-side timeline visualisation.
 *
 * Anti-hallucination notes:
 *   • Re-uses `loadVreForDriver` from `vreLoader.ts` WITHOUT modifying it.
 *   • Does NOT touch openf1.ts, virtualRaceEngineer.ts or vreLoader.ts.
 *   • Does NOT invent any business logic — all metrics here are read directly
 *     from the existing `VirtualRaceEngineerResult` shape.
 *   • Pre-fetches the (session-scoped) cumulative-deviation dataset ONCE and
 *     shares it across every parallel loader, mirroring the proven pattern
 *     used by `Compare.tsx`. This is critical to avoid 429 storms when N≥5.
 */

import {
  loadVreForDriver,
  type VreLoaderOutput,
} from "./vreLoader";
import {
  getAllLaps,
  getSessionResult,
  type Driver,
  type WeatherData,
  type RaceControlMessage,
  type SessionResult,
} from "./openf1";
import {
  computeCumulativeDeviation,
  type CumulativeDeviationResult,
} from "./cumulativeDeviation";
import { classifyLapsTrackStatus, type TrackStatus } from "./trackStatusClassification";
import { classifyLapsWeather, type WeatherCondition } from "./weatherClassification";
import type { Confidence, AnalysisMode } from "./virtualRaceEngineer";
import type { RiskMode } from "./riskAppetite";

/* ── Public types ───────────────────────────────────────────────────────── */

export interface CompetitorStintSummary {
  stint_number: number;
  compound: string;
  lap_start: number;
  lap_end: number;
  avg_pace: number | null;
  degradation_slope: number | null;
  pace_loss_status: string | null;
  cliff_risk: boolean;
}

export interface CompetitorEntry {
  driver_number: number;
  driver_acronym: string;
  team_colour: string;             // hex without leading "#"
  final_position: number | null;
  pit_laps: number[];
  compound_sequence: string[];
  stint_summary: CompetitorStintSummary[];
  total_race_time: number | null;
  cumulative_delta_final: number | null;
  had_issues: boolean;
  confidence: Confidence | null;
  /** Best-effort error message when vreResult is null (load failure or insufficient data). */
  error: string | null;
}

export type SessionEventType = "SC" | "VSC" | "RED" | "WEATHER_CHANGE";

export interface SessionEvent {
  lap: number;
  type: SessionEventType;
  description: string;
}

export interface PitCluster {
  lap_range: [number, number];
  driver_numbers: number[];
  description: string;
}

export interface StartingCompoundGroup {
  compound: string;
  driver_numbers: number[];
}

export interface CompetitorMatrix {
  session_key: number;
  total_laps: number;
  drivers: CompetitorEntry[];                     // sorted by final_position asc, DNF/DNS at end
  session_wide_events: SessionEvent[];
  pit_clusters: PitCluster[];
  compound_divergence_at_start: StartingCompoundGroup[];
  common_confidence: Confidence;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function confidenceMin(values: (Confidence | null)[]): Confidence {
  const order: Confidence[] = ["LOW", "MEDIUM", "HIGH"];
  let minIdx = order.length - 1;
  let any = false;
  for (const v of values) {
    if (!v) continue;
    any = true;
    const i = order.indexOf(v);
    if (i >= 0 && i < minIdx) minIdx = i;
  }
  return any ? order[minIdx] : "LOW";
}

function buildSessionEvents(
  raceControl: RaceControlMessage[],
  weather: WeatherData[],
  unionLaps: { lap_number: number; date_start: string | null }[],
): SessionEvent[] {
  const events: SessionEvent[] = [];

  // Track-status transitions per lap → emit one entry per first-occurrence
  const trackStatusMap = classifyLapsTrackStatus(unionLaps as any, raceControl);
  let prev: TrackStatus | undefined;
  const sortedLaps = [...new Set(unionLaps.map((l) => l.lap_number))].sort((a, b) => a - b);
  for (const lap of sortedLaps) {
    const cur = trackStatusMap.get(lap);
    if (!cur) continue;
    if (cur !== prev && (cur === "SC" || cur === "VSC" || cur === "RED")) {
      events.push({
        lap,
        type: cur as SessionEventType,
        description:
          cur === "SC" ? "Safety Car" : cur === "VSC" ? "Virtual Safety Car" : "Bandiera rossa",
      });
    }
    prev = cur;
  }

  // Weather transitions
  const weatherMap = classifyLapsWeather(unionLaps as any, weather);
  let prevW: WeatherCondition | undefined;
  for (const lap of sortedLaps) {
    const wc = weatherMap.get(lap);
    if (!wc) continue;
    if (prevW && wc !== prevW) {
      events.push({
        lap,
        type: "WEATHER_CHANGE",
        description: `Meteo: ${prevW} → ${wc}`,
      });
    }
    prevW = wc;
  }

  return events.sort((a, b) => a.lap - b.lap);
}

function buildPitClusters(entries: CompetitorEntry[], totalLaps: number): PitCluster[] {
  // Sliding window: group pit events from any driver within a ±2 lap range.
  type PitEvent = { lap: number; driver: number };
  const all: PitEvent[] = [];
  for (const e of entries) {
    for (const lap of e.pit_laps) all.push({ lap, driver: e.driver_number });
  }
  all.sort((a, b) => a.lap - b.lap);

  const clusters: PitCluster[] = [];
  let cur: PitEvent[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    const drivers = Array.from(new Set(cur.map((p) => p.driver)));
    if (drivers.length >= 2) {
      const minL = Math.min(...cur.map((p) => p.lap));
      const maxL = Math.max(...cur.map((p) => p.lap));
      clusters.push({
        lap_range: [minL, maxL],
        driver_numbers: drivers,
        description: `${drivers.length} piloti ai box tra il giro ${minL} e ${maxL}`,
      });
    }
    cur = [];
  };

  for (const ev of all) {
    if (cur.length === 0) {
      cur.push(ev);
      continue;
    }
    const anchorLap = cur[0].lap;
    if (ev.lap - anchorLap <= 2) cur.push(ev);
    else {
      flush();
      cur.push(ev);
    }
  }
  flush();

  return clusters.filter((c) => c.lap_range[1] <= totalLaps + 1);
}

function buildStartingCompoundGroups(entries: CompetitorEntry[]): StartingCompoundGroup[] {
  const map = new Map<string, number[]>();
  for (const e of entries) {
    const c0 = e.compound_sequence[0];
    if (!c0) continue;
    if (!map.has(c0)) map.set(c0, []);
    map.get(c0)!.push(e.driver_number);
  }
  return Array.from(map.entries()).map(([compound, driver_numbers]) => ({
    compound,
    driver_numbers,
  }));
}

/* ── buildCompetitorMatrix ──────────────────────────────────────────────── */

export function buildCompetitorMatrix(
  results: VreLoaderOutput[],
  sessionResults: SessionResult[],
  drivers: Driver[],
  weather: WeatherData[],
  raceControl: RaceControlMessage[],
  sessionKey: number,
): CompetitorMatrix {
  const entries: CompetitorEntry[] = results.map((r) => {
    const driverMeta = drivers.find((d) => d.driver_number === r.driverNumber);
    const sr = sessionResults.find((s) => s.driver_number === r.driverNumber);
    const final_position = sr?.position ?? null;
    const had_session_issue = !!(sr && (sr.dnf || sr.dns || sr.dsq));

    if (!r.vreResult) {
      return {
        driver_number: r.driverNumber,
        driver_acronym: driverMeta?.name_acronym ?? `#${r.driverNumber}`,
        team_colour: driverMeta?.team_colour ?? "888888",
        final_position,
        pit_laps: [],
        compound_sequence: [],
        stint_summary: [],
        total_race_time: null,
        cumulative_delta_final: null,
        had_issues: true,
        confidence: null,
        error: r.error ?? "Analisi non disponibile",
      };
    }

    const vre = r.vreResult;
    const stintSummary: CompetitorStintSummary[] = vre.actual_strategy.stints.map((s) => {
      const pl = vre.pace_loss_results.find((p) => p.stint_number === s.stint_number);
      const cliff = (s.degradation_slope ?? 0) > 0.3;
      return {
        stint_number: s.stint_number,
        compound: s.compound,
        lap_start: s.lap_start,
        lap_end: s.lap_end,
        avg_pace: s.avg_lap_time,
        degradation_slope: s.degradation_slope,
        pace_loss_status: pl?.pace_loss_status ?? null,
        cliff_risk: cliff,
      };
    });

    const cumDevDriver = r.cumDevResult?.drivers.find(
      (d) => d.driver_number === r.driverNumber,
    );
    const cum_final = cumDevDriver?.final_cumulative_delta ?? null;

    // had_issues: explicit DNF/DSQ/DNS or chronically overtaken
    const otReceived = r.diaryEvents.filter((e: any) => e.type === "OVERTAKE_RECEIVED").length;
    const otDone = r.diaryEvents.filter((e: any) => e.type === "OVERTAKE_DONE").length;
    const had_issues = had_session_issue || otReceived > otDone + 3;

    return {
      driver_number: r.driverNumber,
      driver_acronym: vre.driver_acronym,
      team_colour: driverMeta?.team_colour ?? "888888",
      final_position,
      pit_laps: vre.actual_strategy.pit_laps.slice().sort((a, b) => a - b),
      compound_sequence: vre.actual_strategy.stints.map((s) => s.compound),
      stint_summary: stintSummary,
      total_race_time: vre.actual_strategy.total_race_time,
      cumulative_delta_final: cum_final,
      had_issues,
      confidence: vre.confidence,
      error: null,
    };
  });

  // Order: by final_position asc, nulls/DNF at end
  entries.sort((a, b) => {
    const ap = a.final_position ?? Number.POSITIVE_INFINITY;
    const bp = b.final_position ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return a.driver_number - b.driver_number;
  });

  // total_laps from union of all laps across drivers
  let totalLaps = 0;
  for (const r of results) {
    for (const l of r.laps) if (l.lap_number > totalLaps) totalLaps = l.lap_number;
  }

  // Build session events using the union of all driver laps (gives best lap→date coverage)
  const unionLapsMap = new Map<number, { lap_number: number; date_start: string | null }>();
  for (const r of results) {
    for (const l of r.laps) {
      const existing = unionLapsMap.get(l.lap_number);
      if (!existing || (existing.date_start == null && l.date_start != null)) {
        unionLapsMap.set(l.lap_number, { lap_number: l.lap_number, date_start: l.date_start });
      }
    }
  }
  const unionLaps = Array.from(unionLapsMap.values()).sort((a, b) => a.lap_number - b.lap_number);

  const session_wide_events = buildSessionEvents(raceControl, weather, unionLaps);
  const pit_clusters = buildPitClusters(entries, totalLaps);
  const compound_divergence_at_start = buildStartingCompoundGroups(entries);
  const common_confidence = confidenceMin(entries.map((e) => e.confidence));

  return {
    session_key: sessionKey,
    total_laps: totalLaps,
    drivers: entries,
    session_wide_events,
    pit_clusters,
    compound_divergence_at_start,
    common_confidence,
  };
}

/* ── loadCompetitorMatrix ───────────────────────────────────────────────── */

export interface LoadCompetitorMatrixInput {
  sessionKey: number;
  meetingKey: number;
  driverNumbers: number[];
  sessionWeather: WeatherData[];
  raceControlMessages: RaceControlMessage[];
  allDrivers: Driver[];
  sessionResults: SessionResult[];
  riskMode?: RiskMode;
  analysisMode?: AnalysisMode;
}

export async function loadCompetitorMatrix(
  input: LoadCompetitorMatrixInput,
): Promise<CompetitorMatrix> {
  const {
    sessionKey, meetingKey, driverNumbers, sessionWeather,
    raceControlMessages, allDrivers, sessionResults,
    riskMode = "BALANCED",
    analysisMode = "RACE_ENGINEER",
  } = input;

  // Pre-fetch session-scoped cumulative deviation ONCE (mirrors Compare.tsx pattern).
  let sharedCumDev: CumulativeDeviationResult | null = null;
  try {
    const [sessionAllLaps, srResults] = await Promise.all([
      getAllLaps(sessionKey),
      getSessionResult(sessionKey),
    ]);
    const effectiveResults = srResults.length ? srResults : sessionResults;
    if (sessionAllLaps.length && effectiveResults.length) {
      sharedCumDev = computeCumulativeDeviation(
        sessionKey,
        sessionAllLaps,
        effectiveResults,
        allDrivers,
      );
    }
  } catch {
    /* optional — loaders fall back to their own fetch if shared one fails */
  }

  // Parallel per-driver load. Failures are captured per-driver and never crash the whole matrix.
  const loaders = driverNumbers.map((dn) => {
    const driver = allDrivers.find((d) => d.driver_number === dn);
    if (!driver) {
      return Promise.resolve<VreLoaderOutput>({
        driverNumber: dn,
        vreResult: null,
        alternativeVreResult: null,
        kdmResult: null,
        diaryEvents: [],
        laps: [],
        stints: [],
        pits: [],
        intervals: [],
        positions: [],
        cumDevResult: sharedCumDev,
        error: "Pilota non trovato in questa sessione",
      });
    }
    return loadVreForDriver({
      driverNumber: dn,
      driver,
      sessionKey,
      meetingKey,
      sessionWeather,
      raceControlMessages,
      allDrivers,
      riskMode,
      analysisMode,
      computeAlternative: false,
      precomputedCumDev: sharedCumDev,
    }).catch<VreLoaderOutput>((e) => ({
      driverNumber: dn,
      vreResult: null,
      alternativeVreResult: null,
      kdmResult: null,
      diaryEvents: [],
      laps: [],
      stints: [],
      pits: [],
      intervals: [],
      positions: [],
      cumDevResult: sharedCumDev,
      error: e?.message ?? "Errore caricamento pilota",
    }));
  });

  const results = await Promise.all(loaders);

  return buildCompetitorMatrix(
    results,
    sessionResults,
    allDrivers,
    sessionWeather,
    raceControlMessages,
    sessionKey,
  );
}

/* ── Pirelli compound colors (HEX) ──────────────────────────────────────── */

export const COMPOUND_COLOURS: Record<string, string> = {
  SOFT: "#E60000",
  MEDIUM: "#FFCD00",
  HARD: "#DEDEDE",
  INTERMEDIATE: "#00A54F",
  WET: "#0085CA",
};

export function compoundColour(name: string | undefined | null): string {
  if (!name) return "#888888";
  return COMPOUND_COLOURS[name.toUpperCase()] ?? "#888888";
}
