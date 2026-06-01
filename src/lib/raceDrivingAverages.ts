import type { CarData, Lap } from "./openf1";
import type { TrackStatus } from "./trackStatusClassification";

/**
 * Single-lap detection of "superclipping" and "lift & coast" events from CarData.
 *
 * Extracted from `DrivingAnalysis.tsx` so the same logic powers both
 * the per-lap card and the on-demand race-average computation.
 * The behaviour MUST stay identical to the original implementation.
 */
export interface DrivingZoneStats {
  superclipping: { count: number; duration: number; dates: string[] };
  liftcoast: { count: number; duration: number; dates: string[] };
}

// Throttle threshold for superclipping: episode starts only when throttle is
// STRICTLY above 95% (i.e. "oltre il 95%").
const THROTTLE_SUPERCLIP_MIN = 95;

export function computeZones(carData: CarData[]): DrivingZoneStats {
  let superclipCount = 0;
  let superclipMs = 0;
  let liftcoastCount = 0;
  let liftcoastMs = 0;

  const superclipDates: string[] = [];
  const liftcoastDates: string[] = [];

  let inLiftCoast = false;
  let inSuperclip = false;

  for (let i = 1; i < carData.length; i++) {
    const prev = carData[i - 1];
    const curr = carData[i];
    const dt = new Date(curr.date).getTime() - new Date(prev.date).getTime();
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;

    // ---- Superclipping (stateful, episodic) ----
    // Start: throttle > 95% AND speed decreasing. End: brake pressed OR speed rising again.
    // Note: during an active episode the throttle is NOT required to stay > 95 — the
    // definition explicitly anchors the end to brake-on or speed-rising, not to a
    // momentary throttle dip. Only brake-on or speed-rising terminates the episode.
    if (!inSuperclip) {
      if (curr.throttle > THROTTLE_SUPERCLIP_MIN && curr.speed < prev.speed && prev.speed > 0) {
        inSuperclip = true;
        superclipCount++;
        superclipMs += safeDt;
        superclipDates.push(curr.date);
      }
    } else {
      const endsByBrake = (curr.brake ?? 0) > 0;
      const endsBySpeedUp = curr.speed > prev.speed;
      if (endsByBrake || endsBySpeedUp) {
        // Episode ends; the terminating sample is NOT accumulated.
        inSuperclip = false;
      } else {
        superclipMs += safeDt;
        superclipDates.push(curr.date);
      }
    }

    // ---- Lift & Coast (unchanged) ----
    // Starts when going from (throttle>90, brake=0) to (throttle=0, brake=0);
    // ends when throttle OR brake are pressed.
    if (!inLiftCoast) {
      const prevHighThrottle = prev.throttle > 90 && prev.brake === 0;
      const currCoasting = curr.throttle === 0 && curr.brake === 0;
      if (prevHighThrottle && currCoasting) {
        liftcoastCount++;
        inLiftCoast = true;
        liftcoastMs += dt;
        liftcoastDates.push(curr.date);
      }
    } else {
      if (curr.throttle === 0 && curr.brake === 0) {
        liftcoastMs += dt;
        liftcoastDates.push(curr.date);
      } else {
        inLiftCoast = false;
      }
    }
  }

  return {
    superclipping: { count: superclipCount, duration: superclipMs / 1000, dates: superclipDates },
    liftcoast: { count: liftcoastCount, duration: liftcoastMs / 1000, dates: liftcoastDates },
  };
}


// ───────────────────────── Race average aggregation ─────────────────────────

export interface PerLapDrivingPoint {
  lap_number: number;
  superclip_duration: number;
  superclip_count: number;
  liftcoast_duration: number;
  liftcoast_count: number;
}

export interface RaceDrivingAverages {
  laps_used: number;
  laps_total_comparable: number;
  superclip_avg_duration: number;
  superclip_avg_count: number;
  liftcoast_avg_duration: number;
  liftcoast_avg_count: number;
  superclip_std_duration?: number;
  liftcoast_std_duration?: number;
  /** True when fewer than 3 laps were successfully aggregated → average is indicative only. */
  low_sample: boolean;
  /** True when computation was aborted before completing all comparable laps. */
  aborted: boolean;
  /** Per-lap driving series for successfully downloaded comparable laps, ordered by lap_number. */
  per_lap: PerLapDrivingPoint[];
}

