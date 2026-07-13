/**
 * Car profiles (Phase 2 of "Anteprima GP").
 *
 * Derives a per-team profile with TWO measurable indicators from OpenF1:
 *   - top_speed_index: end-of-straight trap speed potential (Lap.st_speed)
 *   - sector_strength: relative strength per sector S1/S2/S3
 *     (Lap.duration_sector_1/2/3)
 *
 * METHODOLOGICAL NOTE (important):
 *  Sector times mix car, driver, and lap-conditions. Comparing absolute
 *  seconds across different circuits is meaningless. We therefore normalize
 *  PER RACE (each team gets a 0..1 score within that race) and then
 *  combine across races with a recency-weighted average. This mitigates,
 *  but does NOT eliminate, the driver/conditions confound. The profile is
 *  a coarse ESTIMATE of car character — not a clean measurement. Confidence
 *  stays cautious accordingly; Phase 4 will surface the caveats in UI.
 *
 * Top speed uses the per-driver p90 of st_speed (robust to outliers while
 * still capturing top-end potential). Team raw value per race = max across
 * its drivers' p90 (best representative of car potential).
 *
 * Sector raw value per race = min across its drivers' medians for each
 * sector (lower is faster). Each sector is then normalized within the race
 * (1 = best team that race, 0 = worst).
 *
 * On-demand: nothing runs at module load. Use OpenF1 primitives (rate
 * limiter / dedup applied there). No raw fetches added, no CarData usage.
 */

import {
  getAllLaps,
  getDrivers,
  getQualifyingSessionsByYear,
  getRaceSessionsByYear,
  type Driver,
  type Lap,
  type SessionInfo,
} from "./openf1";
import type { SessionCornerAnalysis } from "./cornerAnalysis";
import { CIRCUIT_PROFILES } from "./circuitProfiles";
import { resolveCalendarGpName } from "./circuitGeometry";

export interface CarProfile {
  team_name: string;
  /**
   * 0..1, 1 = best in field. Represents primarily the QUALIFYING potential
   * of the engine + low-fuel package (see TOP_SPEED_QUALI_WEIGHT below): in
   * race conditions the trap speed is depressed by lift&coast, ERS
   * management, fuel weight and conservative engine maps, so qualifying is
   * a much cleaner proxy of raw straight-line capability.
   */
  top_speed_index: number;
  sector_strength: { s1: number; s2: number; s3: number }; // 0..1, 1 = best
  /** Number of races with usable data that contributed to this team. */
  sample_races: number;
  /**
   * Kish effective sample size for this team:
   *   (Σ w_i)² / Σ(w_i²)
   * where w_i is the recency weight of each contributing race. Equals
   * sample_races with uniform weights, lower when a few high-weight races
   * dominate. Used for confidence so that including many low-weight old
   * races does NOT inflate confidence.
   */
  effective_sample_races: number;
  sample_laps: number;
  confidence: "high" | "medium" | "low";
  /**
   * EXPERIMENTAL — per-corner-type strength (0..1, 1 = best in field) built
   * from QUALIFYING /location + /car_data via cornerAnalysis. Populated
   * only when the aggregated spatial coverage is ≥ CORNER_COVERAGE_MIN;
   * otherwise null and the consumer should fall back to sector_strength.
   */
  corner_type_strength?: { slow: number; medium: number; fast: number } | null;
  /**
   * Aggregated 0..1 spatial coverage across the contributing GPs.
   * Always populated when the analyzer produced any coverage measurement
   * for this team, EVEN when coverage is below CORNER_COVERAGE_MIN
   * (diagnostic value, preserved so the UI can show why the gate rejected
   * the geometric branch). `null` only when coverage was not measurable at
   * all (no analyzer injected, analyzer error, no /location data).
   */
  corner_data_coverage?: number | null;
  /**
   * Diagnostic-only: aggregated 0..1 coverage restricted to CORNER vertices
   * (slow/medium/fast segments, straights excluded). Lets us tell whether
   * corners are covered better/worse than the full track. Does NOT affect
   * the gate (which still uses corner_data_coverage). `null` when not
   * measurable for this team.
   */
  corner_coverage_curve?: number | null;
  /**
   * Which method produced the cornering signal for this team:
   *  - "location_geometry":     derived from GPS + circuit layout (granular, gold standard)
   *  - "sector_typed_history":  estimate per corner-type aggregated from past
   *                             races using the sector_corner_map of EACH past
   *                             circuit (Opzione A). Available far more often
   *                             than location_geometry — does not depend on GPS.
   *  - "sector_fallback":       neither available → consumer falls back to sector_strength
   */
  corner_source?: "location_geometry" | "sector_typed_history" | "sector_fallback";
  /**
   * Diagnostic summary of the GPS-coverage gate outcome for this team:
   *  - "ok":              coverage measured and ≥ CORNER_COVERAGE_MIN
   *  - "below_threshold": coverage measured but < CORNER_COVERAGE_MIN
   *                       (fallback applies; value preserved on
   *                       corner_data_coverage for diagnosis)
   *  - "not_available":   coverage not measurable (no analyzer / no data /
   *                       analyzer error) → corner_data_coverage is null
   */
  corner_coverage_status?: "ok" | "below_threshold" | "not_available";
  /**
   * Diagnostic-only: aggregated Procrustes residual (normalised RMS) of
   * the GPS↔layout shape alignment. Lower is better; values around 1 mean
   * the alignment failed to lock. `null` when not measured (no analyzer /
   * no GPS data / degenerate-bbox-fallback for every contributing GP).
   * Does NOT affect the gate or the affinity score.
   */
  corner_alignment_error?: number | null;
  /**
   * ADDITIVE, retrocompatible: per-team historical series of the
   * per-race normalized sector score (mean of s1/s2/s3 after quali+race
   * combination, in the range [0,1]) together with the GP name (resolved
   * via {@link resolveCalendarGpName}) and the recency weight applied by
   * this aggregation. Preserved so downstream consumers (e.g. the
   * `teamSensitivity` diagnostic model) can run a regression against
   * per-circuit features. Undefined only if the team contributed to no
   * usable race.
   */
  race_history?: TeamRaceHistoryEntry[];
}

