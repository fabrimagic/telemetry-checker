/**
 * Sign flip cap tests for degradationValidation.
 *
 * Cap 5  — sign flip + short stint            → NEUTRAL
 * Cap 5b — sign flip + large correction Δ     → NEUTRAL (any stint length)
 * Cap 6  — large correction (ratio > max)     → NEUTRAL (no flip required)
 *
 * Compound used: MEDIUM
 *   min_laps_valid = 6, so "long" stint = laps ≥ 9
 *   sign_flip_large_correction_threshold = 0.03
 *   max_correction_ratio = 3.0
 */

import { describe, it, expect } from "vitest";
import { validateDegradationEstimate } from "../degradationValidation";
import type { DegradationResult } from "../tyreDegradation";
import type { CorrectedDegradationResult } from "../correctedDegradation";

function buildSimpleResult(overrides: Partial<DegradationResult> = {}): DegradationResult {
  return {
    driverNumber: 16,
    acronym: "LEC",
    color: "E80020",
    stint: 1,
    compound: "MEDIUM",
    lapsUsed: 12,
    slopeSecPerLap: 0.05,
    intercept: 90,
    rSquared: 0.6,
    points: [],
    rmse: 0.05,
    slopeStdError: 0.01, // t = 5 (always significant in these tests)
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

describe("validateDegradationEstimate — sign flip caps", () => {
  it("1) flip negative→positive on long stint, Δ below threshold → VALID", () => {
    // raw=-0.005, corrected=+0.020, Δ=0.025 < 0.03 (MEDIUM threshold)
    // long stint (12 ≥ 9), no large correction ratio
    const r = validateDegradationEstimate(buildCorrectedResult({
      slopeSecPerLap: 0.020,
      slope_raw: -0.005,
      slope_corrected: 0.020,
      lapsUsed: 12,
    }));
    expect(r.status).toBe("VALID");
  });

  it("2) flip negative→positive on long stint, Δ above threshold → NEUTRAL (cap 5b)", () => {
    // raw=-0.020, corrected=+0.025, Δ=0.045 > 0.03
    const r = validateDegradationEstimate(buildCorrectedResult({
      slopeSecPerLap: 0.025,
      slope_raw: -0.020,
      slope_corrected: 0.025,
      lapsUsed: 12,
    }));
    expect(r.status).toBe("NEUTRAL");
    expect(r.reason).toMatch(/inverte il segno.*magnitudine ampia/);
  });

  it("3) flip positive→negative on long stint, Δ above threshold → NEUTRAL (cap 5b, opposite direction)", () => {
    // raw=+0.025, corrected=-0.025, Δ=0.05 > 0.03
    // To avoid hitting "slope < negative_tolerance" (-0.02 for MEDIUM), use corrected=-0.015
    // raw=+0.025, corrected=-0.015, Δ=0.04 > 0.03, |corrected|=0.015 ≤ neutral_tolerance(0.01)? No 0.015>0.01.
    // corrected=-0.015 is in (negative_tolerance=-0.02, -neutral_tolerance=-0.01) → not invalidated, not zero-neutral.
    // It WILL match `slope < negative_tolerance`? -0.015 < -0.02 ? false. So it's not INVALID.
    // |slope| > neutral_tolerance (0.015 > 0.01)? yes → falls to else-if slope > neutral_tolerance? no, slope is negative.
    // Path: not >max, not <neg_tol, not |≤neutral|, not >neutral → no branch sets status, stays VALID.
    const r = validateDegradationEstimate(buildCorrectedResult({
      slopeSecPerLap: -0.015,
      slope_raw: 0.025,
      slope_corrected: -0.015,
      lapsUsed: 12,
    }));
    expect(r.status).toBe("NEUTRAL");
    expect(r.reason).toMatch(/inverte il segno.*magnitudine ampia/);
  });

  it("4) flip on short stint, Δ below threshold → NEUTRAL (cap 5, NOT 5b)", () => {
    // laps=8 < min_laps_valid+3=9, Δ=0.025 < 0.03 (so cap 5b would NOT fire)
    const r = validateDegradationEstimate(buildCorrectedResult({
      slopeSecPerLap: 0.020,
      slope_raw: -0.005,
      slope_corrected: 0.020,
      lapsUsed: 8,
    }));
    expect(r.status).toBe("NEUTRAL");
    expect(r.reason).toMatch(/stint non lungo/);
    expect(r.reason).not.toMatch(/magnitudine ampia/);
  });

  it("5) no flip, correction ratio above max → NEUTRAL (cap 6)", () => {
    // raw=0.005, corrected=0.020 (same sign), Δ=0.015, ratio=0.015/0.020=0.75 < 3.0 → cap 6 NOT fire.
    // To trigger cap 6: corrected=0.005, raw=0.025, Δ=0.020, ratio=0.020/0.005=4 > 3.0
    // But we want corrected slope to stay VALID first. corrected=0.005 ≤ neutral_tolerance(0.01) → NEUTRAL via slope-near-zero.
    // Use corrected=0.012, raw=0.060: Δ=0.048, ratio=0.048/0.012=4.0 > 3.0
    // corrected=0.012 > neutral_tolerance(0.01), < max_plausible(0.20) → would be VALID, then cap 6 triggers.
    const r = validateDegradationEstimate(buildCorrectedResult({
      slopeSecPerLap: 0.012,
      slope_raw: 0.060,
      slope_corrected: 0.012,
      lapsUsed: 12,
    }));
    expect(r.status).toBe("NEUTRAL");
    expect(r.reason).toMatch(/Correzione raw→corrected molto ampia/);
  });

  it("6) non-corrected result → no signFlip detection → VALID", () => {
    const r = validateDegradationEstimate(buildSimpleResult({
      slopeSecPerLap: 0.05,
      lapsUsed: 12,
    }));
    expect(r.status).toBe("VALID");
  });

  it("7) exact-zero slope on either side → signFlip = false (no false positive)", () => {
    // raw=0 → no flip detected even though corrected is positive
    const rZeroRaw = validateDegradationEstimate(buildCorrectedResult({
      slopeSecPerLap: 0.05,
      slope_raw: 0,
      slope_corrected: 0.05,
      lapsUsed: 12,
    }));
    expect(rZeroRaw.status).toBe("VALID");

    // corrected=0 → caught earlier by neutral_tolerance branch (|0| ≤ 0.01) → NEUTRAL,
    // but reason must NOT mention sign flip.
    const rZeroCorr = validateDegradationEstimate(buildCorrectedResult({
      slopeSecPerLap: 0,
      slope_raw: -0.05,
      slope_corrected: 0,
      lapsUsed: 12,
    }));
    expect(rZeroCorr.reason).not.toMatch(/inverte il segno/);
  });
});
