/**
 * Weekend weather forecast for the upcoming F1 GP.
 *
 * Source: Open-Meteo (https://open-meteo.com) — free, no API key required.
 * Strategy: one hourly forecast call per circuit covering the full weekend window,
 * then we pick the value closest to each session's start UTC.
 *
 * Caching: results are cached client-side via clientCache for 6 hours per spec.
 */

import { F1_CALENDAR_2026, type F1Session } from "@/lib/f1Calendar2026";
import { CIRCUIT_COORDINATES, type CircuitCoords } from "@/lib/circuitCoordinates";
import { CACHE_KEYS, CACHE_TTL, readCache, writeCache } from "@/lib/clientCache";

export interface SessionForecast {
  session: F1Session;
  /** ISO datetime (UTC) of the matched forecast bucket. */
  forecastUtc: string;
  temperatureC: number | null;
  precipitationMm: number | null;
  precipitationProbability: number | null;
  windKph: number | null;
  weatherCode: number | null;
}

export interface WeekendForecast {
  round: number;
  gpName: string;
  coords: CircuitCoords;
  /** UTC ms timestamp when this forecast was generated. */
  generatedAt: number;
  sessions: SessionForecast[];
}

/** Sessions of the next/in-progress GP (same `round` as the next upcoming one). */
export function getNextWeekendSessions(now: Date = new Date()): F1Session[] {
  const nowMs = now.getTime();
  // Find the round that contains the first session whose end is >= now.
  for (const s of F1_CALENDAR_2026) {
    const endMs = new Date(s.dateUtc).getTime() + s.durationMinutes * 60_000;
    if (endMs >= nowMs) {
      return F1_CALENDAR_2026.filter((x) => x.round === s.round);
    }
  }
  return [];
}

interface OpenMeteoHourly {
  time: string[]; // ISO without timezone — interpreted in `timezone` param
  temperature_2m: number[];
  precipitation: number[];
  precipitation_probability: number[];
  wind_speed_10m: number[];
  weather_code: number[];
}

interface OpenMeteoResponse {
  hourly: OpenMeteoHourly;
  utc_offset_seconds: number;
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pickNearest(
  hourly: OpenMeteoHourly,
  utcOffsetSec: number,
  targetUtcMs: number,
): { idx: number; isoUtc: string } | null {
  if (!hourly?.time?.length) return null;
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < hourly.time.length; i++) {
    // hourly.time entries are LOCAL (no offset suffix) per Open-Meteo when timezone param set.
    const localMs = Date.parse(hourly.time[i] + "Z"); // treat as UTC then subtract offset
    const utcMs = localMs - utcOffsetSec * 1000;
    const diff = Math.abs(utcMs - targetUtcMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const localMs = Date.parse(hourly.time[bestIdx] + "Z");
  const utcMs = localMs - utcOffsetSec * 1000;
  return { idx: bestIdx, isoUtc: new Date(utcMs).toISOString() };
}

async function fetchOpenMeteo(
  coords: CircuitCoords,
  startUtcMs: number,
  endUtcMs: number,
): Promise<OpenMeteoResponse | null> {
  const startDate = ymd(new Date(startUtcMs - 24 * 60 * 60_000)); // 1 day pad before
  const endDate = ymd(new Date(endUtcMs + 24 * 60 * 60_000));     // 1 day pad after
  const params = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lon),
    timezone: coords.timezone,
    start_date: startDate,
    end_date: endDate,
    hourly: [
      "temperature_2m",
      "precipitation",
      "precipitation_probability",
      "wind_speed_10m",
      "weather_code",
    ].join(","),
    wind_speed_unit: "kmh",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as OpenMeteoResponse;
  } catch {
    return null;
  }
}

export async function getWeekendForecast(
  now: Date = new Date(),
): Promise<WeekendForecast | null> {
  const sessions = getNextWeekendSessions(now);
  if (!sessions.length) return null;

  const round = sessions[0].round;
  const gpName = sessions[0].gpName;
  const coords = CIRCUIT_COORDINATES[gpName];
  if (!coords) return null;

  // Try cache first.
  const cacheKey = CACHE_KEYS.weekendWeather(round);
  const cached = readCache<WeekendForecast>(cacheKey, CACHE_TTL.WEEKEND_WEATHER);
  if (cached) return cached;

  const startUtcMs = Math.min(...sessions.map((s) => new Date(s.dateUtc).getTime()));
  const endUtcMs = Math.max(
    ...sessions.map((s) => new Date(s.dateUtc).getTime() + s.durationMinutes * 60_000),
  );

  const om = await fetchOpenMeteo(coords, startUtcMs, endUtcMs);
  if (!om?.hourly?.time?.length) return null;

  const sessionForecasts: SessionForecast[] = sessions.map((s) => {
    const targetUtcMs = new Date(s.dateUtc).getTime();
    const match = pickNearest(om.hourly, om.utc_offset_seconds, targetUtcMs);
    if (!match) {
      return {
        session: s,
        forecastUtc: s.dateUtc,
        temperatureC: null,
        precipitationMm: null,
        precipitationProbability: null,
        windKph: null,
        weatherCode: null,
      };
    }
    const i = match.idx;
    return {
      session: s,
      forecastUtc: match.isoUtc,
      temperatureC: om.hourly.temperature_2m?.[i] ?? null,
      precipitationMm: om.hourly.precipitation?.[i] ?? null,
      precipitationProbability: om.hourly.precipitation_probability?.[i] ?? null,
      windKph: om.hourly.wind_speed_10m?.[i] ?? null,
      weatherCode: om.hourly.weather_code?.[i] ?? null,
    };
  });

  const result: WeekendForecast = {
    round,
    gpName,
    coords,
    generatedAt: Date.now(),
    sessions: sessionForecasts,
  };
  writeCache(cacheKey, result);
  return result;
}

/** Open-Meteo WMO weather interpretation → short Italian label. */
export function describeWeatherCode(code: number | null): string {
  if (code == null) return "—";
  if (code === 0) return "Sereno";
  if (code === 1) return "Prev. sereno";
  if (code === 2) return "Parz. nuvoloso";
  if (code === 3) return "Coperto";
  if (code === 45 || code === 48) return "Nebbia";
  if (code >= 51 && code <= 57) return "Pioviggine";
  if (code >= 61 && code <= 65) return "Pioggia";
  if (code === 66 || code === 67) return "Pioggia gelata";
  if (code >= 71 && code <= 77) return "Neve";
  if (code >= 80 && code <= 82) return "Rovesci";
  if (code === 85 || code === 86) return "Rovesci di neve";
  if (code === 95) return "Temporale";
  if (code === 96 || code === 99) return "Temporale + grandine";
  return "—";
}
