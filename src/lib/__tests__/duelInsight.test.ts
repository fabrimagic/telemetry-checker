import { describe, it, expect } from "vitest";
import { computeDuelInsight } from "../duelInsight";
import type { ComparisonResult } from "../headToHeadComparison";

function make(verdict: "A" | "B" | "TIE", altA: any): ComparisonResult {
  return {
    head_to_head_verdict: { faster_driver: verdict },
    alternative_a: altA,
    alternative_b: null,
  } as unknown as ComparisonResult;
}

describe("computeDuelInsight", () => {
  it("TIE → variant null", () => {
    const r = computeDuelInsight(make("TIE", null), "ACR_A", "ACR_B");
    expect(r.variant).toBeNull();
    expect(r.message).toBeNull();
  });

  it("B faster, alternative_a missing → variant null", () => {
    const r = computeDuelInsight(make("B", null), "ACR_A", "ACR_B");
    expect(r.variant).toBeNull();
  });

  it("B faster, A has alt with opp 0.7 and different pit → offensive_chance", () => {
    const altA = {
      recommended_strategy: { pit_windows: [{ ideal_lap: 32 }], analysis: {} },
      alternative_strategies: [
        {
          pit_laps: [28],
          time_delta_vs_actual: 0.3,
          analysis: { competitor_context: { undercut_opportunity: 0.7, undercut_risk: 0.1 } },
        },
      ],
    };
    const r = computeDuelInsight(make("B", altA), "ACR_A", "ACR_B");
    expect(r.variant).toBe("offensive_chance");
    expect(r.message).toContain("ACR_A");
    expect(r.message).toContain("ACR_B");
    expect(r.message).toContain("undercut");
    expect(r.message).toContain("giro 28");
    expect(r.message).toContain("70%");
  });

  it("A faster, undercut_risk 0.65 → defensive_warning", () => {
    const altA = {
      recommended_strategy: {
        pit_windows: [{ ideal_lap: 30 }],
        analysis: { competitor_context: { undercut_opportunity: 0.1, undercut_risk: 0.65 } },
      },
      alternative_strategies: [],
    };
    const r = computeDuelInsight(make("A", altA), "ACR_A", "ACR_B");
    expect(r.variant).toBe("defensive_warning");
    expect(r.message).toContain("ACR_B");
    expect(r.message).toContain("undercuttare");
    expect(r.message).toContain("ACR_A");
    expect(r.message).toContain("65%");
  });

  it("B faster, alt opp high but pit equals recommended → variant null", () => {
    const altA = {
      recommended_strategy: { pit_windows: [{ ideal_lap: 28 }], analysis: {} },
      alternative_strategies: [
        {
          pit_laps: [28],
          time_delta_vs_actual: 0.0,
          analysis: { competitor_context: { undercut_opportunity: 0.7, undercut_risk: 0.1 } },
        },
      ],
    };
    const r = computeDuelInsight(make("B", altA), "ACR_A", "ACR_B");
    expect(r.variant).toBeNull();
  });
});
