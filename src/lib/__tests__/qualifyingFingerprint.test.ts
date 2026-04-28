import { describe, it, expect } from "vitest";
import {
  buildQualifyingFingerprint,
  type QualifyingInput,
} from "../qualifyingFingerprint";
import type { RankingEntry } from "../practiceLongRunAggregator";

function buildRankingEntry(
  driverNumber: number,
  paceRank: number,
  acronym: string,
): RankingEntry {
  return {
    driverNumber,
    acronym,
    teamColour: "FF0000",
    teamName: "Test",
    longRun: {
      driverNumber,
      acronym,
      color: "FF0000",
      stintNumber: 1,
      compound: "MEDIUM",
      lapStartLongRun: 1,
      lapEndLongRun: 10,
      lapsCount: 10,
      avgLapTime: 90 + paceRank * 0.1,
      degradationSlope: 0.05,
      rSquared: 0.9,
      fitRobustness: "HIGH",
      isValidLongRun: true,
    } as unknown as RankingEntry["longRun"],
    sessionName: "Practice 2",
    paceRank,
  };
}

describe("buildQualifyingFingerprint", () => {
  it("1. empty ranking and empty quali", () => {
    const r = buildQualifyingFingerprint([], []);
    expect(r.entries).toEqual([]);
    expect(r.qualifyingDataAvailable).toBe(false);
    expect(r.anomaliesCount).toBe(0);
  });

  it("2. all aligned (delta < 3)", () => {
    const ranking = [
      buildRankingEntry(1, 1, "AAA"),
      buildRankingEntry(2, 2, "BBB"),
      buildRankingEntry(3, 3, "CCC"),
    ];
    const quali: QualifyingInput[] = [
      { driverNumber: 1, qualifyingPosition: 2, qualifyingTime: 80 },
      { driverNumber: 2, qualifyingPosition: 1, qualifyingTime: 80 },
      { driverNumber: 3, qualifyingPosition: 4, qualifyingTime: 80 },
    ];
    const r = buildQualifyingFingerprint(ranking, quali);
    expect(r.entries.every((e) => e.classification === "ALIGNED")).toBe(true);
    expect(r.qualifyingDataAvailable).toBe(true);
    expect(r.anomaliesCount).toBe(0);
  });

  it("3. under-qualifier (delta=+5)", () => {
    const ranking = [buildRankingEntry(7, 2, "GGG")];
    const quali: QualifyingInput[] = [
      { driverNumber: 7, qualifyingPosition: 7, qualifyingTime: null },
    ];
    const r = buildQualifyingFingerprint(ranking, quali);
    expect(r.entries[0].classification).toBe("UNDER_QUALIFIER");
    expect(r.entries[0].positionDelta).toBe(5);
    expect(r.anomaliesCount).toBe(1);
  });

  it("4. over-qualifier (delta=-5)", () => {
    const ranking = [buildRankingEntry(11, 8, "HHH")];
    const quali: QualifyingInput[] = [
      { driverNumber: 11, qualifyingPosition: 3, qualifyingTime: null },
    ];
    const r = buildQualifyingFingerprint(ranking, quali);
    expect(r.entries[0].classification).toBe("OVER_QUALIFIER");
    expect(r.entries[0].positionDelta).toBe(-5);
    expect(r.anomaliesCount).toBe(1);
  });

  it("5. exact thresholds (+3 UNDER, +2 ALIGNED, -3 OVER, -2 ALIGNED)", () => {
    const ranking = [
      buildRankingEntry(1, 1, "A"),
      buildRankingEntry(2, 2, "B"),
      buildRankingEntry(3, 5, "C"),
      buildRankingEntry(4, 6, "D"),
    ];
    const quali: QualifyingInput[] = [
      { driverNumber: 1, qualifyingPosition: 4, qualifyingTime: null }, // +3
      { driverNumber: 2, qualifyingPosition: 4, qualifyingTime: null }, // +2
      { driverNumber: 3, qualifyingPosition: 2, qualifyingTime: null }, // -3
      { driverNumber: 4, qualifyingPosition: 4, qualifyingTime: null }, // -2
    ];
    const r = buildQualifyingFingerprint(ranking, quali);
    expect(r.entries[0].classification).toBe("UNDER_QUALIFIER");
    expect(r.entries[1].classification).toBe("ALIGNED");
    expect(r.entries[2].classification).toBe("OVER_QUALIFIER");
    expect(r.entries[3].classification).toBe("ALIGNED");
    expect(r.anomaliesCount).toBe(2);
  });

  it("6. partial quali (one DNF)", () => {
    const ranking = [
      buildRankingEntry(1, 1, "A"),
      buildRankingEntry(2, 2, "B"),
      buildRankingEntry(3, 3, "C"),
    ];
    const quali: QualifyingInput[] = [
      { driverNumber: 1, qualifyingPosition: 1, qualifyingTime: null },
      { driverNumber: 2, qualifyingPosition: null, qualifyingTime: null },
      { driverNumber: 3, qualifyingPosition: 3, qualifyingTime: null },
    ];
    const r = buildQualifyingFingerprint(ranking, quali);
    expect(r.entries).toHaveLength(3);
    expect(r.entries[1].classification).toBe("NO_QUALI_DATA");
    expect(r.entries[1].qualifyingPosition).toBeNull();
    expect(r.entries[1].positionDelta).toBeNull();
    expect(r.qualifyingDataAvailable).toBe(true);
  });

  it("7. quali completely absent", () => {
    const ranking = [
      buildRankingEntry(1, 1, "A"),
      buildRankingEntry(2, 2, "B"),
      buildRankingEntry(3, 3, "C"),
    ];
    const r = buildQualifyingFingerprint(ranking, []);
    expect(r.entries).toHaveLength(3);
    expect(r.entries.every((e) => e.classification === "NO_QUALI_DATA")).toBe(true);
    expect(r.qualifyingDataAvailable).toBe(false);
    expect(r.anomaliesCount).toBe(0);
  });

  it("8. determinism", () => {
    const ranking = [
      buildRankingEntry(1, 1, "A"),
      buildRankingEntry(2, 4, "B"),
    ];
    const quali: QualifyingInput[] = [
      { driverNumber: 1, qualifyingPosition: 5, qualifyingTime: 80 },
      { driverNumber: 2, qualifyingPosition: 1, qualifyingTime: 80 },
    ];
    const a = JSON.stringify(buildQualifyingFingerprint(ranking, quali));
    const b = JSON.stringify(buildQualifyingFingerprint(ranking, quali));
    const c = JSON.stringify(buildQualifyingFingerprint(ranking, quali));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
