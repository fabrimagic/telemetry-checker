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
  it("top-speed-dominant circuit rewards the team with highest top_speed_index", () => {
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
    const out = predictGpAffinity(c, cars);
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
    const out = predictGpAffinity(c, cars);
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

  it("low-confidence car has larger uncertainty than a high-confidence one", () => {
    const c = circuit();
    const out = predictGpAffinity(c, [
      car("High", 0.5, [0.5, 0.5, 0.5], "high"),
      car("Low", 0.5, [0.5, 0.5, 0.5], "low"),
    ]);
    const hi = out.ranked.find((t) => t.team_name === "High")!;
    const lo = out.ranked.find((t) => t.team_name === "Low")!;
    expect(lo.uncertainty).toBeGreaterThan(hi.uncertainty);
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
    const out = predictGpAffinity(c, [slowSpecialist, fastSpecialist]);
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
    const dom = predictGpAffinity(dominant, cars).ranked[0].affinity_score;
    const bal = predictGpAffinity(balanced, cars).ranked[0].affinity_score;
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
    const out = predictGpAffinity(c, [car("X", 0, [1, 1, 1])]);
    expect(out.ranked[0].affinity_score).toBeCloseTo(0.6, 5);
  });

  it("cornerWeight handles all-zero corner weights without NaN (50/50 fallback)", () => {
    const c = circuit({
      top_speed: 0,
      slow_corner_traction: 0,
      medium_corner: 0,
      fast_corner: 0,
    });
    const out = predictGpAffinity(c, [car("Z", 0.4, [0.8, 0.8, 0.8])]);
    const s = out.ranked[0].affinity_score;
    expect(Number.isFinite(s)).toBe(true);
    // 50/50 fallback: 0.5*0.4 + 0.5*0.8 = 0.6
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
    const out = predictGpAffinity(c, [geomCar]);
    // wTop=0, wCorner=1, cornerIdx=1 → score=1.
    expect(out.ranked[0].affinity_score).toBeCloseTo(1, 5);
  });
});


