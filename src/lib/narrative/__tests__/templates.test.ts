import { describe, it, expect } from "vitest";
import { selectTemplate, hashStringNumeric } from "../templates";
import { renderNarrative } from "../renderer";
import type { NarrativeEvent } from "../types";

describe("Lever 3 — linguistic templates", () => {
  it("1. traffic HEAVY: returns one of 3 strong variants with traffic_loss filled", () => {
    const out = selectTemplate("traffic", {
      data: { level: "HEAVY", traffic_loss: 2.3 },
      session_key: 9621,
      event_id: "traffic_heavy_alt0",
    });
    expect(out).not.toBeNull();
    expect(out!).toContain("2.300");
    expect(out!).not.toContain("{traffic_loss}");
  });

  it("2. determinism: same input produces same variant 5 times", () => {
    const ctx = {
      data: { level: "HEAVY", traffic_loss: 2.3 },
      session_key: 9621,
      event_id: "traffic_heavy_alt0",
    };
    const first = selectTemplate("traffic", ctx);
    for (let i = 0; i < 5; i++) {
      expect(selectTemplate("traffic", ctx)).toBe(first);
    }
  });

  it("3. variety across sessions: different session_key produces ≥2 distinct variants", () => {
    const data = { level: "HEAVY", traffic_loss: 2.3 };
    const id = "traffic_heavy_alt0";
    const variants = new Set([
      selectTemplate("traffic", { data, event_id: id, session_key: 9621 }),
      selectTemplate("traffic", { data, event_id: id, session_key: 9589 }),
      selectTemplate("traffic", { data, event_id: id, session_key: 9121 }),
      selectTemplate("traffic", { data, event_id: id, session_key: 9300 }),
      selectTemplate("traffic", { data, event_id: id, session_key: 9777 }),
    ]);
    expect(variants.size).toBeGreaterThanOrEqual(2);
  });

  it("4. uncovered category returns null", () => {
    const out = selectTemplate("battle_context", {
      data: { foo: 1 },
      session_key: 9621,
      event_id: "anything",
    });
    expect(out).toBeNull();
  });

  it("5. missing placeholder data → returns null (caller falls back)", () => {
    // pace_loss CLIFF_RISK template requires {rate} and {stint}
    const out = selectTemplate("pace_loss", {
      data: { status: "CLIFF_RISK" }, // rate, stint missing
      session_key: 9621,
      event_id: "pace_loss_cliff_risk",
    });
    expect(out).toBeNull();
  });

  it("6. pace_loss CLIFF_RISK with rate+stint → strong variant filled", () => {
    const out = selectTemplate("pace_loss", {
      data: { status: "CLIFF_RISK", rate: 0.18, stint: 2 },
      session_key: 9621,
      event_id: "pace_loss_cliff_risk",
    });
    expect(out).not.toBeNull();
    expect(out!).toContain("0.180");
    expect(out!).toMatch(/stint 2/);
  });

  it("7. hashStringNumeric is deterministic and distributes for similar inputs", () => {
    expect(hashStringNumeric("abc")).toBe(hashStringNumeric("abc"));
    const a = hashStringNumeric("9621:traffic_heavy_alt0");
    const b = hashStringNumeric("9621:traffic_heavy_alt1");
    const c = hashStringNumeric("9622:traffic_heavy_alt0");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("8. end-to-end via renderNarrative: traffic HEAVY uses templated variant", () => {
    const events: NarrativeEvent[] = [
      {
        id: "traffic_heavy_alt0",
        category: "traffic",
        priority: "supporting",
        target: "global",
        data: { level: "HEAVY", traffic_loss: 2.3 },
        prerendered_text: "ORIGINAL_TEXT_PLACEHOLDER",
      },
    ];
    const out = renderNarrative(events, { session_key: 9621 });
    expect(out.insights[0]).not.toBe("ORIGINAL_TEXT_PLACEHOLDER");
    expect(out.insights[0]).toContain("2.300");
    expect(out.insights[0]).not.toContain("{");

    // Without session_key: falls back to prerendered_text (Lever 3 inactive)
    const out2 = renderNarrative(events);
    expect(out2.insights[0]).toBe("ORIGINAL_TEXT_PLACEHOLDER");
  });
});
