import { readCache, writeCache } from "./clientCache";

const BASE = "https://api.openf1.org/v1";

// ---------------------------------------------------------------------------
// Global client-side cache for OpenF1 responses.
//
// Goal: minimize 429s under high load by deduping identical requests.
// Two layers:
//  1) In-flight dedup (Map<path, Promise>): if N components request the same
//     path concurrently, only ONE network call is made; all callers await the
//     same Promise. Cleared when the promise settles.
//  2) Persistent cache via sessionStorage (clientCache.ts), with a TTL chosen
//     per endpoint family. Endpoints that are immutable once a session is
//     finished (laps, stints, pit, weather of past sessions, etc.) get a long
//     TTL; live/standings get a short TTL.
//
// Cache key = full path (already contains all query params → deterministic).
// On error: never cache; on 429: backoff is unchanged (handled below).
// Logic and call sites are untouched — only fetchApi is wrapped.
// ---------------------------------------------------------------------------

const CACHE_PREFIX = "pitwall:openf1:";

// TTL families (ms). Past-session telemetry is effectively immutable; we still
// cap with sessionStorage lifetime (cleared on tab close) for safety.
const TTL_LONG = 60 * 60 * 1000;       // 1h — immutable per-session datasets
const TTL_MEDIUM = 10 * 60 * 1000;     // 10min — calendars, standings
const TTL_SHORT = 30 * 1000;           // 30s — live-ish data (intervals, positions)

function ttlForPath(path: string): number {
  // Live/streaming endpoints — short TTL so live updates aren't stale.
  if (path.startsWith("/intervals")) return TTL_SHORT;
  if (path.startsWith("/position?")) return TTL_SHORT;
  if (path.startsWith("/race_control")) return TTL_SHORT;
  // Calendars and championship standings change at most weekly.
  if (path.startsWith("/sessions")) return TTL_MEDIUM;
  if (path.startsWith("/championship_")) return TTL_MEDIUM;
  // Everything else (laps, car_data, location, weather, stints, pit, drivers,
  // session_result, starting_grid, overtakes) is immutable post-session.
  return TTL_LONG;
}

function cacheKey(path: string): string {
  return `${CACHE_PREFIX}${path}`;
}

// In-flight dedup map. Same path → same Promise.
const inFlight = new Map<string, Promise<unknown>>();

export interface Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  headshot_url: string | null;
  session_key: number;
}

export interface Lap {
  lap_number: number;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  st_speed: number | null;
  date_start: string | null;
  is_pit_out_lap: boolean;
  driver_number: number;
  session_key: number;
  segments_sector_1: (number | null)[] | null;
  segments_sector_2: (number | null)[] | null;
  segments_sector_3: (number | null)[] | null;
}

export interface CarData {
  date: string;
  speed: number;
  throttle: number;
  brake: number;
  n_gear: number;
  rpm: number;
  drs: number;
  driver_number: number;
  session_key: number;
}

export interface LocationData {
  date: string;
  x: number;
  y: number;
  z: number;
  driver_number: number;
  session_key: number;
}

export interface WeatherData {
  air_temperature: number;
  date: string;
  humidity: number;
  meeting_key: number;
  pressure: number;
  rainfall: number;
  session_key: number;
  track_temperature: number;
  wind_direction: number;
  wind_speed: number;
}

export interface OvertakeData {
  date: string;
  meeting_key: number;
  overtaken_driver_number: number;
  overtaking_driver_number: number;
  position: number;
  session_key: number;
}

export interface StintData {
  compound: string;
  driver_number: number;
  lap_end: number;
  lap_start: number;
  meeting_key: number;
  session_key: number;
  stint_number: number;
  tyre_age_at_start: number;
}

export interface PitData {
  date: string;
  driver_number: number;
  lane_duration: number;
  lap_number: number;
  meeting_key: number;
  pit_duration: number;
  session_key: number;
  stop_duration: number | null;
}

export interface IntervalData {
  date: string;
  driver_number: number;
  gap_to_leader: number | string | null;
  interval: number | string | null;
  meeting_key: number;
  session_key: number;
}

// Dual-window rate limiter for OpenF1 free tier.
// Real limits (per openf1.org/#sponsorship): 3 req/s AND 30 req/min.
// We track scheduled timestamps and compute the next available slot as the MAX
// of: (a) earliest time the 1s window has <3 reservations, and
//     (b) earliest time the 60s window has <30 reservations.
// JS single-thread guarantees the reserve read+write pair is atomic across callers.
// 429s remain handled below as a fallback for edge cases (multi-tab, clock skew).
const MAX_PER_SECOND = 3;
const MAX_PER_MINUTE = 30;
const WINDOW_SECOND_MS = 1000;
const WINDOW_MINUTE_MS = 60_000;
const MAX_RETRIES = 4;

// Sorted (ascending) list of scheduled-fire timestamps for issued/in-flight reservations.
const scheduled: number[] = [];

