import { describe, it, expect } from "vitest";
import { buildPreRaceNarrative } from "../preRaceNarrativeBuilder";
import type { PreRaceAnalysisResult, CompoundStress, WatchListEntry, RankingEntry } from "../practiceLongRunAggregator";
import type { QualifyingFingerprintResult, FingerprintEntry } from "../qualifyingFingerprint";

const SESSION_KEY = 9999;

function emptyPreRace(): PreRaceAnalysisResult {
  return {
    ranking: [],
    compoundStress: [],
    watchList: [],
    totalDriversWithLongRun: 0,
    lowSampleCaveat: false,
  };
}

function emptyFingerprint(): QualifyingFingerprintResult {
  return { entries: [], qualifyingDataAvailable: false, anomaliesCount: 0 };
}

function cs(over: Partial<CompoundStress>): CompoundStress {
  return {
    compound: "MEDIUM",
    driversCount: 5,
    slopeMedian: 0.05,
    slopeIQR: 0.02,
    paceMedian: 90.5,
    variability: "COERENTE",
    sampleConfidence: "HIGH",
    ...over,
  };
}

function watch(over: Partial<WatchListEntry>): WatchListEntry {
  return {
    driverNumber: 1,
    acronym: "AAA",
    reason: "test reason",
    signal: "POSITIVE",
    ...over,
  };
}

function fp(over: Partial<FingerprintEntry>): FingerprintEntry {
  return {
    driverNumber: 1,
    acronym: "AAA",
    paceRank: 1,
    qualifyingPosition: 1,
    positionDelta: 0,
    classification: "ALIGNED",
    ...over,
  };
}

