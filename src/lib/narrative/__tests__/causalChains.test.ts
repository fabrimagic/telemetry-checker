import { describe, it, expect } from "vitest";
import { renderNarrative, describeCause } from "../renderer";
import type { NarrativeEvent } from "../types";

function ev(partial: Partial<NarrativeEvent> & { id: string; prerendered_text: string }): NarrativeEvent {
  return {
    category: "scenario",
    priority: "supporting",
    target: "global",
    data: {},
    ...partial,
  } as NarrativeEvent;
}

describe("Lever 2 — causal chains", () => {
  it("1. valid because_of: source present → annotation appended", () => {
    const events: NarrativeEvent[] = [
      ev({
        id: "pace_loss_cliff_risk",
        category: "pace_loss",
        prerendered_text: "Pace loss critica nello stint 2",
        lap: 18,
      }),
      ev({
        id: "cliff_rec",
        category: "cliff",
        prerendered_text: "Rischio cliff se si estende lo stint (75%)",
        because_of: ["pace_loss_cliff_risk"],
        target: "recommended",
        side: "con",
      }),
    ];
    const out = renderNarrative(events);
    expect(out.recommended_cons[0]).toBe(
      "Rischio cliff se si estende lo stint (75%) (conseguenza di calo di passo dal giro 18)",
    );
  });

  it("2. broken chain: source missing → text unchanged", () => {
    const events: NarrativeEvent[] = [
      ev({
        id: "cliff_rec",
        category: "cliff",
        prerendered_text: "Rischio cliff (75%)",
        because_of: ["pace_loss_cliff_risk"], // not in collector
        target: "recommended",
        side: "con",
      }),
    ];
    const out = renderNarrative(events);
    expect(out.recommended_cons[0]).toBe("Rischio cliff (75%)");
  });

  it("3. multi-id because_of: uses first found in collector", () => {
    const events: NarrativeEvent[] = [
      ev({
        id: "deg_quality_invalid_stint2",
        category: "degradation_quality",
        prerendered_text: "Stint 2 degrado anomalo",
      }),
      ev({
        id: "cum_dev_max",
        category: "cumulative_deviation",
        prerendered_text: "Deviazione cumulativa massima +6.0s",
        because_of: ["deg_quality_invalid_stint1", "deg_quality_invalid_stint2", "deg_quality_invalid_stint3"],
      }),
    ];
    const out = renderNarrative(events);
    expect(out.insights[1]).toBe(
      "Deviazione cumulativa massima +6.0s (conseguenza di degrado anomalo)",
    );
  });

  it("4. no because_of: backward-compatible (text identical)", () => {
    const events: NarrativeEvent[] = [
      ev({
        id: "x",
        category: "scenario",
        prerendered_text: "Testo originale invariato",
      }),
    ];
    const out = renderNarrative(events);
    expect(out.insights[0]).toBe("Testo originale invariato");
  });

  it("5. describeCause: pace_loss with lap → 'calo di passo dal giro 18'", () => {
    const e = ev({
      id: "x",
      category: "pace_loss",
      prerendered_text: "x",
      lap: 18,
    });
    expect(describeCause(e)).toBe("calo di passo dal giro 18");
  });

  it("6. describeCause: neutralization without lap → 'neutralizzazione'", () => {
    const e = ev({
      id: "x",
      category: "neutralization",
      prerendered_text: "x",
    });
    expect(describeCause(e)).toBe("neutralizzazione");
  });

  it("7. chained A→B→C: C cites only B (no transitive walking), deterministic", () => {
    const events: NarrativeEvent[] = [
      ev({
        id: "A",
        category: "weather",
        prerendered_text: "A text",
        lap: 5,
      }),
      ev({
        id: "B",
        category: "degradation_quality",
        prerendered_text: "B text",
        because_of: ["A"],
        lap: 10,
      }),
      ev({
        id: "C",
        category: "cumulative_deviation",
        prerendered_text: "C text",
        because_of: ["B"],
      }),
    ];
    const out1 = renderNarrative(events);
    const out2 = renderNarrative(events);
    expect(out1.insights).toEqual(out2.insights); // determinism
    expect(out1.insights[1]).toBe("B text (conseguenza di cambio meteo dal giro 5)");
    expect(out1.insights[2]).toBe("C text (conseguenza di degrado anomalo dal giro 10)");
    // C must NOT mention A
    expect(out1.insights[2]).not.toContain("cambio meteo");
  });
});
