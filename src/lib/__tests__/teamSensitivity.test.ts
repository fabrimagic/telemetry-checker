import { describe, it, expect } from "vitest";
import {
  computeTeamSensitivity,
  MIN_SAMPLE_SIZE,
} from "../teamSensitivity";
import type { CarProfile, TeamRaceHistoryEntry } from "../carProfiles";
import type { CircuitProfile } from "../circuitProfiles";

function mkCircuit(name: string, topSpeed: number): CircuitProfile {
  return {
    gpName: name,
    top_speed: topSpeed,
    slow_corner_traction: 0.5,
    medium_corner: 0.5,
    fast_corner: 0.5,
    tyre_deg: 0.5,
    overtaking_difficulty: 0.5,
    confidence: "high",
    source: "historical",
  };
}

function mkHistory(
  entries: Array<{ gp: string; y: number; w?: number }>,
): TeamRaceHistoryEntry[] {
  return entries.map((e) => ({
    gpName: e.gp,
    date_end: "2026-01-01T00:00:00Z",
    weight: e.w ?? 1,
    sectors_normalized: e.y,
    top_speed_normalized: null,
  }));
}

function mkProfile(
  name: string,
  sectorsMean: number,
  history: TeamRaceHistoryEntry[],
): CarProfile {
  return {
    team_name: name,
    top_speed_index: 0.5,
    sector_strength: {
      s1: sectorsMean,
      s2: sectorsMean,
      s3: sectorsMean,
    },
    sample_races: history.length,
    effective_sample_races: history.length,
    sample_laps: 100 * history.length,
    confidence: "high",
    race_history: history,
  };
}

// Ten circuits with varying top_speed weights to exercise the regression.
const CIRCUITS: Record<string, CircuitProfile> = {
  A: mkCircuit("A", 0.1),
  B: mkCircuit("B", 0.2),
  C: mkCircuit("C", 0.3),
  D: mkCircuit("D", 0.4),
  E: mkCircuit("E", 0.5),
  F: mkCircuit("F", 0.6),
  G: mkCircuit("G", 0.7),
  H: mkCircuit("H", 0.8),
  I: mkCircuit("I", 0.9),
  TARGET_HIGH: mkCircuit("TARGET_HIGH", 0.95),
  TARGET_LOW: mkCircuit("TARGET_LOW", 0.05),
};

describe("computeTeamSensitivity", () => {
  it("positive slope for a team constructed to be strong on fast circuits", () => {
    // y perfectly tracks top_speed → slope > 0, prediction higher on high-target.
    const history = mkHistory([
      { gp: "A", y: 0.1 },
      { gp: "B", y: 0.2 },
      { gp: "C", y: 0.3 },
      { gp: "D", y: 0.4 },
      { gp: "E", y: 0.5 },
      { gp: "F", y: 0.6 },
      { gp: "G", y: 0.7 },
    ]);
    const profiles = [mkProfile("FastTeam", 0.4, history)];
    const high = computeTeamSensitivity({
      profiles,
      target: CIRCUITS.TARGET_HIGH,
      circuitProfiles: CIRCUITS,
    });
    const low = computeTeamSensitivity({
      profiles,
      target: CIRCUITS.TARGET_LOW,
      circuitProfiles: CIRCUITS,
    });
    const entryHigh = high.by_team[0];
    const entryLow = low.by_team[0];
    expect(entryHigh.fallback_reason).toBeNull();
    expect(entryHigh.slope).not.toBeNull();
    expect(entryHigh.slope!).toBeGreaterThan(0);
    expect(entryHigh.predicted_score).toBeGreaterThan(entryLow.predicted_score);
  });

  it("falls back to persistence when the sample is too small", () => {
    // 5 entries < MIN_SAMPLE_SIZE.
    expect(MIN_SAMPLE_SIZE).toBeGreaterThanOrEqual(6);
    const history = mkHistory([
      { gp: "A", y: 0.1 },
      { gp: "B", y: 0.2 },
      { gp: "C", y: 0.3 },
      { gp: "D", y: 0.4 },
      { gp: "E", y: 0.5 },
    ]);
    const profiles = [mkProfile("SmallSample", 0.42, history)];
    const out = computeTeamSensitivity({
      profiles,
      target: CIRCUITS.TARGET_HIGH,
      circuitProfiles: CIRCUITS,
    });
    const e = out.by_team[0];
    expect(e.fallback_reason).toBe("insufficient_sample");
    expect(e.slope).toBeNull();
    expect(e.predicted_score).toBeCloseTo(0.42, 6);
  });

  it("falls back when top_speed variance is near zero", () => {
    // Six entries but all on the same circuit → zero variance.
    const history = mkHistory([
      { gp: "E", y: 0.1 },
      { gp: "E", y: 0.2 },
      { gp: "E", y: 0.3 },
      { gp: "E", y: 0.4 },
      { gp: "E", y: 0.5 },
      { gp: "E", y: 0.6 },
    ]);
    const profiles = [mkProfile("FlatCircuit", 0.5, history)];
    const out = computeTeamSensitivity({
      profiles,
      target: CIRCUITS.TARGET_HIGH,
      circuitProfiles: CIRCUITS,
    });
    const e = out.by_team[0];
    expect(e.fallback_reason).toBe("top_speed_variance_near_zero");
    expect(e.slope).toBeNull();
    expect(e.predicted_score).toBeCloseTo(0.5, 6);
  });
});
