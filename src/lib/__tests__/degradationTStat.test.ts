/**
 * T-stat statistical-significance check in degradationValidation.
 * Verifies that:
 *  - High t-stat (|slope|/stdErr ≥ profile.min_t_stat_valid) does NOT cap status.
 *  - Low t-stat caps a would-be VALID at NEUTRAL.
 *  - Missing stdError (null) is treated as "not enough info" → no cap (backward-compat).
 *  - slope === 0 → t=0 → cap at NEUTRAL (also coherent with neutral_tolerance).
 *  - Corrected results prefer slope_corrected_std_error over raw slopeStdError.
 *  - simpleLinearRegression now returns slopeStdError > 0 for n ≥ 3.
 */

import { describe, it, expect } from "vitest";
import { validateDegradationEstimate } from "../degradationValidation";
import type { DegradationResult } from "../tyreDegradation";
import type { CorrectedDegradationResult } from "../correctedDegradation";

/* ── Helpers ───────────────────────────────────────────────────── */

function buildSimpleResult(overrides: Partial<DegradationResult> = {}): DegradationResult {
  return {
    driverNumber: 16,
    acronym: "LEC",
    color: "E80020",
    stint: 1,
    compound: "MEDIUM",
    lapsUsed: 12, // > min_laps_valid (6) for MEDIUM
    slopeSecPerLap: 0.05,
    intercept: 90,
    rSquared: 0.6,
    points: [],
    rmse: 0.05,
    slopeStdError: 0.01, // t = 5 by default
    ...overrides,
  };
}

function buildCorrectedResult(
  overrides: Partial<CorrectedDegradationResult> = {},
): CorrectedDegradationResult {
  return {
    ...buildSimpleResult(),
    model_type: "corrected_two_stage",
    slope_raw: 0.05,
    slope_corrected: 0.05,
    fuel_proxy_type: "laps_remaining",
    weather_correction_used: true,
    coefficients: {
      intercept: 90,
      tyre_life: 0.05,
      fuel_proxy: -0.01,
      track_temp: 0.001,
      air_temp: 0.001,
    },
    r_squared_corrected: 0.6,
    r_squared_stage_a: 0.5,
    slope_corrected_std_error: 0.01,
    ...overrides,
  };
}

/* ── Tests ─────────────────────────────────────────────────────── */

describe("validateDegradationEstimate — t-stat significance check", () => {
  it("1) high t-stat (slope=0.05, stdErr=0.01 → t=5) keeps VALID", () => {
    const r = validateDegradationEstimate(buildSimpleResult({
      slopeSecPerLap: 0.05,
      slopeStdError: 0.01,
      lapsUsed: 12,
      rSquared: 0.6,
    }));
    expect(r.t_stat).toBeCloseTo(5, 5);
    expect(r.status).toBe("VALID");
  });

  it("2) low t-stat (slope=0.05, stdErr=0.03 → t≈1.67) caps VALID → NEUTRAL", () => {
    const r = validateDegradationEstimate(buildSimpleResult({
      slopeSecPerLap: 0.05,
      slopeStdError: 0.03,
      lapsUsed: 12,
      rSquared: 0.6,
    }));
    expect(r.t_stat).toBeCloseTo(0.05 / 0.03, 5);
    expect(r.status).toBe("NEUTRAL");
    expect(r.reason).toMatch(/non statisticamente significativa/);
  });

  it("3) missing slopeStdError (null) → NO cap, backward-compatible", () => {
    const r = validateDegradationEstimate(buildSimpleResult({
      slopeSecPerLap: 0.05,
      slopeStdError: null,
      lapsUsed: 12,
      rSquared: 0.6,
    }));
    expect(r.t_stat).toBeNull();
    expect(r.status).toBe("VALID");
  });

  it("4) slope=0 with stdErr defined → t=0 → status NEUTRAL", () => {
    const r = validateDegradationEstimate(buildSimpleResult({
      slopeSecPerLap: 0,
      slopeStdError: 0.01,
      lapsUsed: 12,
      rSquared: 0.6,
    }));
    expect(r.t_stat).toBe(0);
    expect(r.status).toBe("NEUTRAL");
  });

  it("5) corrected result prefers slope_corrected_std_error over raw slopeStdError", () => {
    // Raw stdErr is huge (would yield t<2), corrected stdErr is tiny (yields t>2).
    // The validator must use the corrected one.
    const r = validateDegradationEstimate(buildCorrectedResult({
      slope_raw: 0.05,
      slope_corrected: 0.05,
      slopeStdError: 1.0,                  // raw → t = 0.05 (way below 2)
      slope_corrected_std_error: 0.01,     // corrected → t = 5
      lapsUsed: 12,
      r_squared_corrected: 0.6,
      rSquared: 0.6,
    }));
    expect(r.t_stat).toBeCloseTo(5, 5);
    expect(r.status).toBe("VALID");

    // Reverse: corrected stdErr null → fallback to raw stdErr
    const r2 = validateDegradationEstimate(buildCorrectedResult({
      slope_raw: 0.05,
      slope_corrected: 0.05,
      slopeStdError: 0.01,                 // raw → t = 5
      slope_corrected_std_error: null,
      lapsUsed: 12,
      r_squared_corrected: 0.6,
      rSquared: 0.6,
    }));
    expect(r2.t_stat).toBeCloseTo(5, 5);
    expect(r2.status).toBe("VALID");
  });

  it("6) min_t_stat_valid = 0 acts as escape hatch (disables check)", () => {
    const r = validateDegradationEstimate(
      buildSimpleResult({
        slopeSecPerLap: 0.05,
        slopeStdError: 0.5, // would yield t=0.1, normally NEUTRAL
        lapsUsed: 12,
        rSquared: 0.6,
      }),
      {
        negative_tolerance: -0.02,
        neutral_tolerance: 0.01,
        min_valid_laps: 4,
        min_r_squared: 0.1,
        neutral_fallback_slope: 0.03,
        max_plausible_slope: 0.30,
        compound_profiles: {
          MEDIUM: {
            negative_tolerance: -0.02,
            neutral_tolerance: 0.01,
            max_plausible_slope: 0.20,
            neutral_fallback_slope: 0.035,
            min_laps_invalid: 4,
            min_laps_valid: 6,
            min_r_squared: 0.10,
            max_correction_ratio: 3.0,
            min_t_stat_valid: 0, // disabled
          },
        },
      },
    );
    expect(r.status).toBe("VALID");
  });
});
