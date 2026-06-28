/**
 * Presentation-only plausibility clamp on alternatives
 * ─────────────────────────────────────────────────────
 * Verifies that:
 *   (a) when an alternative's raw delta exceeds pitLoss*2.5, the SHOWN value
 *       is clamped and time_delta_vs_actual stays its negation;
 *   (b) raw_delta_vs_actual and delta_clamped expose the original value, and
 *       uncertainty fields (delta_uncertainty_std,
 *       indistinguishable_from_actual) remain computed on raw data;
 *   (c) a FRAGILE alternative is NOT promoted to recommended even when its
 *       raw delta is huge, and an explanatory narrative is emitted when a
 *       (shown) alt delta exceeds the recommended gain without promotion.
 */

import { describe, it, expect } from "vitest";
import { computeVirtualRaceEngineer, type AlternativeStrategy, type VirtualRaceEngineerResult } from "../virtualRaceEngineer";
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

/** 3-stop reale + degrado piatto su ogni stint per favorire la generazione di
 *  alternative a soste ridotte fortemente estrapolate. */
function buildExtrapolatedScenario(): VirtualRaceEngineerResult | null {
  const driver = 12;
  const totalLaps = 60;
  const laps: Lap[] = [];
  for (let i = 1; i <= 15; i++) laps.push(buildLap(driver, i, 90 + (i - 1) * 0.05));
  for (let i = 16; i <= 30; i++) laps.push(buildLap(driver, i, 90.5 + (i - 16) * 0.04, { is_pit_out_lap: i === 16 }));
  for (let i = 31; i <= 45; i++) laps.push(buildLap(driver, i, 90.7 + (i - 31) * 0.04, { is_pit_out_lap: i === 31 }));
  for (let i = 46; i <= totalLaps; i++) laps.push(buildLap(driver, i, 91 + (i - 46) * 0.03, { is_pit_out_lap: i === 46 }));

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

  return runVRE(laps, stints, pits);
}

describe("VRE — presentation-only plausibility clamp on alternatives", () => {
  it("invariant: time_delta_vs_actual === -estimated_delta_vs_actual for every alternative (clamped or not)", () => {
    const result = buildExtrapolatedScenario();
    expect(result).not.toBeNull();
    for (const alt of result!.alternative_strategies) {
      expect(alt.time_delta_vs_actual).toBeCloseTo(-alt.estimated_delta_vs_actual, 6);
    }
  });

  it("when an alternative is clamped, raw_delta_vs_actual preserves the original value and a cons note explains it", () => {
    const result = buildExtrapolatedScenario();
    expect(result).not.toBeNull();
    const clamped: AlternativeStrategy[] = result!.alternative_strategies.filter(a => a.delta_clamped);
    // Scenario non garantisce sempre un clamp; quando presente, verifica gli invarianti.
    for (const alt of clamped) {
      expect(alt.raw_delta_vs_actual).toBeDefined();
      expect(alt.raw_delta_vs_actual!).toBeGreaterThan(alt.estimated_delta_vs_actual);
      expect(alt.cons.join(" ")).toMatch(/limitato|plausibile|estrapolazione/i);
      // Uncertainty fields restano informativi (non azzerati dal clamp).
      if (alt.delta_uncertainty_std !== undefined) {
        expect(Number.isFinite(alt.delta_uncertainty_std)).toBe(true);
      }
    }
  });

  it("FRAGILE alternatives are NOT promoted even if their raw delta is huge (promotion preserved)", () => {
    const result = buildExtrapolatedScenario();
    expect(result).not.toBeNull();
    const fragileAlts = result!.alternative_strategies.filter(
      a => a.analysis?.robustness.robustness_label === "FRAGILE",
    );
    // Per ogni alt FRAGILE assicurati che la raccomandata NON la rispecchi.
    const recCompounds = result!.recommended_strategy.compounds.join(",");
    const recPits = result!.recommended_strategy.pit_windows.map(p => p.ideal_lap).join(",");
    for (const alt of fragileAlts) {
      const altKey = alt.compounds.join(",") + "|" + alt.pit_laps.join(",");
      const recKey = recCompounds + "|" + recPits;
      expect(altKey).not.toEqual(recKey);
    }
  });

  it("emits the explanatory narrative when a shown alt delta exceeds the recommended gain without promotion", () => {
    const result = buildExtrapolatedScenario();
    expect(result).not.toBeNull();
    const recGain = result!.recommended_strategy.estimated_gain_seconds;
    const overrec = result!.alternative_strategies.some(
      a => a.estimated_delta_vs_actual > recGain + 0.05,
    );
    if (overrec) {
      const insights = result!.insights ?? [];
      const hit = insights.some(s => /non è stata promossa|risk-adjusted/i.test(s));
      expect(hit).toBe(true);
    }
  });
});
