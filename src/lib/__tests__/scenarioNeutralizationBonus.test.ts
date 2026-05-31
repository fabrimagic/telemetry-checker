/**
 * Scenario neutralization/opportunity bonus
 * ─────────────────────────────────────────
 * Guards the fix to `simulateStrategyCost` that applies
 * `scenarioMods.neutralization_weight` and `scenarioMods.opportunity_weight`
 * as a strategic BONUS for pits falling inside the scenario window of a
 * simulated neutralization (SC/VSC/...).
 *
 * Without the fix, only `pit_loss_multiplier` shaped the alternatives'
 * ranking under SAFETY_CAR — severely underweighting the strategic value
 * of an opportunistic SC pit.
 */

import { describe, it, expect } from "vitest";
import { computeVirtualRaceEngineer } from "../virtualRaceEngineer";
import type {
  Lap, StintData, PitData, WeatherData, RaceControlMessage,
  IntervalData, PositionData, Driver,
} from "../openf1";

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

function buildFixture() {
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
  return { driver, laps, stints, pits, weather };
}

function run(scenarioId: "REAL_CONTEXT" | "SAFETY_CAR", activationLap: number | null, durationLaps: number | null) {
  const f = buildFixture();
  const intervals: IntervalData[] = [];
  const positions: PositionData[] = [];
  const raceControl: RaceControlMessage[] = [];
  return computeVirtualRaceEngineer(
    f.driver, "LEC", 9999,
    f.laps, f.stints, f.pits,
    f.weather, raceControl,
    intervals, positions, [DRIVER],
    [], "BALANCED",
    null, null,
    scenarioId, activationLap, durationLaps,
    null, "POST_RACE",
  );
}

describe("simulateStrategyCost — scenario neutralization/opportunity bonus", () => {
  // Actual pit at lap 15 → overcut alt at lap 18.
  // SC window 18-20 covers the overcut but NOT the actual pit, so the bonus
  // applies asymmetrically and the overcut delta improves under SAFETY_CAR.
  it("SAFETY_CAR window over an alternative pit improves its delta vs REAL_CONTEXT", () => {
    const real = run("REAL_CONTEXT", null, null);
    const sc = run("SAFETY_CAR", 18, 3);

    expect(real).not.toBeNull();
    expect(sc).not.toBeNull();

    const findOvercut = (r: NonNullable<typeof real>) =>
      r.alternative_strategies.find((a) => a.pit_laps[0] === 18) ?? null;

    const realOvercut = findOvercut(real!);
    const scOvercut = findOvercut(sc!);

    expect(realOvercut).not.toBeNull();
    expect(scOvercut).not.toBeNull();

    // Under SC with the window covering the overcut pit, the alternative
    // must be strictly more favorable than in REAL_CONTEXT.
    expect(scOvercut!.estimated_delta_vs_actual).toBeGreaterThan(
      realOvercut!.estimated_delta_vs_actual,
    );
  });

  it("REAL_CONTEXT baseline is unchanged (no bonus path triggered)", () => {
    // Snapshot the REAL_CONTEXT alt deltas to lock the baseline.
    const real = run("REAL_CONTEXT", null, null);
    expect(real).not.toBeNull();
    const summary = real!.alternative_strategies.map((a) => ({
      name: a.name,
      pit_laps: a.pit_laps,
      compounds: a.compounds,
      estimated_delta_vs_actual: a.estimated_delta_vs_actual,
    }));
    expect(summary).toMatchSnapshot();
  });
});
