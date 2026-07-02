/**
 * Regression tests for the four alternative-strategies bugfixes in
 * computeVirtualRaceEngineer:
 *   1. Promotion index invalidated by in-place sort → snapshot pre-sort refs.
 *   2. Name-based scoring identity collapsed duplicate N+1 alternatives →
 *      reference/position-based resolution + unique names with compound suffix.
 *   3. Invalid pit sequences (duplicates / non-monotonic) in undercut/overcut/
 *      N+1 → validated via strictly-increasing + 3-lap-spacing rule.
 *   4. Palindromic compound sequence made "Strategia compound invertiti"
 *      identical to actual with delta ≈ 0 → skip when reversed == actual.
 */

import { describe, it, expect } from "vitest";
import { computeVirtualRaceEngineer } from "../virtualRaceEngineer";
import type {
  Lap, StintData, PitData, WeatherData, RaceControlMessage,
  IntervalData, PositionData, Driver,
} from "../openf1";

function buildLap(driver: number, lap_number: number, lap_duration: number, opts: Partial<Lap> = {}): Lap {
  const mm = String(Math.floor(lap_number / 60)).padStart(2, "0");
  const ss = String(lap_number % 60).padStart(2, "0");
  return {
    lap_number, lap_duration,
    duration_sector_1: lap_duration / 3, duration_sector_2: lap_duration / 3, duration_sector_3: lap_duration / 3,
    st_speed: 300, date_start: `2024-01-01T13:${mm}:${ss}.000Z`,
    is_pit_out_lap: false, driver_number: driver, session_key: 9999,
    segments_sector_1: null, segments_sector_2: null, segments_sector_3: null, ...opts,
  } as Lap;
}

const DRIVER: Driver = {
  driver_number: 12, broadcast_name: "ANT", full_name: "ANT", name_acronym: "ANT",
  team_name: "M", team_colour: "000000", headshot_url: null, session_key: 9999,
} as Driver;
const WEATHER: WeatherData[] = [{
  air_temperature: 25, date: "2024-01-01T13:00:00.000Z", humidity: 50, meeting_key: 1,
  pressure: 1013, rainfall: 0, session_key: 9999, track_temperature: 35,
  wind_direction: 0, wind_speed: 5,
} as WeatherData];

function pit(lap: number): PitData {
  const mm = String(Math.floor(lap / 60)).padStart(2, "0");
  const ss = String(lap % 60).padStart(2, "0");
  return {
    date: `2024-01-01T13:${mm}:${ss}.000Z`, driver_number: 12, lap_number: lap,
    lane_duration: 23, pit_duration: 23, stop_duration: 2.4,
    session_key: 9999, meeting_key: 1,
  } as PitData;
}

function runVRE(laps: Lap[], stints: StintData[], pits: PitData[]) {
  return computeVirtualRaceEngineer(
    12, "ANT", 9999, laps, stints, pits, WEATHER, [] as RaceControlMessage[],
    [] as IntervalData[], [] as PositionData[], [DRIVER], [], "BALANCED",
    null, null, "REAL_CONTEXT", null, null, null, "POST_RACE",
  );
}

