import { describe, it, expect } from "vitest";
import { buildGpPreviewNarrative } from "../gpPreviewNarrative";
import { predictGpAffinity } from "../gpPrediction";
import type { CircuitProfile } from "../circuitProfiles";
import type { CarProfile } from "../carProfiles";

function circuit(overrides: Partial<CircuitProfile> = {}): CircuitProfile {
  return {
    gpName: "Test GP",
    top_speed: 0.5,
    slow_corner_traction: 0.5,
    medium_corner: 0.5,
    fast_corner: 0.5,
    tyre_deg: 0.5,
    overtaking_difficulty: 0.5,
    confidence: "high",
    source: "historical",
    ...overrides,
  };
}

function car(
  name: string,
  top: number,
  sectors: [number, number, number],
  confidence: CarProfile["confidence"] = "high",
  sampleRaces = 4,
): CarProfile {
  return {
    team_name: name,
    top_speed_index: top,
    sector_strength: { s1: sectors[0], s2: sectors[1], s3: sectors[2] },
    sample_races: sampleRaces,
    sample_laps: 200,
    confidence,
  };
}

describe("buildGpPreviewNarrative", () => {
  it("top-speed-dominant circuit mentions velocità di punta and names the leader", () => {
    const c = circuit({
      top_speed: 1.0,
      slow_corner_traction: 0.1,
      medium_corner: 0.1,
      fast_corner: 0.1,
    });
    const cars = [
      car("Fast", 0.95, [0.3, 0.3, 0.3]),
      car("Cornering", 0.2, [0.95, 0.95, 0.95]),
    ];
    const pred = predictGpAffinity(c, cars);
    const lines = buildGpPreviewNarrative(c, pred);
    const all = lines.join(" ");
    expect(all).toMatch(/velocità di punta/i);
    expect(all).toMatch(/Fast/);
  });

  it("corner-dominant circuit mentions tenuta in curva", () => {
    const c = circuit({
      top_speed: 0.1,
      slow_corner_traction: 1.0,
      medium_corner: 1.0,
      fast_corner: 1.0,
    });
    const cars = [
      car("Fast", 0.95, [0.3, 0.3, 0.3]),
      car("Cornering", 0.2, [0.95, 0.95, 0.95]),
    ];
    const pred = predictGpAffinity(c, cars);
    const lines = buildGpPreviewNarrative(c, pred);
    const all = lines.join(" ");
    expect(all).toMatch(/tenuta in curva/i);
    expect(all).toMatch(/Cornering/);
  });

  it("if top teams share an indistinguishable group, presents them as equivalent (no sole favorite)", () => {
    const c = circuit({ confidence: "high" });
    const cars = [
      car("A", 0.50, [0.50, 0.50, 0.50], "low"),
      car("B", 0.52, [0.52, 0.52, 0.52], "low"),
      car("C", 0.0, [0.0, 0.0, 0.0], "high"),
    ];
    const pred = predictGpAffinity(c, cars);
    const lines = buildGpPreviewNarrative(c, pred);
    const all = lines.join(" ");
    expect(all).toMatch(/equivalent/i);
    // Both A and B should appear in the prose
    expect(all).toMatch(/\bA\b/);
    expect(all).toMatch(/\bB\b/);
  });

  it("empty ranking produces an honest sentence and no crash", () => {
    const c = circuit();
    const pred = predictGpAffinity(c, []);
    const lines = buildGpPreviewNarrative(c, pred);
    expect(lines.some((l) => /Dati insufficienti/i.test(l))).toBe(true);
  });

  it("caveat sentence reflects considered vs withData when they differ", () => {
    const c = circuit();
    const cars = [car("A", 0.5, [0.5, 0.5, 0.5], "medium", 2)];
    const pred = predictGpAffinity(c, cars, { racesConsidered: 4 });
    const lines = buildGpPreviewNarrative(c, pred);
    const caveat = lines.find((l) => /Confidenza/i.test(l));
    expect(caveat).toBeDefined();
    expect(caveat!).toMatch(/2 delle ultime 4/);
  });
});

describe("predictGpAffinity — note on races considered vs withData", () => {
  it("racesConsidered > withData ⇒ note 'X delle ultime Y'", () => {
    const c = circuit();
    const cars = [car("A", 0.5, [0.5, 0.5, 0.5], "medium", 2)];
    const pred = predictGpAffinity(c, cars, { racesConsidered: 4 });
    expect(pred.notes.some((n) => /2 delle ultime 4/.test(n))).toBe(true);
  });

  it("racesConsidered === withData ⇒ simple form without 'delle ultime'", () => {
    const c = circuit();
    const cars = [car("A", 0.5, [0.5, 0.5, 0.5], "high", 4)];
    const pred = predictGpAffinity(c, cars, { racesConsidered: 4 });
    expect(pred.notes.some((n) => /4 gare/.test(n))).toBe(true);
    expect(pred.notes.some((n) => /delle ultime/.test(n))).toBe(false);
  });

  it("no meta ⇒ backward-compatible note based on sample_races only", () => {
    const c = circuit();
    const cars = [car("A", 0.5, [0.5, 0.5, 0.5], "high", 3)];
    const pred = predictGpAffinity(c, cars);
    expect(pred.notes.some((n) => /3 gare/.test(n))).toBe(true);
  });
});
