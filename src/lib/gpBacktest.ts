/**
 * GP Backtest — diagnostic-only tool to measure whether the Anteprima GP
 * predictive model has signal beyond a trivial persistence baseline.
 *
 * Method (no look-ahead):
 *   For each past race N (starting from the 2nd), we reconstruct the
 *   prediction "as it would have looked BEFORE the weekend of N", using
 *   only data with date_end < now where `now` is set to a moment STRICTLY
 *   before the start of N's Qualifying session. That way the prediction for
 *   N never sees ANY data from the weekend of N (no race, no quali, no
 *   FP — all those sessions have date_start ≥ quali_start_of_N).
 *
 * Ground truth: the REAL qualifying order of N, by team (best lap per team
 *   across its drivers). Never enters the prediction — it is the held-out
 *   target.
 *
 * Baseline (persistence): order teams by their "general strength" computed
 *   from the same N-1 data — ignoring the circuit profile of N entirely.
 *   "Whoever was strong stays strong." If the model does not beat this,
 *   the circuit-specific analysis is not adding value on this sample.
 *
 * No fabrication: races without a Qualifying session OR without sufficient
 * upstream data are SKIPPED and reported, never invented.
 *
 * NOTE: this module is read-only w.r.t. production. It CALLS
 * computeCarProfiles and predictGpAffinity but does not modify their state
 * or side effects.
 */

import {
  computeCarProfiles as defaultComputeCarProfiles,
  type CarProfile,
  type ComputeCarProfilesResult,
} from "./carProfiles";
import {
  predictGpAffinity as defaultPredictGpAffinity,
  computePersistenceScore,
  type GpPrediction,
  type PersistenceMode,
} from "./gpPrediction";
import {
  getRaceSessionsByYear as defaultGetRaceSessions,
  getQualifyingSessionsByYear as defaultGetQualifyingSessions,
  getAllLaps as defaultGetAllLaps,
  getDrivers as defaultGetDrivers,
  type Driver,
  type Lap,
  type SessionInfo,
} from "./openf1";
import { CIRCUIT_PROFILES as DEFAULT_CIRCUIT_PROFILES } from "./circuitProfiles";
import type { CircuitProfile } from "./circuitProfiles";
import { resolveCalendarGpName as defaultResolveCalendarGpName } from "./circuitGeometry";

/** Safety margin (ms) subtracted from quali date_start to compute `now`. */
export const DEFAULT_PRE_WEEKEND_MARGIN_MS = 60_000;

export interface BacktestPerRace {
  gpName: string;
  rho_model: number | null;
  /**
   * Persistence baseline using the CURRENT production formula
   * (top_speed_index + mean(s1,s2,s3))/2. Kept under the legacy
   * name `rho_baseline` for back-compat with existing consumers/tests;
   * equals `rho_baseline_topsec`.
   */
  rho_baseline: number | null;
  /** Persistence with both trap + sectors. Same value as rho_baseline. */
  rho_baseline_topsec: number | null;
  /** EXPERIMENTAL persistence using sectors only (no trap speed). */
  rho_baseline_sectors: number | null;
  /** true iff predicted #1 team is in the real qualifying top 3. */
  top3_model: boolean | null;
  top3_baseline: boolean | null;
  top3_baseline_topsec: boolean | null;
  top3_baseline_sectors: boolean | null;
  /** Intersection size between predicted set and quali set. */
  n_teams: number;
  /** Set when the race could not be validated. */
  skipped_reason?:
    | "no_quali_session"
    | "no_quali_data"
    | "no_circuit_profile"
    | "insufficient_upstream_data"
    | "prediction_empty";
}

export interface BacktestAggregate {
  races_validated: number;
  rho_model_mean: number | null;
  rho_baseline_mean: number | null;
  rho_baseline_topsec_mean: number | null;
  rho_baseline_sectors_mean: number | null;
  /** rho_model_mean − rho_baseline_mean. null if either is null. */
  delta_mean: number | null;
  /**
   * KEY METRIC for the Opzione 1 validation:
   * rho_baseline_sectors_mean − rho_baseline_topsec_mean.
   * If > 0 → dropping the trap speed improves prediction → candidate to
   * become the new production persistence formula. If ≈ 0 or < 0 → trap
   * speed, however counter-intuitive, is not hurting prediction.
   */
  delta_sectors_vs_topsec: number | null;
  top3_model_rate: number | null;
  top3_baseline_rate: number | null;
  top3_baseline_topsec_rate: number | null;
  top3_baseline_sectors_rate: number | null;
}

