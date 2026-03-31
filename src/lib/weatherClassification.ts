import type { WeatherData, Lap } from "./openf1";

export type WeatherCondition = "DRY" | "WET" | "MIXED";

export interface LapWeather {
  lap_number: number;
  condition: WeatherCondition;
}

/**
 * Classify each lap as DRY, WET or MIXED based on weather rainfall data.
 * Weather samples are matched to the lap's time window (date_start → date_start + lap_duration).
 * Falls back to DRY when data is missing.
 */
export function classifyLapsWeather(
  laps: Lap[],
  weather: WeatherData[]
): Map<number, WeatherCondition> {
  const result = new Map<number, WeatherCondition>();

  if (!weather.length) return result;

  // Sort weather by date for efficient lookup
  const sortedWeather = [...weather].sort((a, b) => a.date.localeCompare(b.date));
  const weatherTimes = sortedWeather.map((w) => new Date(w.date).getTime());

  for (const lap of laps) {
    if (!lap.date_start || !lap.lap_duration || lap.lap_duration <= 0) {
      continue; // no classification = treated as DRY by consumer
    }

    const lapStart = new Date(lap.date_start).getTime();
    const lapEnd = lapStart + lap.lap_duration * 1000;

    // Expand window by ±60s to catch transitions
    const windowStart = lapStart - 60000;
    const windowEnd = lapEnd + 60000;

    // Find weather samples in the expanded window
    let inLapRain = 0;
    let inLapDry = 0;
    let nearbyRain = false;

    for (let i = 0; i < sortedWeather.length; i++) {
      const wTime = weatherTimes[i];
      if (wTime > windowEnd) break;
      if (wTime < windowStart) continue;

      const isRaining = sortedWeather[i].rainfall > 0;

      if (wTime >= lapStart && wTime <= lapEnd) {
        // Within the actual lap
        if (isRaining) inLapRain++;
        else inLapDry++;
      } else {
        // In the ±60s buffer zone
        if (isRaining) nearbyRain = true;
      }
    }

    let condition: WeatherCondition;
    if (inLapRain > 0 && inLapDry > 0) {
      condition = "MIXED";
    } else if (inLapRain > 0) {
      condition = "WET";
    } else if (nearbyRain && inLapDry >= 0) {
      // Rain nearby but not during lap itself
      condition = "MIXED";
    } else {
      condition = "DRY";
    }

    result.set(lap.lap_number, condition);
  }

  return result;
}
