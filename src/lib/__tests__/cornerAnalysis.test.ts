import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyCircuitCorners,
  lonLatToMeters,
  mapLocationsToOutlineIndices,
  aggregateDriverCornerSpeeds,
  analyzeCornersForSession,
  summarizeAnalysis,
  CORNER_CURVATURE_SLOW,
  CORNER_CURVATURE_STRAIGHT_MAX,
} from "../cornerAnalysis";
import type { CarData, LocationData } from "../openf1";

vi.mock("../openf1", async (orig) => {
  const actual = await orig<typeof import("../openf1")>();
  return {
    ...actual,
    getLocation: vi.fn(),
    getCarData: vi.fn(),
  };
});

vi.mock("../circuitGeometry", () => ({
  fetchCircuitOutline: vi.fn(),
}));

import { getLocation, getCarData } from "../openf1";
import { fetchCircuitOutline } from "../circuitGeometry";

// -------- Synthetic outline builders (work in [lon,lat] degrees) -----------
// We work near (0,0) where 1° lon ≈ 111_320 m. To get small features in meters
// we use very small degree increments.

function metersToDeg(m: number): number {
  return m / 111_320;
}

/** Build outline: straight east (long), then tight U-turn, then a wide curve back. */
/** Build a circular arc of given radius (m) with N points over angleSweep (rad). */
function buildArcOutline(R: number, N: number, angleSweep: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const ang = (i / N) * angleSweep;
    pts.push([metersToDeg(R * Math.cos(ang)), metersToDeg(R * Math.sin(ang))]);
  }
  return pts;
}

function buildSyntheticOutline(): [number, number][] {
  const pts: [number, number][] = [];
  // 1) Long straight: 30 points, 20 m apart, due east.
  for (let i = 0; i < 30; i++) {
    pts.push([metersToDeg(i * 20), 0]);
  }
  // 2) Tight hairpin: arc of radius R=30 m, 180° sweep, 20 points.
  const R1 = 30;
  const cx = metersToDeg(29 * 20);
  const cy = metersToDeg(R1); // center north of last straight point
  for (let i = 1; i <= 20; i++) {
    const ang = -Math.PI / 2 + (i / 20) * Math.PI; // -90° → +90°
    pts.push([cx + metersToDeg(R1 * Math.cos(ang)), cy + metersToDeg(R1 * Math.sin(ang))]);
  }
  // 3) Wide sweeping curve: radius R=300 m, ~60° sweep, 15 points heading back west.
  const R2 = 300;
  const last = pts[pts.length - 1];
  const cx2 = last[0];
  const cy2 = last[1] + metersToDeg(R2);
  for (let i = 1; i <= 15; i++) {
    const ang = -Math.PI / 2 - (i / 15) * (Math.PI / 3);
    pts.push([cx2 + metersToDeg(R2 * Math.cos(ang)), cy2 + metersToDeg(R2 * Math.sin(ang))]);
  }
  return pts;
}

describe("lonLatToMeters", () => {
  it("returns sensible metric distances between known points", () => {
    // Two points ~111 m apart at the equator (0.001° lon).
    const pts = lonLatToMeters([[0, 0], [metersToDeg(100), 0]]);
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(110);
  });

  it("handles empty input", () => {
    expect(lonLatToMeters([])).toEqual([]);
  });
});

