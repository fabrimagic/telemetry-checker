/**
 * Shared visual colors for driving-style zones (superclipping / lift & coast).
 * Used by TrackMap and TelemetryCharts to keep map↔chart highlighting consistent.
 */
export const ZONE_COLORS = {
  superclipping: "hsl(0 85% 55%)",
  liftcoast: "hsl(200 85% 55%)",
} as const;

export type ZoneType = "superclipping" | "liftcoast";

export interface ZoneInterval {
  type: ZoneType;
  startTime: number;
  endTime: number;
}

/**
 * Map a date (ISO string) to a relative time (seconds) using a sorted reference series.
 * Returns null if the reference is empty.
 */
function dateToTime(
  date: string,
  ref: { date: string; time: number }[]
): number | null {
  if (!ref.length) return null;
  const t = new Date(date).getTime();
  let bestIdx = 0;
  let bestDiff = Infinity;
  // Linear scan is fine; series are bounded (~few thousand). Keep simple & robust.
  for (let i = 0; i < ref.length; i++) {
    const diff = Math.abs(new Date(ref[i].date).getTime() - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return ref[bestIdx].time;
}

/**
 * Group an array of ISO date strings into contiguous time intervals.
 * Two consecutive samples belong to the same interval when the gap between
 * their mapped times is below `gapSeconds` (default 0.5s).
 */
export function groupDatesToIntervals(
  dates: string[],
  type: ZoneType,
  ref: { date: string; time: number }[],
  gapSeconds = 0.5
): ZoneInterval[] {
  if (!dates.length || !ref.length) return [];
  const times = dates
    .map((d) => dateToTime(d, ref))
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b);
  if (!times.length) return [];

  const out: ZoneInterval[] = [];
  let start = times[0];
  let prev = times[0];
  for (let i = 1; i < times.length; i++) {
    const t = times[i];
    if (t - prev > gapSeconds) {
      out.push({ type, startTime: start, endTime: prev });
      start = t;
    }
    prev = t;
  }
  out.push({ type, startTime: start, endTime: prev });

  // Ensure a minimum visible width so single-sample episodes render as a thin band
  return out.map((iv) =>
    iv.endTime - iv.startTime < 0.05
      ? { ...iv, startTime: iv.startTime - 0.05, endTime: iv.endTime + 0.05 }
      : iv
  );
}