describe("buildPreRaceNarrative", () => {
  it("1. empty inputs", () => {
    const r = buildPreRaceNarrative(emptyPreRace(), emptyFingerprint(), SESSION_KEY);
    expect(r.totalInsights).toBe(0);
    expect(r.compoundStressInsights).toEqual([]);
    expect(r.watchListInsights).toEqual([]);
    expect(r.qualiAnomalyInsights).toEqual([]);
  });

  it("2. compound stress LOW sample falls back to prerendered_text", () => {
    const pr = emptyPreRace();
    pr.compoundStress = [cs({ compound: "HARD", driversCount: 2, sampleConfidence: "LOW" })];
    const r = buildPreRaceNarrative(pr, emptyFingerprint(), SESSION_KEY);
    expect(r.compoundStressInsights).toHaveLength(1);
    expect(r.compoundStressInsights[0]).toBe("HARD: 2 piloti, slope mediana 0.050 s/giro");
  });

  it("3. compound stress HIGH COERENTE renders templated variant", () => {
    const pr = emptyPreRace();
    pr.compoundStress = [cs({ compound: "SOFT", driversCount: 7, slopeMedian: 0.072, sampleConfidence: "HIGH", variability: "COERENTE" })];
    const r = buildPreRaceNarrative(pr, emptyFingerprint(), SESSION_KEY);
    expect(r.compoundStressInsights).toHaveLength(1);
    const insight = r.compoundStressInsights[0];
    expect(insight).toContain("SOFT");
    expect(insight).toContain("7");
    expect(insight).toContain("0.072");
    expect(insight).not.toContain("{");
  });

  it("4. watchList 3 entries (POSITIVE, NEGATIVE, NEUTRAL)", () => {
    const pr = emptyPreRace();
    pr.watchList = [
      watch({ driverNumber: 1, acronym: "POS", signal: "POSITIVE", reason: "ottimo passo" }),
      watch({ driverNumber: 2, acronym: "NEG", signal: "NEGATIVE", reason: "degrado alto" }),
      watch({ driverNumber: 3, acronym: "NEU", signal: "NEUTRAL", reason: "stint lungo" }),
    ];
    const r = buildPreRaceNarrative(pr, emptyFingerprint(), SESSION_KEY);
    expect(r.watchListInsights).toHaveLength(3);
    expect(r.watchListInsights[0]).toContain("POS");
    expect(r.watchListInsights[1]).toContain("NEG");
    expect(r.watchListInsights[2]).toContain("NEU");
    r.watchListInsights.forEach((s) => expect(s).not.toContain("{"));
  });

  it("5. fingerprint mix: only OVER and UNDER produce insights", () => {
    const fpr: QualifyingFingerprintResult = {
      entries: [
        fp({ driverNumber: 1, acronym: "OVR", paceRank: 8, qualifyingPosition: 3, positionDelta: -5, classification: "OVER_QUALIFIER" }),
        fp({ driverNumber: 2, acronym: "UND", paceRank: 2, qualifyingPosition: 7, positionDelta: 5, classification: "UNDER_QUALIFIER" }),
        fp({ driverNumber: 3, acronym: "ALN", paceRank: 4, qualifyingPosition: 4, positionDelta: 0, classification: "ALIGNED" }),
        fp({ driverNumber: 4, acronym: "NOQ", paceRank: 5, qualifyingPosition: null, positionDelta: null, classification: "NO_QUALI_DATA" }),
      ],
      qualifyingDataAvailable: true,
      anomaliesCount: 2,
    };
    const r = buildPreRaceNarrative(emptyPreRace(), fpr, SESSION_KEY);
    expect(r.qualiAnomalyInsights).toHaveLength(2);
    const joined = r.qualiAnomalyInsights.join("\n");
    expect(joined).toContain("OVR");
    expect(joined).toContain("UND");
    expect(joined).not.toContain("ALN");
    expect(joined).not.toContain("NOQ");
    r.qualiAnomalyInsights.forEach((s) => expect(s).not.toContain("{"));
  });

  it("6. determinism: same input → same output across 3 calls", () => {
    const pr = emptyPreRace();
    pr.compoundStress = [cs({ compound: "MEDIUM" })];
    pr.watchList = [watch({ signal: "POSITIVE" })];
    const fpr: QualifyingFingerprintResult = {
      entries: [fp({ paceRank: 2, qualifyingPosition: 7, positionDelta: 5, classification: "UNDER_QUALIFIER" })],
      qualifyingDataAvailable: true,
      anomaliesCount: 1,
    };
    const a = JSON.stringify(buildPreRaceNarrative(pr, fpr, SESSION_KEY));
    const b = JSON.stringify(buildPreRaceNarrative(pr, fpr, SESSION_KEY));
    const c = JSON.stringify(buildPreRaceNarrative(pr, fpr, SESSION_KEY));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("7. variability across session_keys", () => {
    const pr = emptyPreRace();
    pr.compoundStress = [
      cs({ compound: "SOFT" }),
      cs({ compound: "MEDIUM" }),
      cs({ compound: "HARD", sampleConfidence: "HIGH" }),
    ];
    pr.watchList = [
      watch({ driverNumber: 1, acronym: "AAA", signal: "POSITIVE" }),
      watch({ driverNumber: 2, acronym: "BBB", signal: "NEGATIVE" }),
    ];
    const collect = (k: number) => {
      const out = buildPreRaceNarrative(pr, emptyFingerprint(), k);
      return [...out.compoundStressInsights, ...out.watchListInsights].join("|");
    };
    const s1 = collect(1);
    const s2 = collect(42);
    const s3 = collect(987654);
    const distinct = new Set([s1, s2, s3]);
    expect(distinct.size).toBeGreaterThanOrEqual(2);
  });

  it("8. placeholder integrity across rich combined input", () => {
    const pr: PreRaceAnalysisResult = {
      ranking: [] as RankingEntry[],
      compoundStress: [
        cs({ compound: "SOFT", driversCount: 6, sampleConfidence: "HIGH", variability: "COERENTE" }),
        cs({ compound: "MEDIUM", driversCount: 4, sampleConfidence: "MEDIUM", variability: "COERENTE" }),
        cs({ compound: "HARD", driversCount: 5, slopeIQR: 0.12, variability: "VARIABILE" }),
      ],
      watchList: [
        watch({ driverNumber: 1, acronym: "AAA", signal: "POSITIVE" }),
        watch({ driverNumber: 2, acronym: "BBB", signal: "NEGATIVE" }),
        watch({ driverNumber: 3, acronym: "CCC", signal: "NEUTRAL" }),
      ],
      totalDriversWithLongRun: 3,
      lowSampleCaveat: false,
    };
    const fpr: QualifyingFingerprintResult = {
      entries: [
        fp({ driverNumber: 10, acronym: "OVR", paceRank: 9, qualifyingPosition: 4, positionDelta: -5, classification: "OVER_QUALIFIER" }),
        fp({ driverNumber: 11, acronym: "UND", paceRank: 3, qualifyingPosition: 8, positionDelta: 5, classification: "UNDER_QUALIFIER" }),
      ],
      qualifyingDataAvailable: true,
      anomaliesCount: 2,
    };
    const r = buildPreRaceNarrative(pr, fpr, SESSION_KEY);
    const all = [...r.compoundStressInsights, ...r.watchListInsights, ...r.qualiAnomalyInsights];
    expect(all.length).toBeGreaterThan(0);
    all.forEach((s) => {
      expect(s).not.toContain("{");
      expect(s).not.toContain("}");
    });
  });
});