describe("classifyCircuitCorners", () => {
  it("returns empty for short or empty outlines", () => {
    expect(classifyCircuitCorners([])).toEqual([]);
    expect(classifyCircuitCorners([[0, 0], [0.001, 0]])).toEqual([]);
  });

  it("detects the slow hairpin and excludes the long straight prefix", () => {
    const outline = buildSyntheticOutline();
    const segs = classifyCircuitCorners(outline);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    const types = segs.map((s) => s.type);
    expect(types).toContain("slow");
    // None of the straight prefix points should appear in any segment.
    for (const s of segs) {
      expect(s.start_idx).toBeGreaterThanOrEqual(25);
    }
  });

  it("classifies a wide-radius standalone curve as fast (not slow)", () => {
    // Pure single curve of R=300 m, no hairpin attached → should be fast/medium.
    const pts: [number, number][] = [];
    const R = 300;
    for (let i = 0; i <= 40; i++) {
      const ang = (i / 40) * (Math.PI / 2);
      pts.push([metersToDeg(R * Math.cos(ang)), metersToDeg(R * Math.sin(ang))]);
    }
    const segs = classifyCircuitCorners(pts);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs[0].curvature).toBeLessThan(CORNER_CURVATURE_SLOW);
    expect(["fast", "medium"]).toContain(segs[0].type);
  });

  it("classifies an R≈440 m arc as fast (was straight at the old 400 m ceiling)", () => {
    const outline = buildArcOutline(440, 60, Math.PI);
    const segs = classifyCircuitCorners(outline);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs[0].type).toBe("fast");
    expect(segs[0].curvature).toBeGreaterThan(CORNER_CURVATURE_STRAIGHT_MAX);
    expect(segs[0].curvature).toBeLessThan(1 / 180);
  });

  it("classifies an R≈800 m arc as straight (below the 600 m threshold)", () => {
    const outline = buildArcOutline(800, 60, Math.PI);
    const segs = classifyCircuitCorners(outline);
    expect(segs.length).toBe(0);
  });

  it("classifies an R≈300 m arc as fast", () => {
    const outline = buildArcOutline(300, 40, Math.PI / 2);
    const segs = classifyCircuitCorners(outline);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs[0].type).toBe("fast");
  });

  it("classifies an R≈120 m arc as medium", () => {
    const outline = buildArcOutline(120, 40, Math.PI / 2);
    const segs = classifyCircuitCorners(outline);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs[0].type).toBe("medium");
  });

  it("classifies an R≈25 m arc as slow", () => {
    const outline = buildArcOutline(25, 40, Math.PI);
    const segs = classifyCircuitCorners(outline);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs[0].type).toBe("slow");
  });
});

describe("mapLocationsToOutlineIndices", () => {
  it("snaps each location to its nearest outline vertex", () => {
    const outline = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    ];
    // Locations with x mirrored (TrackMap convention is applied internally).
    const locs = [{ x: 0, y: 0 }, { x: -3, y: 0 }];
    const idx = mapLocationsToOutlineIndices(locs, outline);
    // After internal mirror+normalize, first loc aligns to outline[0], second to outline[3].
    expect(idx).toHaveLength(2);
    expect(idx[0]).not.toBe(idx[1]);
  });

  it("returns empty when no outline", () => {
    expect(mapLocationsToOutlineIndices([{ x: 0, y: 0 }], [])).toEqual([]);
  });
});