function reserveSlot(): number {
  const now = Date.now();
  // Drop timestamps older than the longest window — they no longer constrain anything.
  while (scheduled.length > 0 && scheduled[0] <= now - WINDOW_MINUTE_MS) {
    scheduled.shift();
  }
  // Candidate = now. Push it forward until both windows have capacity.
  let candidate = now;
  // Iterate because pushing past one boundary may move us into another window.
  // Bounded by scheduled.length, so terminates.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const inSecondWindow = scheduled.filter((t) => t > candidate - WINDOW_SECOND_MS).length;
    const inMinuteWindow = scheduled.filter((t) => t > candidate - WINDOW_MINUTE_MS).length;
    if (inSecondWindow < MAX_PER_SECOND && inMinuteWindow < MAX_PER_MINUTE) break;
    // Need to wait until the oldest constraining timestamp falls out of its window.
    let nextCandidate = candidate;
    if (inSecondWindow >= MAX_PER_SECOND) {
      // Find oldest ts inside the 1s window — candidate must move past ts + 1s.
      const oldestInSec = scheduled.find((t) => t > candidate - WINDOW_SECOND_MS)!;
      nextCandidate = Math.max(nextCandidate, oldestInSec + WINDOW_SECOND_MS);
    }
    if (inMinuteWindow >= MAX_PER_MINUTE) {
      const oldestInMin = scheduled.find((t) => t > candidate - WINDOW_MINUTE_MS)!;
      nextCandidate = Math.max(nextCandidate, oldestInMin + WINDOW_MINUTE_MS);
    }
    candidate = nextCandidate;
  }
  // Insert candidate into sorted scheduled[]. Most often it goes at the end.
  if (scheduled.length === 0 || candidate >= scheduled[scheduled.length - 1]) {
    scheduled.push(candidate);
  } else {
    let i = scheduled.length;
    while (i > 0 && scheduled[i - 1] > candidate) i--;
    scheduled.splice(i, 0, candidate);
  }
  return candidate;
}

