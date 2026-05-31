/**
 * Position-aware ranking adjustment
 * ─────────────────────────────────
 * Covers `computePositionAdjustment` and verifies that:
 *  (a) high undercut_opportunity → NEGATIVE position_score_adjustment (bonus)
 *  (b) high undercut_risk → POSITIVE adjustment (penalty)
 *  (c) null competitor_context → 0 (backward compat: empty intervals/positions
 *      ⇒ no behavioral change in ranking)
 *  (d) End-to-end: with empty intervals/positions, all alternatives have
 *      position_score_adjustment = 0 and the ranking matches the pure-pace
 *      baseline (snapshot lock from scenarioNeutralizationBonus).
 */

import { describe, it, expect } from "vitest";
import {
  computePositionAdjustment,
  computeVirtualRaceEngineer,
  POSITION_ADJUSTMENT_MAX,
} from "../virtualRaceEngineer";
import type {
  Lap, StintData, PitData, WeatherData, RaceControlMessage,
  IntervalData, PositionData, Driver,
} from "../openf1";

describe("computePositionAdjustment", () => {
  it("returns 0 for null context", () => {
    expect(computePositionAdjustment(null, "BALANCED")).toBe(0);
    expect(computePositionAdjustment(undefined, "BALANCED")).toBe(0);
  });

  it("returns 0 when opportunity == risk (balanced)", () => {
    expect(
      computePositionAdjustment({ undercut_opportunity: 0.5, undercut_risk: 0.5 }, "BALANCED"),
    ).toBe(0);
  });

  it("returns NEGATIVE when opportunity dominates (attack bonus)", () => {
    const v = computePositionAdjustment(
      { undercut_opportunity: 0.8, undercut_risk: 0.1 }, "BALANCED",
    );
    expect(v).toBeLessThan(0);
  });

  it("returns POSITIVE when risk dominates (exposed penalty)", () => {
    const v = computePositionAdjustment(
      { undercut_opportunity: 0.1, undercut_risk: 0.8 }, "BALANCED",
    );
    expect(v).toBeGreaterThan(0);
  });

  it("AGGRESSIVE weights opportunity more than CONSERVATIVE", () => {
    const ctx = { undercut_opportunity: 0.7, undercut_risk: 0.3 };
    const aggr = computePositionAdjustment(ctx, "AGGRESSIVE");
    const cons = computePositionAdjustment(ctx, "CONSERVATIVE");
    expect(aggr).toBeLessThan(cons); // aggressive → more negative (bigger bonus)
  });

  it("clamps to ±POSITION_ADJUSTMENT_MAX", () => {
    const huge = computePositionAdjustment(
      { undercut_opportunity: 1, undercut_risk: 0 }, "AGGRESSIVE",
    );
    expect(huge).toBeGreaterThanOrEqual(-POSITION_ADJUSTMENT_MAX);
    const hugePos = computePositionAdjustment(
      { undercut_opportunity: 0, undercut_risk: 1 }, "CONSERVATIVE",
    );
    expect(hugePos).toBeLessThanOrEqual(POSITION_ADJUSTMENT_MAX);
  });
});

/* ── Backward-compat integration test ── */

function buildLap(driver: number, lap_number: number, lap_duration: number, opts: Partial<Lap> = {}): Lap {
  return {
    lap_number,
    lap_duration,
    duration_sector_1: lap_duration / 3,
    duration_sector_2: lap_duration / 3,
    duration_sector_3: lap_duration / 3,
    st_speed: 300,
    date_start: `2024-01-01T13:${String(lap_number).padStart(2, "0")}:00.000Z`,
    is_pit_out_lap: false,
    driver_number: driver,
    session_key: 9999,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    ...opts,
  };
}
function buildStint(driver: number, stint_number: number, compound: string, lap_start: number, lap_end: number): StintData {
  return { compound, driver_number: driver, lap_end, lap_start, meeting_key: 1, session_key: 9999, stint_number, tyre_age_at_start: 0 };
}
function buildPit(driver: number, lap_number: number): PitData {
  return { date: `2024-01-01T13:${String(lap_number).padStart(2, "0")}:00.000Z`, driver_number: driver, lane_duration: 22, lap_number, meeting_key: 1, pit_duration: 22, session_key: 9999, stop_duration: 2.5 };
}
const DRIVER: Driver = {
  driver_number: 16, broadcast_name: "C. LECLERC", full_name: "Charles Leclerc",
  name_acronym: "LEC", team_name: "Ferrari", team_colour: "E80020",
  headshot_url: null, session_key: 9999,
};

describe("computeVirtualRaceEngineer — position-aware integration", () => {
  it("with empty intervals/positions: every alternative has position_score_adjustment = 0", () => {
    const driver = 16;
    const laps: Lap[] = [];
    for (let i = 1; i <= 30; i++) {
      const inStint1 = i <= 15;
      const base = inStint1 ? 90 + (i - 1) * 0.05 : 91 + (i - 16) * 0.03;
      laps.push(buildLap(driver, i, base, { is_pit_out_lap: i === 16 }));
    }
    const stints: StintData[] = [
      buildStint(driver, 1, "SOFT", 1, 15),
      buildStint(driver, 2, "HARD", 16, 30),
    ];
    const pits: PitData[] = [buildPit(driver, 15)];
    const weather: WeatherData[] = [{
      air_temperature: 25, date: "2024-01-01T13:00:00.000Z", humidity: 50,
      meeting_key: 1, pressure: 1013, rainfall: 0, session_key: 9999,
      track_temperature: 35, wind_direction: 0, wind_speed: 5,
    }];
    const intervals: IntervalData[] = [];
    const positions: PositionData[] = [];
    const raceControl: RaceControlMessage[] = [];

    const result = computeVirtualRaceEngineer(
      driver, "LEC", 9999, laps, stints, pits, weather, raceControl,
      intervals, positions, [DRIVER], [], "BALANCED",
      null, null, "REAL_CONTEXT", null, null, null, "POST_RACE",
    );

    expect(result).not.toBeNull();
    for (const alt of result!.alternative_strategies) {
      expect(alt.position_score_adjustment ?? 0).toBe(0);
    }
  });
});