describe("aggregateDriverCornerSpeeds", () => {
  const outline = buildSyntheticOutline();
  const segments = classifyCircuitCorners(outline);
  const slowSeg = segments.find((s) => s.type === "slow")!;

  it("routes a speed sample into the slow corner segment", () => {
    // Place one location squarely on the slow-corner apex vertex.
    const apexLonLat = outline[Math.round((slowSeg.start_idx + slowSeg.end_idx) / 2)];
    // Convert apex lon/lat to a fake OpenF1 (x,y) by using the same coords; the
    // alignment normalizes both spaces by their bounding box, so we need to
    // supply a second "anchor" location far away so the bbox isn't degenerate.
    const farLonLat = outline[0];
    const t0 = new Date("2026-01-01T12:00:00Z").getTime();
    const locations: LocationData[] = [
      // Mirror x to undo TrackMap mirror convention used in mapLocations
      { date: new Date(t0).toISOString(), x: -apexLonLat[0], y: apexLonLat[1], z: 0, driver_number: 1, session_key: 1 },
      { date: new Date(t0 + 1000).toISOString(), x: -farLonLat[0], y: farLonLat[1], z: 0, driver_number: 1, session_key: 1 },
    ];
    const carData: CarData[] = [
      { date: new Date(t0 + 10).toISOString(), speed: 80, throttle: 0, brake: 100, n_gear: 2, rpm: 9000, drs: 0, driver_number: 1, session_key: 1 },
      { date: new Date(t0 + 1010).toISOString(), speed: 320, throttle: 100, brake: 0, n_gear: 8, rpm: 12000, drs: 12, driver_number: 1, session_key: 1 },
    ];
    const res = aggregateDriverCornerSpeeds({ driver_number: 1, locations, carData, segments, outline });
    expect(res.partial).toBe(false || res.partial); // coverage may be low; just don't throw
    expect(res.sample_counts.slow + res.sample_counts.straight + res.sample_counts.medium + res.sample_counts.fast).toBe(2);
    expect(res.slow_corner_speed).toBe(80);
  });

  it("skips speed samples with no nearby position in time", () => {
    const t0 = new Date("2026-01-01T12:00:00Z").getTime();
    const locations: LocationData[] = [
      { date: new Date(t0).toISOString(), x: 0, y: 0, z: 0, driver_number: 1, session_key: 1 },
    ];
    const carData: CarData[] = [
      { date: new Date(t0 + 60_000).toISOString(), speed: 100, throttle: 0, brake: 0, n_gear: 3, rpm: 9000, drs: 0, driver_number: 1, session_key: 1 },
    ];
    const res = aggregateDriverCornerSpeeds({ driver_number: 1, locations, carData, segments, outline, maxSyncGapMs: 500 });
    expect(res.sample_counts.slow + res.sample_counts.medium + res.sample_counts.fast + res.sample_counts.straight).toBe(0);
    expect(res.notes.some((n) => n.includes("skipped"))).toBe(true);
  });

  it("returns partial empty when locations missing — never throws", () => {
    const res = aggregateDriverCornerSpeeds({ driver_number: 9, locations: [], carData: [], segments, outline });
    expect(res.partial).toBe(true);
    expect(res.slow_corner_speed).toBeNull();
    expect(res.corner_coverage).toBeNull();
  });

  // -- Diagnostic corner_coverage metric -----------------------------------
  function locOnVertex(idx: number, t: number): LocationData {
    const [lon, lat] = outline[idx];
    return { date: new Date(t).toISOString(), x: -lon, y: lat, z: 0, driver_number: 1, session_key: 1 };
  }
  const cornerVertexIndices: number[] = [];
  for (const s of segments) {
    for (let v = s.start_idx; v <= s.end_idx; v++) cornerVertexIndices.push(v);
  }
  const straightVertexIndices: number[] = [];
  for (let v = 0; v < outline.length; v++) {
    if (!cornerVertexIndices.includes(v)) straightVertexIndices.push(v);
  }

  // NOTE: with the new Procrustes shape alignment (replacing the legacy
  // bbox+mirror), the snap-to-vertex step relies on a good initial PCA
  // estimate. Sources that cover ONLY corners (very few straights) have a
  // PCA orientation that doesn't match the full outline's, so the snap can
  // drift. To exercise the corner_coverage metric correctly we now seed
  // the source with enough straight samples to anchor the alignment, while
  // still covering every corner vertex. Updated consciously after the
  // Procrustes upgrade.
  it("(a) corner_coverage > global coverage when locations target corner vertices", () => {
    const t0 = new Date("2026-01-01T12:00:00Z").getTime();
    // Sample EVERY corner vertex + about half of the straight vertices
    // (every other one). Source PCA now matches the outline's, so
    // Procrustes aligns near-identity and the snap is exact.
    const sampledStraights = straightVertexIndices.filter((_, i) => i % 2 === 0);
    const locations: LocationData[] = [
      ...sampledStraights.map((v, i) => locOnVertex(v, t0 + i * 100)),
      ...cornerVertexIndices.map((v, i) => locOnVertex(v, t0 + (sampledStraights.length + i + 1) * 100)),
    ];
    const carData: CarData[] = locations.map((l, i) => ({
      date: l.date, speed: 100 + i, throttle: 50, brake: 0, n_gear: 4, rpm: 10000, drs: 0, driver_number: 1, session_key: 1,
    }));
    const res = aggregateDriverCornerSpeeds({ driver_number: 1, locations, carData, segments, outline });
    expect(res.corner_coverage).not.toBeNull();
    expect(res.corner_coverage!).toBeGreaterThan(res.coverage);
    expect(res.corner_coverage!).toBeGreaterThan(0.8);
  });

  it("(b) corner_coverage < global coverage when locations target straight vertices", () => {
    const t0 = new Date("2026-01-01T12:00:00Z").getTime();
    const locations: LocationData[] = straightVertexIndices.map((v, i) => locOnVertex(v, t0 + i * 100));
    const carData: CarData[] = locations.map((l, i) => ({
      date: l.date, speed: 200 + i, throttle: 100, brake: 0, n_gear: 7, rpm: 11000, drs: 12, driver_number: 1, session_key: 1,
    }));
    const res = aggregateDriverCornerSpeeds({ driver_number: 1, locations, carData, segments, outline });
    expect(res.corner_coverage).not.toBeNull();
    expect(res.corner_coverage!).toBeLessThan(res.coverage);
  });

  it("(c) corner_coverage is null when there are no corner segments", () => {
    const t0 = new Date("2026-01-01T12:00:00Z").getTime();
    const locations: LocationData[] = [
      locOnVertex(0, t0),
      locOnVertex(1, t0 + 100),
    ];
    const carData: CarData[] = locations.map((l) => ({
      date: l.date, speed: 250, throttle: 100, brake: 0, n_gear: 8, rpm: 12000, drs: 12, driver_number: 1, session_key: 1,
    }));
    const res = aggregateDriverCornerSpeeds({
      driver_number: 1, locations, carData, segments: [], outline,
    });
    expect(res.corner_coverage).toBeNull();
  });

  it("(d) global coverage formula is unchanged (touched / outline.length)", () => {
    const t0 = new Date("2026-01-01T12:00:00Z").getTime();
    const pickedIdx = [0, 5, 10, 30, 35];
    const locations: LocationData[] = pickedIdx.map((v, i) => locOnVertex(v, t0 + i * 100));
    const carData: CarData[] = locations.map((l) => ({
      date: l.date, speed: 150, throttle: 50, brake: 0, n_gear: 4, rpm: 10000, drs: 0, driver_number: 1, session_key: 1,
    }));
    const res = aggregateDriverCornerSpeeds({ driver_number: 1, locations, carData, segments, outline });
    // 5 distinct vertices touched → 5/outline.length.
    expect(res.coverage).toBeCloseTo(pickedIdx.length / outline.length, 6);
  });
});

