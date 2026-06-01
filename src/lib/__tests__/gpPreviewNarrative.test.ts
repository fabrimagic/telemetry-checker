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
    effective_sample_races: sampleRaces,
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

describe("buildGpPreviewNarrative — extended data-context paragraph (Part B)", () => {
  it("emits an extended paragraph naming excluded races when racesWithData < racesConsidered", () => {
    const c = circuit();
    const cars = [
      car("A", 0.5, [0.5, 0.5, 0.5], "medium", 2),
      car("B", 0.4, [0.4, 0.4, 0.4], "medium", 2),
    ];
    const pred = predictGpAffinity(c, cars, { racesConsidered: 4 });
    const lines = buildGpPreviewNarrative(c, pred, {
      totalPastRaces: 5,
      racesConsidered: 4,
      racesWithData: 2,
      diagnostics: [
        { name: "Bahrain", date_end: "2026-03-01", status: "used" },
        { name: "Jeddah", date_end: "2026-04-01", status: "used" },
        { name: "Melbourne", date_end: "2026-04-15", status: "no_data" },
        { name: "Suzuka", date_end: "2026-05-01", status: "no_data" },
      ],
    });
    const all = lines.join("\n");
    expect(all).toMatch(/5 gare/);
    expect(all).toMatch(/ultime 4/);
    expect(all).toMatch(/solo 2/);
    expect(all).toMatch(/Melbourne/);
    expect(all).toMatch(/Suzuka/);
    expect(all).toMatch(/OpenF1/);
    expect(all).toMatch(/incertezza|incert/i);
  });

  it("emits only a short reassurance sentence when racesWithData === racesConsidered", () => {
    const c = circuit();
    const cars = [car("A", 0.5, [0.5, 0.5, 0.5], "high", 4)];
    const pred = predictGpAffinity(c, cars, { racesConsidered: 4 });
    const lines = buildGpPreviewNarrative(c, pred, {
      totalPastRaces: 6,
      racesConsidered: 4,
      racesWithData: 4,
      diagnostics: [],
    });
    const all = lines.join("\n");
    expect(all).toMatch(/ultime 4 gare/);
    expect(all).toMatch(/tutte con dati utilizzabili/);
    // No "esclus*" prose
    expect(all).not.toMatch(/esclus/i);
  });

  it("no dataContext ⇒ no crash, no extended paragraph", () => {
    const c = circuit();
    const cars = [car("A", 0.5, [0.5, 0.5, 0.5], "medium", 2)];
    const pred = predictGpAffinity(c, cars);
    const lines = buildGpPreviewNarrative(c, pred);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(" ")).not.toMatch(/esclus/i);
  });

  it("(NEW) when racesConsidered === totalPastRaces (new default), prose says 'considera tutte' with recency weighting", () => {
    const c = circuit();
    const cars = [car("A", 0.5, [0.5, 0.5, 0.5], "high", 7)];
    const pred = predictGpAffinity(c, cars, { racesConsidered: 7 });
    const lines = buildGpPreviewNarrative(c, pred, {
      totalPastRaces: 7,
      racesConsidered: 7,
      racesWithData: 7,
      diagnostics: [],
    });
    const all = lines.join("\n");
    expect(all).toMatch(/considera tutte/i);
    expect(all).toMatch(/peso maggiore alle più recenti/i);
    expect(all).not.toMatch(/solo le ultime/i);
  });

  it("(NEW) considering all races with some missing data ⇒ explains exclusions + effective-sample caveat", () => {
    const c = circuit();
    const cars = [car("A", 0.5, [0.5, 0.5, 0.5], "medium", 4)];
    const pred = predictGpAffinity(c, cars, { racesConsidered: 6 });
    const lines = buildGpPreviewNarrative(c, pred, {
      totalPastRaces: 6,
      racesConsidered: 6,
      racesWithData: 4,
      diagnostics: [
        { name: "Bahrain", date_end: "2026-03-01", status: "used" },
        { name: "Jeddah", date_end: "2026-04-01", status: "used" },
        { name: "Melbourne", date_end: "2026-04-15", status: "used" },
        { name: "Suzuka", date_end: "2026-05-01", status: "used" },
        { name: "Imola", date_end: "2026-05-15", status: "no_data" },
        { name: "Monaco", date_end: "2026-05-29", status: "no_data" },
      ],
    });
    const all = lines.join("\n");
    expect(all).toMatch(/considera tutte/i);
    expect(all).toMatch(/solo 4/);
    expect(all).toMatch(/Imola/);
    expect(all).toMatch(/Monaco/);
    expect(all).toMatch(/campione effettivo/i);
  });

describe("buildGpPreviewNarrative — extended affinity explanation (Part C)", () => {
  it("includes the didactic score sentence and the uncertainty-band explanation", () => {
    const c = circuit();
    const cars = [car("A", 0.6, [0.5, 0.5, 0.5]), car("B", 0.3, [0.4, 0.4, 0.4])];
    const pred = predictGpAffinity(c, cars);
    const lines = buildGpPreviewNarrative(c, pred);
    const all = lines.join(" ");
    expect(all).toMatch(/indice da 0 a 1/i);
    expect(all).toMatch(/banda di incertezza/i);
    expect(all).toMatch(/sovrappongono/i);
  });

  it("leader with top-speed-dominant contributions: prose says the score comes mostly from velocità di punta", () => {
    const c = circuit({
      top_speed: 1.0,
      slow_corner_traction: 0.1,
      medium_corner: 0.1,
      fast_corner: 0.1,
    });
    const cars = [
      car("Fast", 0.95, [0.3, 0.3, 0.3]),
      car("Slow", 0.2, [0.5, 0.5, 0.5]),
    ];
    const pred = predictGpAffinity(c, cars);
    const lines = buildGpPreviewNarrative(c, pred);
    const all = lines.join(" ");
    expect(all).toMatch(/Fast/);
    // The leader's top-speed contribution should dominate.
    expect(all).toMatch(/grazie alla velocità di punta/i);
    // One of the fraction phrases should appear.
    expect(all).toMatch(/(tre quarti|due terzi|larghissima parte)/i);
  });

  it("indistinguishable leaders: no sole favorite, both teams cited together", () => {
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
    expect(all).toMatch(/\bA\b/);
    expect(all).toMatch(/\bB\b/);
    expect(all).toMatch(/arbitrario/i);
  });

  it("edge: empty ranking + missing dataContext ⇒ no crash", () => {
    const c = circuit();
    const pred = predictGpAffinity(c, []);
    expect(() => buildGpPreviewNarrative(c, pred)).not.toThrow();
  });
});

