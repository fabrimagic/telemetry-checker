/**
 * Tests for the refactored long-run detector.
 *
 * The detector now delegates statistical qualification to the main engine
 * (calculateTyreDegradation). These tests verify:
 *   - Sequence detection (consecutive, pit-out, splits, null durations)
 *   - Validity gate (rSquared ≥ 0.25, lapsUsed ≥ minLaps)
 *   - Filter behavior in longRunToStintsAndLaps
 */

import { describe, it, expect } from "vitest";
import { detectLongRuns, longRunToStintsAndLaps } from "../longRunDetector";
import type { Lap, StintData, PitData } from "../openf1";

function lap(driver: number, lap_number: number, lap_duration: number | null, opts: Partial<Lap> = {}): Lap {
  return {
    lap_number,
    lap_duration: lap_duration as number,
    duration_sector_1: lap_duration ? lap_duration / 3 : null as unknown as number,
    duration_sector_2: lap_duration ? lap_duration / 3 : null as unknown as number,
    duration_sector_3: lap_duration ? lap_duration / 3 : null as unknown as number,
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

function stint(driver: number, stint_number: number, compound: string, lap_start: number, lap_end: number): StintData {
  return {
    compound,
    driver_number: driver,
    lap_end,
    lap_start,
    meeting_key: 1,
    session_key: 9999,
    stint_number,
    tyre_age_at_start: 0,
  };
}

const DRV = 16;

describe("detectLongRuns (refactored, delegates to main engine)", () => {
  it("1) clean linear stint of 8 laps → isValidLongRun=true, high R²", () => {
    const laps: Lap[] = [];
    for (let i = 1; i <= 8; i++) laps.push(lap(DRV, i, 90.0 + 0.05 * (i - 1)));
    const stints = [stint(DRV, 1, "MEDIUM", 1, 8)];
    const out = detectLongRuns(DRV, "LEC", "E80020", laps, stints, []);
    expect(out).toHaveLength(1);
    expect(out[0].isValidLongRun).toBe(true);
    expect(out[0].rSquared).toBeGreaterThan(0.9);
    expect(out[0].lapsCount).toBe(8);
  });

  it("2) too-short stint (3 laps, below default minLaps=5) → returns []", () => {
    const laps: Lap[] = [
      lap(DRV, 1, 90.0),
      lap(DRV, 2, 90.05),
      lap(DRV, 3, 90.10),
    ];
    const stints = [stint(DRV, 1, "MEDIUM", 1, 3)];
    const out = detectLongRuns(DRV, "LEC", "E80020", laps, stints, []);
    expect(out).toHaveLength(0);
  });

  it("3) pit-out lap excluded → sequence starts at lap 2", () => {
    const laps: Lap[] = [
      lap(DRV, 1, 95.0, { is_pit_out_lap: true }),
    ];
    for (let i = 2; i <= 8; i++) laps.push(lap(DRV, i, 90.0 + 0.05 * (i - 2)));
    const stints = [stint(DRV, 1, "MEDIUM", 1, 8)];
    const out = detectLongRuns(DRV, "LEC", "E80020", laps, stints, []);
    expect(out).toHaveLength(1);
    expect(out[0].lapStartLongRun).toBe(2);
    expect(out[0].lapEndLongRun).toBe(8);
    expect(out[0].lapsCount).toBe(7);
  });

  it("4) two consecutive sub-sequences split by a missing lap → longest wins", () => {
    // Laps 1,2,3 then gap then 5,6,7,8,9 — second is longer (5 vs 3).
    const laps: Lap[] = [];
    [1, 2, 3, 5, 6, 7, 8, 9].forEach((n, idx) => laps.push(lap(DRV, n, 90.0 + 0.05 * idx)));
    const stints = [stint(DRV, 1, "MEDIUM", 1, 9)];
    const out = detectLongRuns(DRV, "LEC", "E80020", laps, stints, []);
    expect(out).toHaveLength(1);
    expect(out[0].lapsCount).toBe(5);
    expect(out[0].lapStartLongRun).toBe(5);
    expect(out[0].lapEndLongRun).toBe(9);
  });

  it("5) noisy stint with low R² but flat slope → still valid (low-degradation long run)", () => {
    // Alternating push/lift pattern with no real trend. The slope is
    // statistically indistinguishable from zero (|slope| ≤ 2·stdError) and
    // CV stays under 5%, so this is treated as a genuine flat long run —
    // mirroring real-world cases (e.g., new HARD on a green track) where
    // tyres simply don't degrade and rejecting the run would discard
    // useful information.
    const laps: Lap[] = [];
    const noise = [90.0, 91.5, 89.5, 91.4, 89.6, 91.3, 89.7, 91.2];
    noise.forEach((d, i) => laps.push(lap(DRV, i + 1, d)));
    const stints = [stint(DRV, 1, "MEDIUM", 1, 8)];
    const out = detectLongRuns(DRV, "LEC", "E80020", laps, stints, []);
    expect(out).toHaveLength(1);
    expect(out[0].isValidLongRun).toBe(true);
    expect(out[0].rSquared).toBeLessThan(0.25);
  });

  it("6) longRunToStintsAndLaps keeps only valid runs", () => {
    const laps: Lap[] = [];
    for (let i = 1; i <= 16; i++) laps.push(lap(DRV, i, 90.0 + 0.05 * ((i - 1) % 8)));
    const stints = [
      stint(DRV, 1, "MEDIUM", 1, 8),
      stint(DRV, 2, "MEDIUM", 9, 16),
    ];
    const fakeRuns = [
      {
        driverNumber: DRV, acronym: "LEC", color: "E80020",
        stintNumber: 1, compound: "MEDIUM",
        lapStartLongRun: 1, lapEndLongRun: 8, lapsCount: 8,
        avgLapTime: 90.175, degradationSlope: 0.05, rSquared: 0.95,
        fitRobustness: "HIGH" as const, isValidLongRun: true,
      },
      {
        driverNumber: DRV, acronym: "LEC", color: "E80020",
        stintNumber: 2, compound: "MEDIUM",
        lapStartLongRun: 9, lapEndLongRun: 16, lapsCount: 8,
        avgLapTime: 90.175, degradationSlope: 0.01, rSquared: 0.10,
        fitRobustness: "LOW" as const, isValidLongRun: false,
      },
    ];
    const { filteredLaps, virtualStints } = longRunToStintsAndLaps(laps, fakeRuns, stints);
    expect(virtualStints).toHaveLength(1);
    expect(virtualStints[0].stint_number).toBe(1);
    expect(filteredLaps.every((l) => l.lap_number >= 1 && l.lap_number <= 8)).toBe(true);
  });

  it("7) null lap_duration values are filtered, sequences rebuilt around them", () => {
    const laps: Lap[] = [];
    for (let i = 1; i <= 10; i++) {
      const d = i === 5 ? null : 90.0 + 0.05 * (i - 1);
      laps.push(lap(DRV, i, d));
    }
    const stints = [stint(DRV, 1, "MEDIUM", 1, 10)];
    const out = detectLongRuns(DRV, "LEC", "E80020", laps, stints, []);
    expect(out).toHaveLength(1);
    // Two sub-sequences: 1-4 (len 4) and 6-10 (len 5). Longest wins.
    expect(out[0].lapStartLongRun).toBe(6);
    expect(out[0].lapEndLongRun).toBe(10);
    expect(out[0].lapsCount).toBe(5);
  });
});
