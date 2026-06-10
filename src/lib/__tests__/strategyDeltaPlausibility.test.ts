/**
 * Strategy delta plausibility
 * ───────────────────────────
 * Regression: il VRE produceva delta strategici implausibili (>100s) quando
 * uno stint lungo con slope ripido veniva confrontato con un ottimo che lo
 * evitava. Senza i clamp (degrado per-giro, cliff, bestDelta) questo scenario
 * genera ~104s di guadagno; con i clamp resta ancorato a ~2.5x pit loss.
 *
 * NB: serve uno scenario a piu' soste con uno stint INTERNO lungo e ripido —
 * un singolo stint lungo non innesca il bug, perche' il modello gonfiato si
 * applica anche alle candidate e i termini si compensano nel delta.
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
    duration_sector_1: lap_duration / 3,
    duration_sector_2: lap_duration / 3,
    duration_sector_3: lap_duration / 3,
    st_speed: 300,
    date_start: `2024-01-01T13:${mm}:${ss}.000Z`,
    is_pit_out_lap: false,
    driver_number: driver,
    session_key: 9999,
    segments_sector_1: null, segments_sector_2: null, segments_sector_3: null,
    ...opts,
  } as Lap;
}

const DRIVER: Driver = {
  driver_number: 12, broadcast_name: "K. ANTONELLI", full_name: "Andrea Kimi Antonelli",
  name_acronym: "ANT", team_name: "Mercedes", team_colour: "27F4D2",
  headshot_url: null, session_key: 9999,
} as Driver;

describe("VRE — plausibility clamp on estimated strategy gain", () => {
  it("stint centrale lungo e ripido: il guadagno resta entro ~2.5x pit loss", () => {
    const driver = 12;
    const totalLaps = 68;
    const laps: Lap[] = [];

    // Stint 1: SOFT, giri 1-18, slope medio
    for (let i = 1; i <= 18; i++) laps.push(buildLap(driver, i, 89 + (i - 1) * 0.25));
    // Stint 2: MEDIUM, giri 19-55 (37 giri!), slope ripido -> senza clamp degrada
    // di decine di secondi a fine stint + cliff quadratica enorme
    for (let i = 19; i <= 55; i++) {
      const tl = i - 19;
      laps.push(buildLap(driver, i, 90 + tl * 0.35, { is_pit_out_lap: i === 19 }));
    }
    // Stint 3: HARD, giri 56-68, slope bassissimo (compound "piatto")
    for (let i = 56; i <= totalLaps; i++) {
      const tl = i - 56;
      laps.push(buildLap(driver, i, 90.5 + tl * 0.05, { is_pit_out_lap: i === 56 }));
    }

    const stints: StintData[] = [
      { compound: "SOFT",   driver_number: driver, lap_end: 18,        lap_start: 1,  meeting_key: 1, session_key: 9999, stint_number: 1, tyre_age_at_start: 0 } as StintData,
      { compound: "MEDIUM", driver_number: driver, lap_end: 55,        lap_start: 19, meeting_key: 1, session_key: 9999, stint_number: 2, tyre_age_at_start: 0 } as StintData,
      { compound: "HARD",   driver_number: driver, lap_end: totalLaps, lap_start: 56, meeting_key: 1, session_key: 9999, stint_number: 3, tyre_age_at_start: 0 } as StintData,
    ];
    const pits: PitData[] = [
      { date: "2024-01-01T13:18:00.000Z", driver_number: driver, lane_duration: 21, lap_number: 18, meeting_key: 1, pit_duration: 21, session_key: 9999, stop_duration: 2.5 } as PitData,
      { date: "2024-01-01T13:55:00.000Z", driver_number: driver, lane_duration: 21, lap_number: 55, meeting_key: 1, pit_duration: 21, session_key: 9999, stop_duration: 2.5 } as PitData,
    ];
    const weather: WeatherData[] = [{
      air_temperature: 25, date: "2024-01-01T13:00:00.000Z", humidity: 50,
      meeting_key: 1, pressure: 1013, rainfall: 0, session_key: 9999,
      track_temperature: 35, wind_direction: 0, wind_speed: 5,
    } as WeatherData];

    const result = computeVirtualRaceEngineer(
      driver, "ANT", 9999,
      laps, stints, pits,
      weather, [] as RaceControlMessage[],
      [] as IntervalData[], [] as PositionData[], [DRIVER],
      [], "BALANCED",
      null, null,
      "REAL_CONTEXT", null, null,
      null, "POST_RACE",
    );

    expect(result).not.toBeNull();
    const gain = result!.recommended_strategy.estimated_gain_seconds;

    // pit loss ~21s -> cap MAX_PLAUSIBLE_DELTA = 52.5s. Senza i clamp questo
    // scenario produce ~104s: la soglia <= 55 fallirebbe se i clamp venissero
    // rimossi, rendendo il test una vera protezione di regressione.
    expect(gain).toBeLessThanOrEqual(55);
    expect(gain).toBeGreaterThanOrEqual(0);
  });
});
