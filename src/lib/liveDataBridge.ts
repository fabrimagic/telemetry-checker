import type { Lap, StintData } from "./openf1";
import type { LiveLap, LiveStint, LivePit } from "./livedataClient";

/**
 * Bridge module: adapt live OpenF1-mirror types to post-race types
 * expected by the existing analytical engine. Pure functions, no fetch.
 */

/** A pit-out lap is the lap immediately after the lap recorded in /v1/pit. */
export function deriveIsPitOutLap(
  lapNumber: number,
  driverNumber: number,
  pits: LivePit[],
): boolean {
  return pits.some(
    (p) => p.driver_number === driverNumber && p.lap_number + 1 === lapNumber,
  );
}

export function adaptLapsToPostRace(
  liveLaps: LiveLap[],
  pits: LivePit[],
  sessionKey: number,
): Lap[] {
  return liveLaps.map((l) => ({
    lap_number: l.lap_number,
    lap_duration: l.lap_duration,
    duration_sector_1: l.duration_sector_1,
    duration_sector_2: l.duration_sector_2,
    duration_sector_3: l.duration_sector_3,
    st_speed: l.st_speed,
    date_start: l.date_start ?? null,
    is_pit_out_lap: deriveIsPitOutLap(l.lap_number, l.driver_number, pits),
    driver_number: l.driver_number,
    session_key: sessionKey,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
  }));
}

export function adaptStintsToPostRace(
  liveStints: LiveStint[],
  maxLapSeen: number,
  sessionKey: number,
): StintData[] {
  return liveStints.map((s) => ({
    compound: s.compound,
    driver_number: s.driver_number,
    lap_end: s.lap_end != null ? s.lap_end : maxLapSeen,
    lap_start: s.lap_start,
    meeting_key: 0,
    session_key: sessionKey,
    stint_number: s.stint_number,
    tyre_age_at_start: s.tyre_age_at_start,
  }));
}
