import { describe, it, expect } from "vitest";
import { classifyStrategyIntent } from "../strategyIntent";
import type { CompetitorContext } from "../strategyAnalysis";

const ctx = (opp: number, risk: number) =>
  ({ undercut_opportunity: opp, undercut_risk: risk } as CompetitorContext);

describe("classifyStrategyIntent", () => {
  it("null context → neutral with zeroed metrics", () => {
    const r = classifyStrategyIntent(null);
    expect(r.intent).toBe("neutral");
    expect(r.opportunity).toBe(0);
    expect(r.risk).toBe(0);
  });

  it("high opportunity, low risk → attack", () => {
    const r = classifyStrategyIntent(ctx(0.7, 0.2));
    expect(r.intent).toBe("attack");
    expect(r.rationale).toContain("sorpasso strategico");
  });

  it("low opportunity, high risk → defense", () => {
    const r = classifyStrategyIntent(ctx(0.2, 0.8));
    expect(r.intent).toBe("defense");
    expect(r.rationale).toContain("copertura della posizione");
  });

  it("both below threshold → optimal", () => {
    const r = classifyStrategyIntent(ctx(0.3, 0.3));
    expect(r.intent).toBe("optimal");
    expect(r.rationale).toContain("passo puro");
  });

  it("both high and balanced (delta < 0.1) → neutral", () => {
    const r = classifyStrategyIntent(ctx(0.55, 0.55));
    expect(r.intent).toBe("neutral");
    expect(r.rationale).toContain("bilanciata");
  });

  it("both high but attack dominates (delta > 0.1) → attack", () => {
    const r = classifyStrategyIntent(ctx(0.8, 0.55));
    expect(r.intent).toBe("attack");
    expect(r.rationale).toContain("sorpasso");
  });
});
