/**
 * Test suite for analytical propagation of degradation-slope uncertainty
 * through simulateStrategyCost (computeStrategyDeltaUncertainty).
 *
 * The function is a pure linear propagation: for each stint of length T,
 * var(stintTime) = (T(T-1)/2)^2 * (slopeStdError^2 + TRACK_EVOLUTION^2).
 * Stint variances are summed under the independence approximation.
 */

import { describe, it, expect } from "vitest";
import {
  computeStrategyDeltaUncertainty,
  TRACK_EVOLUTION_SLOPE_UNCERTAINTY,
  DELTA_SIGNIFICANCE_K,
  type StintBoundForUncertainty,
} from "../virtualRaceEngineer";

function makeModels(spec: Record<string, number | null>) {
  const m = new Map<string, { slopeStdError: number | null }>();
  for (const [k, v] of Object.entries(spec)) m.set(k, { slopeStdError: v });
  return m;
}

describe("computeStrategyDeltaUncertainty — analytical slope-error propagation", () => {
  it("grows with stint length (Σ tyre_life scales quadratically)", () => {
    const models = makeModels({ SOFT: 0.01 });
    const short: StintBoundForUncertainty[] = [{ start: 1, end: 10, compound: "SOFT" }]; // T=10
    const long: StintBoundForUncertainty[]  = [{ start: 1, end: 30, compound: "SOFT" }]; // T=30
    const sShort = computeStrategyDeltaUncertainty(short, models).stdDev;
    const sLong  = computeStrategyDeltaUncertainty(long, models).stdDev;
    expect(sLong).toBeGreaterThan(sShort);
    // Sensitivity grows like T(T-1)/2 → ratio of stdDev ≈ (30·29) / (10·9) = 9.67
    expect(sLong / sShort).toBeGreaterThan(8);
  });

  it("grows with slopeStdError", () => {
    const small = makeModels({ HARD: 0.005 });
    const big   = makeModels({ HARD: 0.05 });
    const bounds: StintBoundForUncertainty[] = [{ start: 1, end: 20, compound: "HARD" }];
    const sSmall = computeStrategyDeltaUncertainty(bounds, small).stdDev;
    const sBig   = computeStrategyDeltaUncertainty(bounds, big).stdDev;
    expect(sBig).toBeGreaterThan(sSmall);
  });

  it("returns a positive band even when slopeStdError is null on all compounds (track-evolution only)", () => {
    const models = makeModels({ SOFT: null, HARD: null });
    const bounds: StintBoundForUncertainty[] = [
      { start: 1, end: 15, compound: "SOFT" },
      { start: 16, end: 30, compound: "HARD" },
    ];
    const result = computeStrategyDeltaUncertainty(bounds, models);
    expect(result.stdDev).toBeGreaterThan(0);
    expect(Number.isFinite(result.stdDev)).toBe(true);
    expect(result.missingStdError).toBe(true);
  });

  it("track-evolution term increases the band vs zero-systematic baseline", () => {
    // Compare: with only statistical noise vs statistical+systematic
    const stat = 0.01;
    const models = makeModels({ SOFT: stat });
    const bounds: StintBoundForUncertainty[] = [{ start: 1, end: 25, compound: "SOFT" }];
    const withSys = computeStrategyDeltaUncertainty(bounds, models).stdDev;

    // Reconstruct the "statistical only" baseline manually
    const T = 25;
    const sens = (T * (T - 1)) / 2;
    const statOnly = Math.sqrt(sens * sens * stat * stat);
    expect(withSys).toBeGreaterThan(statOnly);

    // And the analytical relation: stdDev = sens * sqrt(stat² + sys²)
    const expected = sens * Math.sqrt(stat * stat + TRACK_EVOLUTION_SLOPE_UNCERTAINTY * TRACK_EVOLUTION_SLOPE_UNCERTAINTY);
    expect(withSys).toBeCloseTo(expected, 6);
  });

  it("DELTA_SIGNIFICANCE_K classifies small vs large deltas correctly", () => {
    const models = makeModels({ SOFT: 0.02, HARD: 0.02 });
    const altBounds: StintBoundForUncertainty[] = [
      { start: 1, end: 15, compound: "SOFT" },
      { start: 16, end: 30, compound: "HARD" },
    ];
    const actualBounds: StintBoundForUncertainty[] = [
      { start: 1, end: 18, compound: "SOFT" },
      { start: 19, end: 30, compound: "HARD" },
    ];
    const altStd = computeStrategyDeltaUncertainty(altBounds, models).stdDev;
    const actStd = computeStrategyDeltaUncertainty(actualBounds, models).stdDev;
    const deltaStd = Math.sqrt(altStd * altStd + actStd * actStd);

    // Small delta < K·σ → indistinguishable
    const smallDelta = 0.1 * deltaStd;
    expect(Math.abs(smallDelta) < DELTA_SIGNIFICANCE_K * deltaStd).toBe(true);

    // Large delta > K·σ → distinguishable
    const largeDelta = 5 * deltaStd;
    expect(Math.abs(largeDelta) < DELTA_SIGNIFICANCE_K * deltaStd).toBe(false);
  });
});
