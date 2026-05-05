import { describe, it, expect } from "vitest";
import { isWetCompound, WET_COMPOUND_CAVEAT_IT } from "@/lib/wetCompoundCheck";

describe("isWetCompound", () => {
  it("returns false for dry compounds", () => {
    expect(isWetCompound("SOFT")).toBe(false);
    expect(isWetCompound("MEDIUM")).toBe(false);
    expect(isWetCompound("HARD")).toBe(false);
  });

  it("returns true for wet compound variants (case-insensitive)", () => {
    expect(isWetCompound("INTERMEDIATE")).toBe(true);
    expect(isWetCompound("intermediate")).toBe(true);
    expect(isWetCompound("Intermediate")).toBe(true);
    expect(isWetCompound("INTER")).toBe(true);
    expect(isWetCompound("WET")).toBe(true);
    expect(isWetCompound("wet")).toBe(true);
  });

  it("returns false for null/undefined/empty/unknown (conservative default)", () => {
    expect(isWetCompound(null)).toBe(false);
    expect(isWetCompound(undefined)).toBe(false);
    expect(isWetCompound("")).toBe(false);
    expect(isWetCompound("UNKNOWN")).toBe(false);
  });

  it("exposes the Italian caveat constant", () => {
    expect(WET_COMPOUND_CAVEAT_IT).toContain("Degrado non modellato");
  });
});
