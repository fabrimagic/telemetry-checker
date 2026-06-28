/**
 * Reduced-stops counterfactuals (N-1 down to legal minimum)
 * ─────────────────────────────────────────────────────────
 * Verifica che il motore aggiunga alternative con MENO soste rispetto a quella
 * reale, rispettando il minimo regolamentare di due mescole e segnalando la
 * natura estrapolativa nei cons (riuso clamp + cliff + uncertainty esistenti).
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

const WEATHER: WeatherData[] = [{
  air_temperature: 25, date: "2024-01-01T13:00:00.000Z", humidity: 50,
  meeting_key: 1, pressure: 1013, rainfall: 0, session_key: 9999,
  track_temperature: 35, wind_direction: 0, wind_speed: 5,
} as WeatherData];

function runVRE(laps: Lap[], stints: StintData[], pits: PitData[]) {
  return computeVirtualRaceEngineer(
    12, "ANT", 9999,
    laps, stints, pits,
    WEATHER, [] as RaceControlMessage[],
    [] as IntervalData[], [] as PositionData[], [DRIVER],
    [], "BALANCED",
    null, null,
    "REAL_CONTEXT", null, null,
    null, "POST_RACE",
  );
}

describe("VRE — reduced-stops counterfactuals (N-1)", () => {
  it("3-stop reale: genera alternative 2-stop e 1-stop con avvisi di estrapolazione", () => {
    const driver = 12;
    const totalLaps = 60;
    const laps: Lap[] = [];
    // 4 stints (3 pits): SOFT 1-15, MEDIUM 16-30, MEDIUM 31-45, HARD 46-60
    for (let i = 1; i <= 15; i++) laps.push(buildLap(driver, i, 90 + (i - 1) * 0.10));
    for (let i = 16; i <= 30; i++) laps.push(buildLap(driver, i, 90.5 + (i - 16) * 0.08, { is_pit_out_lap: i === 16 }));
    for (let i = 31; i <= 45; i++) laps.push(buildLap(driver, i, 90.7 + (i - 31) * 0.08, { is_pit_out_lap: i === 31 }));
    for (let i = 46; i <= totalLaps; i++) laps.push(buildLap(driver, i, 91 + (i - 46) * 0.06, { is_pit_out_lap: i === 46 }));

    const stints: StintData[] = [
      { compound: "SOFT",   driver_number: driver, lap_end: 15,       lap_start: 1,  meeting_key: 1, session_key: 9999, stint_number: 1, tyre_age_at_start: 0 } as StintData,
      { compound: "MEDIUM", driver_number: driver, lap_end: 30,       lap_start: 16, meeting_key: 1, session_key: 9999, stint_number: 2, tyre_age_at_start: 0 } as StintData,
      { compound: "MEDIUM", driver_number: driver, lap_end: 45,       lap_start: 31, meeting_key: 1, session_key: 9999, stint_number: 3, tyre_age_at_start: 0 } as StintData,
      { compound: "HARD",   driver_number: driver, lap_end: totalLaps,lap_start: 46, meeting_key: 1, session_key: 9999, stint_number: 4, tyre_age_at_start: 0 } as StintData,
    ];
    const pits: PitData[] = [15, 30, 45].map(lap => ({
      date: `2024-01-01T13:${String(lap).padStart(2, "0")}:00.000Z`,
      driver_number: driver, lane_duration: 21, lap_number: lap,
      meeting_key: 1, pit_duration: 21, session_key: 9999, stop_duration: 2.5,
    } as PitData));

    const result = runVRE(laps, stints, pits);
    expect(result).not.toBeNull();

    const reduced = result!.alternative_strategies.filter(a => /^\d+-stop$/.test(a.name) && a.pit_laps.length < 3);
    const names = reduced.map(a => a.name);
    expect(names).toContain("2-stop");
    expect(names).toContain("1-stop");

    // Tutti i candidati ridotti devono rispettare il minimo due mescole.
    for (const alt of reduced) {
      const distinct = new Set(alt.compounds.filter(c => c && c !== "UNKNOWN"));
      expect(distinct.size).toBeGreaterThanOrEqual(2);
      // E devono segnalare l'estrapolazione nei cons.
      const joined = alt.cons.join(" | ");
      expect(joined).toMatch(/estrapolazione|più lungo|estrapolat/i);
    }
  });

  it("2-stop reale: genera l'alternativa 1-stop con cons espliciti su long stint", () => {
    const driver = 12;
    const totalLaps = 55;
    const laps: Lap[] = [];
    for (let i = 1; i <= 18; i++) laps.push(buildLap(driver, i, 90 + (i - 1) * 0.12));
    for (let i = 19; i <= 38; i++) laps.push(buildLap(driver, i, 90.3 + (i - 19) * 0.10, { is_pit_out_lap: i === 19 }));
    for (let i = 39; i <= totalLaps; i++) laps.push(buildLap(driver, i, 90.6 + (i - 39) * 0.08, { is_pit_out_lap: i === 39 }));

    const stints: StintData[] = [
      { compound: "SOFT",   driver_number: driver, lap_end: 18,        lap_start: 1,  meeting_key: 1, session_key: 9999, stint_number: 1, tyre_age_at_start: 0 } as StintData,
      { compound: "MEDIUM", driver_number: driver, lap_end: 38,        lap_start: 19, meeting_key: 1, session_key: 9999, stint_number: 2, tyre_age_at_start: 0 } as StintData,
      { compound: "HARD",   driver_number: driver, lap_end: totalLaps, lap_start: 39, meeting_key: 1, session_key: 9999, stint_number: 3, tyre_age_at_start: 0 } as StintData,
    ];
    const pits: PitData[] = [18, 38].map(lap => ({
      date: `2024-01-01T13:${String(lap).padStart(2, "0")}:00.000Z`,
      driver_number: driver, lane_duration: 21, lap_number: lap,
      meeting_key: 1, pit_duration: 21, session_key: 9999, stop_duration: 2.5,
    } as PitData));

    const result = runVRE(laps, stints, pits);
    expect(result).not.toBeNull();

    const oneStop = result!.alternative_strategies.find(a => a.name === "1-stop" && a.pit_laps.length === 1);
    expect(oneStop).toBeDefined();
    expect(oneStop!.pit_laps.length).toBe(1);
    const distinct = new Set(oneStop!.compounds.filter(c => c && c !== "UNKNOWN"));
    expect(distinct.size).toBeGreaterThanOrEqual(2);
    expect(oneStop!.cons.join(" ")).toMatch(/estrapolazione|più lungo/i);
    expect(oneStop!.pros.join(" ")).toMatch(/pit loss/i);
  });

  it("1-stop reale: nessuna alternativa a soste ridotte viene generata (guard length>=2)", () => {
    const driver = 12;
    const totalLaps = 50;
    const laps: Lap[] = [];
    for (let i = 1; i <= 25; i++) laps.push(buildLap(driver, i, 90 + (i - 1) * 0.10));
    for (let i = 26; i <= totalLaps; i++) laps.push(buildLap(driver, i, 90.4 + (i - 26) * 0.08, { is_pit_out_lap: i === 26 }));

    const stints: StintData[] = [
      { compound: "SOFT",   driver_number: driver, lap_end: 25,        lap_start: 1,  meeting_key: 1, session_key: 9999, stint_number: 1, tyre_age_at_start: 0 } as StintData,
      { compound: "MEDIUM", driver_number: driver, lap_end: totalLaps, lap_start: 26, meeting_key: 1, session_key: 9999, stint_number: 2, tyre_age_at_start: 0 } as StintData,
    ];
    const pits: PitData[] = [{
      date: "2024-01-01T13:25:00.000Z", driver_number: driver, lane_duration: 21,
      lap_number: 25, meeting_key: 1, pit_duration: 21, session_key: 9999, stop_duration: 2.5,
    } as PitData];

    const result = runVRE(laps, stints, pits);
    expect(result).not.toBeNull();

    // Non deve esistere alcuna alternativa 0-stop (illegale: un solo compound).
    const zeroStop = result!.alternative_strategies.find(a => a.pit_laps.length === 0);
    expect(zeroStop).toBeUndefined();
  });
});