export interface TeamRaceHistoryEntry {
  gpName: string;
  date_end: string;
  /** Recency weight assigned to this race by the aggregation. */
  weight: number;
  /** Mean of per-race normalized s1/s2/s3 for this team, [0,1]. */
  sectors_normalized: number;
  /** Per-race normalized top-speed index for this team, or null. */
  top_speed_normalized: number | null;
}

/**
 * Normalization mode used to convert per-race raw team metrics into a
 * comparable [0,1] score:
 *  - "min_max"   (DEFAULT, unchanged production behavior): best team maps
 *    to 1, worst to 0. Amplifies small gaps.
 *  - "gap_ratio" (CANDIDATE): the best team maps to 1 and everyone else
 *    to a proportional ratio close to 1 that preserves the actual size
 *    of the gap (sectors: t_best/t_team; top speed: v_team/v_best). Used
 *    ONLY as an alternative candidate in the backtest — not wired into
 *    production.
 */
export type NormalizationMode = "min_max" | "gap_ratio";

/**
 * Minimum aggregated /location coverage for a team to be considered
 * trustworthy on the per-corner-type dimension. Below this threshold the
 * spatial alignment is too thin to be meaningful and we fall back to the
 * sector-strength estimate, which doesn't depend on GPS alignment.
 */
export const CORNER_COVERAGE_MIN = 0.5;

export type RaceDiagnosticStatus = "used" | "no_data" | "fetch_failed";

export interface RaceDiagnostic {
  name: string;
  date_end: string;
  status: RaceDiagnosticStatus;
  /**
   * Which sessions were actually available and contributed to this GP's
   * aggregation. Both can be true (ideal), or just one (fallback). Both
   * false implies status !== "used".
   */
  sources?: { quali: boolean; race: boolean };
}

export interface ComputeCarProfilesResult {
  profiles: CarProfile[];
  races_used: SessionInfo[];
  aborted: boolean;
  /** Diagnostics for each considered race (used | no_data | fetch_failed). */
  races_diagnostics: RaceDiagnostic[];
  /** Number of races effectively iterated. */
  races_considered: number;
  /** Total number of past 2026 races. */
  total_past_races: number;
  /**
   * Optional alternative profile array normalized with the "gap_ratio"
   * mode. Populated only when {@link ComputeCarProfilesOptions.emitGapRatioVariant}
   * is true. Contains only the two dimensions used by the sectors_only
   * baseline (top_speed_index + sector_strength); the corner/coverage
   * diagnostics are NOT re-computed here — they are shared with the
   * primary `profiles`. Consumers that need corner diagnostics must
   * use `profiles`.
   */
  profiles_gap_ratio?: CarProfile[];
}

function sessionDisplayName(s: SessionInfo): string {
  return s.location ?? s.country_name ?? s.session_name ?? `Session ${s.session_key}`;
}

export interface ComputeCarProfilesOptions {
  /**
   * Optional cap on how many of the most recent past races to consider.
   * When omitted (default) ALL past 2026 races are included; recency is
   * handled via continuous weight decay (see RECENCY_HALFLIFE_RACES), not
   * via a hard cutoff. The parameter remains for backward-compat / tests.
   */
  lastNRaces?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Override "now" for testing. */
  now?: Date;
  /**
   * Optional injected analyzer for the per-GP corner-type dimension.
   * Receives the QUALIFYING session and the list of driver_numbers to
   * sample (one representative per team to bound /location load), and
   * must return a SessionCornerAnalysis or null. When omitted the corner
   * dimension is skipped — profiles are still computed, just without
   * corner_type_strength (consumers fall back to sector_strength).
   *
   * Heavy: /location is one request per driver. Errors are absorbed
   * (treated as no data → sector_fallback).
   */
  analyzeQualiCorners?: (
    qualiSession: SessionInfo,
    driverNumbers: number[],
  ) => Promise<SessionCornerAnalysis | null>;
  /**
   * Normalization mode used to convert per-race raw team metrics into
   * comparable [0,1] scores. Defaults to "min_max" (current production
   * behavior). "gap_ratio" is exposed only as an alternative candidate
   * for backtest evaluation; setting it does NOT change any production
   * call site.
   */
  normalizationMode?: NormalizationMode;
  /**
   * When true, computeCarProfiles produces an ADDITIONAL profile array
   * computed with the alternative "gap_ratio" normalization, exposed on
   * the result as `profiles_gap_ratio`. The primary `profiles` field is
   * NOT affected: it still uses {@link normalizationMode} (default
   * "min_max"). Motivation: the backtest can measure the gap_ratio
   * candidate without paying a second full data-fetch pass. Cheap: only
   * an in-memory second aggregation of the already-fetched laps.
   */
  emitGapRatioVariant?: boolean;
}

/**
 * Half-life of the recency weight, in races.
 *
 * For a race with age a (a = 0 for the most recent, 1 for the previous, ...)
 * the weight is:
 *
 *     w(a) = 0.5 ^ (a / RECENCY_HALFLIFE_RACES)
 *
 * The decay is smooth and continuous; there is no hard cutoff. A race that
 * is RECENCY_HALFLIFE_RACES old contributes half as much as the most
 * recent one. Rationale: 2026 has a new technical regulation and few
 * races, so discarding old races wastes signal; at the same time, ongoing
 * upgrades make recent races more representative of the current cars.
 */
