import { describe, it, expect } from "vitest";
import {
  computePerformanceRadar,
  buildAxisNarrative,
  buildH2HAxisNarrative,
  AXIS_LABELS,
  type RadarInputDriver,
} from "../performanceRadar";
import type { Lap } from "../openf1";
import type { LongRunResult } from "../longRunDetector";
import type { TrackStatus } from "../trackStatusClassification";

function lap(
  n: number,
  s1: number | null,
  s2: number | null,
  s3: number | null,
  trap: number | null = 320,
  opts: { is_pit_out_lap?: boolean } = {},
): Lap {
  return {
    lap_number: n,
    lap_duration: (s1 ?? 0) + (s2 ?? 0) + (s3 ?? 0) || null,
    duration_sector_1: s1,
    duration_sector_2: s2,
    duration_sector_3: s3,
    st_speed: trap,
    date_start: `2025-01-01T00:00:${String(n).padStart(2, "0")}Z`,
    is_pit_out_lap: opts.is_pit_out_lap ?? false,
    driver_number: 1,
    session_key: 1,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
  };
}

function longRun(slope: number, valid: boolean, lapsCount = 12): LongRunResult {
  return {
    driverNumber: 1,
    acronym: "AAA",
    color: "#fff",
    stintNumber: 1,
    compound: "MEDIUM",
    lapStartLongRun: 10,
    lapEndLongRun: 10 + lapsCount - 1,
    lapsCount,
    avgLapTime: 90,
    degradationSlope: slope,
    rSquared: 0.8,
    fitRobustness: "MEDIUM",
    isValidLongRun: valid,
  };
}

function makeDriver(
  driverNumber: number,
  acronym: string,
  color: string,
  laps: Lap[],
  longRuns?: LongRunResult[],
  trackStatusMap?: Map<number, TrackStatus>,
): RadarInputDriver {
  return { driverNumber, acronym, color, laps, longRuns, trackStatusMap };
}