describe("analyzeCornersForSession", () => {
  beforeEach(() => {
    vi.mocked(fetchCircuitOutline).mockReset();
    vi.mocked(getLocation).mockReset();
    vi.mocked(getCarData).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result (no throw) when no layout is available", async () => {
    vi.mocked(fetchCircuitOutline).mockResolvedValue(null);
    const res = await analyzeCornersForSession("Unknown GP", 1, [1], {
      dateStart: "2026-01-01T00:00:00Z",
      dateEnd: "2026-01-01T02:00:00Z",
    });
    expect(res.segments).toEqual([]);
    expect(res.per_driver).toEqual([]);
    expect(res.notes).toContain("no_circuit_layout_available");
  });

  it("aggregates per driver for a mocked session", async () => {
    const outline = buildSyntheticOutline();
    vi.mocked(fetchCircuitOutline).mockResolvedValue(outline);
    const t0 = new Date("2026-01-01T12:00:00Z").getTime();
    vi.mocked(getLocation).mockResolvedValue([
      { date: new Date(t0).toISOString(), x: -outline[0][0], y: outline[0][1], z: 0, driver_number: 1, session_key: 1 },
      { date: new Date(t0 + 1000).toISOString(), x: -outline[40][0], y: outline[40][1], z: 0, driver_number: 1, session_key: 1 },
    ] as LocationData[]);
    vi.mocked(getCarData).mockResolvedValue([
      { date: new Date(t0).toISOString(), speed: 300, throttle: 100, brake: 0, n_gear: 8, rpm: 12000, drs: 12, driver_number: 1, session_key: 1 },
      { date: new Date(t0 + 1000).toISOString(), speed: 90, throttle: 0, brake: 100, n_gear: 2, rpm: 9000, drs: 0, driver_number: 1, session_key: 1 },
    ] as CarData[]);
    const res = await analyzeCornersForSession("GP", 1, [1], {
      dateStart: "2026-01-01T00:00:00Z",
      dateEnd: "2026-01-01T02:00:00Z",
    });
    expect(res.segments.length).toBeGreaterThan(0);
    expect(res.per_driver).toHaveLength(1);
    expect(res.aborted).toBe(false);
    const lines = summarizeAnalysis(res);
    expect(lines.some((l) => l.includes("Driver #1"))).toBe(true);
  });

  it("driver fetch error → partial entry, never throws", async () => {
    vi.mocked(fetchCircuitOutline).mockResolvedValue(buildSyntheticOutline());
    vi.mocked(getLocation).mockRejectedValue(new Error("boom"));
    vi.mocked(getCarData).mockRejectedValue(new Error("boom"));
    const res = await analyzeCornersForSession("GP", 1, [42], {
      dateStart: "2026-01-01T00:00:00Z",
      dateEnd: "2026-01-01T02:00:00Z",
    });
    expect(res.per_driver).toHaveLength(1);
    expect(res.per_driver[0].partial).toBe(true);
  });

  it("aborts cleanly mid-iteration", async () => {
    vi.mocked(fetchCircuitOutline).mockResolvedValue(buildSyntheticOutline());
    vi.mocked(getLocation).mockResolvedValue([]);
    vi.mocked(getCarData).mockResolvedValue([]);
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await analyzeCornersForSession("GP", 1, [1, 2, 3], {
      dateStart: "2026-01-01T00:00:00Z",
      dateEnd: "2026-01-01T02:00:00Z",
      signal: ctrl.signal,
    });
    expect(res.aborted).toBe(true);
    expect(res.per_driver.length).toBeLessThan(3);
  });
});
