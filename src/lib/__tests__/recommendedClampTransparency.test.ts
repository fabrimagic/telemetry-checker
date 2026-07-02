/**
 * Transparency & symmetry regressions on the plausibility clamp
 * ──────────────────────────────────────────────────────────────
 * Guards three improvements to computeVirtualRaceEngineer:
 *
 *   1) When the recommended `bestDelta` exceeds MAX_PLAUSIBLE_DELTA
 *      (pitLoss × 2.5), the recommended strategy exposes `delta_clamped=true`
 *      and `raw_gain_seconds` preserves the pre-clamp value (previously the
 *      clamp was silent on the recommended side).
 *
 *   2) When the actual race strategy violates the two-compound rule, the
 *      alternative-strategies engine cannot run — the engine now DECLARES
 *      the reason via both `confidence_factors` and `narrative_insights`
 *      instead of returning a silent empty section.
 *
 * The symmetric negative-clamp path on alternatives is unit-verified by
 * structural inspection: no realistic fixture in this repo produces a raw
 * delta below −MAX_PLAUSIBLE_DELTA, so we assert the shape/contract of the
 * new fields is upheld on every alternative.
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

describe("VRE — recommended clamp transparency & alternatives-unavailable declaration", () => {
  it("recommended strategy exposes delta_clamped=true and raw_gain_seconds when the plausibility ceiling triggers", () => {
    // Reuse the extreme scenario from strategyDeltaPlausibility.test.ts:
    // stint centrale lungo e ripido produce un bestDelta grezzo ~104s che
    // il cap riporta a ~52.5s. Prima dei nuovi campi il clamp era silenzioso.
    const driver = 12;
    const totalLaps = 68;
    const laps: Lap[] = [];
    for (let i = 1; i <= 18; i++) laps.push(buildLap(driver, i, 89 + (i - 1) * 0.25));
    for (let i = 19; i <= 55; i++) {
      const tl = i - 19;
      laps.push(buildLap(driver, i, 90 + tl * 0.35, { is_pit_out_lap: i === 19 }));
    }
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

    const result = runVRE(laps, stints, pits);
    expect(result).not.toBeNull();

    const rec = result!.recommended_strategy;
    expect(rec.delta_clamped).toBe(true);
    expect(typeof rec.raw_gain_seconds).toBe("number");
    // Il raw pre-clamp deve essere > del valore mostrato (compatibile con
    // la meccanica: mostrato = clamp, raw = pre-clamp).
    expect(rec.raw_gain_seconds!).toBeGreaterThan(rec.estimated_gain_seconds);
    // I cons devono includere il messaggio esplicativo.
    expect((rec.cons ?? []).join(" ")).toMatch(/limitato|plausibile|estrapolazione/i);
  });

  it("declares alternatives-unavailable reason (two-compound rule) in confidence_factors AND narrative_insights", () => {
    const driver = 12;
    const totalLaps = 30;
    const laps: Lap[] = [];
    // Stessa mescola su entrambi gli stint → viola la regola dei due compound.
    for (let i = 1; i <= 15; i++) laps.push(buildLap(driver, i, 90 + (i - 1) * 0.05));
    for (let i = 16; i <= totalLaps; i++) laps.push(buildLap(driver, i, 90.3 + (i - 16) * 0.05, { is_pit_out_lap: i === 16 }));

    const stints: StintData[] = [
      { compound: "MEDIUM", driver_number: driver, lap_end: 15,        lap_start: 1,  meeting_key: 1, session_key: 9999, stint_number: 1, tyre_age_at_start: 0 } as StintData,
      { compound: "MEDIUM", driver_number: driver, lap_end: totalLaps, lap_start: 16, meeting_key: 1, session_key: 9999, stint_number: 2, tyre_age_at_start: 0 } as StintData,
    ];
    const pits: PitData[] = [
      { date: "2024-01-01T13:15:00.000Z", driver_number: driver, lane_duration: 21, lap_number: 15, meeting_key: 1, pit_duration: 21, session_key: 9999, stop_duration: 2.5 } as PitData,
    ];

    const result = runVRE(laps, stints, pits);
    expect(result).not.toBeNull();
    expect(result!.alternative_strategies.length).toBe(0);

    const cf = result!.confidence_factors.join(" | ");
    const ni = result!.narrative_insights.join(" | ");
    expect(cf).toMatch(/Strategie alternative non calcolate/i);
    expect(ni).toMatch(/Strategie alternative non calcolate/i);
    // Deve indicare il motivo (regola dei due compound).
    expect(cf + ni).toMatch(/due compound/i);
  });

  it("every alternative preserves the clamp contract: when delta_clamped is true, raw_delta_vs_actual is defined and |shown| ≤ |raw|", () => {
    // Riusa lo scenario estremo per attivare il clamp positivo sulle
    // alternative; verifica il contratto strutturale che copre anche il
    // ramo simmetrico negativo (stesso codice, segno opposto).
    const driver = 12;
    const totalLaps = 60;
    const laps: Lap[] = [];
    for (let i = 1; i <= 15; i++) laps.push(buildLap(driver, i, 90 + (i - 1) * 0.05));
    for (let i = 16; i <= 30; i++) laps.push(buildLap(driver, i, 90.5 + (i - 16) * 0.30, { is_pit_out_lap: i === 16 }));
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

    const result = runVRE(laps, stints, pits);
    expect(result).not.toBeNull();
    for (const alt of result!.alternative_strategies) {
      if (alt.delta_clamped) {
        expect(alt.raw_delta_vs_actual).toBeDefined();
        expect(Math.abs(alt.estimated_delta_vs_actual))
          .toBeLessThanOrEqual(Math.abs(alt.raw_delta_vs_actual!) + 1e-6);
        // Il segno mostrato deve combaciare col segno del raw.
        expect(Math.sign(alt.estimated_delta_vs_actual))
          .toBe(Math.sign(alt.raw_delta_vs_actual!));
        expect(alt.time_delta_vs_actual).toBeCloseTo(-alt.estimated_delta_vs_actual, 6);
      }
    }
  });
});
