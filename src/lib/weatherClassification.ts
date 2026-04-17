import type { WeatherData, Lap } from "./openf1";

export type WeatherCondition = "DRY" | "WET" | "MIXED";

export interface LapWeather {
  lap_number: number;
  condition: WeatherCondition;
}

/* ── Configuration ─────────────────────────────────────────────── */

const CONFIG = {
  /** Minimum rainfall value (mm) to count as active rain */
  RAIN_THRESHOLD: 0,
  /** Lookback window (ms) for recent-rain persistence signal */
  PERSISTENCE_LOOKBACK_MS: 5 * 60_000, // 5 minutes
  /** Half-life (ms) of wet persistence decay — how fast track dries */
  PERSISTENCE_HALF_LIFE_MS: 3 * 60_000, // 3 minutes
  /** Track temp (°C) above which drying is accelerated */
  FAST_DRY_TRACK_TEMP: 40,
  /** Track temp (°C) below which drying is slowed */
  SLOW_DRY_TRACK_TEMP: 25,
  /** Drying speed multiplier when track is hot */
  FAST_DRY_FACTOR: 1.6,
  /** Drying speed multiplier when track is cold */
  SLOW_DRY_FACTOR: 0.6,
  /** Persistence score threshold: above → WET */
  WET_PERSISTENCE_THRESHOLD: 0.55,
  /** Persistence score threshold: above → MIXED */
  MIXED_PERSISTENCE_THRESHOLD: 0.15,
  /** Fraction of in-lap samples with rain to call the lap WET outright */
  DIRECT_WET_FRACTION: 0.6,
  /** Fraction of in-lap samples with rain needed for MIXED (when mixed dry/rain) */
  DIRECT_MIXED_MIN_RAIN_FRACTION: 0.1,
} as const;

/* ── Internal helpers ──────────────────────────────────────────── */

interface WeatherSample {
  time: number;
  rainfall: number;
  trackTemp: number | null;
}

/**
 * Pre-process and sort weather data into efficient internal format.
 */
