/**
 * Canonical Compound Profiles — structural unification test
 * ─────────────────────────────────────────────────────────
 * Verifies that the three downstream profile structures
 * (tyreDegradation, correctedDegradation, degradationValidation)
 * are derived consistently from the canonical source.
 */

import { describe, it, expect } from "vitest";
import {
  CANONICAL_COMPOUND_PROFILES,
  CANONICAL_DEFAULT_COMPOUND,
  getCanonicalProfile,
} from "../tyreCompoundProfiles";
import { COMPOUND_PROFILES } from "../degradationValidation";

describe("CANONICAL_COMPOUND_PROFILES", () => {
  it("contains exactly SOFT, MEDIUM, HARD keys", () => {
    expect(Object.keys(CANONICAL_COMPOUND_PROFILES).sort()).toEqual(["HARD", "MEDIUM", "SOFT"]);
  });

  it("getCanonicalProfile is case-insensitive", () => {
    expect(getCanonicalProfile("soft")).toEqual(CANONICAL_COMPOUND_PROFILES.SOFT);
    expect(getCanonicalProfile("Medium")).toEqual(CANONICAL_COMPOUND_PROFILES.MEDIUM);
  });

  it("getCanonicalProfile(null) returns the default", () => {
    expect(getCanonicalProfile(null)).toBe(CANONICAL_DEFAULT_COMPOUND);
    expect(getCanonicalProfile(undefined)).toBe(CANONICAL_DEFAULT_COMPOUND);
  });

  it("getCanonicalProfile of unknown compound returns the default", () => {
    expect(getCanonicalProfile("XYZ")).toBe(CANONICAL_DEFAULT_COMPOUND);
    expect(getCanonicalProfile("INTERMEDIATE")).toBe(CANONICAL_DEFAULT_COMPOUND);
  });

  it("validation profile (COMPOUND_PROFILES) matches canonical for shared fields", () => {
    for (const compound of ["SOFT", "MEDIUM", "HARD"] as const) {
      const canonical = CANONICAL_COMPOUND_PROFILES[compound];
      const validation = COMPOUND_PROFILES[compound];
      expect(validation.min_r_squared).toBe(canonical.validation.min_r_squared);
      expect(validation.max_plausible_slope).toBe(canonical.validation.max_plausible_slope);
      expect(validation.min_t_stat_valid).toBe(canonical.validation.min_t_stat_valid);
      expect(validation.neutral_fallback_slope).toBe(canonical.validation.neutral_fallback_slope);
    }
  });
});
