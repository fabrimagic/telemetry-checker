import { describe, it, expect } from "vitest";
import {
  CIRCUIT_KEY_TO_GP_NAME,
  CIRCUIT_PROFILES,
  resolveGpNameByCircuitKey,
} from "../circuitProfiles";
import { resolveCalendarGpName } from "../circuitGeometry";

describe("circuit_key resolution (structural)", () => {
  it("(a) resolves known circuit_keys to the correct gpName", () => {
    expect(resolveGpNameByCircuitKey(151)).toBe("Gran Premio di Miami");
    expect(resolveGpNameByCircuitKey(9)).toBe("Gran Premio degli Stati Uniti");
    expect(resolveGpNameByCircuitKey(15)).toBe("Gran Premio di Barcellona-Catalunya");
    expect(resolveGpNameByCircuitKey(153)).toBe("Gran Premio di Spagna");
    expect(resolveGpNameByCircuitKey(152)).toBe("Gran Premio di Las Vegas");
    expect(resolveGpNameByCircuitKey(39)).toBe("Gran Premio d'Italia");
  });

  it("(b) circuit_key wins over inconsistent location string", () => {
    // OpenF1 has occasionally returned "Miami Gardens" instead of "Miami"
    // — the string lookup misses, but circuit_key=151 still resolves.
    expect(resolveCalendarGpName("Miami Gardens", "United States", 151)).toBe(
      "Gran Premio di Miami",
    );
    // COTA's location "Austin" already works by string, but circuit_key=9
    // is the canonical/primary path.
    expect(resolveCalendarGpName("Austin", "United States", 9)).toBe(
      "Gran Premio degli Stati Uniti",
    );
  });

  it("(c) falls back to string resolution when circuit_key is missing", () => {
    expect(resolveCalendarGpName("Austin", "United States")).toBe(
      "Gran Premio degli Stati Uniti",
    );
    expect(resolveCalendarGpName(undefined, "United States")).toBeNull();
    expect(resolveCalendarGpName("Monza")).toBe("Gran Premio d'Italia");
  });

  it("(d) every circuit_key entry points to an existing CIRCUIT_PROFILES key", () => {
    for (const [keyStr, gpName] of Object.entries(CIRCUIT_KEY_TO_GP_NAME)) {
      expect(
        CIRCUIT_PROFILES[gpName],
        `circuit_key ${keyStr} maps to missing profile "${gpName}"`,
      ).toBeDefined();
    }
  });

  it("(e) handles missing/invalid circuit_key without crashing", () => {
    expect(resolveGpNameByCircuitKey()).toBeNull();
    expect(resolveGpNameByCircuitKey(null)).toBeNull();
    expect(resolveGpNameByCircuitKey(undefined)).toBeNull();
    expect(resolveGpNameByCircuitKey(NaN)).toBeNull();
    expect(resolveGpNameByCircuitKey(99999)).toBeNull();
    // Unknown circuit_key with usable location still resolves.
    expect(resolveCalendarGpName("Monaco", undefined, 99999)).toBe(
      "Gran Premio di Monaco",
    );
  });
});