describe("Alternative strategies — bugfixes regression", () => {
  it("Bug 3: pit ai giri 10, 13, 30 non genera alternative con pit non strettamente crescenti", () => {
    const totalLaps = 55;
    const laps: Lap[] = [];
    for (let i = 1; i <= 10; i++) laps.push(buildLap(12, i, 90 + i * 0.05));
    for (let i = 11; i <= 13; i++) laps.push(buildLap(12, i, 90 + (i - 11) * 0.05, { is_pit_out_lap: i === 11 }));
    for (let i = 14; i <= 30; i++) laps.push(buildLap(12, i, 90 + (i - 14) * 0.05, { is_pit_out_lap: i === 14 }));
    for (let i = 31; i <= totalLaps; i++) laps.push(buildLap(12, i, 90 + (i - 31) * 0.05, { is_pit_out_lap: i === 31 }));

    const stints: StintData[] = [
      { compound: "SOFT",   driver_number: 12, lap_start: 1,  lap_end: 10, stint_number: 1, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
      { compound: "HARD",   driver_number: 12, lap_start: 11, lap_end: 13, stint_number: 2, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
      { compound: "SOFT",   driver_number: 12, lap_start: 14, lap_end: 30, stint_number: 3, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
      { compound: "HARD",   driver_number: 12, lap_start: 31, lap_end: totalLaps, stint_number: 4, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
    ] as StintData[];
    const pits = [pit(10), pit(13), pit(30)];

    const r = runVRE(laps, stints, pits);
    expect(r).not.toBeNull();
    for (const alt of r!.alternative_strategies) {
      for (let i = 1; i < alt.pit_laps.length; i++) {
        expect(alt.pit_laps[i]).toBeGreaterThan(alt.pit_laps[i - 1]);
      }
      // No duplicates
      expect(new Set(alt.pit_laps).size).toBe(alt.pit_laps.length);
    }
  });

  it("Bug 2: 1-stop reale genera N+1 alternative con nomi unici e scoring distinti coerenti coi delta", () => {
    const totalLaps = 60, pitLap = 30;
    const laps: Lap[] = [];
    for (let i = 1; i <= pitLap; i++) laps.push(buildLap(12, i, 90 + (i - 1) * 0.05));
    for (let i = pitLap + 1; i <= totalLaps; i++) {
      laps.push(buildLap(12, i, 90.5 + (i - pitLap - 1) * 0.04, { is_pit_out_lap: i === pitLap + 1 }));
    }
    const stints: StintData[] = [
      { compound: "SOFT",   driver_number: 12, lap_start: 1,          lap_end: pitLap,    stint_number: 1, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
      { compound: "MEDIUM", driver_number: 12, lap_start: pitLap + 1, lap_end: totalLaps, stint_number: 2, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
    ] as StintData[];

    const r = runVRE(laps, stints, [pit(pitLap)]);
    expect(r).not.toBeNull();
    const alts = r!.alternative_strategies;
    // All names must be distinct (no collision between N+1 siblings).
    const names = alts.map(a => a.name);
    expect(new Set(names).size).toBe(names.length);

    // Locate the two N+1 (2-stop) siblings with different compounds; if both
    // present, their delta and scoring_with_soft_sensors must be coherent
    // (higher delta ⇒ higher scoring).
    const twoStop = alts.filter(a => a.name.startsWith("2-stop"));
    if (twoStop.length >= 2 && twoStop.every(a => a.scoring_with_soft_sensors != null)) {
      // Distinct scores (no name-collision copying)
      const scores = twoStop.map(a => a.scoring_with_soft_sensors!);
      expect(new Set(scores).size).toBe(scores.length);
      // Monotonic on delta
      const sorted = [...twoStop].sort((a, b) =>
        b.estimated_delta_vs_actual - a.estimated_delta_vs_actual);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].scoring_with_soft_sensors!)
          .toBeLessThanOrEqual(sorted[i - 1].scoring_with_soft_sensors!);
      }
    }
  });

  it("Bug 4: mescole palindrome non producono l'alternativa 'Strategia compound invertiti'", () => {
    const totalLaps = 60;
    const laps: Lap[] = [];
    for (let i = 1; i <= 20; i++) laps.push(buildLap(12, i, 90 + (i - 1) * 0.05));
    for (let i = 21; i <= 40; i++) laps.push(buildLap(12, i, 90.5 + (i - 21) * 0.04, { is_pit_out_lap: i === 21 }));
    for (let i = 41; i <= totalLaps; i++) laps.push(buildLap(12, i, 90 + (i - 41) * 0.05, { is_pit_out_lap: i === 41 }));
    const stints: StintData[] = [
      { compound: "SOFT",   driver_number: 12, lap_start: 1,  lap_end: 20, stint_number: 1, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
      { compound: "MEDIUM", driver_number: 12, lap_start: 21, lap_end: 40, stint_number: 2, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
      { compound: "SOFT",   driver_number: 12, lap_start: 41, lap_end: totalLaps, stint_number: 3, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
    ] as StintData[];

    const r = runVRE(laps, stints, [pit(20), pit(40)]);
    expect(r).not.toBeNull();
    const names = r!.alternative_strategies.map(a => a.name);
    expect(names).not.toContain("Strategia compound invertiti");
  });

  it("Bug 1: quando la raccomandata è 'Promossa', pit e compound coincidono con l'alternativa a scoring massimo", () => {
    const totalLaps = 60, pitLap = 30;
    const laps: Lap[] = [];
    // Degrado elevato per favorire una promozione dal ranking (N+1 tipico).
    for (let i = 1; i <= pitLap; i++) laps.push(buildLap(12, i, 90 + (i - 1) * 0.25));
    for (let i = pitLap + 1; i <= totalLaps; i++) {
      laps.push(buildLap(12, i, 91 + (i - pitLap - 1) * 0.20, { is_pit_out_lap: i === pitLap + 1 }));
    }
    const stints: StintData[] = [
      { compound: "SOFT",   driver_number: 12, lap_start: 1,          lap_end: pitLap,    stint_number: 1, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
      { compound: "MEDIUM", driver_number: 12, lap_start: pitLap + 1, lap_end: totalLaps, stint_number: 2, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 },
    ] as StintData[];

    const r = runVRE(laps, stints, [pit(pitLap)]);
    expect(r).not.toBeNull();
    const rec = r!.recommended_strategy;
    if (rec.reason.startsWith("Promossa")) {
      const alts = r!.alternative_strategies.filter(a => a.scoring_with_soft_sensors != null);
      expect(alts.length).toBeGreaterThan(0);
      const bestAlt = [...alts].sort((a, b) =>
        b.scoring_with_soft_sensors! - a.scoring_with_soft_sensors!)[0];
      const recPits = rec.pit_windows.map(w => w.ideal_lap);
      expect(recPits).toEqual(bestAlt.pit_laps);
      expect(rec.compounds).toEqual(bestAlt.compounds);
    }
  });
});