export const RECENCY_HALFLIFE_RACES = 3;

/**
 * Weights for combining the two SOURCES (qualifying vs race) WITHIN the
 * same GP. These are differentiated per-dimension because the two sessions
 * carry different physical information:
 *
 *  - Top speed: in race trim st_speed is depressed by lift&coast, ERS
 *    deployment strategy, fuel weight and conservative engine maps. In
 *    qualifying everything is at its peak (party mode, ERS dumped, light
 *    car, fresh tyres). Qualifying is therefore the much cleaner proxy of
 *    raw straight-line capability and is given a dominant weight.
 *
 *  - Cornering (sector medians): in race the sustainable corner pace —
 *    which factors in tyre management — is real, useful information, not
 *    just noise. We therefore balance qualifying and race more evenly so
 *    that long-run grip contributes to the cornering index too.
 *
 * NOTE: this within-GP combination is ORTHOGONAL to the across-GP recency
 * weighting (RECENCY_HALFLIFE_RACES). Pipeline:
 *   1. combine quali + race INSIDE the same GP → one normalized map per GP
 *   2. combine GPs across each other with the recency decay above
 */
export const TOP_SPEED_QUALI_WEIGHT = 0.75;
export const TOP_SPEED_RACE_WEIGHT = 0.25;
export const CORNER_QUALI_WEIGHT = 0.5;
export const CORNER_RACE_WEIGHT = 0.5;

// ----- statistic helpers -----

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return quantile(s, 0.5);
}

function p90(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return quantile(s, 0.9);
}

/** Normalize so the maximum maps to 1 and minimum to 0 (min-max), or so
 * that best maps to 1 and others map to v_team/v_best (gap-ratio). */
function normalizeHigherIsBetter(
  map: Map<string, number>,
  mode: NormalizationMode = "min_max",
): Map<string, number> {
  const vals = [...map.values()].filter((v) => Number.isFinite(v));
  if (vals.length === 0) return new Map();
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const out = new Map<string, number>();
  for (const [k, v] of map.entries()) {
    if (!Number.isFinite(v)) continue;
    if (mode === "gap_ratio") {
      // best value maps to 1; others to v/best. Preserves proportional gaps.
      out.set(k, max > 0 ? v / max : 1);
    } else {
      out.set(k, max === min ? 1 : (v - min) / (max - min));
    }
  }
  return out;
}

/** Lower is better → invert. Under gap_ratio: best/v (times close to 1). */
function normalizeLowerIsBetter(
  map: Map<string, number>,
  mode: NormalizationMode = "min_max",
): Map<string, number> {
  const vals = [...map.values()].filter((v) => Number.isFinite(v));
  if (vals.length === 0) return new Map();
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const out = new Map<string, number>();
  for (const [k, v] of map.entries()) {
    if (!Number.isFinite(v)) continue;
    if (mode === "gap_ratio") {
      out.set(k, v > 0 ? min / v : 1);
    } else {
      out.set(k, max === min ? 1 : (max - v) / (max - min));
    }
  }
  return out;
}

// ----- per-race aggregation -----

interface RaceTeamMetrics {
  /** normalized 0..1 per dimension (1=best) for each team present in this race */
  topSpeed: Map<string, number>;
  s1: Map<string, number>;
  s2: Map<string, number>;
  s3: Map<string, number>;
  /** lap counts contributing per team (max across dimensions) */
  lapsByTeam: Map<string, number>;
}

function aggregateRace(
  laps: Lap[],
  drivers: Driver[],
  mode: NormalizationMode = "min_max",
): RaceTeamMetrics | null {
  const teamByDriver = new Map<number, string>();
  for (const d of drivers) {
    if (d.team_name) teamByDriver.set(d.driver_number, d.team_name);
  }

  // Group laps per driver (only valid laps: not pit-out, lap_duration > 0)
  const lapsByDriver = new Map<number, Lap[]>();
  for (const lap of laps) {
    if (lap.is_pit_out_lap) continue;
    if (lap.lap_duration == null || lap.lap_duration <= 0) continue;
    const arr = lapsByDriver.get(lap.driver_number) ?? [];
    arr.push(lap);
    lapsByDriver.set(lap.driver_number, arr);
  }

  // Per-driver: p90 st_speed, median of each sector
  const driverTopSpeed = new Map<number, number>();
  const driverS1 = new Map<number, number>();
  const driverS2 = new Map<number, number>();
  const driverS3 = new Map<number, number>();
  const driverLapCount = new Map<number, number>();

  for (const [drv, dLaps] of lapsByDriver.entries()) {
    const speeds = dLaps
      .map((l) => l.st_speed)
      .filter((v): v is number => v != null && v > 0);
    if (speeds.length > 0) driverTopSpeed.set(drv, p90(speeds));

    const sectorLaps = dLaps.filter(
      (l) =>
        l.duration_sector_1 != null && l.duration_sector_1 > 0 &&
        l.duration_sector_2 != null && l.duration_sector_2 > 0 &&
        l.duration_sector_3 != null && l.duration_sector_3 > 0,
    );
    if (sectorLaps.length > 0) {
      driverS1.set(drv, median(sectorLaps.map((l) => l.duration_sector_1!)));
      driverS2.set(drv, median(sectorLaps.map((l) => l.duration_sector_2!)));
      driverS3.set(drv, median(sectorLaps.map((l) => l.duration_sector_3!)));
    }
    driverLapCount.set(drv, dLaps.length);
  }

  // Team raw values: aggregate over drivers
  const teamTop = new Map<string, number>(); // higher better
  const teamS1 = new Map<string, number>(); // lower better
  const teamS2 = new Map<string, number>();
  const teamS3 = new Map<string, number>();
  const teamLaps = new Map<string, number>();

  function pushBest(
    map: Map<string, number>,
    team: string,
    val: number,
    mode: "max" | "min",
  ) {
    const cur = map.get(team);
    if (cur == null) map.set(team, val);
    else if (mode === "max" && val > cur) map.set(team, val);
    else if (mode === "min" && val < cur) map.set(team, val);
  }

  for (const [drv, team] of teamByDriver.entries()) {
    const ts = driverTopSpeed.get(drv);
    if (ts != null) pushBest(teamTop, team, ts, "max");
    const s1 = driverS1.get(drv);
    const s2 = driverS2.get(drv);
    const s3 = driverS3.get(drv);
    if (s1 != null) pushBest(teamS1, team, s1, "min");
    if (s2 != null) pushBest(teamS2, team, s2, "min");
    if (s3 != null) pushBest(teamS3, team, s3, "min");
    const lc = driverLapCount.get(drv) ?? 0;
    teamLaps.set(team, (teamLaps.get(team) ?? 0) + lc);
  }

  if (teamTop.size === 0 && teamS1.size === 0) return null;

  return {
    topSpeed: normalizeHigherIsBetter(teamTop, mode),
    s1: normalizeLowerIsBetter(teamS1, mode),
    s2: normalizeLowerIsBetter(teamS2, mode),
    s3: normalizeLowerIsBetter(teamS3, mode),
    lapsByTeam: teamLaps,
  };
}

