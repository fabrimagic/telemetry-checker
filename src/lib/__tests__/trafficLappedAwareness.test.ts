/**
 * Pit-exit traffic — lapped-car awareness
 * ───────────────────────────────────────
 * 1) A lapped car reported by OpenF1 as "+1 LAP" must NOT be parsed as "1s
 *    behind the leader" (that placed it at the front of the field and
 *    corrupted rejoin position / pack structure).
 * 2) When lap timestamps place that lapped car physically close to the rejoin
 *    point, it must be counted as on-track traffic.
 * 3) No timestamps for the lapped car → it is skipped, not invented.
 */

import { describe, it, expect } from "vitest";
import { predictTrafficForPitLaps } from "../trafficPredictor";
import type { Lap, IntervalData, PositionData, Driver } from "../openf1";

const T0 = Date.parse("2024-01-01T13:00:00.000Z");
const LAP = 90; // seconds

function mkLap(driver: number, n: number, startOffsetSec: number, dur = LAP): Lap {
  return {
    lap_number: n,
    lap_duration: dur,
    duration_sector_1: dur / 3,
    duration_sector_2: dur / 3,
    duration_sector_3: dur / 3,
    st_speed: 300,
    date_start: new Date(T0 + startOffsetSec * 1000).toISOString(),
    is_pit_out_lap: false,
    driver_number: driver,
    session_key: 1,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
  };
}

/** `count` laps at `dur`, first lap starting at `startOffset`. */
function series(driver: number, count: number, dur: number, startOffset = 0): Lap[] {
  const out: Lap[] = [];
  let t = startOffset;
  for (let n = 1; n <= count; n++) {
    out.push(mkLap(driver, n, t, dur));
    t += dur;
  }
  return out;
}

function interval(driver: number, offsetSec: number, gap: number | string | null): IntervalData {
  return {
    date: new Date(T0 + offsetSec * 1000).toISOString(),
    driver_number: driver,
    gap_to_leader: gap,
    interval: null,
    meeting_key: 1,
    session_key: 1,
  };
}

function position(driver: number, offsetSec: number, pos: number): PositionData {
  return {
    date: new Date(T0 + offsetSec * 1000).toISOString(),
    driver_number: driver,
    meeting_key: 1,
    position: pos,
    session_key: 1,
  } as PositionData;
}

const drivers: Driver[] = [1, 2, 3, 20].map((dn, i) => ({
  driver_number: dn,
  broadcast_name: `D. ${dn}`,
  full_name: `Driver ${dn}`,
  name_acronym: `D${dn}`,
  team_name: `Team ${i}`,
  team_colour: "FFFFFF",
  headshot_url: null,
  session_key: 1,
})) as Driver[];

const PIT_LOSS = 22;
const PIT_LAP = 10;
const pitLapStart = (PIT_LAP - 1) * LAP; // 810s

/** Analyzed driver 1 plus two rivals on the lead lap. */
function baseWorld() {
  const laps = new Map<number, Lap[]>();
  laps.set(1, series(1, 20, LAP));
  laps.set(2, series(2, 20, LAP, 2));
  laps.set(3, series(3, 20, LAP, 30));

  const intervals: IntervalData[] = [];
  const positions: PositionData[] = [];
  for (const [dn, gap, pos] of [[1, 10, 2], [2, 0, 1], [3, 40, 3]] as const) {
    for (let t = 0; t <= 1800; t += 60) {
      intervals.push(interval(dn, t, gap));
      positions.push(position(dn, t, pos));
    }
  }
  return { laps, intervals, positions };
}

describe("predictTrafficForPitLaps — lapped cars", () => {
  it("does not treat a '+1 LAP' marker as a 1-second gap to the leader", () => {
    const w = baseWorld();
    // Lapped car #20: far away on track (phase ~half a lap from the rejoin
    // point) so it must not be counted as traffic either.
    w.laps.set(20, series(20, 10, LAP * 2));
    for (let t = 0; t <= 1800; t += 60) {
      w.intervals.push(interval(20, t, "+1 LAP"));
      w.positions.push(position(20, t, 20));
    }

    const [p] = predictTrafficForPitLaps(
      1, [PIT_LAP], PIT_LOSS, 20, w.laps, w.positions, w.intervals, drivers,
    );

    // The lapped car must never appear as the car directly ahead/behind
    // in the classified order (that was the symptom of the parsing bug).
    expect(p.rejoin_between).not.toContain("D20");
    expect(p.lapped_cars_nearby ?? []).not.toContain(20);
  });

  it("counts a lapped car as on-track traffic when timestamps place it near the rejoin point", () => {
    const w = baseWorld();
    // Driver 20 runs 180s laps (a full lap down). Offset chosen so that at
    // pit-exit time (810 + 22 = 832s) it sits ~2s ahead on track.
    const exit = pitLapStart + PIT_LOSS; // 832
    // Self phase at exit: lap 10 started at 810 → phase = 22/90 = 0.2444.
    // Want other phase ≈ 0.2444 + 2/90 = 0.2667 on a 180s lap → elapsed 48s.
    const startOffset = exit - 48 - 180 * 4; // 4 completed laps before
    w.laps.set(20, series(20, 8, 180, startOffset));
    for (let t = 0; t <= 1800; t += 60) {
      w.intervals.push(interval(20, t, "1 LAP"));
      w.positions.push(position(20, t, 20));
    }

    const [p] = predictTrafficForPitLaps(
      1, [PIT_LAP], PIT_LOSS, 20, w.laps, w.positions, w.intervals, drivers,
    );

    expect(p.lapped_traffic_considered).toBe(true);
    expect(p.lapped_cars_nearby).toContain(20);
    expect(p.nearest_lapped_gap_ahead).not.toBeNull();
    expect(p.nearest_lapped_gap_ahead!).toBeGreaterThan(0);
    expect(p.nearest_lapped_gap_ahead!).toBeLessThanOrEqual(3);
    // Nearest car on track is now the lapped one → not clean air.
    expect(p.release_classification).not.toBe("CLEAN");
  });

  it("skips lapped cars whose on-track position cannot be resolved (no invention)", () => {
    const w = baseWorld();
    w.laps.set(20, []); // no lap timestamps at all
    for (let t = 0; t <= 1800; t += 60) {
      w.intervals.push(interval(20, t, "+2 LAPS"));
      w.positions.push(position(20, t, 20));
    }

    const [p] = predictTrafficForPitLaps(
      1, [PIT_LAP], PIT_LOSS, 20, w.laps, w.positions, w.intervals, drivers,
    );

    expect(p.lapped_cars_in_window).toBe(0);
    expect(p.nearest_lapped_gap_ahead).toBeNull();
  });
});
