/**
 * Strategy delta plausibility
 * ───────────────────────────
 * Regression: VRE produceva delta strategici implausibili (>200s) su stint
 * lunghi a causa di (a) degrado per-giro estrapolato linearmente,
 * (b) cliff penalty quadratica non limitata, (c) assenza di un cap finale
 * sul guadagno stimato. Questo test costruisce uno stint lungo con slope
 * ripido e verifica che il guadagno stimato rimanga ancorato a ~2.5x pit
 * loss (e comunque < 60s).
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
    date_start: `2024-01-01T13:${String(Math.floor(lap_number / 60)).padStart(2, "0")}:${String(lap_number % 60).padStart(2, "0")}.000Z`,
    is_pit_out_lap: false,
    driver_number: driver,
    session_key: 9999,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    ...opts,
  };
}

const DRIVER: Driver = {
  driver_number: 12, broadcast_name: "K. ANTONELLI", full_name: "Andrea Kimi Antonelli",
  name_acronym: "ANT", team_name: "Mercedes", team_colour: "27F4D2",
  headshot_url: null, session_key: 9999,
};

describe("VRE — plausibility clamp on estimated strategy gain", () => {
  it("long first stint with steep slope keeps bestDelta within ~2.5x pit loss", () => {
    const driver = 12;
    const totalLaps = 68;
    const pitLap = 45;
    const laps: Lap[] = [];

    // Stint 1: SOFT, 45 laps, ripido slope (~0.4 s/giro) → senza clamp
    // estrapolerebbe +18 s/giro a fine stint.
    for (let i = 1; i <= pitLap; i++) {
      const tyreLife = i - 1;
      laps.push(buildLap(driver, i, 90 + tyreLife * 0.4));
    }
    // Stint 2: HARD, 23 laps, slope moderato
    for (let i = pitLap + 1; i <= totalLaps; i++) {
      const tyreLife = i - (pitLap + 1);
      laps.push(buildLap(driver, i, 91 + tyreLife * 0.1, { is_pit_out_lap: i === pitLap + 1 }));
    }

    const stints: StintData[] = [
      { compound: "SOFT", driver_number: driver, lap_end: pitLap, lap_start: 1, meeting_key: 1, session_key: 9999, stint_number: 1, tyre_age_at_start: 0 },
      { compound: "HARD", driver_number: driver, lap_end: totalLaps, lap_start: pitLap + 1, meeting_key: 1, session_key: 9999, stint_number: 2, tyre_age_at_start: 0 },
    ];
    const pits: PitData[] = [{
      date: `2024-01-01T13:45:00.000Z`,
      driver_number: driver, lane_duration: 21, lap_number: pitLap,
      meeting_key: 1, pit_duration: 21, session_key: 9999, stop_duration: 2.5,
    }];
    const weather: WeatherData[] = [{
      air_temperature: 25, date: "2024-01-01T13:00:00.000Z", humidity: 50,
      meeting_key: 1, pressure: 1013, rainfall: 0, session_key: 9999,
      track_temperature: 35, wind_direction: 0, wind_speed: 5,
    }];
    const intervals: IntervalData[] = [];
    const positions: PositionData[] = [];
    const raceControl: RaceControlMessage[] = [];

    const result = computeVirtualRaceEngineer(
      driver, "ANT", 9999,
      laps, stints, pits,
      weather, raceControl,
      intervals, positions, [DRIVER],
      [], "BALANCED",
      null, null,
      "REAL_CONTEXT", null, null,
      null, "POST_RACE",
    );

    expect(result).not.toBeNull();
    const gain = result!.recommended_strategy.estimated_gain_seconds;
    // Pit loss realistico ~21s → soglia ~52.5s. Cap di sicurezza < 60s.
    expect(gain).toBeLessThanOrEqual(60);
    expect(gain).toBeGreaterThanOrEqual(0);
  });
});