export type CarDataFetcher = (
  sessionKey: number,
  driverNumber: number,
  dateStart: string,
  dateEnd: string,
) => Promise<CarData[]>;

const MIN_SAMPLE_FOR_RELIABLE_AVG = 3;

/**
 * Decide which laps are honest-to-compare for driving-style averages.
 * Excludes:
 *  - pit-out laps (`is_pit_out_lap === true`)
 *  - the lap immediately PRECEDING a pit-out lap (i.e. the pit-in lap, approximated)
 *  - laps under any non-GREEN track status (SC/VSC/RED/YELLOW/MIXED, as classified)
 *  - laps without a valid `date_start` / `lap_duration > 0`
 */
export function pickComparableLaps(
  laps: Lap[],
  trackStatusMap: Map<number, TrackStatus>,
): Lap[] {
  const byNumber = new Map<number, Lap>();
  for (const l of laps) byNumber.set(l.lap_number, l);

  const out: Lap[] = [];
  for (const lap of laps) {
    if (lap.is_pit_out_lap) continue;
    if (!lap.date_start) continue;
    if (!lap.lap_duration || lap.lap_duration <= 0) continue;
    // Track status: any entry in the map is non-GREEN by construction → skip.
    if (trackStatusMap.has(lap.lap_number)) continue;
    // Pit-in approximation: next lap is a pit-out lap.
    const next = byNumber.get(lap.lap_number + 1);
    if (next?.is_pit_out_lap) continue;
    out.push(lap);
  }
  return out;
}

export interface ComputeRaceDrivingAveragesOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Download CarData for every comparable lap (sequentially — relies on the
 * existing openf1 client rate limiter / dedup) and aggregate the driving
 * style metrics. Failed laps are skipped, never thrown. Honest about sample
 * size via `low_sample`.
 *
 * NOTE: the result is purely informational — it MUST NOT be fed into any
 * strategy engine (virtualRaceEngineer, cost functions, …).
 */
export async function computeRaceDrivingAverages(
  sessionKey: number,
  driverNumber: number,
  laps: Lap[],
  trackStatusMap: Map<number, TrackStatus>,
  fetchCarData: CarDataFetcher,
  opts: ComputeRaceDrivingAveragesOptions = {},
): Promise<RaceDrivingAverages> {
  const comparable = pickComparableLaps(laps, trackStatusMap);
  const total = comparable.length;

  const superclipDurations: number[] = [];
  const superclipCounts: number[] = [];
  const liftcoastDurations: number[] = [];
  const liftcoastCounts: number[] = [];

  let aborted = false;

  for (let i = 0; i < comparable.length; i++) {
    if (opts.signal?.aborted) {
      aborted = true;
      break;
    }
    const lap = comparable[i];
    const start = lap.date_start!;
    const endDate = new Date(
      new Date(start).getTime() + (lap.lap_duration ?? 0) * 1000,
    ).toISOString();

    try {
      const car = await fetchCarData(sessionKey, driverNumber, start, endDate);
      if (car && car.length > 1) {
        const z = computeZones(car);
        superclipDurations.push(z.superclipping.duration);
        superclipCounts.push(z.superclipping.count);
        liftcoastDurations.push(z.liftcoast.duration);
        liftcoastCounts.push(z.liftcoast.count);
      }
    } catch {
      // skip failed lap, keep going
    }

    opts.onProgress?.(i + 1, total);
  }

  const used = superclipDurations.length;
  const avg = (xs: number[]) =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  const std = (xs: number[]) => {
    if (xs.length < 2) return undefined;
    const m = avg(xs);
    const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
    return Math.sqrt(v);
  };

  return {
    laps_used: used,
    laps_total_comparable: total,
    superclip_avg_duration: avg(superclipDurations),
    superclip_avg_count: avg(superclipCounts),
    liftcoast_avg_duration: avg(liftcoastDurations),
    liftcoast_avg_count: avg(liftcoastCounts),
    superclip_std_duration: std(superclipDurations),
    liftcoast_std_duration: std(liftcoastDurations),
    low_sample: used < MIN_SAMPLE_FOR_RELIABLE_AVG,
    aborted,
  };
}
