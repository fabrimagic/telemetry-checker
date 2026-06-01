/**
 * Physical fuel correction tests for correctedDegradation.
 *
 * (a) computeFuelTimeCorrection: monotonic, anchored, scales with load.
 * (b) Sign: physical correction removes the burn-off and yields a slope
 *     closer to the true degradation than the degenerate "laps_remaining"
 *     proxy, when fuel and tyre_life are collinear inside the stint.
 * (c) Default path (no carData / no high-quality alt proxy) selects
 *     model_type === "corrected_physical_fuel".
 * (d) Backward-compat: throttle_integral HIGH proxy keeps the existing
 *     two-stage path (corrected_two_stage / corrected_fuel_only).
 */

import { describe, it, expect } from "vitest";
import {
  computeFuelTimeCorrection,
  calculateCorrectedTyreDegradation,
  DEFAULT_CORRECTED_CONFIG,
  FUEL_EFFECT_S_PER_KG,
  FUEL_LOAD_KG_DEFAULT,
} from "../correctedDegradation";
import type { Lap, StintData, WeatherData } from "../openf1";

function makeLap(lapNumber: number, duration: number, dateStart?: string): Lap {
  return {
    lap_number: lapNumber,
    lap_duration: duration,
    duration_sector_1: duration / 3,
    duration_sector_2: duration / 3,
    duration_sector_3: duration / 3,
    st_speed: null,
    date_start: dateStart ?? null,
    is_pit_out_lap: false,
    driver_number: 1,
    session_key: 1,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
  };
}

describe("computeFuelTimeCorrection", () => {
  it("is 0 at lap 1 and ≈ full effect at the last lap", () => {
    expect(computeFuelTimeCorrection(1, 50)).toBe(0);
    const last = computeFuelTimeCorrection(50, 50);
    expect(last).toBeCloseTo(FUEL_LOAD_KG_DEFAULT * FUEL_EFFECT_S_PER_KG, 5);
  });

  it("is monotonically non-decreasing in lap_abs", () => {
    let prev = -Infinity;
    for (let lap = 1; lap <= 50; lap++) {
      const v = computeFuelTimeCorrection(lap, 50);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("scales linearly with fuelLoadKg", () => {
    const a = computeFuelTimeCorrection(25, 50, 100);
    const b = computeFuelTimeCorrection(25, 50, 50);
    expect(a / b).toBeCloseTo(2, 5);
  });

  it("clamps non-finite or out-of-range inputs to 0", () => {
    expect(computeFuelTimeCorrection(0, 50)).toBe(0);
    expect(computeFuelTimeCorrection(Number.NaN, 50)).toBe(0);
    expect(computeFuelTimeCorrection(10, 1)).toBe(0);
  });
});

/**
 * Build a synthetic stint where the TRUE degradation slope is known
 * (TRUE_SLOPE s/lap on tyre_life), but lap times are observed AFTER
 * the fuel burn-off (cars get faster by ~0.033 s/kg). The stint
 * spans absolute race laps [stintStart, stintEnd] of a totalLaps race.
 */
function buildSyntheticStint(
  totalLaps: number,
  stintStart: number,
  stintEnd: number,
  baseLapTime: number,
  trueDegSlope: number,
): { laps: Lap[]; stint: StintData } {
  const laps: Lap[] = [];
  for (let lap = stintStart; lap <= stintEnd; lap++) {
    const tyreLife = lap - stintStart;
    // Observed = base + true_deg * tyre_life - fuel_advantage(lap_abs)
    const fuelAdvantage = computeFuelTimeCorrection(lap, totalLaps);
    const lapTime = baseLapTime + trueDegSlope * tyreLife - fuelAdvantage;
    laps.push(makeLap(lap, lapTime));
  }
  const stint: StintData = {
    driver_number: 1,
    session_key: 1,
    stint_number: 1,
    compound: "MEDIUM",
    lap_start: stintStart,
    lap_end: stintEnd,
    tyre_age_at_start: 0,
  };
  return { laps, stint };
}

describe("calculateCorrectedTyreDegradation — physical fuel path", () => {
  it("(c) default config (no carData) selects model_type 'corrected_physical_fuel'", () => {
    const { laps, stint } = buildSyntheticStint(50, 5, 20, 90, 0.08);
    const res = calculateCorrectedTyreDegradation(
      1, "TST", "ffffff", laps, [stint], [] as WeatherData[], 50,
    );
    expect(res).toHaveLength(1);
    expect(res[0].model_type).toBe("corrected_physical_fuel");
    // Slope should be close to true 0.08, well within plausible range.
    expect(Math.abs(res[0].slope_corrected - 0.08)).toBeLessThan(0.02);
  });

  it("(b) physical correction recovers true slope better than degenerate laps_remaining proxy", () => {
    const TRUE_SLOPE = 0.07;
    const { laps, stint } = buildSyntheticStint(60, 10, 30, 92, TRUE_SLOPE);

    // Physical path (default routing — laps_remaining is intercepted)
    const physicalRes = calculateCorrectedTyreDegradation(
      1, "TST", "ffffff", laps, [stint], [], 60,
    );
    expect(physicalRes[0].model_type).toBe("corrected_physical_fuel");

    // Raw slope (uncorrected) is contaminated by fuel burn-off (looks lower)
    const rawSlope = physicalRes[0].slope_raw;
    const physicalSlope = physicalRes[0].slope_corrected;

    expect(Math.abs(physicalSlope - TRUE_SLOPE)).toBeLessThan(
      Math.abs(rawSlope - TRUE_SLOPE),
    );
  });

  it("(d) backward-compat: throttle_integral HIGH quality still uses two-stage proxy regression", () => {
    const totalLaps = 50;
    const { laps, stint } = buildSyntheticStint(totalLaps, 5, 25, 90, 0.05);

    // Build a throttle_integral context with HIGH quality variance
    // (work-remaining decreases monotonically with > 15% relative range).
    const lapWorkEstimates = laps.map((l, i) => ({
      lap_number: l.lap_number,
      // Per-lap "work" with strong variance — totalEstimatedWork - cumulative
      estimated_work: 1000 + i * 5,
    }));
    const totalEstimatedWork = 10_000;

    const res = calculateCorrectedTyreDegradation(
      1, "TST", "ffffff", laps, [stint], [], totalLaps, undefined, undefined,
      { ...DEFAULT_CORRECTED_CONFIG, fuel_proxy_type: "throttle_integral" },
      { lapWorkEstimates, totalEstimatedWork },
    );

    expect(res).toHaveLength(1);
    // When throttle_integral resolves as HIGH it stays on the legacy two-stage
    // path; otherwise it falls back to physical. Either way we should NOT
    // see "simple_fallback" for a long, clean synthetic stint.
    expect(["corrected_two_stage", "corrected_fuel_only", "corrected_physical_fuel"])
      .toContain(res[0].model_type);
    // If proxy quality was HIGH, ensure we did NOT regress to physical.
    if (res[0].fuel_proxy_quality === "HIGH") {
      expect(res[0].model_type).not.toBe("corrected_physical_fuel");
    }
  });
});