/**
 * Combine two per-session normalized maps (quali + race) into a single
 * per-GP map using the provided weights. If a team is present in only
 * one of the two sources, that source is used as-is for the team. Both
 * sources missing → undefined.
 */
function combineMaps(
  qMap: Map<string, number> | undefined,
  rMap: Map<string, number> | undefined,
  wQ: number,
  wR: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const teams = new Set<string>([
    ...(qMap ? qMap.keys() : []),
    ...(rMap ? rMap.keys() : []),
  ]);
  for (const t of teams) {
    const q = qMap?.get(t);
    const r = rMap?.get(t);
    if (q != null && r != null) out.set(t, (wQ * q + wR * r) / (wQ + wR));
    else if (q != null) out.set(t, q);
    else if (r != null) out.set(t, r);
  }
  return out;
}

function combineSessions(
  quali: RaceTeamMetrics | null,
  race: RaceTeamMetrics | null,
): RaceTeamMetrics | null {
  if (!quali && !race) return null;
  const laps = new Map<string, number>();
  for (const m of [quali?.lapsByTeam, race?.lapsByTeam]) {
    if (!m) continue;
    for (const [t, n] of m.entries()) laps.set(t, (laps.get(t) ?? 0) + n);
  }
  return {
    topSpeed: combineMaps(quali?.topSpeed, race?.topSpeed, TOP_SPEED_QUALI_WEIGHT, TOP_SPEED_RACE_WEIGHT),
    s1: combineMaps(quali?.s1, race?.s1, CORNER_QUALI_WEIGHT, CORNER_RACE_WEIGHT),
    s2: combineMaps(quali?.s2, race?.s2, CORNER_QUALI_WEIGHT, CORNER_RACE_WEIGHT),
    s3: combineMaps(quali?.s3, race?.s3, CORNER_QUALI_WEIGHT, CORNER_RACE_WEIGHT),
    lapsByTeam: laps,
  };
}

// ----- public API -----

