import { describe, it, expect } from "vitest";
import {
  predictGpAffinity,
  OVERTAKING_DIFFICULTY_DOWNGRADE_THRESHOLD,
} from "../gpPrediction";
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
): CarProfile {
  return {
    team_name: name,
    top_speed_index: top,
    sector_strength: { s1: sectors[0], s2: sectors[1], s3: sectors[2] },
    sample_races: 4,
    effective_sample_races: 4,
    sample_laps: 200,
    confidence,
  };
}

describe("gpPrediction", () => {
  it("top-speed-dominant circuit rewards the team with highest top_speed_index (legacy circuit-specific engine)", () => {
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
    // sectors_only production would put Cornering first; the assertion
    // exercises the DORMANT circuit-specific engine explicitly.
    const out = predictGpAffinity(c, cars, { useCircuitSpecificModel: true });
    expect(out.ranked[0].team_name).toBe("Fast");
  });

  it("corner-dominant circuit rewards the team with highest corner_index", () => {
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
    const out = predictGpAffinity(c, cars, { useCircuitSpecificModel: true });
    expect(out.ranked[0].team_name).toBe("Cornering");
  });

  it("weights normalize and affinity stays in [0,1]", () => {
    const c = circuit({
      top_speed: 0.7,
      slow_corner_traction: 0.3,
      medium_corner: 0.3,
      fast_corner: 0.3,
    });
    const cars = [
      car("A", 1, [1, 1, 1]),
      car("B", 0, [0, 0, 0]),
      car("C", 0.5, [0.5, 0.5, 0.5]),
    ];
    const out = predictGpAffinity(c, cars);
    for (const t of out.ranked) {
      expect(t.affinity_score).toBeGreaterThanOrEqual(0);
      expect(t.affinity_score).toBeLessThanOrEqual(1);
    }
    // The all-1 car should score 1.0, all-0 should score 0.
    expect(out.ranked.find((t) => t.team_name === "A")!.affinity_score).toBeCloseTo(1, 6);
    expect(out.ranked.find((t) => t.team_name === "B")!.affinity_score).toBeCloseTo(0, 6);
  });

  it("smaller effective sample yields larger uncertainty than a larger one", () => {
    const c = circuit();
    const hiSample = { ...car("Big", 0.5, [0.5, 0.5, 0.5]), effective_sample_races: 8 };
    const loSample = { ...car("Small", 0.5, [0.5, 0.5, 0.5]), effective_sample_races: 3 };
    const out = predictGpAffinity(c, [hiSample, loSample]);
    const big = out.ranked.find((t) => t.team_name === "Big")!;
    const small = out.ranked.find((t) => t.team_name === "Small")!;
    expect(small.uncertainty).toBeGreaterThan(big.uncertainty);
  });

  it("high overtaking_difficulty downgrades global_confidence and adds a note", () => {
    const c = circuit({
      overtaking_difficulty: OVERTAKING_DIFFICULTY_DOWNGRADE_THRESHOLD,
      confidence: "high",
    });
    const out = predictGpAffinity(c, [car("A", 0.5, [0.5, 0.5, 0.5], "high")]);
    expect(out.global_confidence).toBe("medium");
    expect(out.notes.some((n) => /sorpasso/i.test(n))).toBe(true);
  });

  it("layout_estimate circuit adds an explanatory note", () => {
    const c = circuit({ source: "layout_estimate", confidence: "low" });
    const out = predictGpAffinity(c, [car("A", 0.5, [0.5, 0.5, 0.5], "high")]);
    expect(out.notes.some((n) => /layout/i.test(n))).toBe(true);
    expect(out.global_confidence).toBe("low");
  });

  it("teams with close scores and wide bands end up in the same indistinguishable group", () => {
    const c = circuit({ confidence: "high" });
    const out = predictGpAffinity(c, [
      car("A", 0.50, [0.50, 0.50, 0.50], "low"),
      car("B", 0.52, [0.52, 0.52, 0.52], "low"),
      car("C", 0.0, [0.0, 0.0, 0.0], "high"),
    ]);
    const group = out.indistinguishable_groups.find(
      (g) => g.includes("A") && g.includes("B"),
    );
    expect(group).toBeDefined();
    expect(group).not.toContain("C");
  });

  it("empty cars array returns safe output without throwing", () => {
    const out = predictGpAffinity(circuit(), []);
    expect(out.ranked).toEqual([]);
    expect(out.global_confidence).toBe("low");
    expect(out.indistinguishable_groups).toEqual([]);
    expect(out.notes.length).toBeGreaterThan(0);
  });



  it("uses corner_type_strength weighted by circuit per-corner weights when present", () => {
    const c = circuit({
      top_speed: 0, slow_corner_traction: 1.0, medium_corner: 0, fast_corner: 0,
    });
    const slowSpecialist: CarProfile = {
      ...car("Slow", 0.5, [0.5, 0.5, 0.5], "high"),
      corner_type_strength: { slow: 1.0, medium: 0.0, fast: 0.0 },
      corner_data_coverage: 0.8,
      corner_source: "location_geometry",
    };
    const fastSpecialist: CarProfile = {
      ...car("Fast", 0.5, [0.5, 0.5, 0.5], "high"),
      corner_type_strength: { slow: 0.0, medium: 0.0, fast: 1.0 },
      corner_data_coverage: 0.8,
      corner_source: "location_geometry",
    };
    const out = predictGpAffinity(c, [slowSpecialist, fastSpecialist], { useCircuitSpecificModel: true });
    expect(out.ranked[0].team_name).toBe("Slow");
    expect(out.ranked[0].corner_source).toBe("location_geometry");
    expect(out.ranked[0].corner_coverage).toBeCloseTo(0.8, 5);
  });

  it("falls back to sector_strength when corner_type_strength is null", () => {
    const c = circuit({ top_speed: 0, slow_corner_traction: 1, medium_corner: 0, fast_corner: 0 });
    const out = predictGpAffinity(c, [
      car("X", 0.5, [0.8, 0.8, 0.8], "high"),
    ]);
    expect(out.ranked[0].corner_source).toBe("sector_fallback");
  });

  it("emits a geometry-source note when at least one team uses location_geometry", () => {
    const c = circuit();
    const geomCar: CarProfile = {
      ...car("G", 0.5, [0.5, 0.5, 0.5], "high"),
      corner_type_strength: { slow: 0.7, medium: 0.7, fast: 0.7 },
      corner_data_coverage: 0.7,
      corner_source: "location_geometry",
    };
    const out = predictGpAffinity(c, [geomCar, car("S", 0.5, [0.5, 0.5, 0.5], "high")]);
    expect(out.notes.some((n) => /geometria del tracciato/i.test(n))).toBe(true);
  });



  // ---- Weighted-quadratic cornerWeight aggregation ----
  // For a circuit with a single dominant corner type, the weighted quadratic
  // mean Σ(wᵢ²)/Σ(wᵢ) must be strictly larger than the simple arithmetic
  // mean. Concretely Monaco-like (slow=1, medium=0.6, fast=0.15) gives
  // (1+0.36+0.0225)/1.75 ≈ 0.79 vs simple mean 0.5833.
  it("weighted-quadratic cornerWeight amplifies extreme-character circuits", () => {
    const dominant = circuit({
      top_speed: 0.2,
      slow_corner_traction: 1.0,
      medium_corner: 0.6,
      fast_corner: 0.15,
    });
    const balanced = circuit({
      top_speed: 0.2,
      slow_corner_traction: 0.583,
      medium_corner: 0.583,
      fast_corner: 0.583,
    });
    // Same car with equal top/cornering signals — the score is
    //   wTop*top + wCorner*corner = wTop*0.5 + wCorner*0.5 = 0.5
    // ONLY when top==corner. Use top≠corner so that a higher wCorner moves
    // the score toward the cornering value.
    const cars = [car("T", 0.2, [0.9, 0.9, 0.9])];
    const dom = predictGpAffinity(dominant, cars, { useCircuitSpecificModel: true }).ranked[0].affinity_score;
    const bal = predictGpAffinity(balanced, cars, { useCircuitSpecificModel: true }).ranked[0].affinity_score;
    // Dominant circuit: higher wCorner ⇒ score closer to 0.9 than balanced.
    expect(dom).toBeGreaterThan(bal);
  });

  it("weighted-quadratic equals simple mean when corner weights are equal", () => {
    const c = circuit({
      top_speed: 0.4,
      slow_corner_traction: 0.6,
      medium_corner: 0.6,
      fast_corner: 0.6,
    });
    // With equal weights the aggregate is 0.6, so wCorner = 0.6/(0.4+0.6)=0.6.
    // Score for car(top=0, corners=1) = 0.6*1 = 0.6.
    const out = predictGpAffinity(c, [car("X", 0, [1, 1, 1])], { useCircuitSpecificModel: true });
    expect(out.ranked[0].affinity_score).toBeCloseTo(0.6, 5);
  });

  it("cornerWeight handles all-zero corner weights without NaN (50/50 fallback)", () => {
    const c = circuit({
      top_speed: 0,
      slow_corner_traction: 0,
      medium_corner: 0,
      fast_corner: 0,
    });
    const out = predictGpAffinity(c, [car("Z", 0.4, [0.8, 0.8, 0.8])], { useCircuitSpecificModel: true });
    const s = out.ranked[0].affinity_score;
    expect(Number.isFinite(s)).toBe(true);
    // 50/50 fallback (legacy circuit-weighted engine): 0.5*0.4 + 0.5*0.8 = 0.6
    expect(s).toBeCloseTo(0.6, 5);
  });

  it("geometric branch still applies raw slow/medium/fast circuit weights inside cornerIdx (unchanged)", () => {
    // Sanity: the per-team cornerIdx in the geometric branch uses the RAW
    // circuit weights, not the quadratic aggregate. With slow=1,med=0,fast=0
    // and corner_type_strength={slow:1,medium:0,fast:0}, cornerIdx must be 1.
    const c = circuit({
      top_speed: 0,
      slow_corner_traction: 1,
      medium_corner: 0,
      fast_corner: 0,
    });
    const geomCar: CarProfile = {
      ...car("G", 0, [0, 0, 0]),
      corner_type_strength: { slow: 1, medium: 0, fast: 0 },
      corner_data_coverage: 0.9,
      corner_source: "location_geometry",
    };
    const out = predictGpAffinity(c, [geomCar], { useCircuitSpecificModel: true });
    // wTop=0, wCorner=1, cornerIdx=1 → score=1.
    expect(out.ranked[0].affinity_score).toBeCloseTo(1, 5);
  });

  // ---- Diagnostic coverage propagation (does NOT affect score) ----
  it("propagates corner_coverage and corner_coverage_status in the geometric branch", () => {
    const c = circuit();
    const geomCar: CarProfile = {
      ...car("G", 0.5, [0.5, 0.5, 0.5], "high"),
      corner_type_strength: { slow: 0.5, medium: 0.5, fast: 0.5 },
      corner_data_coverage: 0.73,
      corner_source: "location_geometry",
      corner_coverage_status: "ok",
    };
    const out = predictGpAffinity(c, [geomCar]);
    expect(out.ranked[0].corner_source).toBe("location_geometry");
    expect(out.ranked[0].corner_coverage).toBeCloseTo(0.73, 5);
    expect(out.ranked[0].corner_coverage_status).toBe("ok");
  });

  it("propagates measured coverage EVEN in sector_fallback (diagnostic)", () => {
    const c = circuit();
    const fallbackCar: CarProfile = {
      ...car("F", 0.5, [0.5, 0.5, 0.5], "high"),
      corner_type_strength: null,
      corner_data_coverage: 0.23,
      corner_source: "sector_fallback",
      corner_coverage_status: "below_threshold",
    };
    const out = predictGpAffinity(c, [fallbackCar]);
    expect(out.ranked[0].corner_source).toBe("sector_fallback");
    expect(out.ranked[0].corner_coverage).toBeCloseTo(0.23, 5);
    expect(out.ranked[0].corner_coverage_status).toBe("below_threshold");
  });

  it("propagates null coverage with not_available when not measurable", () => {
    const c = circuit();
    const noCovCar: CarProfile = {
      ...car("N", 0.5, [0.5, 0.5, 0.5], "high"),
      corner_data_coverage: null,
      corner_coverage_status: "not_available",
    };
    const out = predictGpAffinity(c, [noCovCar]);
    expect(out.ranked[0].corner_coverage).toBeNull();
    expect(out.ranked[0].corner_coverage_status).toBe("not_available");
  });

  it("affinity_score is invariant w.r.t. coverage / status (diagnostic-only fields)", () => {
    const c = circuit({
      top_speed: 0.4,
      slow_corner_traction: 0.6,
      medium_corner: 0.6,
      fast_corner: 0.6,
    });
    const baseCar: CarProfile = car("X", 0.7, [0.5, 0.5, 0.5], "high");
    const withLowCov: CarProfile = {
      ...baseCar,
      corner_data_coverage: 0.05,
      corner_source: "sector_fallback",
      corner_coverage_status: "below_threshold",
    };
    const withNullCov: CarProfile = {
      ...baseCar,
      corner_data_coverage: null,
      corner_coverage_status: "not_available",
    };
    const a = predictGpAffinity(c, [baseCar]).ranked[0].affinity_score;
    const b = predictGpAffinity(c, [withLowCov]).ranked[0].affinity_score;
    const d = predictGpAffinity(c, [withNullCov]).ranked[0].affinity_score;
    expect(b).toBeCloseTo(a, 10);
    expect(d).toBeCloseTo(a, 10);
  });

  it("propagates corner_coverage_curve (diagnostic) in both branches without affecting score", () => {
    const c = circuit();
    const baseCar: CarProfile = car("X", 0.7, [0.5, 0.5, 0.5], "high");
    const withCurve: CarProfile = {
      ...baseCar,
      corner_data_coverage: 0.3,
      corner_coverage_curve: 0.85,
      corner_source: "sector_fallback",
      corner_coverage_status: "below_threshold",
    };
    const withNullCurve: CarProfile = {
      ...baseCar,
      corner_data_coverage: 0.3,
      corner_coverage_curve: null,
      corner_source: "sector_fallback",
      corner_coverage_status: "below_threshold",
    };
    const baseScore = predictGpAffinity(c, [baseCar]).ranked[0].affinity_score;
    const r1 = predictGpAffinity(c, [withCurve]).ranked[0];
    const r2 = predictGpAffinity(c, [withNullCurve]).ranked[0];
    expect(r1.corner_coverage_curve).toBeCloseTo(0.85, 5);
    expect(r2.corner_coverage_curve).toBeNull();
    // Score invariance — diagnostic field never changes the result.
    expect(r1.affinity_score).toBeCloseTo(baseScore, 10);
    expect(r2.affinity_score).toBeCloseTo(baseScore, 10);
  });

  // ---- sector_typed branch (Opzione 2): stima dai settori ----
  describe("sector_typed branch (sector_corner_map)", () => {
    const monacoLikeMap = {
      s1: { slow: 0.7, medium: 0.3, fast: 0.0 },
      s2: { slow: 0.6, medium: 0.2, fast: 0.2 },
      s3: { slow: 0.8, medium: 0.2, fast: 0.0 },
    };

    it("uses sector_typed when map is present and car has no corner_type_strength", () => {
      const c = circuit({
        top_speed: 0,
        slow_corner_traction: 1.0,
        medium_corner: 0.2,
        fast_corner: 0.0,
        sector_corner_map: monacoLikeMap,
      });
      const strongInSlow = car("Slow", 0.5, [0.95, 0.95, 0.95]);
      const out = predictGpAffinity(c, [strongInSlow], { useCircuitSpecificModel: true });
      expect(out.ranked[0].corner_source).toBe("sector_typed");
      expect(out.ranked[0].affinity_score).toBeGreaterThan(0.9);
    });

    it("granularità: stessa media settori, distribuzione diversa → punteggi diversi", () => {
      const c = circuit({
        top_speed: 0,
        slow_corner_traction: 1.0,
        medium_corner: 0.2,
        fast_corner: 0.0,
        sector_corner_map: monacoLikeMap,
      });
      const A = car("FrontInSlow", 0.5, [0.5, 0.5, 0.8]);
      const B = car("FrontInFast", 0.5, [0.8, 0.5, 0.5]);
      const out = predictGpAffinity(c, [A, B], { useCircuitSpecificModel: true });
      const sA = out.ranked.find((t) => t.team_name === "FrontInSlow")!.affinity_score;
      const sB = out.ranked.find((t) => t.team_name === "FrontInFast")!.affinity_score;
      expect(sA).toBeGreaterThan(sB);
      // CONFRONTO con sector_fallback (no mappa): media piatta → punteggi uguali.
      const cFlat = circuit({
        top_speed: 0, slow_corner_traction: 1.0, medium_corner: 0.2, fast_corner: 0.0,
      });
      const outFlat = predictGpAffinity(cFlat, [A, B], { useCircuitSpecificModel: true });
      const fA = outFlat.ranked.find((t) => t.team_name === "FrontInSlow")!.affinity_score;
      const fB = outFlat.ranked.find((t) => t.team_name === "FrontInFast")!.affinity_score;
      expect(fA).toBeCloseTo(fB, 10);
      expect(outFlat.ranked[0].corner_source).toBe("sector_fallback");
    });

    it("circuito senza mappa → sector_fallback (non-regressione)", () => {
      const c = circuit({ sector_corner_map: undefined });
      const out = predictGpAffinity(c, [car("X", 0.5, [0.6, 0.6, 0.6])]);
      expect(out.ranked[0].corner_source).toBe("sector_fallback");
    });

    it("corner_type_strength reale vince sulla mappa (priorità rispettata)", () => {
      const c = circuit({
        top_speed: 0, slow_corner_traction: 1.0, medium_corner: 0, fast_corner: 0,
        sector_corner_map: monacoLikeMap,
      });
      const geomCar: CarProfile = {
        ...car("G", 0.5, [0.1, 0.1, 0.1]),
        corner_type_strength: { slow: 1.0, medium: 0, fast: 0 },
        corner_data_coverage: 0.8,
        corner_source: "location_geometry",
      };
      const out = predictGpAffinity(c, [geomCar], { useCircuitSpecificModel: true });
      expect(out.ranked[0].corner_source).toBe("location_geometry");
      expect(out.ranked[0].affinity_score).toBeCloseTo(1, 5);
    });

    it("gestisce pesi-tipo nulli (sumW=0 e weights del circuito 0) senza NaN", () => {
      const zeroMap = {
        s1: { slow: 0, medium: 0, fast: 0 },
        s2: { slow: 0, medium: 0, fast: 0 },
        s3: { slow: 0, medium: 0, fast: 0 },
      };
      const c = circuit({
        top_speed: 0, slow_corner_traction: 0, medium_corner: 0, fast_corner: 0,
        sector_corner_map: zeroMap,
      });
      const out = predictGpAffinity(c, [car("Z", 0.4, [0.8, 0.8, 0.8])]);
      const s = out.ranked[0].affinity_score;
      expect(Number.isFinite(s)).toBe(true);
      expect(out.ranked[0].corner_source).toBe("sector_typed");
    });

    it("i 3 circuiti pilota hanno sector_corner_map valida", async () => {
      const { CIRCUIT_PROFILES } = await import("../circuitProfiles");
      const pilots = [
        "Gran Premio di Monaco",
        "Gran Premio d'Italia",
        "Gran Premio di Barcellona-Catalunya",
      ];
      for (const name of pilots) {
        const p = CIRCUIT_PROFILES[name];
        expect(p.sector_corner_map).toBeDefined();
        const map = p.sector_corner_map!;
        for (const sec of ["s1", "s2", "s3"] as const) {
          const w = map[sec];
          for (const k of ["slow", "medium", "fast"] as const) {
            expect(w[k]).toBeGreaterThanOrEqual(0);
            expect(w[k]).toBeLessThanOrEqual(1);
          }
          const sum = w.slow + w.medium + w.fast;
          expect(sum).toBeGreaterThan(0.5);
          expect(sum).toBeLessThanOrEqual(1.5);
        }
      }
    });

    it("propaga sector_corner_map_confidence e corner_type_estimate su TeamGpAffinity", () => {
      const c = circuit({
        top_speed: 0,
        slow_corner_traction: 1.0,
        medium_corner: 0.5,
        fast_corner: 0.0,
        sector_corner_map: monacoLikeMap,
        sector_corner_map_confidence: "low",
      });
      const out = predictGpAffinity(c, [car("X", 0.5, [0.4, 0.6, 0.8])]);
      const r = out.ranked[0];
      expect(r.corner_source).toBe("sector_typed");
      expect(r.sector_corner_map_confidence).toBe("low");
      expect(r.corner_type_estimate).toBeDefined();
      expect(typeof r.corner_type_estimate!.slow).toBe("number");
      expect(typeof r.corner_type_estimate!.medium).toBe("number");
      expect(r.corner_type_estimate!.fast).toBeGreaterThanOrEqual(0);
    });

    it("tutti i 24 profili (22 attivi + 2 dormienti) hanno sector_corner_map con confidenza valida", async () => {
      const { CIRCUIT_PROFILES } = await import("../circuitProfiles");
      // Esclude i circuiti senza mappa (Madrid layout_estimate, Canada).
      const withMap = Object.values(CIRCUIT_PROFILES).filter((p) => p.sector_corner_map);
      expect(withMap.length).toBeGreaterThanOrEqual(22);
      for (const p of withMap) {
        expect(["high", "medium", "low"]).toContain(p.sector_corner_map_confidence);
        const map = p.sector_corner_map!;
        for (const sec of ["s1", "s2", "s3"] as const) {
          for (const k of ["slow", "medium", "fast"] as const) {
            const v = map[sec][k];
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    });

    it("Silverstone (nuovo) attiva sector_typed e differenzia distribuzioni-settore", async () => {
      const { CIRCUIT_PROFILES } = await import("../circuitProfiles");
      const silverstone = CIRCUIT_PROFILES["Gran Premio di Gran Bretagna"];
      expect(silverstone.sector_corner_map).toBeDefined();
      const A = car("StrongS2", 0.5, [0.5, 0.9, 0.5]); // forte nelle veloci (S2)
      const B = car("StrongS3", 0.5, [0.5, 0.5, 0.9]); // più bilanciato
      const out = predictGpAffinity(silverstone, [A, B], { useCircuitSpecificModel: true });
      expect(out.ranked[0].corner_source).toBe("sector_typed");
      const sA = out.ranked.find((t) => t.team_name === "StrongS2")!.affinity_score;
      const sB = out.ranked.find((t) => t.team_name === "StrongS3")!.affinity_score;
      expect(sA).not.toBeCloseTo(sB, 4);
    });
  });

  // ---- Opzione A: propagazione di sector_typed_history ----
  describe("sector_typed_history propagation (Opzione A)", () => {
    it("propaga corner_source=sector_typed_history quando il car lo dichiara", () => {
      const c = circuit({
        top_speed: 0, slow_corner_traction: 1.0, medium_corner: 0, fast_corner: 0,
      });
      const historyCar: CarProfile = {
        ...car("H", 0.5, [0.5, 0.5, 0.5]),
        corner_type_strength: { slow: 1.0, medium: 0, fast: 0 },
        corner_source: "sector_typed_history",
      };
      const out = predictGpAffinity(c, [historyCar], { useCircuitSpecificModel: true });
      expect(out.ranked[0].corner_source).toBe("sector_typed_history");
      // Il punteggio usa direttamente corner_type_strength (priorità a monte),
      // non il vecchio sector_typed a valle.
      expect(out.ranked[0].affinity_score).toBeCloseTo(1, 5);
    });

    it("sector_typed_history vince sul sector_typed a valle anche se la mappa target è presente", () => {
      const c = circuit({
        top_speed: 0, slow_corner_traction: 1.0, medium_corner: 0, fast_corner: 0,
        sector_corner_map: {
          s1: { slow: 0.7, medium: 0.3, fast: 0 },
          s2: { slow: 0.6, medium: 0.2, fast: 0.2 },
          s3: { slow: 0.8, medium: 0.2, fast: 0 },
        },
      });
      const historyCar: CarProfile = {
        ...car("H", 0.5, [0.1, 0.1, 0.1]),
        corner_type_strength: { slow: 1.0, medium: 0, fast: 0 },
        corner_source: "sector_typed_history",
      };
      const out = predictGpAffinity(c, [historyCar], { useCircuitSpecificModel: true });
      // Quando corner_type_strength è presente, il ramo a valle è bypassato.
      expect(out.ranked[0].corner_source).toBe("sector_typed_history");
      expect(out.ranked[0].affinity_score).toBeCloseTo(1, 5);
    });

    it("la nota GPS-experimental NON viene emessa per i team sector_typed_history", () => {
      const c = circuit();
      const historyCar: CarProfile = {
        ...car("H", 0.5, [0.5, 0.5, 0.5]),
        corner_type_strength: { slow: 0.7, medium: 0.7, fast: 0.7 },
        corner_source: "sector_typed_history",
      };
      const out = predictGpAffinity(c, [historyCar]);
      // L'avviso "geometria/posizione GPS" è specifico di location_geometry.
      expect(out.notes.some((n) => /geometria del tracciato/i.test(n))).toBe(false);
    });
  });
});

describe("teamBandFromSample", () => {
  it("is calibrated to the legacy step mapping at the typical-sample anchor", async () => {
    const { teamBandFromSample } = await import("../gpPrediction");
    expect(teamBandFromSample(4)).toBeCloseTo(0.12, 2);
    expect(teamBandFromSample(7)).toBeCloseTo(0.24 / Math.sqrt(7), 4);
    expect(teamBandFromSample(7)).toBeLessThan(teamBandFromSample(4));
  });

  it("clamps to [MIN, MAX] for extreme sample sizes", async () => {
    const { teamBandFromSample, TEAM_BAND_MIN, TEAM_BAND_MAX } = await import(
      "../gpPrediction"
    );
    expect(teamBandFromSample(1)).toBeLessThanOrEqual(TEAM_BAND_MAX);
    expect(teamBandFromSample(0.1)).toBeLessThanOrEqual(TEAM_BAND_MAX);
    expect(teamBandFromSample(50)).toBeGreaterThanOrEqual(TEAM_BAND_MIN);
    expect(teamBandFromSample(1000)).toBe(TEAM_BAND_MIN);
  });

  it("handles missing/zero effective sample without NaN (EFF_MIN floor)", async () => {
    const { teamBandFromSample, TEAM_BAND_K, TEAM_BAND_EFF_MIN } = await import(
      "../gpPrediction"
    );
    const expected = TEAM_BAND_K / Math.sqrt(TEAM_BAND_EFF_MIN);
    expect(teamBandFromSample(0)).toBeCloseTo(expected, 6);
    expect(Number.isFinite(teamBandFromSample(Number.NaN))).toBe(true);
    expect(Number.isFinite(teamBandFromSample(-1))).toBe(true);
  });
});






describe("OPZIONE Z — pure persistence (default production engine)", () => {
  function circ(o: Partial<CircuitProfile> = {}): CircuitProfile {
    return {
      gpName: "Z", top_speed: 0.5, slow_corner_traction: 0.5,
      medium_corner: 0.5, fast_corner: 0.5, tyre_deg: 0.5,
      overtaking_difficulty: 0.5, confidence: "high", source: "historical", ...o,
    };
  }
  function ca(name: string, top: number, s: [number, number, number]): CarProfile {
    return {
      team_name: name, top_speed_index: top,
      sector_strength: { s1: s[0], s2: s[1], s3: s[2] },
      sample_races: 4, effective_sample_races: 4, sample_laps: 200, confidence: "high",
    };
  }

  it("affinity_score equals computePersistenceScore(., PRODUCTION_PERSISTENCE_MODE)", async () => {
    const { computePersistenceScore, PRODUCTION_PERSISTENCE_MODE } = await import(
      "../gpPrediction"
    );
    const cars = [ca("A", 0.8, [0.6, 0.5, 0.7]), ca("B", 0.4, [0.4, 0.5, 0.4])];
    const out = predictGpAffinity(circ(), cars);
    for (const t of out.ranked) {
      const car = cars.find((c) => c.team_name === t.team_name)!;
      expect(t.affinity_score).toBeCloseTo(
        computePersistenceScore(car, PRODUCTION_PERSISTENCE_MODE),
        10,
      );
    }
  });

  it("production ranking matches computeBaselineOrder bit-for-bit (default = production mode)", async () => {
    const { computeBaselineOrder } = await import("../gpBacktest");
    const cars = [ca("A", 0.8, [0.6, 0.5, 0.7]), ca("B", 0.4, [0.4, 0.5, 0.4]), ca("C", 0.6, [0.6, 0.6, 0.6])];
    const out = predictGpAffinity(circ(), cars);
    // computeBaselineOrder default == PRODUCTION_PERSISTENCE_MODE ("sectors_only").
    expect(out.ranked.map((t) => t.team_name)).toEqual(computeBaselineOrder(cars));
  });

  it("score is INVARIANT w.r.t. the circuit profile (persistence ignores it)", () => {
    const car1 = ca("X", 0.7, [0.5, 0.6, 0.5]);
    const cA = circ({ top_speed: 1.0, slow_corner_traction: 0, medium_corner: 0, fast_corner: 0 });
    const cB = circ({ top_speed: 0, slow_corner_traction: 1, medium_corner: 1, fast_corner: 1 });
    const sA = predictGpAffinity(cA, [car1]).ranked[0].affinity_score;
    const sB = predictGpAffinity(cB, [car1]).ranked[0].affinity_score;
    expect(sA).toBeCloseTo(sB, 10);
  });

  it("PROMOZIONE — production = 'sectors_only': trap speed does NOT affect the score", async () => {
    const { PRODUCTION_PERSISTENCE_MODE } = await import("../gpPrediction");
    expect(PRODUCTION_PERSISTENCE_MODE).toBe("sectors_only");
    // Two cars with identical sectors but different trap → same score.
    const c = circ();
    const high = ca("HiTrap", 0.95, [0.5, 0.5, 0.5]);
    const low = ca("LoTrap", 0.05, [0.5, 0.5, 0.5]);
    const out = predictGpAffinity(c, [high, low]);
    const sHi = out.ranked.find((t) => t.team_name === "HiTrap")!.affinity_score;
    const sLo = out.ranked.find((t) => t.team_name === "LoTrap")!.affinity_score;
    expect(sHi).toBeCloseTo(0.5, 10);
    expect(sLo).toBeCloseTo(0.5, 10);
    expect(sHi).toBe(sLo);
  });

  it("PROMOZIONE — McLaren-like (low trap, strong sectors) ranks ABOVE Audi-like (high trap, weak sectors)", () => {
    const c = circ();
    const mclaren = ca("McL", 0.36, [0.85, 0.80, 0.82]);
    const audi = ca("Aud", 0.99, [0.40, 0.42, 0.41]);
    const out = predictGpAffinity(c, [mclaren, audi]);
    expect(out.ranked[0].team_name).toBe("McL");
  });

  it("PROMOZIONE — contributions: top_speed=0, cornering=sectorMean (trap excluded from score)", () => {
    const car1 = ca("Z", 0.95, [0.5, 0.6, 0.7]);
    const out = predictGpAffinity(circ(), [car1]);
    const t = out.ranked[0];
    expect(t.contributions.top_speed).toBe(0);
    expect(t.contributions.cornering).toBeCloseTo(0.6, 10);
  });

  it("flag override: useCircuitSpecificModel=true restores legacy circuit-weighted score", () => {
    const c = circ({ top_speed: 1, slow_corner_traction: 0, medium_corner: 0, fast_corner: 0 });
    const car1 = ca("F", 0.95, [0.1, 0.1, 0.1]);
    const persistence = predictGpAffinity(c, [car1]).ranked[0].affinity_score;
    const legacy = predictGpAffinity(c, [car1], { useCircuitSpecificModel: true }).ranked[0].affinity_score;
    // Persistence (sectors_only) = mean(0.1,0.1,0.1) = 0.1; legacy wTop=1 = 0.95.
    expect(persistence).toBeCloseTo(0.1, 5);
    expect(legacy).toBeCloseTo(0.95, 5);
  });

  it("USE_CIRCUIT_SPECIFIC_MODEL is false by default", async () => {
    const mod = await import("../gpPrediction");
    expect(mod.USE_CIRCUIT_SPECIFIC_MODEL).toBe(false);
  });
});

describe("computePersistenceScore — mode parameter (Opzione 1 validation)", () => {
  function ca(top: number, s: [number, number, number]) {
    return {
      top_speed_index: top,
      sector_strength: { s1: s[0], s2: s[1], s3: s[2] },
    };
  }

  it("default mode = 'top_and_sectors' (non-regression, unchanged production formula)", async () => {
    const { computePersistenceScore } = await import("../gpPrediction");
    const car = ca(0.8, [0.6, 0.5, 0.7]);
    // Default = single-arg call: identical to explicit "top_and_sectors".
    const a = computePersistenceScore(car);
    const b = computePersistenceScore(car, "top_and_sectors");
    expect(a).toBe(b);
    expect(a).toBeCloseTo((0.8 + 0.6) / 2, 10); // sectorMean = 0.6
  });

  it("'sectors_only' = mean(s1,s2,s3) and IGNORES top_speed_index", async () => {
    const { computePersistenceScore } = await import("../gpPrediction");
    const carHighTrap = ca(0.95, [0.5, 0.5, 0.5]);
    const carLowTrap = ca(0.05, [0.5, 0.5, 0.5]);
    const sH = computePersistenceScore(carHighTrap, "sectors_only");
    const sL = computePersistenceScore(carLowTrap, "sectors_only");
    expect(sH).toBeCloseTo(0.5, 10);
    expect(sL).toBeCloseTo(0.5, 10);
    expect(sH).toBe(sL);
    // For comparison, top_and_sectors DOES distinguish them.
    expect(computePersistenceScore(carHighTrap)).not.toBeCloseTo(
      computePersistenceScore(carLowTrap),
      5,
    );
  });

  it("McLaren-like case (low trap, strong sectors): sectors_only ranks it higher than top_and_sectors", async () => {
    const { computePersistenceScore } = await import("../gpPrediction");
    const mclaren = ca(0.36, [0.85, 0.80, 0.82]); // weak trap, strong sectors
    const audi = ca(0.99, [0.40, 0.42, 0.41]); // high trap, weak sectors
    // top_and_sectors: Audi wins (penalizes McLaren).
    expect(computePersistenceScore(audi)).toBeGreaterThan(computePersistenceScore(mclaren));
    // sectors_only: McLaren wins (reflects real performance, not aero choice).
    expect(computePersistenceScore(mclaren, "sectors_only")).toBeGreaterThan(
      computePersistenceScore(audi, "sectors_only"),
    );
  });
});

describe("uncertainty band — persistenza pura non usa la confidenza del circuito", () => {
  it("in modalità persistenza (default) la banda non cambia al variare di circuit.confidence", () => {
    const cars = [car("A", 0.5, [0.6, 0.6, 0.6], "medium")];
    const cHigh = circuit({ confidence: "high" });
    const cLow = circuit({ confidence: "low" });
    const uHigh = predictGpAffinity(cHigh, cars).ranked[0].uncertainty;
    const uLow = predictGpAffinity(cLow, cars).ranked[0].uncertainty;
    expect(uHigh).toBeCloseTo(uLow, 10);
  });

  it("in modalità circuit-specific la banda dipende dalla confidenza del circuito", () => {
    const cars = [car("A", 0.5, [0.6, 0.6, 0.6], "medium")];
    const cHigh = circuit({ confidence: "high" });
    const cLow = circuit({ confidence: "low" });
    const uHigh = predictGpAffinity(cHigh, cars, { useCircuitSpecificModel: true }).ranked[0].uncertainty;
    const uLow = predictGpAffinity(cLow, cars, { useCircuitSpecificModel: true }).ranked[0].uncertainty;
    expect(uLow).toBeGreaterThan(uHigh);
  });
});

describe("ranked sort — tie-break alfabetico su team_name", () => {
  it("a parità di punteggio i team sono ordinati alfabeticamente per team_name", () => {
    const c = circuit();
    // Stessi sector_strength ⇒ stesso persistence score.
    const cars = [
      car("Charlie", 0.5, [0.5, 0.5, 0.5]),
      car("Alpha", 0.5, [0.5, 0.5, 0.5]),
      car("Bravo", 0.5, [0.5, 0.5, 0.5]),
    ];
    const out = predictGpAffinity(c, cars);
    expect(out.ranked.map((r) => r.team_name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });
});


