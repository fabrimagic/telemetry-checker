/**
 * Verifies that HeadToHeadVerdict exposes both `gap_at_finish_seconds`
 * (official finishing gap) and `pace_sum_delta_seconds` (sum of comparable
 * lap-by-lap deltas) independently, while `delta_total_seconds` keeps
 * backward-compat (mirrors the official gap when available, else pace sum).
 */
import { describe, it, expect } from "vitest";
import { computeHeadToHead } from "../headToHeadComparison";
import type { VirtualRaceEngineerResult } from "../virtualRaceEngineer";
import type { Lap, SessionResult } from "../openf1";

function mkLap(lap_number: number, lap_duration: number, isPitOut = false): Lap {
  return { lap_number, lap_duration, is_pit_out_lap: isPitOut } as unknown as Lap;
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

function mkResult(driver_number: number, gap_to_leader: number | null, dnf = false, position = 1): SessionResult {
  return {
    driver_number,
    gap_to_leader,
    dnf,
    dns: false,
    dsq: false,
    position,
  } as unknown as SessionResult;
}

describe("HeadToHead — delta source separation", () => {
  it("Test 1: session_results disponibili → gap_at_finish e pace_sum entrambi popolati e divergenti", () => {
    const A = mkVreResult(1, 9999, [10]);
    const B = mkVreResult(2, 9999, [10, 20]);
    const lapsA: Lap[] = Array.from({ length: 30 }, (_, i) =>
      mkLap(i + 1, i + 1 === 10 ? 113.0 : 91.0),
    );
    const lapsB: Lap[] = Array.from({ length: 30 }, (_, i) => {
      const ln = i + 1;
      const isPitIn = ln === 10 || ln === 20;
      return mkLap(ln, isPitIn ? 113.0 : 90.0);
    });
    const sessionResults: SessionResult[] = [
      mkResult(1, 45, false, 2),
      mkResult(2, 20, false, 1),
    ];

    const r = computeHeadToHead({ resultA: A, resultB: B, lapsA, lapsB, sessionResults });

    expect(r.head_to_head_verdict.delta_source).toBe("official_gap");
    expect(r.head_to_head_verdict.gap_at_finish_seconds!).toBeCloseTo(25, 0);
    expect(r.head_to_head_verdict.pace_sum_delta_seconds!).toBeCloseTo(28, 0);
    expect(r.head_to_head_verdict.delta_total_seconds).toBeCloseTo(25, 0);
    expect(r.head_to_head_verdict.faster_driver).toBe("B");
  });

  it("Test 2: session_results NON disponibili → solo pace_sum", () => {
    const A = mkVreResult(1, 9999, [10]);
    const B = mkVreResult(2, 9999, [10, 20]);
    const lapsA: Lap[] = Array.from({ length: 30 }, (_, i) =>
      mkLap(i + 1, i + 1 === 10 ? 113.0 : 91.0),
    );
    const lapsB: Lap[] = Array.from({ length: 30 }, (_, i) => {
      const ln = i + 1;
      const isPitIn = ln === 10 || ln === 20;
      return mkLap(ln, isPitIn ? 113.0 : 90.0);
    });

    const r = computeHeadToHead({ resultA: A, resultB: B, lapsA, lapsB });

    expect(r.head_to_head_verdict.delta_source).toBe("pace_sum");
    expect(r.head_to_head_verdict.gap_at_finish_seconds).toBeNull();
    expect(r.head_to_head_verdict.pace_sum_delta_seconds!).toBeCloseTo(28, 0);
    expect(r.head_to_head_verdict.delta_total_seconds).toBeCloseTo(28, 0);
    expect(r.head_to_head_verdict.faster_driver).toBe("B");
  });

  it("Test 3: DNF in sessionResults → ricade su pace_sum", () => {
    const A = mkVreResult(1, 9999, []);
    const B = mkVreResult(2, 9999, []);
    const lapsA: Lap[] = Array.from({ length: 30 }, (_, i) => mkLap(i + 1, 90.0));
    const lapsB: Lap[] = Array.from({ length: 30 }, (_, i) => mkLap(i + 1, 90.0));
    const sessionResults: SessionResult[] = [
      mkResult(1, null, true, 20),
      mkResult(2, 0, false, 1),
    ];

    const r = computeHeadToHead({ resultA: A, resultB: B, lapsA, lapsB, sessionResults });

    expect(r.head_to_head_verdict.delta_source).toBe("pace_sum");
    expect(r.head_to_head_verdict.gap_at_finish_seconds).toBeNull();
    expect(r.head_to_head_verdict.pace_sum_delta_seconds!).toBeLessThan(0.1);
    expect(r.head_to_head_verdict.faster_driver).toBe("TIE");
  });
});