export async function computeCarProfiles(
  opts: ComputeCarProfilesOptions = {},
): Promise<ComputeCarProfilesResult> {
  const now = opts.now ?? new Date();
  const signal = opts.signal;
  const normMode: NormalizationMode = opts.normalizationMode ?? "min_max";


  let sessions: SessionInfo[] = [];
  try {
    sessions = await getRaceSessionsByYear(2026);
  } catch {
    return {
      profiles: [],
      races_used: [],
      aborted: false,
      races_diagnostics: [],
      races_considered: 0,
      total_past_races: 0,
    };
  }

  // Fetch standard Qualifying sessions (NOT Sprint Qualifying) and index by
  // meeting_key. Failure is non-fatal: we just proceed without quali data
  // for any race, falling back to race-only aggregation per GP.
  let qualiByMeeting = new Map<number, SessionInfo>();
  try {
    const qSessions = await getQualifyingSessionsByYear(2026);
    for (const q of qSessions ?? []) {
      if (q?.meeting_key != null) qualiByMeeting.set(q.meeting_key, q);
    }
  } catch {
    qualiByMeeting = new Map();
  }

  const past = sessions
    .filter((s) => {
      if (!s.date_end) return false;
      const t = new Date(s.date_end).getTime();
      return Number.isFinite(t) && t < now.getTime();
    })
    .sort((a, b) => new Date(a.date_end!).getTime() - new Date(b.date_end!).getTime());

  const totalPastRaces = past.length;
  const selected =
    typeof opts.lastNRaces === "number" && opts.lastNRaces > 0
      ? past.slice(-opts.lastNRaces) // backward-compat: hard cap
      : past; // default: ALL past races, recency handled by weight decay
  const total = selected.length;

  if (total === 0) {
    return {
      profiles: [],
      races_used: [],
      aborted: false,
      races_diagnostics: [],
      races_considered: 0,
      total_past_races: totalPastRaces,
    };
  }

  // Recency weights: continuous exponential decay with half-life
  // RECENCY_HALFLIFE_RACES. selected is oldest→newest, so age of
  // selected[i] is (lastIndex - i). The most recent race gets weight 1.
  const lastIndex = selected.length - 1;
  const weights = selected.map((_, i) => {
    const age = lastIndex - i;
    return Math.pow(0.5, age / RECENCY_HALFLIFE_RACES);
  });

  // Accumulators: weighted sum and weight sum per (team, dimension).
  const accSum = {
    top: new Map<string, number>(),
    s1: new Map<string, number>(),
    s2: new Map<string, number>(),
    s3: new Map<string, number>(),
  };
  const accW = {
    top: new Map<string, number>(),
    s1: new Map<string, number>(),
    s2: new Map<string, number>(),
    s3: new Map<string, number>(),
  };
  // Per-corner-type accumulators (location_geometry dimension, optional).
  const accCornerSum = {
    slow: new Map<string, number>(),
    medium: new Map<string, number>(),
    fast: new Map<string, number>(),
  };
  const accCornerW = {
    slow: new Map<string, number>(),
    medium: new Map<string, number>(),
    fast: new Map<string, number>(),
  };
  // SEPARATE accumulators for the historic-sector-map estimate (Opzione A).
  // We do NOT merge them with the GPS accumulators above: the two sources
  // are conceptually distinct (direct geometric measurement vs. estimate
  // through sector→type maps) and we want to pick GPS-when-available, then
  // sector-history. Keeping them separate makes the priority explicit.
  const accCornerFromSectorsSum = {
    slow: new Map<string, number>(),
    medium: new Map<string, number>(),
    fast: new Map<string, number>(),
  };
  const accCornerFromSectorsW = {
    slow: new Map<string, number>(),
    medium: new Map<string, number>(),
    fast: new Map<string, number>(),
  };
  const accCoverageSum = new Map<string, number>();
  const accCoverageW = new Map<string, number>();
  // Diagnostic-only: corner-vertices coverage (slow/medium/fast only).
  const accCornerCovSum = new Map<string, number>();
  const accCornerCovW = new Map<string, number>();
  // Diagnostic-only: aggregated Procrustes alignment error per team.
  const accAlignErrSum = new Map<string, number>();
  const accAlignErrW = new Map<string, number>();
  const racesByTeam = new Map<string, number>();
  const lapsByTeam = new Map<string, number>();
  // For each team, collect the weights of the races it contributed to —
  // used to compute the Kish effective sample size.
  const weightsByTeam = new Map<string, number[]>();
  // Additive: preserved per-team per-race history for downstream regression
  // consumers (see `race_history` on CarProfile).
  const historyByTeam = new Map<string, TeamRaceHistoryEntry[]>();

  const racesUsed: SessionInfo[] = [];
  const diagnostics: RaceDiagnostic[] = [];
  let aborted = false;
  let racesConsidered = 0;
  let done = 0;

  // Helper that fetches one session's laps+drivers and returns the
  // per-session normalized metrics. Returns:
  //   { ok: true, metrics }            → session aggregated successfully
  //   { ok: true, metrics: null }      → fetched but no usable data
  //   { ok: false }                    → fetch failed
  const wantGap = opts.emitGapRatioVariant === true;

  async function fetchSession(
    sessionKey: number,
  ): Promise<
    | { ok: true; metrics: RaceTeamMetrics | null; metricsGap: RaceTeamMetrics | null }
    | { ok: false }
  > {
    try {
      const laps = await getAllLaps(sessionKey);
      const drivers = await getDrivers(sessionKey);
      return {
        ok: true,
        metrics: aggregateRace(laps, drivers, normMode),
        metricsGap: wantGap ? aggregateRace(laps, drivers, "gap_ratio") : null,
      };
    } catch {
      return { ok: false };
    }
  }

  // Accumulators for the additive gap_ratio variant (only populated when
  // wantGap === true). Only the four dimensions consumed by the sectors_only
  // baseline are tracked here.
  const accSumGap = {
    top: new Map<string, number>(),
    s1: new Map<string, number>(),
    s2: new Map<string, number>(),
    s3: new Map<string, number>(),
  };
  const accWGap = {
    top: new Map<string, number>(),
    s1: new Map<string, number>(),
    s2: new Map<string, number>(),
    s3: new Map<string, number>(),
  };

  for (let i = 0; i < selected.length; i++) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    const session = selected[i];
    const w = weights[i];
    racesConsidered++;
    let status: RaceDiagnosticStatus = "no_data";
    let qualiAvailable = false;
    let raceAvailable = false;

    // Fetch race session.
    const raceRes = await fetchSession(session.session_key);
    let raceMetrics: RaceTeamMetrics | null = null;
    let raceMetricsGap: RaceTeamMetrics | null = null;
    let raceFetchFailed = false;
    if (raceRes.ok) {
      raceMetrics = raceRes.metrics;
      raceMetricsGap = raceRes.metricsGap;
      raceAvailable = raceMetrics != null;
    } else {
      raceFetchFailed = true;
    }

    // Fetch matching Qualifying (same meeting_key), if any.
    let qualiMetrics: RaceTeamMetrics | null = null;
    let qualiMetricsGap: RaceTeamMetrics | null = null;
    const qualiSession = qualiByMeeting.get(session.meeting_key);
    if (qualiSession) {
      const qRes = await fetchSession(qualiSession.session_key);
      if (qRes.ok) {
        qualiMetrics = qRes.metrics;
        qualiMetricsGap = qRes.metricsGap;
        qualiAvailable = qualiMetrics != null;
      }
      // qRes fetch failure is silently absorbed: quali is a "bonus" source.
    }

    const agg = combineSessions(qualiMetrics, raceMetrics);
    if (agg) {
      status = "used";
      racesUsed.push(session);

      function add(
        src: Map<string, number>,
        sumMap: Map<string, number>,
        wMap: Map<string, number>,
      ) {
        for (const [team, v] of src.entries()) {
          sumMap.set(team, (sumMap.get(team) ?? 0) + v * w);
          wMap.set(team, (wMap.get(team) ?? 0) + w);
        }
      }
      add(agg.topSpeed, accSum.top, accW.top);
      add(agg.s1, accSum.s1, accW.s1);
      add(agg.s2, accSum.s2, accW.s2);
      add(agg.s3, accSum.s3, accW.s3);

      // Companion accumulation for the gap_ratio variant, when requested.
      if (wantGap) {
        const aggGap = combineSessions(qualiMetricsGap, raceMetricsGap);
        if (aggGap) {
          add(aggGap.topSpeed, accSumGap.top, accWGap.top);
          add(aggGap.s1, accSumGap.s1, accWGap.s1);
          add(aggGap.s2, accSumGap.s2, accWGap.s2);
          add(aggGap.s3, accSumGap.s3, accWGap.s3);
        }
      }

      const teamsInRace = new Set<string>([
        ...agg.topSpeed.keys(),
        ...agg.s1.keys(),
        ...agg.s2.keys(),
        ...agg.s3.keys(),
      ]);
      for (const t of teamsInRace) {
        racesByTeam.set(t, (racesByTeam.get(t) ?? 0) + 1);
        const arr = weightsByTeam.get(t) ?? [];
        arr.push(w);
        weightsByTeam.set(t, arr);
      }
      for (const [t, n] of agg.lapsByTeam.entries()) {
        lapsByTeam.set(t, (lapsByTeam.get(t) ?? 0) + n);
      }

      // Per-team per-race history entry (additive, retrocompatible).
      const historyGpName =
        resolveCalendarGpName(
          session.location,
          session.country_name,
          session.circuit_key,
        ) ?? sessionDisplayName(session);
      const historyDate = session.date_end ?? "";
      for (const t of teamsInRace) {
        const s1 = agg.s1.get(t);
        const s2 = agg.s2.get(t);
        const s3 = agg.s3.get(t);
        const parts = [s1, s2, s3].filter(
          (x): x is number => x != null && Number.isFinite(x),
        );
        if (parts.length === 0) continue;
        const sectorsNorm = parts.reduce((a, b) => a + b, 0) / parts.length;
        const topN = agg.topSpeed.get(t);
        const arr = historyByTeam.get(t) ?? [];
        arr.push({
          gpName: historyGpName,
          date_end: historyDate,
          weight: w,
          sectors_normalized: sectorsNorm,
          top_speed_normalized:
            topN != null && Number.isFinite(topN) ? topN : null,
        });
        historyByTeam.set(t, arr);
      }


      // ----- Opzione A: stima per-tipo dai SETTORI STORICI -----
      // Use the sector_corner_map of THIS past circuit (origin) to attribute
      // the team's per-sector strength to corner types. Without an origin
      // map (gpName unresolved or no map for that circuit) this race simply
      // does NOT contribute to the historic-sector estimate — no fabrication.
      const originGpName = resolveCalendarGpName(
        session.location,
        session.country_name,
        session.circuit_key,
      );
      const originMap = originGpName
        ? CIRCUIT_PROFILES[originGpName]?.sector_corner_map
        : undefined;
      if (originMap) {
        const teamsForEstimate = new Set<string>([
          ...agg.s1.keys(),
          ...agg.s2.keys(),
          ...agg.s3.keys(),
        ]);
        for (const team of teamsForEstimate) {
          const v1 = agg.s1.get(team);
          const v2 = agg.s2.get(team);
          const v3 = agg.s3.get(team);
          for (const k of ["slow", "medium", "fast"] as const) {
            let num = 0;
            let den = 0;
            if (v1 != null) { num += originMap.s1[k] * v1; den += originMap.s1[k]; }
            if (v2 != null) { num += originMap.s2[k] * v2; den += originMap.s2[k]; }
            if (v3 != null) { num += originMap.s3[k] * v3; den += originMap.s3[k]; }
            if (den > 0) {
              const contrib = num / den;
              accCornerFromSectorsSum[k].set(
                team,
                (accCornerFromSectorsSum[k].get(team) ?? 0) + contrib * w,
              );
              accCornerFromSectorsW[k].set(
                team,
                (accCornerFromSectorsW[k].get(team) ?? 0) + w,
              );
            }
          }
        }
      }
    } else if (raceFetchFailed && !qualiAvailable) {
      // Both sources unusable AND race fetch errored → fetch_failed.
      status = "fetch_failed";
    }

    // ----- EXPERIMENTAL: per-corner-type strength from quali /location -----
    // Heavy: one /location + /car_data per representative driver. Runs only
    // when the caller injected an analyzer AND a Quali session exists for
    // this GP. All failures are absorbed (treated as "no data" → eventually
    // the team falls back to sector_strength). Recency weight `w` is the
    // same one used by all other dimensions, so the recency model stays
    // consistent across signals.
    if (status === "used" && qualiSession && opts.analyzeQualiCorners) {
      try {
        const qDrivers = await getDrivers(qualiSession.session_key);
        // One representative per team — lowest driver_number for
        // determinism — to bound /location calls.
        const repByTeam = new Map<string, number>();
        for (const d of qDrivers) {
          if (!d.team_name) continue;
          const cur = repByTeam.get(d.team_name);
          if (cur == null || d.driver_number < cur) {
            repByTeam.set(d.team_name, d.driver_number);
          }
        }
        const driverToTeam = new Map<number, string>();
        for (const [team, num] of repByTeam.entries()) driverToTeam.set(num, team);
        const driverNumbers = [...repByTeam.values()];
        if (driverNumbers.length > 0) {
          const analysis = await opts.analyzeQualiCorners(qualiSession, driverNumbers);
          if (analysis && analysis.per_driver.length > 0) {
            // Per-GP per-team RAW speeds (km/h) per corner type, plus the
            // representative driver's coverage.
            const rawByType: Record<"slow" | "medium" | "fast", Map<string, number>> = {
              slow: new Map(),
              medium: new Map(),
              fast: new Map(),
            };
            const coverageByTeam = new Map<string, number>();
            const cornerCoverageByTeam = new Map<string, number>();
            const alignErrByTeam = new Map<string, number>();
            for (const pd of analysis.per_driver) {
              const team = driverToTeam.get(pd.driver_number);
              if (!team) continue;
              if (pd.slow_corner_speed != null) rawByType.slow.set(team, pd.slow_corner_speed);
              if (pd.medium_corner_speed != null) rawByType.medium.set(team, pd.medium_corner_speed);
              if (pd.fast_corner_speed != null) rawByType.fast.set(team, pd.fast_corner_speed);
              coverageByTeam.set(team, pd.coverage);
              if (pd.corner_coverage != null) cornerCoverageByTeam.set(team, pd.corner_coverage);
              if (pd.alignment_error != null && Number.isFinite(pd.alignment_error)) {
                alignErrByTeam.set(team, pd.alignment_error);
              }
            }
            // Normalize per type within this GP (higher speed = stronger).
            const normSlow = normalizeHigherIsBetter(rawByType.slow);
            const normMed = normalizeHigherIsBetter(rawByType.medium);
            const normFast = normalizeHigherIsBetter(rawByType.fast);
            function pushNorm(
              norm: Map<string, number>,
              sumMap: Map<string, number>,
              wMap: Map<string, number>,
            ) {
              for (const [team, v] of norm.entries()) {
                sumMap.set(team, (sumMap.get(team) ?? 0) + v * w);
                wMap.set(team, (wMap.get(team) ?? 0) + w);
              }
            }
            pushNorm(normSlow, accCornerSum.slow, accCornerW.slow);
            pushNorm(normMed, accCornerSum.medium, accCornerW.medium);
            pushNorm(normFast, accCornerSum.fast, accCornerW.fast);
            for (const [team, cov] of coverageByTeam.entries()) {
              accCoverageSum.set(team, (accCoverageSum.get(team) ?? 0) + cov * w);
              accCoverageW.set(team, (accCoverageW.get(team) ?? 0) + w);
            }
            for (const [team, cov] of cornerCoverageByTeam.entries()) {
              accCornerCovSum.set(team, (accCornerCovSum.get(team) ?? 0) + cov * w);
              accCornerCovW.set(team, (accCornerCovW.get(team) ?? 0) + w);
            }
            for (const [team, err] of alignErrByTeam.entries()) {
              accAlignErrSum.set(team, (accAlignErrSum.get(team) ?? 0) + err * w);
              accAlignErrW.set(team, (accAlignErrW.get(team) ?? 0) + w);
            }
          }
        }
      } catch {
        // Swallow: the corner dimension is optional. Sector fallback covers it.
      }
    }

    diagnostics.push({
      name: sessionDisplayName(session),
      date_end: session.date_end ?? "",
      status,
      sources: { quali: qualiAvailable, race: raceAvailable },
    });
    done++;
    opts.onProgress?.(done, total);
  }

  // Compute weighted-average normalized indices per team.
  const teams = new Set<string>([
    ...accSum.top.keys(),
    ...accSum.s1.keys(),
    ...accSum.s2.keys(),
    ...accSum.s3.keys(),
  ]);

  function avg(team: string, sumMap: Map<string, number>, wMap: Map<string, number>): number {
    const w = wMap.get(team);
    const s = sumMap.get(team);
    if (!w || s == null) return NaN;
    return s / w;
  }

  const rawTop = new Map<string, number>();
  const rawS1 = new Map<string, number>();
  const rawS2 = new Map<string, number>();
  const rawS3 = new Map<string, number>();
  for (const t of teams) {
    const a = avg(t, accSum.top, accW.top);
    if (Number.isFinite(a)) rawTop.set(t, a);
    const b = avg(t, accSum.s1, accW.s1);
    if (Number.isFinite(b)) rawS1.set(t, b);
    const c = avg(t, accSum.s2, accW.s2);
    if (Number.isFinite(c)) rawS2.set(t, c);
    const d = avg(t, accSum.s3, accW.s3);
    if (Number.isFinite(d)) rawS3.set(t, d);
  }

  // Final cross-field re-normalization to ensure index in [0,1] with max=1.
  const normTop = normalizeHigherIsBetter(rawTop, normMode);
  const normS1 = normalizeHigherIsBetter(rawS1, normMode);
  const normS2 = normalizeHigherIsBetter(rawS2, normMode);
  const normS3 = normalizeHigherIsBetter(rawS3, normMode);

  // Sector-history per-type raw averages, then cross-team normalization
  // so the resulting index is in [0,1] with 1 = best in field (same
  // contract as location_geometry/sector_strength).
  const rawSectorTyped: Record<"slow" | "medium" | "fast", Map<string, number>> = {
    slow: new Map(),
    medium: new Map(),
    fast: new Map(),
  };
  for (const t of teams) {
    for (const k of ["slow", "medium", "fast"] as const) {
      const s = accCornerFromSectorsSum[k].get(t);
      const wt = accCornerFromSectorsW[k].get(t);
      if (s == null || !wt || wt <= 0) continue;
      rawSectorTyped[k].set(t, s / wt);
    }
  }
  // NOTE: we intentionally do NOT re-normalize across teams here. The raw
  // weighted averages are already in [0,1] (each per-race sector value is
  // 0..1 with 1=best in that race), and they preserve the per-type DISTRI-
  // BUTION shape — which is the whole point of attributing performance
  // through the origin-circuit's sector_corner_map. A cross-team normali-
  // zation would flatten ratios between types and defeat the attribution.
  // This matches the GPS branch (location_geometry) which also stores raw
  // weighted averages without final cross-team normalization.
  const normSectorTyped = rawSectorTyped;

  const profiles: CarProfile[] = [];
  for (const team of teams) {
    const sampleRaces = racesByTeam.get(team) ?? 0;
    const sampleLaps = lapsByTeam.get(team) ?? 0;
    // Kish effective sample size from the recency weights of the races
    // this team actually contributed to: (Σ w)² / Σ(w²). Equals the count
    // with uniform weights; decreases when a few races dominate.
    const ws = weightsByTeam.get(team) ?? [];
    let effective = 0;
    if (ws.length > 0) {
      const sumW = ws.reduce((s, x) => s + x, 0);
      const sumW2 = ws.reduce((s, x) => s + x * x, 0);
      effective = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
    }
    // Confidence thresholds (cautious; 2026 has few races and new regs).
    // Driven by the EFFECTIVE sample so that including many low-weight old
    // races does NOT inflate confidence.
    let confidence: CarProfile["confidence"];
    if (effective < 2 || sampleLaps < 20) confidence = "low";
    else if (effective < 6 || sampleLaps < 60) confidence = "medium";
    else confidence = "high";

    // ----- Per-corner-type strength (gated by coverage) -----
    function avgCorner(type: "slow" | "medium" | "fast"): number | null {
      const s = accCornerSum[type].get(team);
      const wt = accCornerW[type].get(team);
      if (s == null || !wt || wt <= 0) return null;
      return s / wt;
    }
    const covW = accCoverageW.get(team) ?? 0;
    const covS = accCoverageSum.get(team) ?? 0;
    const coverageAgg = covW > 0 ? covS / covW : 0;
    const coverageMeasured = covW > 0;
    // Diagnostic-only: aggregate corner-vertices coverage.
    const ccW = accCornerCovW.get(team) ?? 0;
    const ccS = accCornerCovSum.get(team) ?? 0;
    const cornerCoverageCurve = ccW > 0 ? ccS / ccW : null;
    // Diagnostic-only: aggregate Procrustes alignment error.
    const aeW = accAlignErrW.get(team) ?? 0;
    const aeS = accAlignErrSum.get(team) ?? 0;
    const cornerAlignmentError = aeW > 0 ? aeS / aeW : null;

    let cornerTypeStrength: CarProfile["corner_type_strength"] = null;
    let cornerSource: CarProfile["corner_source"] = "sector_fallback";
    let coverageStatus: CarProfile["corner_coverage_status"] = "not_available";
    if (coverageMeasured && coverageAgg >= CORNER_COVERAGE_MIN) {
      const slow = avgCorner("slow");
      const medium = avgCorner("medium");
      const fast = avgCorner("fast");
      // Require at least one type to be present; missing types default to 0.
      if (slow != null || medium != null || fast != null) {
        cornerTypeStrength = {
          slow: slow ?? 0,
          medium: medium ?? 0,
          fast: fast ?? 0,
        };
        cornerSource = "location_geometry";
        coverageStatus = "ok";
      } else {
        // Coverage was measured but no per-type value survived (degenerate
        // analyzer output) → diagnostic-only fallback.
        coverageStatus = "below_threshold";
      }
    } else if (coverageMeasured) {
      coverageStatus = "below_threshold";
    }

    // Priorità sorgenti per corner_type_strength (Opzione A):
    //   1) location_geometry (GPS) — preferita se la copertura passa il gate;
    //   2) sector_typed_history — stima dai settori delle gare passate usando
    //      la sector_corner_map del circuito d'ORIGINE di ogni gara;
    //   3) sector_fallback — nessuna delle due → corner_type_strength resta
    //      null e il consumer userà sector_strength.
    if (cornerTypeStrength == null) {
      const histSlow = normSectorTyped.slow.get(team);
      const histMed = normSectorTyped.medium.get(team);
      const histFast = normSectorTyped.fast.get(team);
      if (histSlow != null || histMed != null || histFast != null) {
        cornerTypeStrength = {
          slow: histSlow ?? 0,
          medium: histMed ?? 0,
          fast: histFast ?? 0,
        };
        cornerSource = "sector_typed_history";
        // Non tocchiamo coverageStatus: rimane diagnostico del SOLO ramo GPS.
      }
    }

    profiles.push({
      team_name: team,
      top_speed_index: normTop.get(team) ?? 0,
      sector_strength: {
        s1: normS1.get(team) ?? 0,
        s2: normS2.get(team) ?? 0,
        s3: normS3.get(team) ?? 0,
      },
      sample_races: sampleRaces,
      effective_sample_races: effective,
      sample_laps: sampleLaps,
      confidence,
      corner_type_strength: cornerTypeStrength,
      // Preserve real coverage value in every branch (even below threshold)
      // so downstream consumers can diagnose; null only when not measurable.
      corner_data_coverage: coverageMeasured ? coverageAgg : null,
      corner_coverage_curve: cornerCoverageCurve,
      corner_source: cornerSource,
      corner_coverage_status: coverageStatus,
      corner_alignment_error: cornerAlignmentError,
      race_history: historyByTeam.get(team) ?? [],
    });
  }

  profiles.sort((a, b) => a.team_name.localeCompare(b.team_name));

  return {
    profiles,
    races_used: racesUsed,
    aborted,
    races_diagnostics: diagnostics,
    races_considered: racesConsidered,
    total_past_races: totalPastRaces,
  };
}

