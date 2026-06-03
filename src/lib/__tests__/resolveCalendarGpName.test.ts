import { describe, it, expect } from "vitest";
import { resolveCalendarGpName, GP_TO_CIRCUIT_ID } from "../circuitGeometry";

describe("resolveCalendarGpName", () => {
  it("(a) maps OpenF1 location to the calendar gpName key present in GP_TO_CIRCUIT_ID", () => {
    const cases: Array<[string, string]> = [
      ["Monaco", "Gran Premio di Monaco"],
      ["Monte Carlo", "Gran Premio di Monaco"],
      ["Suzuka", "Gran Premio del Giappone"],
      ["Catalunya", "Gran Premio di Barcellona-Catalunya"],
      ["Silverstone", "Gran Premio di Gran Bretagna"],
      ["Spa-Francorchamps", "Gran Premio del Belgio"],
      ["Monza", "Gran Premio d'Italia"],
      ["Las Vegas", "Gran Premio di Las Vegas"],
      ["Lusail", "Gran Premio del Qatar"],
    ];
    for (const [openf1, expected] of cases) {
      const resolved = resolveCalendarGpName(openf1);
      expect(resolved).toBe(expected);
      // The whole point of the bug fix: the resolved key MUST be a valid
      // key in GP_TO_CIRCUIT_ID so fetchCircuitOutline can succeed.
      expect(GP_TO_CIRCUIT_ID[resolved!]).toBeDefined();
    }
  });

  it("falls back to country_name only for mono-GP countries", () => {
    // Mono-GP countries: country fallback is safe.
    expect(resolveCalendarGpName(undefined, "Japan")).toBe("Gran Premio del Giappone");
    expect(resolveCalendarGpName(undefined, "Hungary")).toBe("Gran Premio d'Ungheria");
    expect(resolveCalendarGpName(undefined, "Canada")).toBe("Gran Premio del Canada");
  });

  it("(bug-fix) refuses country fallback for MULTI-GP countries", () => {
    // USA hosts Miami, COTA, Las Vegas → country alone cannot disambiguate.
    // Must return null (honest degradation), NOT silently resolve to COTA.
    expect(resolveCalendarGpName(undefined, "United States")).toBeNull();
    expect(resolveCalendarGpName(undefined, "USA")).toBeNull();
    expect(resolveCalendarGpName("", "United States")).toBeNull();
    // Italy hosts Monza (and potentially Imola) → also ambiguous by country.
    expect(resolveCalendarGpName(undefined, "Italy")).toBeNull();
    // But a specific location for the same country still resolves correctly.
    expect(resolveCalendarGpName("Miami", "United States")).toBe("Gran Premio di Miami");
    expect(resolveCalendarGpName("Austin", "United States")).toBe("Gran Premio degli Stati Uniti");
    expect(resolveCalendarGpName("Las Vegas", "United States")).toBe("Gran Premio di Las Vegas");
    expect(resolveCalendarGpName("Monza", "Italy")).toBe("Gran Premio d'Italia");
  });


  it("is case-insensitive and trims whitespace", () => {
    expect(resolveCalendarGpName("  MONACO ")).toBe("Gran Premio di Monaco");
    expect(resolveCalendarGpName("silverstone")).toBe("Gran Premio di Gran Bretagna");
  });

  it("(b) returns null for unknown circuit (real degradation, no crash)", () => {
    expect(resolveCalendarGpName("Imola")).toBeNull();
    expect(resolveCalendarGpName("Atlantis")).toBeNull();
    expect(resolveCalendarGpName(undefined, undefined)).toBeNull();
    expect(resolveCalendarGpName("", "")).toBeNull();
  });
});
