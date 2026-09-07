import { describe, it, expect } from "vitest";
import { computeDuelCounterMoves } from "../duelCounterMove";
import type { ComparisonResult } from "../headToHeadComparison";

function mkDriver(pitLaps: number[], stints: any[] = [], pitStops: any[] = []) {
  return {
    actual_strategy: { pit_laps: pitLaps, stints, pit_stops: pitStops },
    alternative_strategies: [],
  } as any;
}

/** cumulative delta (A−B) constant per lap, from a map. */
function mkComparison(
  cum: Record<number, number>,
  a: any,
  b: any,
  altA: any = null,
  altB: any = null,
): ComparisonResult {
  const laps = Object.keys(cum).map(Number).sort((x, y) => x - y);
  return {
    driver_a: a,
    driver_b: b,
    alternative_a: altA,
    alternative_b: altB,
    lap_by_lap_delta: laps.map((l) => ({ lap: l, delta_a_minus_b: 0.1, cumulative_delta: cum[l] })),
  } as unknown as ComparisonResult;
}

describe("computeDuelCounterMoves", () => {
  it("returns null when no undercut attempt is identifiable", () => {
    // B pits but B is ahead (cumulative > 0 → A behind)
    const cum: Record<number, number> = {};
    for (let i = 1; i <= 30; i++) cum[i] = 2.0;
    const r = computeDuelCounterMoves(mkComparison(cum, mkDriver([]), mkDriver([20])), "AAA", "BBB");
    expect(r).toBeNull();
  });

  it("detects a real cover (COVERED_IN_RACE)", () => {
    const cum: Record<number, number> = {};
    for (let i = 1; i <= 30; i++) cum[i] = i <= 20 ? 1.5 : 0.5; // A behind, then closer
    const a = mkDriver([20], [{ compound: "SOFT", lap_start: 1, lap_end: 20 }], [
      { lap_number: 20, compound_after: "HARD" },
    ]);
    const b = mkDriver([21], [{ compound: "MEDIUM", lap_start: 1, lap_end: 21 }]);
    const r = computeDuelCounterMoves(mkComparison(cum, a, b), "AAA", "BBB")!;
    expect(r.episodes).toHaveLength(1);
    const e = r.episodes[0];
    expect(e.status).toBe("COVERED_IN_RACE");
    expect(e.attacker).toBe("A");
    expect(e.counter_pit_lap).toBe(21);
    expect(e.attacker_compound_after).toBe("HARD");
    expect(e.defender_compound_at_attack).toBe("MEDIUM");
    expect(e.attacker_swing_seconds).toBeCloseTo(1.0, 5);
    expect(r.covered_attacks).toBe(1);
  });

  it("uses a simulated alternative as counter-move (COVER_SIMULATED)", () => {
    const cum: Record<number, number> = {};
    for (let i = 1; i <= 30; i++) cum[i] = 1.0;
    const a = mkDriver([18]);
    const b = mkDriver([26]);
    const altB = {
      alternative_strategies: [
        {
          name: "Undercut anticipato",
          pit_laps: [19],
          time_delta_vs_actual: 0.8,
          analysis: { competitor_context: { undercut_opportunity: 0.2, undercut_risk: 0.6 } },
        },
      ],
    } as any;
    const r = computeDuelCounterMoves(mkComparison(cum, a, b, null, altB), "AAA", "BBB")!;
    const e = r.episodes[0];
    expect(e.status).toBe("COVER_SIMULATED");
    expect(e.counter_pit_lap).toBe(19);
    expect(e.counter_delta_seconds).toBeCloseTo(0.8, 5);
    expect(e.counter_undercut_risk).toBe(0.6);
    expect(e.message).toContain("60%");
    expect(r.unanswered_attacks).toBe(1);
  });

  it("reports NOT_SIMULABLE when no alternative covers the window", () => {
    const cum: Record<number, number> = {};
    for (let i = 1; i <= 30; i++) cum[i] = -1.0; // B behind
    const a = mkDriver([25]);
    const b = mkDriver([15]);
    const altA = { alternative_strategies: [{ name: "Late stop", pit_laps: [30], time_delta_vs_actual: -1 }] } as any;
    const r = computeDuelCounterMoves(mkComparison(cum, a, b, altA, null), "AAA", "BBB")!;
    const e = r.episodes[0];
    expect(e.attacker).toBe("B");
    expect(e.defender).toBe("A");
    expect(e.status).toBe("NOT_SIMULABLE");
    expect(e.reason).toContain("Nessuna alternativa simulata");
  });

  it("ignores attempts outside striking range", () => {
    const cum: Record<number, number> = {};
    for (let i = 1; i <= 30; i++) cum[i] = 12.0; // A far behind
    const r = computeDuelCounterMoves(mkComparison(cum, mkDriver([20]), mkDriver([])), "AAA", "BBB");
    expect(r).toBeNull();
  });
});
