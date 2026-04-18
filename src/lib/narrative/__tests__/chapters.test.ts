/**
 * buildChapters — pure function tests
 * ────────────────────────────────────
 * Lever 1: deterministic chapter segmentation. No randomness expected.
 */

import { describe, it, expect } from "vitest";
import { buildChapters } from "../chapters";
import type { NarrativeEvent } from "../types";

function ev(
  id: string,
  category: NarrativeEvent["category"],
  priority: NarrativeEvent["priority"],
  text: string,
  lap?: number,
  target: NarrativeEvent["target"] = "global",
): NarrativeEvent {
  return {
    id,
    category,
    priority,
    target,
    lap,
    data: {},
    prerendered_text: text,
  };
}

describe("buildChapters", () => {
  it("0 pit + N global events → single DEVELOPMENT chapter", () => {
    const events: NarrativeEvent[] = [
      ev("e1", "weather", "supporting", "Pioggia leggera al giro 5", 5),
      ev("e2", "weather", "supporting", "Asciuga al giro 20", 20),
      ev("e3", "neutralization", "supporting", "VSC al giro 30", 30),
    ];
    const chapters = buildChapters(events, 50, []);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].phase).toBe("DEVELOPMENT");
    expect(chapters[0].lap_range).toEqual([1, 50]);
    expect(chapters[0].events).toHaveLength(3);
    expect(chapters[0].outcome).toBeNull();
  });

  it("1 pit at lap 20, totalLaps 50 → OPENING + CLOSING", () => {
    const events: NarrativeEvent[] = [
      ev("e1", "weather", "supporting", "Asciutto", 5),
      ev("e2", "neutralization", "supporting", "VSC", 30),
    ];
    const chapters = buildChapters(events, 50, [20]);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].phase).toBe("OPENING");
    expect(chapters[0].lap_range).toEqual([1, 20]);
    expect(chapters[0].title).toBe("Primo stint (giri 1-20)");
    expect(chapters[1].phase).toBe("CLOSING");
    expect(chapters[1].lap_range).toEqual([21, 50]);
    expect(chapters[1].title).toBe("Il finale (giri 21-50)");
  });

  it("2 pits → up to 3 chapters in OPENING/DEVELOPMENT/CLOSING order", () => {
    const events: NarrativeEvent[] = [
      ev("e1", "weather", "supporting", "Asciutto", 5),
      ev("e2", "neutralization", "supporting", "VSC mid race", 25),
      ev("e3", "traffic", "supporting", "Traffico finale", 45),
    ];
    const chapters = buildChapters(events, 55, [15, 35]);
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    expect(chapters[0].phase).toBe("OPENING");
    expect(chapters[chapters.length - 1].phase).toBe("CLOSING");
    // Mid event at lap 25 falls into DEVELOPMENT window [16..35]
    const dev = chapters.find(c => c.phase === "DEVELOPMENT");
    expect(dev).toBeDefined();
    expect(dev!.events.some(e => e.id === "e2")).toBe(true);
    // Title for DEV after first pit
    expect(dev!.title).toBe("Dopo il pit al giro 15");
  });

  it("mix of events with/without lap → cap context >2 becomes Setup OPENING", () => {
    const events: NarrativeEvent[] = [
      ev("c1", "mode_context", "context", "Modalità POST_RACE"),
      ev("c2", "raw_vs_corrected", "context", "Correzione applicata"),
      ev("c3", "degradation_quality", "context", "Qualità degrado: BUONA"),
      ev("c4", "scenario", "context", "Scenario REAL_CONTEXT"),
      ev("e1", "weather", "supporting", "Pioggia al 10", 10),
    ];
    const chapters = buildChapters(events, 40, [20]);
    // 4 cap-context > 2 → dedicated setup chapter
    const setup = chapters.find(c => c.id === "setup_analysis");
    expect(setup).toBeDefined();
    expect(setup!.phase).toBe("OPENING");
    expect(setup!.lap_range).toBeNull();
    expect(setup!.title).toBe("Setup dell'analisi");
    expect(setup!.events).toHaveLength(4);
  });

  it("merges <=2 cap context into first OPENING window", () => {
    const events: NarrativeEvent[] = [
      ev("c1", "mode_context", "context", "Modalità"),
      ev("e1", "weather", "supporting", "Pioggia", 5),
    ];
    const chapters = buildChapters(events, 30, [15]);
    expect(chapters.find(c => c.id === "setup_analysis")).toBeUndefined();
    const opening = chapters.find(c => c.phase === "OPENING");
    expect(opening).toBeDefined();
    expect(opening!.events.some(e => e.id === "c1")).toBe(true);
    expect(opening!.events.some(e => e.id === "e1")).toBe(true);
  });

  it("a critical event promotes its window to phase=CRITICAL", () => {
    const events: NarrativeEvent[] = [
      ev("e1", "weather", "supporting", "Asciutto", 5),
      ev("e2", "cliff", "critical", "Cliff degrado al giro 25", 25),
      ev("e3", "traffic", "supporting", "Traffico", 45),
    ];
    const chapters = buildChapters(events, 55, [15, 35]);
    const critical = chapters.find(c => c.phase === "CRITICAL");
    expect(critical).toBeDefined();
    expect(critical!.events.some(e => e.id === "e2")).toBe(true);
    expect(critical!.title).toBe("Il degrado morde");
    expect(critical!.priority_max).toBe("critical");
  });

  it("ignores events with target !== 'global'", () => {
    const events: NarrativeEvent[] = [
      ev("a1", "traffic", "supporting", "Alt traffic", 10, "alternative"),
      ev("r1", "robustness", "supporting", "Rec robust", 20, "recommended"),
      ev("g1", "weather", "supporting", "Global", 30),
    ];
    const chapters = buildChapters(events, 50, []);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].events).toHaveLength(1);
    expect(chapters[0].events[0].id).toBe("g1");
  });

  it("malformed inputs → empty chapters array (no throw)", () => {
    expect(buildChapters([], 50, [])).toEqual([]);
    expect(buildChapters([ev("e1", "weather", "supporting", "x", 1)], 0, [])).toEqual([]);
    expect(buildChapters([ev("e1", "weather", "supporting", "x", 1)], -10, [])).toEqual([]);
    // non-array pits
    expect(buildChapters([ev("e1", "weather", "supporting", "x", 1)], 50, null as unknown as number[])).toEqual([]);
  });

  it("populates outcome on CRITICAL → non-CRITICAL pit transition", () => {
    const events: NarrativeEvent[] = [
      ev("e1", "weather", "supporting", "Asciutto", 5),
      ev("e2", "cliff", "critical", "Cliff", 14),
      ev("e3", "traffic", "supporting", "Post pit", 25),
    ];
    const chapters = buildChapters(events, 40, [15]);
    // First chapter: window [1..15] becomes CRITICAL because of e2
    const first = chapters[0];
    expect(first.phase).toBe("CRITICAL");
    expect(first.outcome).toBe("La situazione si stabilizza dopo il pit al giro 15");
  });
});
