/**
 * Counterfactual scenarios tests for `computeHeadToHead`.
 *
 * Validates the three independent scenarios (only_a, only_b, both) and the
 * top-level mirroring rule (mirror `both` if applicable, else first applicable).
 *
 * Formula: new_delta(A−B) = realDelta + (appliedGainA − appliedGainB)
 *  - appliedGain_X = recommendedStrategy_X.time_delta_vs_actual if X switches, else 0
 *  - convention: negative gain = faster than actual
 *
 * Synthetic in-memory fixtures only, no module mocks.
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
  timeDeltaVsActual: number | null = null,
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
    recommended_strategy: { time_delta_vs_actual: timeDeltaVsActual },
    narrative_insights: [],
    weather_impact: null,
    confidence: "MEDIUM",
    common_confidence: "MEDIUM",
  } as unknown as VirtualRaceEngineerResult;
}

describe("computeHeadToHead — counterfactual scenarios", () => {
  it("Test 1: both alternatives available; all three scenarios applicable", () => {
    // 30 laps, A is 1s/lap slower → realDelta = +30 (B faster), no pits.
    const A = mkVreResult(1, 9999, []);
    const B = mkVreResult(2, 9999, []);
    const altA = mkVreResult(1, 9999, [], -10); // A's alt saves 10s
    const altB = mkVreResult(2, 9999, [], -2);  // B's alt saves 2s
    const lapsA: Lap[] = Array.from({ length: 30 }, (_, i) => mkLap(i + 1, 91.0));
    const lapsB: Lap[] = Array.from({ length: 30 }, (_, i) => mkLap(i + 1, 90.0));

    const r = computeHeadToHead({
      resultA: A, resultB: B, lapsA, lapsB,
      alternativeA: altA, alternativeB: altB,
    });

    expect(r.head_to_head_verdict.faster_driver).toBe("B");
    expect(r.head_to_head_verdict.delta_source).toBe("pace_sum");
    expect(r.head_to_head_verdict.gap_at_finish_seconds).toBeNull();
    expect(r.head_to_head_verdict.pace_sum_delta_seconds!).toBeCloseTo(30, 0);
    expect(r.counterfactual_analysis).not.toBeNull();
    const cf = r.counterfactual_analysis!;

    expect(cf.real_h2h_delta_seconds).toBeCloseTo(30, 0);

    // only_a: 30 + (−10 − 0) = +20 → B
    expect(cf.scenarios.only_a.applicable).toBe(true);
    expect(cf.scenarios.only_a.counterfactual_h2h_delta_seconds!).toBeCloseTo(20, 0);
    expect(cf.scenarios.only_a.counterfactual_faster).toBe("B");
    expect(cf.scenarios.only_a.outcome_changed).toBe(false);

    // only_b: 30 + (0 − (−2)) = +32 → B
    expect(cf.scenarios.only_b.applicable).toBe(true);
    expect(cf.scenarios.only_b.counterfactual_h2h_delta_seconds!).toBeCloseTo(32, 0);
    expect(cf.scenarios.only_b.counterfactual_faster).toBe("B");
    expect(cf.scenarios.only_b.outcome_changed).toBe(false);

    // both: 30 + (−10 − (−2)) = +22 → B
    expect(cf.scenarios.both.applicable).toBe(true);
    expect(cf.scenarios.both.counterfactual_h2h_delta_seconds!).toBeCloseTo(22, 0);
    expect(cf.scenarios.both.counterfactual_faster).toBe("B");
    expect(cf.scenarios.both.outcome_changed).toBe(false);

    // Top-level mirrors `both`
    expect(cf.counterfactual_h2h_delta_seconds!).toBeCloseTo(22, 0);
    expect(cf.counterfactual_faster).toBe("B");
  });

  it("Test 2: only alternativeA provided → only_a applicable, others not; mirrors only_a", () => {
    // Identical pace, no pits → realDelta = 0, TIE.
    const A = mkVreResult(1, 9999, []);
    const B = mkVreResult(2, 9999, []);
    const altA = mkVreResult(1, 9999, [], -5);
    const lapsA: Lap[] = Array.from({ length: 30 }, (_, i) => mkLap(i + 1, 90.0));
    const lapsB: Lap[] = Array.from({ length: 30 }, (_, i) => mkLap(i + 1, 90.0));

    const r = computeHeadToHead({
      resultA: A, resultB: B, lapsA, lapsB,
      alternativeA: altA, alternativeB: null,
    });

    expect(r.head_to_head_verdict.faster_driver).toBe("TIE");
    const cf = r.counterfactual_analysis!;
    expect(cf).not.toBeNull();
    expect(cf.real_h2h_delta_seconds).toBeCloseTo(0, 1);

    // only_a: 0 + (−5 − 0) = −5 → A, outcome_changed (TIE → A)
    expect(cf.scenarios.only_a.applicable).toBe(true);
    expect(cf.scenarios.only_a.counterfactual_h2h_delta_seconds!).toBeCloseTo(-5, 1);
    expect(cf.scenarios.only_a.counterfactual_faster).toBe("A");
    expect(cf.scenarios.only_a.outcome_changed).toBe(true);

    // only_b and both not applicable
    expect(cf.scenarios.only_b.applicable).toBe(false);
    expect(cf.scenarios.only_b.counterfactual_h2h_delta_seconds).toBeNull();
    expect(cf.scenarios.only_b.counterfactual_faster).toBeNull();

    expect(cf.scenarios.both.applicable).toBe(false);
    expect(cf.scenarios.both.counterfactual_h2h_delta_seconds).toBeNull();
    expect(cf.scenarios.both.counterfactual_faster).toBeNull();

    // Top-level mirrors only_a (first applicable, since `both` is not applicable)
    expect(cf.counterfactual_h2h_delta_seconds!).toBeCloseTo(-5, 1);
    expect(cf.counterfactual_faster).toBe("A");
    expect(cf.outcome_changed).toBe(true);
  });

  it("Test 3: outcome flipped in only_a, unchanged in only_b", () => {
    // realDelta = +6 (B faster by 0.2s/lap × 30 laps), no pits.
    const A = mkVreResult(1, 9999, []);
    const B = mkVreResult(2, 9999, []);
    const altA = mkVreResult(1, 9999, [], -10);
    const altB = mkVreResult(2, 9999, [], -1);
    const lapsA: Lap[] = Array.from({ length: 30 }, (_, i) => mkLap(i + 1, 90.2));
    const lapsB: Lap[] = Array.from({ length: 30 }, (_, i) => mkLap(i + 1, 90.0));

    const r = computeHeadToHead({
      resultA: A, resultB: B, lapsA, lapsB,
      alternativeA: altA, alternativeB: altB,
    });

    expect(r.head_to_head_verdict.faster_driver).toBe("B");
    const cf = r.counterfactual_analysis!;
    expect(cf.real_h2h_delta_seconds).toBeCloseTo(6, 0);

    // only_a: 6 + (−10 − 0) = −4 → A, outcome_changed (B → A)
    expect(cf.scenarios.only_a.applicable).toBe(true);
    expect(cf.scenarios.only_a.counterfactual_h2h_delta_seconds!).toBeCloseTo(-4, 0);
    expect(cf.scenarios.only_a.counterfactual_faster).toBe("A");
    expect(cf.scenarios.only_a.outcome_changed).toBe(true);

    // only_b: 6 + (0 − (−1)) = +7 → B, unchanged
    expect(cf.scenarios.only_b.applicable).toBe(true);
    expect(cf.scenarios.only_b.counterfactual_h2h_delta_seconds!).toBeCloseTo(7, 0);
    expect(cf.scenarios.only_b.counterfactual_faster).toBe("B");
    expect(cf.scenarios.only_b.outcome_changed).toBe(false);

    // both: 6 + (−10 − (−1)) = −3 → A, outcome_changed
    expect(cf.scenarios.both.applicable).toBe(true);
    expect(cf.scenarios.both.counterfactual_h2h_delta_seconds!).toBeCloseTo(-3, 0);
    expect(cf.scenarios.both.counterfactual_faster).toBe("A");
    expect(cf.scenarios.both.outcome_changed).toBe(true);

    // Top-level mirrors `both`
    expect(cf.counterfactual_h2h_delta_seconds!).toBeCloseTo(-3, 0);
    expect(cf.counterfactual_faster).toBe("A");
    expect(cf.outcome_changed).toBe(true);
  });

  it("Test 4: no alternatives provided → counterfactual_analysis is null", () => {
    const A = mkVreResult(1, 9999, []);
    const B = mkVreResult(2, 9999, []);
    const lapsA: Lap[] = Array.from({ length: 20 }, (_, i) => mkLap(i + 1, 90.0));
    const lapsB: Lap[] = Array.from({ length: 20 }, (_, i) => mkLap(i + 1, 90.0));

    const r = computeHeadToHead({
      resultA: A, resultB: B, lapsA, lapsB,
      alternativeA: null, alternativeB: null,
    });

    expect(r.counterfactual_analysis).toBeNull();
  });
});
