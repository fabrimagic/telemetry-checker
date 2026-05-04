import { describe, it, expect } from "vitest";
import { isBetterCompoundModel, type CompoundModelCandidate } from "../virtualRaceEngineer";

describe("isBetterCompoundModel — hierarchical compound model selection", () => {
  it("VALID prevails over NEUTRAL even with lower R²", () => {
    const candidate: CompoundModelCandidate = { status: "VALID", rSquared: 0.30, lapsUsed: 6 };
    const incumbent: CompoundModelCandidate = { status: "NEUTRAL", rSquared: 0.85, lapsUsed: 18 };
    expect(isBetterCompoundModel(candidate, incumbent)).toBe(true);
  });

  it("Same status: higher rSquared wins", () => {
    const candidate: CompoundModelCandidate = { status: "VALID", rSquared: 0.85, lapsUsed: 18 };
    const incumbent: CompoundModelCandidate = { status: "VALID", rSquared: 0.30, lapsUsed: 25 };
    expect(isBetterCompoundModel(candidate, incumbent)).toBe(true);
  });

  it("Same status & rSquared: higher lapsUsed wins", () => {
    const candidate: CompoundModelCandidate = { status: "VALID", rSquared: 0.50, lapsUsed: 18 };
    const incumbent: CompoundModelCandidate = { status: "VALID", rSquared: 0.50, lapsUsed: 12 };
    expect(isBetterCompoundModel(candidate, incumbent)).toBe(true);
  });

  it("Full tie → incumbent stays (caller iteration tiebreaker)", () => {
    const candidate: CompoundModelCandidate = { status: "VALID", rSquared: 0.50, lapsUsed: 12 };
    const incumbent: CompoundModelCandidate = { status: "VALID", rSquared: 0.50, lapsUsed: 12 };
    expect(isBetterCompoundModel(candidate, incumbent)).toBe(false);
  });

  it("INVALID vs INVALID: rSquared decides", () => {
    const candidate: CompoundModelCandidate = { status: "INVALID", rSquared: 0.10, lapsUsed: 4 };
    const incumbent: CompoundModelCandidate = { status: "INVALID", rSquared: 0.05, lapsUsed: 6 };
    expect(isBetterCompoundModel(candidate, incumbent)).toBe(true);
  });
});
