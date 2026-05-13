import type { Lap, PositionData, Driver } from "./openf1";

/**
 * Given a pit lap number for driver A and the race-wide position snapshots,
 * find the driver immediately ahead of A and immediately behind A at the
 * time of the lap (or the closest preceding position record).
 *
 * Pure function. Returns null entries when no driver is found in that slot
 * (e.g., A is the leader or last).
 */
export interface AdjacentDrivers {
  ahead: Driver | null;
  behind: Driver | null;
}

export function resolveAdjacentDrivers(
  driverA: number,
  pitLapNumber: number,
  laps: Lap[],
  positions: PositionData[],
  allDrivers: Driver[],
): AdjacentDrivers {
  const aLap = laps.find((l) => l.driver_number === driverA && l.lap_number === pitLapNumber);
  const referenceDate = aLap?.date_start ?? null;
  const refMs = referenceDate ? new Date(referenceDate).getTime() : null;

  const latestPerDriver = new Map<number, PositionData>();
  for (const p of positions) {
    const t = new Date(p.date).getTime();
    if (refMs != null && t > refMs) continue;
    const cur = latestPerDriver.get(p.driver_number);
    if (!cur || new Date(p.date).getTime() > new Date(cur.date).getTime()) {
      latestPerDriver.set(p.driver_number, p);
    }
  }

  const sorted = Array.from(latestPerDriver.values()).sort((a, b) => a.position - b.position);
  const aIdx = sorted.findIndex((p) => p.driver_number === driverA);
  if (aIdx === -1) return { ahead: null, behind: null };

  const aheadNum = aIdx > 0 ? sorted[aIdx - 1].driver_number : null;
  const behindNum = aIdx < sorted.length - 1 ? sorted[aIdx + 1].driver_number : null;
  const ahead = aheadNum != null ? allDrivers.find((d) => d.driver_number === aheadNum) ?? null : null;
  const behind = behindNum != null ? allDrivers.find((d) => d.driver_number === behindNum) ?? null : null;
  return { ahead, behind };
}

/**
 * Compute the [dateStart, dateEnd] window for fetching /location data for
 * a specific pit lap. Window covers from start of pit lap until ~30s after
 * the start of pit lap + 1 to capture both pre-pit and post-pit moments.
 */
export function computeLocationWindow(
  driverNumber: number,
  pitLapNumber: number,
  laps: Lap[],
): { dateStart: string; dateEnd: string } | null {
  const sortedLaps = laps
    .filter((l) => l.driver_number === driverNumber)
    .sort((a, b) => a.lap_number - b.lap_number);
  const pitLap = sortedLaps.find((l) => l.lap_number === pitLapNumber);
  if (!pitLap?.date_start) return null;
  const nextLap = sortedLaps.find((l) => l.lap_number === pitLapNumber + 1);
  if (!nextLap?.date_start) {
    const start = new Date(pitLap.date_start).getTime();
    return {
      dateStart: pitLap.date_start,
      dateEnd: new Date(start + 120_000).toISOString(),
    };
  }
  const end = new Date(nextLap.date_start).getTime() + 30_000;
  return {
    dateStart: pitLap.date_start,
    dateEnd: new Date(end).toISOString(),
  };
}

/**
 * Pick the "pre-pit" (~5s before pit-lap end) and "post-pit" (~25s after) reference
 * timestamps. Approximations; TrackMap will highlight closest sample.
 */
export function pickPrePostTimestamps(
  driverNumber: number,
  pitLapNumber: number,
  laps: Lap[],
): { prePit: string; postPit: string } | null {
  const sortedLaps = laps
    .filter((l) => l.driver_number === driverNumber)
    .sort((a, b) => a.lap_number - b.lap_number);
  const nextLap = sortedLaps.find((l) => l.lap_number === pitLapNumber + 1);
  if (!nextLap?.date_start) return null;
  const nextStartMs = new Date(nextLap.date_start).getTime();
  return {
    prePit: new Date(nextStartMs - 5_000).toISOString(),
    postPit: new Date(nextStartMs + 25_000).toISOString(),
  };
}
