import { describe, it, expect } from "vitest";
import { buildGpPreviewNarrative, buildPerTeamExplanations } from "../gpPreviewNarrative";
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
    const pred = predictGpAffinity(c, cars, { useCircuitSpecificModel: true });
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

  it("PROMOZIONE — leader prose says the score is based on sector pace, NOT on trap speed", () => {
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
    expect(all).toMatch(/tempi di settore/i);
    // No more "trap dominant" composition phrasing in the leader clause.
    expect(all).not.toMatch(/composto\s+(in\s+larghissima|per\s+circa)/i);
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


describe("buildPerTeamExplanations — accessible per-team prose", () => {


  function c(over: Partial<CircuitProfile> = {}): CircuitProfile {
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
      ...over,
    };
  }

  it("returns one explanation per ranked team, all non-empty", () => {
    const circ = c();
    const cars = [
      car("A", 0.8, [0.5, 0.5, 0.5]),
      car("B", 0.5, [0.5, 0.5, 0.5]),
      car("C", 0.2, [0.5, 0.5, 0.5]),
    ];
    const pred = predictGpAffinity(circ, cars);
    const out = buildPerTeamExplanations(circ, pred);
    expect(out).toHaveLength(pred.ranked.length);
    for (const e of out) {
      expect(e.team_name).toBeTruthy();
      expect(e.text.length).toBeGreaterThan(20);
    }
  });

  it("PROMOZIONE — per-team explanation says the score is from sector pace; no top/corner composition split", () => {
    const circ = c({ top_speed: 1.0, slow_corner_traction: 0.1, medium_corner: 0.1, fast_corner: 0.1 });
    const cars = [car("Fast", 0.95, [0.2, 0.2, 0.2]), car("Slow", 0.2, [0.5, 0.5, 0.5])];
    const pred = predictGpAffinity(circ, cars);
    const out = buildPerTeamExplanations(circ, pred);
    const fastText = out.find((e: { team_name: string; text: string }) => e.team_name === "Fast")!.text;
    expect(fastText).toMatch(/tempi di settore/i);
    expect(fastText).toMatch(/non entra nel calcolo|non entra/i);
    // No legacy composition phrasing.
    expect(fastText).not.toMatch(/composizione interna/i);
    expect(fastText).not.toMatch(/\b\d{1,3}\s?%\b/);
    expect(fastText).not.toMatch(/punto di forza/i);
    expect(fastText).not.toMatch(/più forte in rettilineo/i);
  });

  it("corner-context test: per-team explanation still mentions sector pace for a corner-strong car", () => {
    const circ = c({ top_speed: 0.1, slow_corner_traction: 1.0, medium_corner: 1.0, fast_corner: 1.0 });
    const cars = [car("Corner", 0.2, [0.95, 0.95, 0.95]), car("Drag", 0.9, [0.3, 0.3, 0.3])];
    const pred = predictGpAffinity(circ, cars);
    const out = buildPerTeamExplanations(circ, pred);
    const cornerText = out.find((e: { team_name: string; text: string }) => e.team_name === "Corner")!.text;
    expect(cornerText).toMatch(/tempi di settore/i);
  });

  it("teams in an indistinguishable group name each other and say 'alla pari'", () => {
    const circ = c({ confidence: "high" });
    const cars = [
      car("A", 0.50, [0.50, 0.50, 0.50], "low"),
      car("B", 0.52, [0.52, 0.52, 0.52], "low"),
      car("C", 0.0, [0.0, 0.0, 0.0], "high"),
    ];
    const pred = predictGpAffinity(circ, cars);
    const out = buildPerTeamExplanations(circ, pred);
    const aText = out.find((e: { team_name: string; text: string }) => e.team_name === "A")!.text;
    const bText = out.find((e: { team_name: string; text: string }) => e.team_name === "B")!.text;
    const cText = out.find((e: { team_name: string; text: string }) => e.team_name === "C")!.text;
    expect(aText).toMatch(/\bB\b/);
    expect(aText).toMatch(/alla pari/i);
    expect(bText).toMatch(/\bA\b/);
    expect(bText).toMatch(/alla pari/i);
    expect(cText).not.toMatch(/alla pari/i);
  });

  it("empty ranking ⇒ empty array, no crash", () => {
    const circ = c();
    const pred = predictGpAffinity(circ, []);
    expect(buildPerTeamExplanations(circ, pred)).toEqual([]);
  });

  it("sector_typed branch (differentiated) ⇒ usa la variante 'stimata per tipo (lente/medie/veloci)' dai settori", () => {
    const circ = c({
      top_speed: 0,
      slow_corner_traction: 1.0,
      medium_corner: 0.2,
      fast_corner: 0.0,
      sector_corner_map: {
        s1: { slow: 0.7, medium: 0.3, fast: 0.0 },
        s2: { slow: 0.6, medium: 0.2, fast: 0.2 },
        s3: { slow: 0.8, medium: 0.2, fast: 0.0 },
      },
    });
    // s2 diverso da s1/s3 per generare spread ≥ 0.05 sulla stima fast-corner
    const cars = [car("Mc", 0.5, [0.7, 0.4, 0.7]), car("Rb", 0.4, [0.6, 0.6, 0.6])];
    const pred = predictGpAffinity(circ, cars);
    expect(pred.ranked[0].corner_source).toBe("sector_typed");
    const out = buildPerTeamExplanations(circ, pred);
    const txt = out.find((e) => e.team_name === "Mc")!.text;
    expect(txt).toMatch(/stimata per tipo/i);
    expect(txt).toMatch(/lente\/medie\/veloci/i);
    // distinct from the sector_fallback wording
    expect(txt).not.toMatch(/settore aggregat/i);
    // note telaio/motore present
    expect(txt).toMatch(/telaio/i);
  });

  it("sector_typed branch (uniform) ⇒ usa la variante 'uniforme' quando i dati non distinguono i tipi", () => {
    const circ = c({
      top_speed: 0,
      slow_corner_traction: 1.0,
      medium_corner: 0.2,
      fast_corner: 0.0,
      sector_corner_map: {
        s1: { slow: 0.7, medium: 0.3, fast: 0.0 },
        s2: { slow: 0.6, medium: 0.2, fast: 0.2 },
        s3: { slow: 0.8, medium: 0.2, fast: 0.0 },
      },
    });
    const cars = [car("Mc", 0.5, [0.64, 0.64, 0.63]), car("Rb", 0.4, [0.6, 0.6, 0.6])];
    const pred = predictGpAffinity(circ, cars);
    expect(pred.ranked[0].corner_source).toBe("sector_typed");
    const out = buildPerTeamExplanations(circ, pred);
    const txt = out.find((e) => e.team_name === "Mc")!.text;
    expect(txt).toMatch(/uniforme/i);
    expect(txt).toMatch(/i dati non permettono di distinguere/i);
    expect(txt).not.toMatch(/stimata per tipo/i);
    // note telaio/motore present
    expect(txt).toMatch(/telaio/i);
  });

  it("sector_fallback branch ⇒ mantiene la variante 'tempi di settore aggregati'", () => {
    const circ = c({ top_speed: 0.5, slow_corner_traction: 0.5, medium_corner: 0.5, fast_corner: 0.5 });
    const cars = [car("X", 0.5, [0.5, 0.5, 0.5])];
    const pred = predictGpAffinity(circ, cars);
    expect(pred.ranked[0].corner_source).toBe("sector_fallback");
    const out = buildPerTeamExplanations(circ, pred);
    expect(out[0].text).toMatch(/settore aggregati/i);
    expect(out[0].text).not.toMatch(/stimata per tipo/i);
  });

  it("sector_typed_history branch ⇒ usa la variante 'storico settori' nel per-team", () => {
    const circ = c({ top_speed: 0.3, slow_corner_traction: 0.7, medium_corner: 0.5, fast_corner: 0.4 });
    const cars: CarProfile[] = [
      {
        ...car("Hist", 0.4, [0.6, 0.6, 0.6]),
        corner_type_strength: { slow: 0.7, medium: 0.5, fast: 0.3 },
        corner_source: "sector_typed_history",
      },
    ];
    const pred = predictGpAffinity(circ, cars);
    expect(pred.ranked[0].corner_source).toBe("sector_typed_history");
    const out = buildPerTeamExplanations(circ, pred);
    expect(out[0].text).toMatch(/storico|gare precedenti/i);
    expect(out[0].text).not.toMatch(/geometria GPS|geometria del tracciato/i);
  });

  it("intro paragraph mentions sector_typed_history teams distinctly", () => {
    const circ = c({ top_speed: 0.3, slow_corner_traction: 0.7, medium_corner: 0.5, fast_corner: 0.4 });
    const cars: CarProfile[] = [
      {
        ...car("Hist", 0.4, [0.6, 0.6, 0.6]),
        corner_type_strength: { slow: 0.7, medium: 0.5, fast: 0.3 },
        corner_source: "sector_typed_history",
      },
    ];
    const pred = predictGpAffinity(circ, cars);
    const lines = buildGpPreviewNarrative(circ, pred);
    const all = lines.join(" ");
    expect(all).toMatch(/gare già disputate|gare precedenti/i);
    expect(all).toMatch(/Hist/);
  });
});

describe("buildGpPreviewNarrative — qualifying-source transparency", () => {
  it("didactic block describes top speed as trap speed and warns it depends also on aero load, not only on engine power", () => {
    const c = circuit();
    const cars = [car("A", 0.6, [0.5, 0.5, 0.5]), car("B", 0.3, [0.4, 0.4, 0.4])];
    const pred = predictGpAffinity(c, cars);
    const lines = buildGpPreviewNarrative(c, pred);
    const all = lines.join(" ");
    expect(all).toMatch(/trap speed|velocità massima rilevata/i);
    expect(all).toMatch(/carico aerodinamico/i);
    expect(all).toMatch(/non come misura della potenza/i);
    // Trap is now framed as NOT used in the score.
    expect(all).toMatch(/non è usata nel punteggio|non entra nel punteggio/i);
    expect(all).toMatch(/tempi di settore/i);
  });

  it("flags GPs whose qualifying session was missing among used races", () => {
    const c = circuit();
    const cars = [car("A", 0.5, [0.5, 0.5, 0.5], "medium", 3)];
    const pred = predictGpAffinity(c, cars, { racesConsidered: 3 });
    const lines = buildGpPreviewNarrative(c, pred, {
      totalPastRaces: 3,
      racesConsidered: 3,
      racesWithData: 3,
      diagnostics: [
        { name: "Bahrain", date_end: "2026-03-01", status: "used", sources: { quali: true, race: true } },
        { name: "Jeddah", date_end: "2026-04-01", status: "used", sources: { quali: false, race: true } },
        { name: "Melbourne", date_end: "2026-04-15", status: "used", sources: { quali: false, race: true } },
      ],
    });
    const all = lines.join("\n");
    expect(all).toMatch(/non era disponibile la sessione di qualifica/i);
    expect(all).toMatch(/Jeddah/);
    expect(all).toMatch(/Melbourne/);
  });

  it("does NOT flag quali-missing when all used GPs had quali", () => {
    const c = circuit();
    const cars = [car("A", 0.5, [0.5, 0.5, 0.5], "high", 3)];
    const pred = predictGpAffinity(c, cars, { racesConsidered: 3 });
    const lines = buildGpPreviewNarrative(c, pred, {
      totalPastRaces: 3,
      racesConsidered: 3,
      racesWithData: 3,
      diagnostics: [
        { name: "Bahrain", date_end: "2026-03-01", status: "used", sources: { quali: true, race: true } },
        { name: "Jeddah", date_end: "2026-04-01", status: "used", sources: { quali: true, race: true } },
        { name: "Melbourne", date_end: "2026-04-15", status: "used", sources: { quali: true, race: true } },
      ],
    });
    const all = lines.join("\n");
    expect(all).not.toMatch(/non era disponibile la sessione di qualifica/i);
  });
});

describe("Role A — corner-type spread threshold + chassis/engine disclosure", () => {
  it("flat per-type (spread < 0.05) ⇒ narrative does NOT claim per-type strength + chassis/engine disclosure present", () => {
    const c = circuit({ top_speed: 0.3, slow_corner_traction: 0.7, medium_corner: 0.5, fast_corner: 0.4 });
    const cars: CarProfile[] = [{
      ...car("Flat", 0.5, [0.6, 0.6, 0.6]),
      corner_type_strength: { slow: 0.64, medium: 0.64, fast: 0.63 },
      corner_source: "sector_typed_history",
    }];
    const pred = predictGpAffinity(c, cars);
    const out = buildPerTeamExplanations(c, pred);
    const text = out[0].text;
    expect(text).toMatch(/uniforme/i);
    expect(text).toMatch(/non permettono di distinguere/i);
    expect(text).toMatch(/poca potenza|tratti in rettilineo/i);
  });

  it("differentiated per-type (spread ≥ 0.05) ⇒ keeps per-type framing", () => {
    const c = circuit({ top_speed: 0.3, slow_corner_traction: 0.7, medium_corner: 0.5, fast_corner: 0.4 });
    const cars: CarProfile[] = [{
      ...car("Diff", 0.5, [0.6, 0.6, 0.6]),
      corner_type_strength: { slow: 0.75, medium: 0.55, fast: 0.30 },
      corner_source: "sector_typed_history",
    }];
    const pred = predictGpAffinity(c, cars);
    const out = buildPerTeamExplanations(c, pred);
    const text = out[0].text;
    expect(text).toMatch(/per tipo|lente\/medie\/veloci/i);
    expect(text).not.toMatch(/non permettono di distinguere/i);
  });
});