async function fetchApiUncached<T>(path: string, retries = MAX_RETRIES): Promise<T> {
  const scheduledTime = reserveSlot();
  const delay = scheduledTime - Date.now();
  if (delay > 0) {
    if (delay >= 250) {
      console.debug(
        `[openf1] rate-limit wait ${delay}ms (queue=${scheduled.length}) for ${path}`
      );
    }
    await new Promise((r) => setTimeout(r, delay));
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`);
  } catch (networkErr) {
    // Transient network error: retry with backoff
    if (retries > 0) {
      const attempt = MAX_RETRIES - retries;
      const backoff = 800 * Math.pow(2, attempt); // 800, 1600, 3200, 6400
      await new Promise((r) => setTimeout(r, backoff));
      return fetchApiUncached<T>(path, retries - 1);
    }
    throw networkErr;
  }

  if (res.status === 429 && retries > 0) {
    // Exponential backoff: 1.5s, 3s, 6s, 12s
    const attempt = MAX_RETRIES - retries;
    const backoff = 1500 * Math.pow(2, attempt);
    // Push a phantom reservation into the future so concurrent siblings also wait.
    const blockUntil = Date.now() + backoff;
    scheduled.push(blockUntil);
    scheduled.sort((a, b) => a - b);
    console.debug(`[openf1] 429 received, backing off ${backoff}ms for ${path}`);
    await new Promise((r) => setTimeout(r, backoff));
    return fetchApiUncached<T>(path, retries - 1);
  }
  if (!res.ok) throw new Error(`OpenF1 API error: ${res.status}`);
  return res.json();
}

/**
 * Public fetch wrapper used by every endpoint helper below.
 * Adds two layers on top of the rate-limited network fetch:
 *  - sessionStorage cache (TTL per endpoint family)
 *  - in-flight Promise dedup (concurrent identical requests share one fetch)
 * On error: nothing is cached and the in-flight entry is cleared so the next
 * caller can retry cleanly.
 */
async function fetchApi<T>(path: string): Promise<T> {
  // 1) Persistent cache hit?
  const cached = readCache<T>(cacheKey(path), ttlForPath(path));
  if (cached !== null) return cached;

  // 2) In-flight dedup: another caller already fetching the same path?
  const pending = inFlight.get(path) as Promise<T> | undefined;
  if (pending) return pending;

  // 3) Cold path: fire the network request and register the in-flight Promise.
  const promise = (async () => {
    try {
      const data = await fetchApiUncached<T>(path);
      writeCache(cacheKey(path), data);
      return data;
    } finally {
      inFlight.delete(path);
    }
  })();

  inFlight.set(path, promise);
  return promise;
}

export function getDrivers(sessionKey: number) {
  return fetchApi<Driver[]>(`/drivers?session_key=${sessionKey}`);
}

export function getLaps(sessionKey: number, driverNumber: number) {
  return fetchApi<Lap[]>(`/laps?session_key=${sessionKey}&driver_number=${driverNumber}`);
}

export function getCarData(sessionKey: number, driverNumber: number, dateStart: string, dateEnd: string) {
  return fetchApi<CarData[]>(
    `/car_data?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${dateStart}&date<=${dateEnd}`
  );
}

export function getLocation(sessionKey: number, driverNumber: number, dateStart: string, dateEnd: string) {
  return fetchApi<LocationData[]>(
    `/location?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${dateStart}&date<=${dateEnd}`
  );
}

export function getWeather(sessionKey: number, dateStart: string, dateEnd: string) {
  return fetchApi<WeatherData[]>(
    `/weather?session_key=${sessionKey}&date>=${dateStart}&date<=${dateEnd}`
  );
}

export function getOvertakes(sessionKey: number, driverNumber: number) {
  return fetchApi<OvertakeData[]>(
    `/overtakes?session_key=${sessionKey}&overtaking_driver_number=${driverNumber}`
  );
}

export function getOvertakesReceived(sessionKey: number, driverNumber: number) {
  return fetchApi<OvertakeData[]>(
    `/overtakes?session_key=${sessionKey}&overtaken_driver_number=${driverNumber}`
  );
}

export function getStints(sessionKey: number, driverNumber: number) {
  return fetchApi<StintData[]>(
    `/stints?session_key=${sessionKey}&driver_number=${driverNumber}`
  );
}

export function getPitStops(sessionKey: number, driverNumber: number) {
  return fetchApi<PitData[]>(
    `/pit?session_key=${sessionKey}&driver_number=${driverNumber}`
  );
}

export interface SessionResult {
  dnf: boolean;
  dns: boolean;
  dsq: boolean;
  driver_number: number;
  duration: number | number[] | null;
  gap_to_leader: number | string | null;
  number_of_laps: number;
  meeting_key: number;
  position: number;
  session_key: number;
}

export interface StartingGridEntry {
  driver_number: number;
  lap_duration: number;
  meeting_key: number;
  position: number;
  session_key: number;
}

export interface PositionData {
  date: string;
  driver_number: number;
  meeting_key: number;
  position: number;
  session_key: number;
}

export function getSessionResult(sessionKey: number) {
  return fetchApi<SessionResult[]>(`/session_result?session_key=${sessionKey}`);
}

export function getStartingGrid(sessionKey: number) {
  return fetchApi<StartingGridEntry[]>(`/starting_grid?session_key=${sessionKey}`);
}

export function getPositions(sessionKey: number) {
  return fetchApi<PositionData[]>(`/position?session_key=${sessionKey}`);
}

export function getAllStints(sessionKey: number) {
  return fetchApi<StintData[]>(`/stints?session_key=${sessionKey}`);
}

export function getAllPitStops(sessionKey: number) {
  return fetchApi<PitData[]>(`/pit?session_key=${sessionKey}`);
}

export function getWeatherForSession(sessionKey: number) {
  return fetchApi<WeatherData[]>(`/weather?session_key=${sessionKey}`);
}

export function getIntervals(sessionKey: number) {
  return fetchApi<IntervalData[]>(`/intervals?session_key=${sessionKey}`);
}

export interface RaceControlMessage {
  date: string;
  category: string;
  flag: string | null;
  message: string;
  scope: string | null;
  sector: number | null;
  meeting_key: number;
  session_key: number;
}

export function getRaceControl(sessionKey: number) {
  return fetchApi<RaceControlMessage[]>(`/race_control?session_key=${sessionKey}`);
}

export interface SessionInfo {
  session_key: number;
  session_type: string;
  session_name: string;
  meeting_key: number;
  date_start: string;
  date_end?: string;
  location?: string;
  country_name?: string;
}

export function getSessionsByMeetingKey(meetingKey: number) {
  return fetchApi<SessionInfo[]>(`/sessions?meeting_key=${meetingKey}`);
}

export function getAllLaps(sessionKey: number) {
  return fetchApi<Lap[]>(`/laps?session_key=${sessionKey}`);
}

export interface ChampionshipDriverStanding {
  driver_number: number;
  meeting_key: number;
  session_key: number;
  position_start: number;
  position_current: number;
  points_start: number;
  points_current: number;
}

export interface ChampionshipTeamStanding {
  team_name: string;
  meeting_key: number;
  session_key: number;
  position_start: number;
  position_current: number;
  points_start: number;
  points_current: number;
}

/** Returns all Race sessions for a given year. Note: includes future races
 *  whose date_end is in the future. Caller must filter as needed. */
export function getRaceSessionsByYear(year: number) {
  return fetchApi<SessionInfo[]>(`/sessions?year=${year}&session_name=Race`);
}

export function getChampionshipDrivers(sessionKey: number) {
  return fetchApi<ChampionshipDriverStanding[]>(
    `/championship_drivers?session_key=${sessionKey}`,
  );
}

export function getChampionshipTeams(sessionKey: number) {
  return fetchApi<ChampionshipTeamStanding[]>(
    `/championship_teams?session_key=${sessionKey}`,
  );
}

/** Test-only helper. Resets the rate limiter's internal state.
 *  Production code MUST NOT call this. */
export function __resetRateLimiterForTests(): void {
  scheduled.length = 0;
}