export interface BacktestResult {
  per_race: BacktestPerRace[];
  aggregate: BacktestAggregate;
  /** Races considered (= total past races minus the first). */
  total_races: number;
  notes: string[];
}

export interface BacktestDeps {
  computeCarProfiles?: typeof defaultComputeCarProfiles;
  predictGpAffinity?: typeof defaultPredictGpAffinity;
  getRaceSessionsByYear?: typeof defaultGetRaceSessions;
  getQualifyingSessionsByYear?: typeof defaultGetQualifyingSessions;
  getAllLaps?: typeof defaultGetAllLaps;
  getDrivers?: typeof defaultGetDrivers;
  resolveCalendarGpName?: typeof defaultResolveCalendarGpName;
  circuitProfiles?: Record<string, CircuitProfile>;
}

export interface BacktestOptions {
  year?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, currentGp?: string) => void;
  marginMs?: number;
  deps?: BacktestDeps;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests).
// ---------------------------------------------------------------------------

/**
 * Spearman rank correlation between two orders (arrays of team names from
 * best to worst). Only the INTERSECTION of teams is considered. Returns
 * null when fewer than 2 teams are in common. Uses average ranks to handle
 * ties (none expected for ordered lists, but safe).
 */
export function spearman(
  predOrder: readonly string[],
  truthOrder: readonly string[],
): number | null {
  const truthSet = new Set(truthOrder);
  const inter = predOrder.filter((t) => truthSet.has(t));
  const n = inter.length;
  if (n < 2) return null;
  const interSet = new Set(inter);
  const predRank = new Map<string, number>();
  predOrder.filter((t) => interSet.has(t)).forEach((t, i) => predRank.set(t, i + 1));
  const truthRank = new Map<string, number>();
  truthOrder.filter((t) => interSet.has(t)).forEach((t, i) => truthRank.set(t, i + 1));
  let sumD2 = 0;
  for (const t of inter) {
    const d = (predRank.get(t) ?? 0) - (truthRank.get(t) ?? 0);
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

/** True iff the predicted #1 team appears in the first `k` of the truth order. */
export function topKHit(
  predOrder: readonly string[],
  truthOrder: readonly string[],
  k = 3,
): boolean | null {
  if (predOrder.length === 0 || truthOrder.length === 0) return null;
  const head = truthOrder.slice(0, k);
  return head.includes(predOrder[0]);
}

/**
 * Persistence baseline: orders teams by an OVERALL strength index that does
 * NOT use any circuit-specific information. The `mode` argument selects the
 * persistence variant:
 *   - "top_and_sectors" (default, current production formula),
 *   - "sectors_only"    (experimental — drops trap speed).
 * Deterministic tie-break on team name to keep tests stable.
 */
export function computeBaselineOrder(
  profiles: readonly CarProfile[],
  mode: PersistenceMode = "top_and_sectors",
): string[] {
  // Reuse the SAME helper exported from gpPrediction so the production
  // ranking (OPZIONE Z: pure persistence) and the backtest baseline stay
  // bit-for-bit identical. Tie-break on team name keeps tests stable.
  const scored = profiles.map((p) => ({
    team: p.team_name,
    score: computePersistenceScore(p, mode),
  }));
  scored.sort((a, b) => b.score - a.score || a.team.localeCompare(b.team));
  return scored.map((x) => x.team);
}

/** Convenience: sectors-only baseline. Equivalent to computeBaselineOrder(p, "sectors_only"). */
export function computeBaselineOrderSectorsOnly(
  profiles: readonly CarProfile[],
): string[] {
  return computeBaselineOrder(profiles, "sectors_only");
}

/**
 * Build the qualifying order BY TEAM from raw OpenF1 quali laps + drivers.
 * For each team, take the BEST (minimum) lap_duration across its drivers'
 * valid laps. Order ascending (faster first). Returns [] when no valid
 * data is present (caller treats as "no quali data" → skip race).
 */
export function computeQualifyingOrderByTeam(
  laps: readonly Lap[],
  drivers: readonly Driver[],
): string[] {
  const teamByDriver = new Map<number, string>();
  for (const d of drivers) {
    if (d.team_name) teamByDriver.set(d.driver_number, d.team_name);
  }
  const bestByTeam = new Map<string, number>();
  for (const lap of laps) {
    if (lap.is_pit_out_lap) continue;
    if (lap.lap_duration == null || !(lap.lap_duration > 0)) continue;
    const team = teamByDriver.get(lap.driver_number);
    if (!team) continue;
    const cur = bestByTeam.get(team);
    if (cur == null || lap.lap_duration < cur) bestByTeam.set(team, lap.lap_duration);
  }
  return [...bestByTeam.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}

function meanOrNull(xs: number[]): number | null {
  const f = xs.filter((x) => Number.isFinite(x));
  if (f.length === 0) return null;
  return f.reduce((s, x) => s + x, 0) / f.length;
}

function rateOrNull(xs: (boolean | null)[]): number | null {
  const f = xs.filter((x): x is boolean => typeof x === "boolean");
  if (f.length === 0) return null;
  return f.filter(Boolean).length / f.length;
}

function skippedRace(
  gpName: string,
  reason: BacktestPerRace["skipped_reason"],
  n_teams = 0,
): BacktestPerRace {
  return {
    gpName,
    rho_model: null,
    rho_baseline: null,
    rho_baseline_topsec: null,
    rho_baseline_sectors: null,
    top3_model: null,
    top3_baseline: null,
    top3_baseline_topsec: null,
    top3_baseline_sectors: null,
    n_teams,
    skipped_reason: reason,
  };
}

// ---------------------------------------------------------------------------
// runBacktest
// ---------------------------------------------------------------------------

export async function runBacktest(opts: BacktestOptions = {}): Promise<BacktestResult> {
  const year = opts.year ?? 2026;
  const margin = opts.marginMs ?? DEFAULT_PRE_WEEKEND_MARGIN_MS;
  const signal = opts.signal;
  const deps = opts.deps ?? {};
  const getRace = deps.getRaceSessionsByYear ?? defaultGetRaceSessions;
  const getQuali = deps.getQualifyingSessionsByYear ?? defaultGetQualifyingSessions;
  const getLaps = deps.getAllLaps ?? defaultGetAllLaps;
  const getDrv = deps.getDrivers ?? defaultGetDrivers;
  const compute = deps.computeCarProfiles ?? defaultComputeCarProfiles;
  const predict = deps.predictGpAffinity ?? defaultPredictGpAffinity;
  const resolveGp = deps.resolveCalendarGpName ?? defaultResolveCalendarGpName;
  const circuitProfiles = deps.circuitProfiles ?? DEFAULT_CIRCUIT_PROFILES;

  const notes: string[] = [];

  // Past races only (date_end ≤ "real now"). We still call the network for the
  // raw calendar; the look-ahead protection is provided by the per-race `now`
  // we pass to computeCarProfiles below.
  const realNow = Date.now();
  let races: SessionInfo[] = [];
  let qualis: SessionInfo[] = [];
  try {
    races = (await getRace(year)) ?? [];
    qualis = (await getQuali(year)) ?? [];
  } catch {
    return {
      per_race: [],
      aggregate: {
        races_validated: 0,
        rho_model_mean: null,
        rho_baseline_mean: null,
        rho_baseline_topsec_mean: null,
        rho_baseline_sectors_mean: null,
        delta_mean: null,
        delta_sectors_vs_topsec: null,
        top3_model_rate: null,
        top3_baseline_rate: null,
        top3_baseline_topsec_rate: null,
        top3_baseline_sectors_rate: null,
      },
      total_races: 0,
      notes: ["Errore nel recupero del calendario"],
    };
  }

  const past = races
    .filter((s) => s.date_end && new Date(s.date_end).getTime() < realNow)
    .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());

  const qualiByMeeting = new Map<number, SessionInfo>();
  for (const q of qualis) {
    if (q?.meeting_key != null) qualiByMeeting.set(q.meeting_key, q);
  }

  const per_race: BacktestPerRace[] = [];
  // Start from index 1: the 2nd past race onward.
  const targets = past.slice(1);
  const total = targets.length;

  for (let i = 0; i < targets.length; i++) {
    if (signal?.aborted) {
      notes.push("Backtest interrotto dall'utente");
      break;
    }
    const target = targets[i];
    const gpName =
      resolveGp(target.location, target.country_name, target.circuit_key) ??
      target.location ??
      target.country_name ??
      `meeting_${target.meeting_key}`;

    opts.onProgress?.(i, total, gpName);

    // ----- compute `now` strictly BEFORE the start of N's Qualifying -----
    const qualiOfN = qualiByMeeting.get(target.meeting_key);
    if (!qualiOfN || !qualiOfN.date_start) {
      per_race.push(skippedRace(gpName, "no_quali_session"));
      continue;
    }
    const qualiStart = new Date(qualiOfN.date_start).getTime();
    if (!Number.isFinite(qualiStart)) {
      per_race.push(skippedRace(gpName, "no_quali_session"));
      continue;
    }
    const now = new Date(qualiStart - margin);

    // ----- prediction (uses ONLY data with date_end < now) -----
    let profilesResult: ComputeCarProfilesResult;
    try {
      profilesResult = await compute({ now, signal });
    } catch {
      per_race.push(skippedRace(gpName, "insufficient_upstream_data"));
      continue;
    }
    if (!profilesResult.profiles || profilesResult.profiles.length === 0) {
      per_race.push(skippedRace(gpName, "insufficient_upstream_data"));
      continue;
    }

    const circuit = circuitProfiles[gpName];
    if (!circuit) {
      per_race.push(skippedRace(gpName, "no_circuit_profile"));
      continue;
    }

    const prediction: GpPrediction = predict(circuit, profilesResult.profiles, {
      racesConsidered: profilesResult.races_considered,
    });
    if (!prediction.ranked || prediction.ranked.length === 0) {
      per_race.push(skippedRace(gpName, "prediction_empty"));
      continue;
    }
    const predOrder = prediction.ranked.map((t) => t.team_name);
    const baselineOrderTopSec = computeBaselineOrder(
      profilesResult.profiles,
      "top_and_sectors",
    );
    const baselineOrderSectors = computeBaselineOrder(
      profilesResult.profiles,
      "sectors_only",
    );

    // ----- ground truth: real qualifying of N -----
    let qLaps: Lap[] = [];
    let qDrivers: Driver[] = [];
    try {
      qLaps = (await getLaps(qualiOfN.session_key)) ?? [];
      qDrivers = (await getDrv(qualiOfN.session_key)) ?? [];
    } catch {
      per_race.push(skippedRace(gpName, "no_quali_data"));
      continue;
    }
    const truthOrder = computeQualifyingOrderByTeam(qLaps, qDrivers);
    if (truthOrder.length < 2) {
      per_race.push(skippedRace(gpName, "no_quali_data", truthOrder.length));
      continue;
    }

    const rho_model = spearman(predOrder, truthOrder);
    const rho_baseline_topsec = spearman(baselineOrderTopSec, truthOrder);
    const rho_baseline_sectors = spearman(baselineOrderSectors, truthOrder);
    const top3_model = topKHit(predOrder, truthOrder, 3);
    const top3_baseline_topsec = topKHit(baselineOrderTopSec, truthOrder, 3);
    const top3_baseline_sectors = topKHit(baselineOrderSectors, truthOrder, 3);
    const n_teams = predOrder.filter((t) => truthOrder.includes(t)).length;

    per_race.push({
      gpName,
      rho_model,
      rho_baseline: rho_baseline_topsec,
      rho_baseline_topsec,
      rho_baseline_sectors,
      top3_model,
      top3_baseline: top3_baseline_topsec,
      top3_baseline_topsec,
      top3_baseline_sectors,
      n_teams,
    });
  }
  opts.onProgress?.(total, total);

  const validated = per_race.filter((r) => !r.skipped_reason);
  const rhoModelMean = meanOrNull(
    validated.map((r) => r.rho_model).filter((x): x is number => x != null),
  );
  const rhoBaseTopSecMean = meanOrNull(
    validated.map((r) => r.rho_baseline_topsec).filter((x): x is number => x != null),
  );
  const rhoBaseSectorsMean = meanOrNull(
    validated.map((r) => r.rho_baseline_sectors).filter((x): x is number => x != null),
  );
  const delta =
    rhoModelMean != null && rhoBaseTopSecMean != null
      ? rhoModelMean - rhoBaseTopSecMean
      : null;
  const deltaSectorsVsTopSec =
    rhoBaseSectorsMean != null && rhoBaseTopSecMean != null
      ? rhoBaseSectorsMean - rhoBaseTopSecMean
      : null;

  return {
    per_race,
    aggregate: {
      races_validated: validated.length,
      rho_model_mean: rhoModelMean,
      rho_baseline_mean: rhoBaseTopSecMean,
      rho_baseline_topsec_mean: rhoBaseTopSecMean,
      rho_baseline_sectors_mean: rhoBaseSectorsMean,
      delta_mean: delta,
      delta_sectors_vs_topsec: deltaSectorsVsTopSec,
      top3_model_rate: rateOrNull(validated.map((r) => r.top3_model)),
      top3_baseline_rate: rateOrNull(validated.map((r) => r.top3_baseline_topsec)),
      top3_baseline_topsec_rate: rateOrNull(validated.map((r) => r.top3_baseline_topsec)),
      top3_baseline_sectors_rate: rateOrNull(validated.map((r) => r.top3_baseline_sectors)),
    },
    total_races: total,
    notes,
  };
}