function prepareWeatherTimeline(weather: WeatherData[]): WeatherSample[] {
  return weather
    .map((w) => ({
      time: new Date(w.date).getTime(),
      rainfall: w.rainfall ?? 0,
      trackTemp:
        w.track_temperature != null && w.track_temperature > 0
          ? w.track_temperature
          : null,
    }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Get weather samples within a time window using binary-search bounds.
 */
function getWeatherSamplesForWindow(
  timeline: WeatherSample[],
  from: number,
  to: number
): WeatherSample[] {
  // Simple linear scan is fine for typical weather sample counts (< 500/session)
  const result: WeatherSample[] = [];
  for (const s of timeline) {
    if (s.time > to) break;
    if (s.time >= from) result.push(s);
  }
  return result;
}

/**
 * Compute a recent-rain persistence score (0–1) for a given moment.
 *
 * Each past rain sample contributes an exponentially-decayed weight.
 * Track temperature modulates the decay rate:
 *   - hot track → faster drying → faster decay
 *   - cold track → slower drying → slower decay
 *
 * Returns a score where 1 = track is certainly still wet, 0 = fully dry.
 */
function computeWetPersistenceScore(
  timeline: WeatherSample[],
  atTime: number,
  trackTemp: number | null
): number {
  const lookbackStart = atTime - CONFIG.PERSISTENCE_LOOKBACK_MS;

  // Determine drying speed multiplier from track temperature
  // Conservative default: when track temp is unknown, assume slow drying (cold track)
  // so the system leans toward MIXED/WET rather than optimistic DRY.
  let dryingFactor = CONFIG.SLOW_DRY_FACTOR;
  if (trackTemp != null) {
    if (trackTemp >= CONFIG.FAST_DRY_TRACK_TEMP) {
      dryingFactor = CONFIG.FAST_DRY_FACTOR;
    } else if (trackTemp <= CONFIG.SLOW_DRY_TRACK_TEMP) {
      dryingFactor = CONFIG.SLOW_DRY_FACTOR;
    } else {
      // Linear interpolation between slow and fast
      const t =
        (trackTemp - CONFIG.SLOW_DRY_TRACK_TEMP) /
        (CONFIG.FAST_DRY_TRACK_TEMP - CONFIG.SLOW_DRY_TRACK_TEMP);
      dryingFactor =
        CONFIG.SLOW_DRY_FACTOR +
        t * (CONFIG.FAST_DRY_FACTOR - CONFIG.SLOW_DRY_FACTOR);
    }
  }

  const effectiveHalfLife = CONFIG.PERSISTENCE_HALF_LIFE_MS / dryingFactor;

  let maxScore = 0;
  for (const s of timeline) {
    if (s.time > atTime) break;
    if (s.time < lookbackStart) continue;
    if (s.rainfall <= CONFIG.RAIN_THRESHOLD) continue;

    const age = atTime - s.time;
    // Exponential decay: score = e^(-ln2 * age / halfLife)
    const score = Math.exp((-Math.LN2 * age) / Math.max(effectiveHalfLife, 1));
    if (score > maxScore) maxScore = score;
  }

  return maxScore;
}

/**
 * Compute the median track temperature from samples near a time window.
 * Returns null if no samples have valid track temperature.
 */
function getTrackTempForWindow(
  samples: WeatherSample[]
): number | null {
  const temps = samples
    .map((s) => s.trackTemp)
    .filter((t): t is number => t != null);
  if (temps.length === 0) return null;
  temps.sort((a, b) => a - b);
  return temps[Math.floor(temps.length / 2)];
}

interface LapRainSignals {
  /** Fraction of in-lap samples showing active rain (0–1) */
  activeRainFraction: number;
  /** Number of in-lap samples */
  sampleCount: number;
  /** Persistence score at lap midpoint (0–1) */
  persistenceScore: number;
  /** Whether any sample in the lap shows rain */
  hasActiveRain: boolean;
  /** Track temperature during the lap, if available */
  trackTemp: number | null;
}

/**
 * Compute all rain signals for a single lap.
 */
function computeLapRainSignals(
  timeline: WeatherSample[],
  lapStart: number,
  lapEnd: number
): LapRainSignals {
  const inLapSamples = getWeatherSamplesForWindow(timeline, lapStart, lapEnd);
  const trackTemp = getTrackTempForWindow(inLapSamples.length > 0 ? inLapSamples : getWeatherSamplesForWindow(timeline, lapStart - 60_000, lapEnd));

  let rainCount = 0;
  for (const s of inLapSamples) {
    if (s.rainfall > CONFIG.RAIN_THRESHOLD) rainCount++;
  }

  const activeRainFraction =
    inLapSamples.length > 0 ? rainCount / inLapSamples.length : 0;

  const lapMid = (lapStart + lapEnd) / 2;
  const persistenceScore = computeWetPersistenceScore(
    timeline,
    lapMid,
    trackTemp
  );

  return {
    activeRainFraction,
    sampleCount: inLapSamples.length,
    persistenceScore,
    hasActiveRain: rainCount > 0,
    trackTemp,
  };
}

/**
 * Classify a lap from its rain signals.
 *
 * Priority:
 *  1. Strong active rain during lap → WET
 *  2. Mixed active rain (some samples) → MIXED or WET depending on fraction
 *  3. No active rain but high persistence → WET or MIXED (track still wet)
 *  4. No rain, low persistence → DRY
 */
function classifyFromSignals(signals: LapRainSignals): WeatherCondition {
  const { activeRainFraction, hasActiveRain, persistenceScore, sampleCount } =
    signals;

  // If we have in-lap samples with rain data
  if (sampleCount > 0 && hasActiveRain) {
    if (activeRainFraction >= CONFIG.DIRECT_WET_FRACTION) {
      return "WET";
    }
    if (activeRainFraction >= CONFIG.DIRECT_MIXED_MIN_RAIN_FRACTION) {
      // Some rain, some dry → at least MIXED; persistence may push to WET
      return persistenceScore >= CONFIG.WET_PERSISTENCE_THRESHOLD
        ? "WET"
        : "MIXED";
    }
  }

  // No active rain in this lap — rely on persistence from recent rain
  if (persistenceScore >= CONFIG.WET_PERSISTENCE_THRESHOLD) {
    return "WET";
  }
  if (persistenceScore >= CONFIG.MIXED_PERSISTENCE_THRESHOLD) {
    return "MIXED";
  }

  return "DRY";
}

/* ── Public API (unchanged) ────────────────────────────────────── */

/**
 * Classify each lap as DRY, WET or MIXED based on weather data.
 *
 * Uses three internal signals per lap:
 *  - active_rain: rainfall samples during the lap itself
 *  - recent_rain: exponentially-decayed persistence from prior rain
 *  - track_temperature: modulates drying speed (hot = dries faster)
 *
 * Falls back conservatively to DRY when data is insufficient.
 * Anti-hallucination: never infers conditions from absent data.
 */
export function classifyLapsWeather(
  laps: Lap[],
  weather: WeatherData[]
): Map<number, WeatherCondition> {
  const result = new Map<number, WeatherCondition>();
  if (!weather.length) return result;

  const timeline = prepareWeatherTimeline(weather);

  for (const lap of laps) {
    if (!lap.date_start || !lap.lap_duration || lap.lap_duration <= 0) {
      continue; // no classification → treated as DRY by consumers
    }

    const lapStart = new Date(lap.date_start).getTime();
    const lapEnd = lapStart + lap.lap_duration * 1000;

    const signals = computeLapRainSignals(timeline, lapStart, lapEnd);
    const condition = classifyFromSignals(signals);

    result.set(lap.lap_number, condition);
  }

  return result;
}
