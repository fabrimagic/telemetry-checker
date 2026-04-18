/**
 * R² threshold tightening (min_r_squared: SOFT/MEDIUM 0.10→0.25, HARD 0.12→0.30).
 *
 * Verifies that:
 *  - Below new threshold → fit INSUFFICIENT → status INVALID.
 *  - Inside the narrow POOR bucket [min_r_squared, 0.30) → POOR + positive slope → NEUTRAL.
 *  - At/above 0.30 → ACCEPTABLE bucket → VALID (when other criteria are OK).
 *  - HARD threshold (0.30) is stricter than SOFT/MEDIUM (0.25).
 *  - Boundary inclusivity at min_r_squared.
 */

import { describe, it, expect } from "vitest";
import { validateDegradationEstimate } from "../degradationValidation";
import type { DegradationResult } from "../tyreDegradation";

function buildResult(overrides: Partial<DegradationResult> = {}): DegradationResult {
  return {
    driverNumber: 16,
    acronym: "LEC",
    color: "E80020",
    stint: 1,
    compound: "MEDIUM",
    lapsUsed: 12, // > min_laps_valid for all compounds
    slopeSecPerLap: 0.05,
    intercept: 90,
    rSquared: 0.6,
    points: [],
    rmse: 0.05,
    slopeStdError: 0.01, // t-stat = 5 → no significance cap
    ...overrides,
  };
}

describe("min_r_squared thresholds — tightened", () => {
  it("1) MEDIUM, R²=0.20 → INVALID (below new 0.25 threshold)", () => {
    const r = validateDegradationEstimate(buildResult({
      compound: "MEDIUM",
      rSquared: 0.20,
    }));
    expect(r.fit_quality).toBe("INSUFFICIENT");
    expect(r.status).toBe("INVALID");
    expect(r.reason).toMatch(/Fit insufficiente/);
  });

  it("2) MEDIUM, R²=0.27 → POOR bucket → NEUTRAL (positive slope + POOR fit)", () => {
    const r = validateDegradationEstimate(buildResult({
      compound: "MEDIUM",
      rSquared: 0.27,
    }));
    expect(r.fit_quality).toBe("POOR");
    expect(r.status).toBe("NEUTRAL");
  });

  it("3) MEDIUM, R²=0.35 → ACCEPTABLE → VALID", () => {
    const r = validateDegradationEstimate(buildResult({
      compound: "MEDIUM",
      rSquared: 0.35,
    }));
    expect(r.fit_quality).toBe("ACCEPTABLE");
    expect(r.status).toBe("VALID");
  });

  it("4) HARD, R²=0.28 → INVALID (below new 0.30 HARD threshold)", () => {
    const r = validateDegradationEstimate(buildResult({
      compound: "HARD",
      lapsUsed: 14, // > min_laps_valid HARD (7)
      rSquared: 0.28,
    }));
    expect(r.fit_quality).toBe("INSUFFICIENT");
    expect(r.status).toBe("INVALID");
  });

  it("5) SOFT, R²=0.25 (boundary inclusive) → POOR → NEUTRAL (positive slope)", () => {
    const r = validateDegradationEstimate(buildResult({
      compound: "SOFT",
      lapsUsed: 10, // > min_laps_valid SOFT (5)
      rSquared: 0.25,
    }));
    expect(r.fit_quality).toBe("POOR");
    expect(r.status).toBe("NEUTRAL");
  });
});
