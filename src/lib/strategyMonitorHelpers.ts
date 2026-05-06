import type { LiveLap, LiveStint } from "@/lib/livedataClient";

/**
 * Mean lap_duration for the given stint, EXCLUDING the out-lap
 * (lap_number === stint.lap_start) and any null/zero durations.
 * Returns null if fewer than 3 valid laps are available.
 */
export function meanStintLap(stint: LiveStint, laps: LiveLap[]): number | null {
  const stintLaps = laps.filter(
    (l) =>
      l.lap_number > stint.lap_start &&
      (stint.lap_end == null || l.lap_number <= stint.lap_end) &&
      l.lap_duration != null &&
      l.lap_duration > 0,
  );
  if (stintLaps.length < 3) return null;
  const sum = stintLaps.reduce((s, l) => s + (l.lap_duration as number), 0);
  return sum / stintLaps.length;
}
