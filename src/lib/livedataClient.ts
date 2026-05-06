const LIVEDATA_BASE = "https://livedata.pitwall.it";

/**
 * Generic fetch helper for the self-hosted OpenF1 mirror at livedata.pitwall.it.
 * Distinct from openf1.ts (which targets api.openf1.org and applies caching).
 * Live dashboard polls aggressively: NO cache here.
 */
export async function fetchLivedata<T>(
  endpoint: string,
  params: Record<string, string | number | undefined | null>,
): Promise<T[]> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      search.set(k, String(v));
    }
  }
  const qs = search.toString();
  const url = `${LIVEDATA_BASE}${endpoint}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Livedata fetch ${endpoint} failed: ${res.status}`);
  }
  return res.json() as Promise<T[]>;
}

export interface LiveSession {
  session_key: number;
  meeting_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end?: string | null;
  country_name?: string;
  location?: string;
  circuit_short_name?: string;
}

export interface LiveDriver {
  driver_number: number;
  name_acronym: string;
  full_name?: string;
  team_name?: string;
  team_colour?: string;
  headshot_url?: string;
}

export interface LiveLap {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  st_speed: number | null;
  date_start?: string;
}

export interface LiveInterval {
  driver_number: number;
  gap_to_leader: number | string | null;
  interval: number | string | null;
  date: string;
}

export interface LivePosition {
  driver_number: number;
  position: number;
  date: string;
}

export interface LiveStint {
  driver_number: number;
  stint_number: number;
  compound: string;
  tyre_age_at_start: number;
  lap_start: number;
  lap_end: number | null;
}

export interface LivePit {
  driver_number: number;
  lap_number: number;
  pit_duration: number | null;
}

export interface LiveWeather {
  date: string;
  air_temperature: number | null;
  track_temperature: number | null;
  humidity: number | null;
  rainfall: number | null;
  wind_speed: number | null;
  wind_direction?: number | null;
  pressure?: number | null;
}

export interface LiveCarData {
  driver_number: number;
  date: string;
  speed: number;
  throttle: number;
  brake: number;
  n_gear: number;
  rpm: number;
  drs: number;
}

/**
 * DRS canonical OpenF1 codes: 0/1=off, 8=detected eligible, 10/12/14=on.
 * Active means actively deployed on the wing.
 */
export function isDrsActive(drs: number | null | undefined): boolean {
  if (drs == null) return false;
  return drs >= 10;
}

export async function detectLiveSession(): Promise<LiveSession | null> {
  const testKey =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("test_session_key")
      : null;
  if (testKey) {
    const sessions = await fetchLivedata<LiveSession>("/v1/sessions", {
      session_key: testKey,
    });
    return sessions[0] ?? null;
  }
  const allSessions = await fetchLivedata<LiveSession>("/v1/sessions", {});
  const now = Date.now();
  const sorted = [...allSessions].sort(
    (a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime(),
  );
  for (const s of sorted) {
    const start = new Date(s.date_start).getTime();
    if (isNaN(start)) continue;
    if (start > now) continue;
    if (!s.date_end) {
      if (now - start <= 4 * 60 * 60 * 1000) return s;
      continue;
    }
    const end = new Date(s.date_end).getTime();
    if (isNaN(end)) continue;
    if (now <= end) return s;
  }
  return null;
}