describe("performanceRadar — axes & filters", () => {
  it("(a) excludes SC/VSC laps and per-axis outliers from aggregation", () => {
    // Driver has 6 clean laps with s1≈25.0, plus one SC lap with s1=40 (huge),
    // plus one wild outlier on s1=200. Both must be excluded.
    const laps = [
      lap(1, 25.0, 30, 28, 320),
      lap(2, 25.1, 30, 28, 321),
      lap(3, 25.0, 30, 28, 322),
      lap(4, 200.0, 30, 28, 100), // outlier (s1 and trap)
      lap(5, 24.9, 30, 28, 320),
      lap(6, 25.2, 30, 28, 320),
      lap(7, 40.0, 30, 28, 320), // SC lap → excluded by track status
      lap(8, 25.0, 30, 28, 321),
    ];
    const status = new Map<number, TrackStatus>([[7, "SC"]]);
    const driver = makeDriver(1, "AAA", "#f00", laps, [longRun(0.05, true)], status);
    const out = computePerformanceRadar([driver]);
    const s1 = out.drivers[0].axes.sector1.raw!;
    expect(s1).toBeGreaterThan(24);
    expect(s1).toBeLessThan(26); // outlier 200 and SC 40 are filtered
    // The reference equals the best aggregate (=same value here, only 1 driver).
    expect(out.reference.sector1).toBeCloseTo(s1, 5);
    // With a single driver the span is zero → score collapses to the neutral 0.5
    // and the axis is flagged negligible (no field to amplify against).
    expect(out.drivers[0].axes.sector1.score).toBeCloseTo(0.5, 5);
    expect(out.drivers[0].axes.sector1.negligible).toBe(true);
  });

  it("(b) ZOOM normalization amplifies real gaps but anti-collapses the worst", () => {
    // Two drivers: A is clearly faster in sector1 than B (1s gap > guardrail).
    const A = makeDriver(
      1, "AAA", "#f00",
      Array.from({ length: 6 }, (_, i) => lap(i + 1, 25.0, 30, 28, 330)),
      [longRun(0.05, true)],
    );
    const B = makeDriver(
      2, "BBB", "#0f0",
      Array.from({ length: 6 }, (_, i) => lap(i + 1, 26.0, 30, 28, 320)),
      [longRun(0.10, true)],
    );
    const out = computePerformanceRadar([A, B]);
    const a = out.drivers.find((d) => d.acronym === "AAA")!;
    const b = out.drivers.find((d) => d.acronym === "BBB")!;
    // best of the set → 1.0; worst is anti-collapsed at ~1/3 with margin 0.5
    expect(a.axes.sector1.score).toBeCloseTo(1, 5);
    expect(b.axes.sector1.score).toBeCloseTo(1 / 3, 3);
    expect(b.axes.sector1.score!).toBeGreaterThan(0.25);
    // trap: same anti-collapse symmetry
    expect(a.axes.trap.score).toBeCloseTo(1, 5);
    expect(b.axes.trap.score).toBeCloseTo(1 / 3, 3);
    // 1.0s sector gap and 10 km/h trap gap are well above guardrail thresholds.
    expect(a.axes.sector1.negligible).toBe(false);
    expect(b.axes.trap.negligible).toBe(false);
    // Range exposed for UI.
    expect(out.range.sector1).toEqual({ min: 25.0, max: 26.0 });
    expect(out.range.trap).toEqual({ min: 320, max: 330 });
  });

  it("(b2) ZOOM keeps very close values distinguishable, GUARDRAIL flags them negligible", () => {
    // 36.082 vs 36.086 — 4 ms gap, below the 0.05s sector guardrail.
    const A = makeDriver(
      1, "AAA", "#f00",
      Array.from({ length: 6 }, (_, i) => lap(i + 1, 36.082, 30, 28, 320)),
    );
    const B = makeDriver(
      2, "BBB", "#0f0",
      Array.from({ length: 6 }, (_, i) => lap(i + 1, 36.086, 30, 28, 320)),
    );
    const out = computePerformanceRadar([A, B]);
    const a = out.drivers[0];
    const b = out.drivers[1];
    // Distinguishable thanks to zoom: best=1.0, worst≈1/3 (not both ~1.0).
    expect(a.axes.sector1.score).toBeCloseTo(1, 5);
    expect(b.axes.sector1.score).toBeCloseTo(1 / 3, 3);
    expect(Math.abs((a.axes.sector1.score ?? 0) - (b.axes.sector1.score ?? 0))).toBeGreaterThan(0.3);
    // But the guardrail honestly flags both axes as negligible (Δ < 0.05s).
    expect(a.axes.sector1.negligible).toBe(true);
    expect(b.axes.sector1.negligible).toBe(true);
    const narrative = buildH2HAxisNarrative(a, b);
    expect(narrative.sector1.toLowerCase()).toContain("pari");
  });

  it("(d) span ≈ 0 (equal values) → score ~0.5 for all + negligible", () => {
    const A = makeDriver(
      1, "AAA", "#f00",
      Array.from({ length: 6 }, (_, i) => lap(i + 1, 25.0, 30, 28, 320)),
    );
    const B = makeDriver(
      2, "BBB", "#0f0",
      Array.from({ length: 6 }, (_, i) => lap(i + 1, 25.0, 30, 28, 320)),
    );
    const out = computePerformanceRadar([A, B]);
    out.drivers.forEach((d) => {
      expect(d.axes.sector1.score).toBeCloseTo(0.5, 5);
      expect(d.axes.trap.score).toBeCloseTo(0.5, 5);
      expect(d.axes.sector1.negligible).toBe(true);
      expect(d.axes.trap.negligible).toBe(true);
    });
  });

  it("(c) degradation axis is 'non disponibile' (null) when no validated long run", () => {
    const laps = Array.from({ length: 6 }, (_, i) => lap(i + 1, 25, 30, 28, 320));
    const driverNoVal = makeDriver(1, "AAA", "#f00", laps, [longRun(0.2, false)]);
    const driverNoLR = makeDriver(2, "BBB", "#0f0", laps, []);
    const out = computePerformanceRadar([driverNoVal, driverNoLR]);
    out.drivers.forEach((d) => {
      expect(d.axes.degradation.raw).toBeNull();
      expect(d.axes.degradation.score).toBeNull();
      expect(d.axes.degradation.note?.toLowerCase()).toContain("non");
    });
  });

  it("(d) trap axis is honestly labelled with aero/setup caveat", () => {
    const laps = Array.from({ length: 6 }, (_, i) => lap(i + 1, 25, 30, 28, 320));
    const out = computePerformanceRadar([makeDriver(1, "AAA", "#f00", laps)]);
    expect(AXIS_LABELS.trap).toMatch(/Velocità massima rilevata.*trap/i);
    const note = out.drivers[0].axes.trap.note!;
    expect(note).toMatch(/assetto/i);
  });

  it("(e) H2H: both drivers normalized on the same reference + comparative narrative", () => {
    const A = makeDriver(
      1, "AAA", "#f00",
      Array.from({ length: 6 }, (_, i) => lap(i + 1, 25.0, 30, 28, 330)),
      [longRun(0.05, true)],
    );
    const B = makeDriver(
      2, "BBB", "#0f0",
      Array.from({ length: 6 }, (_, i) => lap(i + 1, 26.0, 30, 28, 320)),
      [longRun(0.20, true)],
    );
    const out = computePerformanceRadar([A, B]);
    expect(out.drivers).toHaveLength(2);
    const a = out.drivers[0];
    const b = out.drivers[1];
    const narrative = buildH2HAxisNarrative(a, b);
    expect(narrative.sector1).toMatch(/AAA/);
    expect(narrative.sector1).toMatch(/BBB/);
    expect(narrative.sector1.toLowerCase()).toContain("migliore");
    expect(narrative.trap.toLowerCase()).toContain("ala");
    expect(narrative.degradation.toLowerCase()).toContain("degrado");
  });

  it("(f) robustness: missing sector data / few laps / no degradation → no crash, axes honestly null", () => {
    // 2 clean laps (below MIN_SECTOR_SAMPLES=3), sector3 always null.
    const laps = [
      lap(1, 25.0, 30, null, null),
      lap(2, 25.1, null, null, 320),
    ];
    const out = computePerformanceRadar([makeDriver(1, "AAA", "#f00", laps)]);
    const d = out.drivers[0];
    expect(d.axes.sector3.raw).toBeNull();
    expect(d.axes.sector3.score).toBeNull();
    expect(d.axes.sector1.raw).toBeNull(); // only 2 samples
    expect(d.axes.degradation.raw).toBeNull();
    // narrative still works
    const n = buildAxisNarrative(d);
    expect(n.sector3.toLowerCase()).toContain("insufficient");
  });

  it("excludes out-laps and pit-in laps", () => {
    const laps = [
      lap(1, 28.0, 30, 28, 320, { is_pit_out_lap: true }), // out lap excluded
      lap(2, 25.0, 30, 28, 320),
      lap(3, 25.1, 30, 28, 321),
      lap(4, 25.0, 30, 28, 322),
      lap(5, 25.2, 30, 28, 320),
      lap(6, 35.0, 30, 28, 320), // pit-in lap, excluded
      lap(7, 25.0, 30, 28, 320),
    ];
    const driver: RadarInputDriver = {
      driverNumber: 1, acronym: "AAA", color: "#f00", laps,
      pitInLaps: [6],
    };
    const out = computePerformanceRadar([driver]);
    const s1 = out.drivers[0].axes.sector1.raw!;
    expect(s1).toBeGreaterThan(24);
    expect(s1).toBeLessThan(26);
  });
});
