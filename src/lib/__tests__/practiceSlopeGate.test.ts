import { describe, it, expect } from "vitest";
import { computeVirtualRaceEngineer, type PracticeCompoundModel } from "../virtualRaceEngineer";
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
const D: Driver = {
  driver_number: 12, broadcast_name: "ANT", full_name: "ANT", name_acronym: "ANT",
  team_name: "M", team_colour: "000000", headshot_url: null, session_key: 9999,
} as Driver;

describe("Practice slope gate — scarta modelli con degrado implausibile", () => {
  function run(practiceModels: PracticeCompoundModel[]) {
    const driver = 12, totalLaps = 60, pitLap = 30;
    const laps: Lap[] = [];
    // Stint 1 SOFT 1-30, degrado lieve; Stint 2 MEDIUM 31-60, degrado lieve
    for (let i = 1; i <= pitLap; i++) laps.push(buildLap(driver, i, 90 + (i - 1) * 0.05));
    for (let i = pitLap + 1; i <= totalLaps; i++) {
      laps.push(buildLap(driver, i, 90.5 + (i - (pitLap + 1)) * 0.04, { is_pit_out_lap: i === pitLap + 1 }));
    }
    const stints: StintData[] = [
      { compound: "SOFT", driver_number: driver, lap_start: 1, lap_end: pitLap, stint_number: 1, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 } as StintData,
      { compound: "MEDIUM", driver_number: driver, lap_start: pitLap + 1, lap_end: totalLaps, stint_number: 2, session_key: 9999, meeting_key: 1, tyre_age_at_start: 0 } as StintData,
    ];
    const pits: PitData[] = [
      { date: "2024-01-01T13:30:00.000Z", driver_number: driver, lap_number: pitLap, lane_duration: 23, pit_duration: 23, stop_duration: 2.4, session_key: 9999, meeting_key: 1 } as PitData,
    ];
    const weather: WeatherData[] = [{
      air_temperature: 25, date: "2024-01-01T13:00:00.000Z", humidity: 50, meeting_key: 1, pressure: 1013,
      rainfall: 0, session_key: 9999, track_temperature: 35, wind_direction: 0, wind_speed: 5,
    } as WeatherData];
    return computeVirtualRaceEngineer(
      driver, "ANT", 9999, laps, stints, pits, weather, [] as RaceControlMessage[],
      [] as IntervalData[], [] as PositionData[], [D], practiceModels, "BALANCED",
      null, null, "REAL_CONTEXT", null, null, null, "RACE_ENGINEER",
    );
  }

  it("un practice model HARD con slope NEGATIVO viene scartato", () => {
    const r = run([{ compound: "HARD", slope: -0.215, intercept: 88, rSquared: 0.65, source: "Practice 1" }]);
    expect(r).not.toBeNull();
    // HARD implausibile non deve entrare tra i compound usati
    expect(r!.practice_compounds_used).not.toContain("HARD");
    // e il delta non deve esplodere (resta sotto il cap di plausibilità
    // MAX_PLAUSIBLE_DELTA_DISPLAY = pitLoss × 2.5 ≈ 57.5s)
    expect(r!.recommended_strategy.estimated_gain_seconds).toBeLessThan(50);
  });

  it("un practice model con slope di degrado plausibile viene accettato", () => {
    const r = run([{ compound: "HARD", slope: 0.08, intercept: 90, rSquared: 0.65, source: "Practice 1" }]);
    expect(r).not.toBeNull();
    expect(r!.practice_compounds_used).toContain("HARD");
  });

  it("nessun practice model: comportamento invariato", () => {
    const r = run([]);
    expect(r).not.toBeNull();
    expect(r!.practice_compounds_used).toHaveLength(0);
  });
});
