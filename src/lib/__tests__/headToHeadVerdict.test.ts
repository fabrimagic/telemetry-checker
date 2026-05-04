/**
 * Regression tests for the pit-in lap fix in `computeHeadToHead` verdict.
 *
 * Without the fix (isComparableLap excluding `actual_strategy.pit_laps`), a
 * driver with more pit stops would appear artificially slower because each
 * pit-in lap (~22s of pit-lane crawl) contaminates the lap-by-lap pace delta
 * sum, distorting `head_to_head_verdict.faster_driver`.
 *
 * These tests use only synthetic in-memory fixtures, no module mocks.
 */
import { describe, it, expect } from "vitest";
import { computeHeadToHead } from "../headToHeadComparison";
import type { VirtualRaceEngineerResult } from "../virtualRaceEngineer";
import type { Lap } from "../openf1";

function mkLap(lap_number: number, lap_duration: number, isPitOut = false): Lap {
  return {
    lap_number,
    lap_duration,
    is_pit_out_lap: isPitOut,
  } as unknown as Lap;
}

function mkVreResult(
  driverNumber: number,
  sessionKey: number,
  pitLaps: number[],
): VirtualRaceEngineerResult {
  return {
    session_key: sessionKey,
    driver_number: driverNumber,
    driver_acronym: `D${driverNumber}`,
    actual_strategy: {
      pit_laps: pitLaps,
      stints: [],
      pit_stops: pitLaps.map((lap) => ({ lap_number: lap })),
    },
    recommended_strategy: { time_delta_vs_actual: null },
    narrative_insights: [],
    weather_impact: null,
    common_confidence: "MEDIUM",
  } as unknown as VirtualRaceEngineerResult;
}

describe("computeHeadToHead verdict — pit-in lap exclusion", () => {
  it("Test 1: A no-pit vs B 1-pit, identical pace → TIE (B's pit-in lap excluded)", () => {
    const A = mkVreResult(1, 9999, []);
    const B = mkVreResult(2, 9999, [10]);
    const lapsA: Lap[] = Array.from({ length: 20 }, (_, i) => mkLap(i + 1, 90.0));
    const lapsB: Lap[] = Array.from({ length: 20 }, (_, i) =>
      mkLap(i + 1, i + 1 === 10 ? 112.0 : 90.0),
    );

    const result = computeHeadToHead({ resultA: A, resultB: B, lapsA, lapsB });

    expect(result.head_to_head_verdict.faster_driver).toBe("TIE");
    expect(Math.abs(result.head_to_head_verdict.delta_total_seconds)).toBeLessThan(0.1);
    expect(result.head_to_head_verdict.delta_source).toBe("pace_sum");
    expect(result.head_to_head_verdict.gap_at_finish_seconds).toBeNull();
    expect(result.head_to_head_verdict.pace_sum_delta_seconds!).toBeLessThan(0.1);
  });

  it("Test 2: A 1-pit vs B 2-pit, B faster by 1s/lap → faster_driver = B", () => {
    const A = mkVreResult(1, 9999, [15]);
    const B = mkVreResult(2, 9999, [10, 20]);
    const lapsA: Lap[] = Array.from({ length: 30 }, (_, i) =>
      mkLap(i + 1, i + 1 === 15 ? 113.0 : 91.0),
    );
    const lapsB: Lap[] = Array.from({ length: 30 }, (_, i) => {
      const ln = i + 1;
      const isPitIn = ln === 10 || ln === 20;
      return mkLap(ln, isPitIn ? 112.0 : 90.0);
    });

    const result = computeHeadToHead({ resultA: A, resultB: B, lapsA, lapsB });

    // Comparable laps: 30 - 1 (A pit) - 2 (B pits) = 27. Each delta = +1s (A slower).
    expect(result.head_to_head_verdict.faster_driver).toBe("B");
    const abs = Math.abs(result.head_to_head_verdict.delta_total_seconds);
    expect(abs).toBeGreaterThan(20);
    expect(abs).toBeCloseTo(27, 0);
  });

  it("Test 3: identical pit_laps and identical pace → TIE (backward compatibility)", () => {
    const A = mkVreResult(1, 9999, [12, 18]);
    const B = mkVreResult(2, 9999, [12, 18]);
    const mk = (ln: number) =>
      mkLap(ln, ln === 12 || ln === 18 ? 112.0 : 90.0);
    const lapsA: Lap[] = Array.from({ length: 25 }, (_, i) => mk(i + 1));
    const lapsB: Lap[] = Array.from({ length: 25 }, (_, i) => mk(i + 1));

    const result = computeHeadToHead({ resultA: A, resultB: B, lapsA, lapsB });

    expect(result.head_to_head_verdict.faster_driver).toBe("TIE");
    expect(Math.abs(result.head_to_head_verdict.delta_total_seconds)).toBeLessThan(0.1);
  });
});
