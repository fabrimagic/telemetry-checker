import { describe, it, expect } from "vitest";
import {
  computeStartTractionPenalty,
  START_TRACTION_PENALTY,
  computeStartWarmupTempFactor,
} from "../tyreWarmup";

describe("Start traction / launch penalty", () => {
  it("SOFT is the reference compound (zero penalty) at any temperature", () => {
    expect(computeStartTractionPenalty("SOFT", 10)).toBe(0);
    expect(computeStartTractionPenalty("SOFT", 30)).toBe(0);
    expect(computeStartTractionPenalty("SOFT", 45)).toBe(0);
  });

  it("harder compounds cost more off the line (SOFT < MEDIUM < HARD)", () => {
    const t = 25;
    const soft = computeStartTractionPenalty("SOFT", t);
    const med = computeStartTractionPenalty("MEDIUM", t);
    const hard = computeStartTractionPenalty("HARD", t);
    expect(soft).toBeLessThan(med);
    expect(med).toBeLessThan(hard);
  });

  it("the penalty grows on a colder track (cold-track amplification)", () => {
    const cold = computeStartTractionPenalty("MEDIUM", 15);
    const warm = computeStartTractionPenalty("MEDIUM", 40);
    expect(cold).toBeGreaterThan(warm);
  });

  it("scales by exactly the shared warmup temperature factor", () => {
    const t = 18;
    const expected = START_TRACTION_PENALTY.MEDIUM * computeStartWarmupTempFactor(t);
    expect(computeStartTractionPenalty("MEDIUM", t)).toBeCloseTo(expected, 6);
  });

  it("stays a moderate pure-time term (not a multi-second standing-start gap)", () => {
    expect(computeStartTractionPenalty("MEDIUM", 5)).toBeLessThan(3.0);
    expect(computeStartTractionPenalty("HARD", 5)).toBeLessThan(6.0);
  });

  it("unknown compound contributes no penalty", () => {
    expect(computeStartTractionPenalty("INTERMEDIATE", 20)).toBe(0);
    expect(computeStartTractionPenalty("", 20)).toBe(0);
  });
});
