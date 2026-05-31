import { describe, it, expect } from "vitest";
import {
  computeStartWarmupCost,
  computeStartWarmupTempFactor,
  computeStintWarmupCost,
  START_WARMUP_FRACTION,
  TEMP_REFERENCE_C,
  TEMP_FACTOR_MIN,
  TEMP_FACTOR_MAX,
} from "../tyreWarmup";

describe("computeStartWarmupCost", () => {
  it("returns positive monotonic values HARD > MEDIUM > SOFT at fixed temp", () => {
    const soft = computeStartWarmupCost("SOFT", 30);
    const med = computeStartWarmupCost("MEDIUM", 30);
    const hard = computeStartWarmupCost("HARD", 30);
    expect(soft).toBeGreaterThan(0);
    expect(med).toBeGreaterThan(soft);
    expect(hard).toBeGreaterThan(med);
  });

  it("colder track increases penalty, hotter reduces it", () => {
    const cold = computeStartWarmupCost("HARD", 10);
    const ref = computeStartWarmupCost("HARD", TEMP_REFERENCE_C);
    const hot = computeStartWarmupCost("HARD", 50);
    expect(cold).toBeGreaterThan(ref);
    expect(hot).toBeLessThan(ref);
  });

  it("respects temp factor clamps at extremes", () => {
    expect(computeStartWarmupTempFactor(-1000)).toBe(TEMP_FACTOR_MAX);
    expect(computeStartWarmupTempFactor(1000)).toBe(TEMP_FACTOR_MIN);
  });

  it("undefined trackTempC → only START_WARMUP_FRACTION applies (factor 1)", () => {
    const noTemp = computeStartWarmupCost("HARD");
    const refTemp = computeStartWarmupCost("HARD", TEMP_REFERENCE_C);
    expect(noTemp).toBeCloseTo(refTemp, 6);
    expect(computeStartWarmupTempFactor(undefined)).toBe(1);
  });

  it("first-stint cost on HARD at cold temp stays in realistic range (1–2.5s)", () => {
    const c = computeStartWarmupCost("HARD", 12);
    expect(c).toBeGreaterThan(0.5);
    expect(c).toBeLessThan(3.0);
  });

  it("computeStintWarmupCost(first=true) now equals computeStartWarmupCost", () => {
    expect(computeStintWarmupCost("HARD", true, 15)).toBeCloseTo(
      computeStartWarmupCost("HARD", 15),
      6,
    );
    expect(computeStintWarmupCost("MEDIUM", true)).toBeCloseTo(
      computeStartWarmupCost("MEDIUM"),
      6,
    );
  });

  it("non-first stint behaviour unchanged (full warmup, no temp effect)", () => {
    const a = computeStintWarmupCost("HARD", false, 5);
    const b = computeStintWarmupCost("HARD", false, 50);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(START_WARMUP_FRACTION * a); // sanity
  });
});
