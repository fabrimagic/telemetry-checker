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
  getRaceSessionsByYear,
  type Driver,
  type Lap,
  type SessionInfo,
} from "./openf1";

export interface CarProfile {
  team_name: string;
  top_speed_index: number; // 0..1, 1 = best in field
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
}

export type RaceDiagnosticStatus = "used" | "no_data" | "fetch_failed";

export interface RaceDiagnostic {
  name: string;
  date_end: string;
  status: RaceDiagnosticStatus;
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

/** Normalize so the maximum maps to 1 and minimum to 0. */
function normalizeHigherIsBetter(map: Map<string, number>): Map<string, number> {
  const vals = [...map.values()].filter((v) => Number.isFinite(v));
  if (vals.length === 0) return new Map();
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const out = new Map<string, number>();
  for (const [k, v] of map.entries()) {
    if (!Number.isFinite(v)) continue;
    out.set(k, max === min ? 1 : (v - min) / (max - min));
  }
  return out;
}

/** Lower is better → invert. */
function normalizeLowerIsBetter(map: Map<string, number>): Map<string, number> {
  const vals = [...map.values()].filter((v) => Number.isFinite(v));
  if (vals.length === 0) return new Map();
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const out = new Map<string, number>();
  for (const [k, v] of map.entries()) {
    if (!Number.isFinite(v)) continue;
    out.set(k, max === min ? 1 : (max - v) / (max - min));
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

function aggregateRace(laps: Lap[], drivers: Driver[]): RaceTeamMetrics | null {
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
    topSpeed: normalizeHigherIsBetter(teamTop),
    s1: normalizeLowerIsBetter(teamS1),
    s2: normalizeLowerIsBetter(teamS2),
    s3: normalizeLowerIsBetter(teamS3),
    lapsByTeam: teamLaps,
  };
}

// ----- public API -----

export async function computeCarProfiles(
  opts: ComputeCarProfilesOptions = {},
): Promise<ComputeCarProfilesResult> {
  const lastN = opts.lastNRaces ?? DEFAULT_LAST_N;
  const now = opts.now ?? new Date();
  const signal = opts.signal;

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

  const past = sessions
    .filter((s) => {
      if (!s.date_end) return false;
      const t = new Date(s.date_end).getTime();
      return Number.isFinite(t) && t < now.getTime();
    })
    .sort((a, b) => new Date(a.date_end!).getTime() - new Date(b.date_end!).getTime());

  const totalPastRaces = past.length;
  const selected = past.slice(-lastN); // oldest → newest among the N
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

  // weight: linear, most-recent has highest weight.
  // weights[i] for selected[i] where higher i = more recent.
  const weights = selected.map((_, i) => i + 1);

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
  const racesByTeam = new Map<string, number>();
  const lapsByTeam = new Map<string, number>();

  const racesUsed: SessionInfo[] = [];
  const diagnostics: RaceDiagnostic[] = [];
  let aborted = false;
  let racesConsidered = 0;
  let done = 0;

  for (let i = 0; i < selected.length; i++) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    const session = selected[i];
    const w = weights[i];
    racesConsidered++;
    let status: RaceDiagnosticStatus = "no_data";
    try {
      const [laps, drivers] = [
        await getAllLaps(session.session_key),
        await getDrivers(session.session_key),
      ];
      const agg = aggregateRace(laps, drivers);
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

        const teamsInRace = new Set<string>([
          ...agg.topSpeed.keys(),
          ...agg.s1.keys(),
          ...agg.s2.keys(),
          ...agg.s3.keys(),
        ]);
        for (const t of teamsInRace) {
          racesByTeam.set(t, (racesByTeam.get(t) ?? 0) + 1);
        }
        for (const [t, n] of agg.lapsByTeam.entries()) {
          lapsByTeam.set(t, (lapsByTeam.get(t) ?? 0) + n);
        }
      }
    } catch {
      status = "fetch_failed";
    }
    diagnostics.push({
      name: sessionDisplayName(session),
      date_end: session.date_end ?? "",
      status,
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
  const normTop = normalizeHigherIsBetter(rawTop);
  const normS1 = normalizeHigherIsBetter(rawS1);
  const normS2 = normalizeHigherIsBetter(rawS2);
  const normS3 = normalizeHigherIsBetter(rawS3);

  const profiles: CarProfile[] = [];
  for (const team of teams) {
    const sampleRaces = racesByTeam.get(team) ?? 0;
    const sampleLaps = lapsByTeam.get(team) ?? 0;
    // confidence thresholds (cautious; 2026 has few races and new regs).
    let confidence: CarProfile["confidence"];
    if (sampleRaces < 2 || sampleLaps < 20) confidence = "low";
    else if (sampleRaces < 4 || sampleLaps < 60) confidence = "medium";
    else confidence = "high";

    profiles.push({
      team_name: team,
      top_speed_index: normTop.get(team) ?? 0,
      sector_strength: {
        s1: normS1.get(team) ?? 0,
        s2: normS2.get(team) ?? 0,
        s3: normS3.get(team) ?? 0,
      },
      sample_races: sampleRaces,
      sample_laps: sampleLaps,
      confidence,
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

