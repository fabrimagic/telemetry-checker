/**
 * Unit tests for the throttle×rpm fuel estimator.
 * Covers the 6 acceptance scenarios from the task spec.
 */
import { describe, it, expect } from "vitest";
import {
  estimateLapWork,
  buildThrottleIntegralProxy,
  estimateTotalWork,
  type LapWorkEstimate,
} from "../fuelEstimator";
import type { Lap, CarData } from "../openf1";

function makeLap(lap_number: number, date_start: string | null, lap_duration = 90): Lap {
  return {
    lap_number,
    lap_duration,
    duration_sector_1: 30,
    duration_sector_2: 30,
    duration_sector_3: 30,
    st_speed: 300,
    date_start,
    is_pit_out_lap: false,
    driver_number: 1,
    session_key: 1,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
  };
}

function makeCar(date: string, throttle: number, rpm: number): CarData {
  return { date, speed: 250, throttle, brake: 0, n_gear: 7, rpm, drs: 0, driver_number: 1, session_key: 1 };
}

/** Generate dense (~3.7 Hz) carData over [startMs, endMs). */
function denseSamples(startMs: number, endMs: number, throttle: number, rpm: number): CarData[] {
  const samples: CarData[] = [];
  const stepMs = 270; // ~3.7Hz
  for (let t = startMs; t < endMs; t += stepMs) {
    samples.push(makeCar(new Date(t).toISOString(), throttle, rpm));
  }
  return samples;
}

describe("estimateLapWork", () => {
  it("empty carData → array of zeros with coverage=0", () => {
    const laps = [makeLap(1, "2024-01-01T13:00:00.000Z"), makeLap(2, "2024-01-01T13:01:30.000Z")];
    const res = estimateLapWork(laps, []);
    expect(res).toHaveLength(2);
    for (const r of res) {
      expect(r.cumulative_work).toBe(0);
      expect(r.coverage).toBe(0);
    }
  });

  it("3 synthetic laps with dense carData → cumulative_work strictly increasing", () => {
    const t0 = new Date("2024-01-01T13:00:00.000Z").getTime();
    const laps = [
      makeLap(1, new Date(t0).toISOString(), 90),
      makeLap(2, new Date(t0 + 90_000).toISOString(), 90),
      makeLap(3, new Date(t0 + 180_000).toISOString(), 90),
    ];
    // Constant throttle/rpm → equal work per lap, monotonically growing cumulative.
    const carData = denseSamples(t0, t0 + 270_000, 80, 11000);
    const res = estimateLapWork(laps, carData);
    expect(res).toHaveLength(3);
    expect(res[0].cumulative_work).toBeGreaterThan(0);
    expect(res[1].cumulative_work).toBeGreaterThan(res[0].cumulative_work);
    expect(res[2].cumulative_work).toBeGreaterThan(res[1].cumulative_work);
    // Coverage should be near 1.0 with dense samples.
    for (const r of res) {
      expect(r.coverage).toBeGreaterThan(0.8);
    }
  });

  it("gap in carData (one lap with no samples) → coverage=0 for that lap", () => {
    const t0 = new Date("2024-01-01T13:00:00.000Z").getTime();
    const laps = [
      makeLap(1, new Date(t0).toISOString(), 90),
      makeLap(2, new Date(t0 + 90_000).toISOString(), 90),
      makeLap(3, new Date(t0 + 180_000).toISOString(), 90),
    ];
    // Samples only for laps 1 and 3, none for lap 2.
    const carData = [
      ...denseSamples(t0, t0 + 90_000, 80, 11000),
      ...denseSamples(t0 + 180_000, t0 + 270_000, 80, 11000),
    ];
    const res = estimateLapWork(laps, carData);
    expect(res[0].coverage).toBeGreaterThan(0.8);
    expect(res[1].coverage).toBe(0);
    expect(res[2].coverage).toBeGreaterThan(0.8);
  });
});

describe("buildThrottleIntegralProxy", () => {
  const t0 = new Date("2024-01-01T13:00:00.000Z").getTime();
  const laps = [
    makeLap(1, new Date(t0).toISOString(), 90),
    makeLap(2, new Date(t0 + 90_000).toISOString(), 90),
    makeLap(3, new Date(t0 + 180_000).toISOString(), 90),
  ];
  const carData = denseSamples(t0, t0 + 270_000, 80, 11000);
  const lapWorkEstimates = estimateLapWork(laps, carData);
  const totalEstimated = lapWorkEstimates[2].cumulative_work * 1.5; // pretend race is 4-5 laps total

  it("valid lapWorkEstimates → proxy decreases across successive laps", () => {
    const p1 = buildThrottleIntegralProxy(laps[0], lapWorkEstimates, totalEstimated);
    const p2 = buildThrottleIntegralProxy(laps[1], lapWorkEstimates, totalEstimated);
    const p3 = buildThrottleIntegralProxy(laps[2], lapWorkEstimates, totalEstimated);
    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();
    expect(p3).not.toBeNull();
    expect(p1!).toBeGreaterThan(p2!);
    expect(p2!).toBeGreaterThan(p3!);
  });

  it("coverage < 0.5 → null", () => {
    const lowCov: LapWorkEstimate[] = [
      { lap_number: 1, cumulative_work: 100, coverage: 0.2 },
    ];
    expect(buildThrottleIntegralProxy(laps[0], lowCov, 200)).toBeNull();
  });

  it("empty lapWorkEstimates → null", () => {
    expect(buildThrottleIntegralProxy(laps[0], [], 200)).toBeNull();
  });

  it("estimateTotalWork extrapolates linearly", () => {
    const total = estimateTotalWork(lapWorkEstimates, 6);
    expect(total).not.toBeNull();
    // 3 laps' worth scaled to 6 laps ≈ 2× last cumulative.
    expect(total!).toBeCloseTo(lapWorkEstimates[2].cumulative_work * 2, 3);
  });
});
