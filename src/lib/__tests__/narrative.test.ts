import { describe, it, expect } from "vitest";
import { NarrativeCollector } from "../narrative/collector";
import { renderNarrative } from "../narrative/renderer";
import type { NarrativeEvent } from "../narrative/types";

describe("NarrativeCollector + renderer", () => {
  it("preserves insertion order in getAll()", () => {
    const c = new NarrativeCollector();
    const a: NarrativeEvent = { id: "a", category: "weather", priority: "context", target: "global", data: {}, prerendered_text: "A" };
    const b: NarrativeEvent = { id: "b", category: "neutralization", priority: "context", target: "global", data: {}, prerendered_text: "B" };
    c.add(a); c.add(b);
    expect(c.getAll().map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("renders only events with prerendered_text", () => {
    const out = renderNarrative([
      { id: "1", category: "weather", priority: "context", target: "global", data: {}, prerendered_text: "Hello" },
      { id: "2", category: "weather", priority: "context", target: "global", data: {} }, // no text → skipped
    ]);
    expect(out.insights).toEqual(["Hello"]);
  });

  it("routes events to the correct bucket by target/side", () => {
    const out = renderNarrative([
      { id: "g", category: "weather", priority: "context", target: "global", data: {}, prerendered_text: "G" },
      { id: "rp", category: "pit_window", priority: "supporting", target: "recommended", side: "pro", data: {}, prerendered_text: "RP" },
      { id: "rc", category: "pit_window", priority: "supporting", target: "recommended", side: "con", data: {}, prerendered_text: "RC" },
      { id: "a0p", category: "traffic", priority: "supporting", target: "alternative", target_index: 0, side: "pro", data: {}, prerendered_text: "A0P" },
      { id: "a0c", category: "traffic", priority: "supporting", target: "alternative", target_index: 0, side: "con", data: {}, prerendered_text: "A0C" },
      { id: "a1c", category: "traffic", priority: "supporting", target: "alternative", target_index: 1, side: "con", data: {}, prerendered_text: "A1C" },
    ]);
    expect(out.insights).toEqual(["G"]);
    expect(out.recommended_pros).toEqual(["RP"]);
    expect(out.recommended_cons).toEqual(["RC"]);
    expect(out.alternatives.get(0)).toEqual({ pros: ["A0P"], cons: ["A0C"] });
    expect(out.alternatives.get(1)).toEqual({ pros: [], cons: ["A1C"] });
  });
});
