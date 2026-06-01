import { describe, it, expect } from "vitest";
import { F1_CALENDAR_2026 } from "../f1Calendar2026";
import {
  CIRCUIT_PROFILES,
  CircuitProfile,
  getCircuitProfile,
  getCircuitProfileForNextGP,
} from "../circuitProfiles";

const WEIGHT_KEYS: (keyof CircuitProfile)[] = [
  "top_speed",
  "slow_corner_traction",
  "medium_corner",
  "fast_corner",
  "tyre_deg",
  "overtaking_difficulty",
];

describe("circuitProfiles", () => {
  const calendarGpNames = new Set(F1_CALENDAR_2026.map((s) => s.gpName));

  it("has no orphan keys (every non-dormant profile gpName exists in the calendar)", () => {
    for (const key of Object.keys(CIRCUIT_PROFILES)) {
      const isDormant = CIRCUIT_PROFILES[key].dormant === true;
      expect(calendarGpNames.has(key) || isDormant).toBe(true);
    }
  });

  it("dormant profiles (Bahrain, Arabia Saudita) exist, are marked dormant, and are NOT in the 2026 calendar", () => {
    const dormantKeys = ["Gran Premio del Bahrain", "Gran Premio dell'Arabia Saudita"];
    for (const k of dormantKeys) {
      expect(CIRCUIT_PROFILES[k]).toBeDefined();
      expect(CIRCUIT_PROFILES[k].dormant).toBe(true);
      expect(calendarGpNames.has(k)).toBe(false);
    }
  });

  it("getCircuitProfileForNextGP never returns a dormant profile (they are not in the calendar)", () => {
    // Sample across the season: no next-GP resolution should ever yield a dormant profile.
    const samples = [
      new Date("2026-02-01T00:00:00Z"),
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-09-15T00:00:00Z"),
      new Date("2026-11-20T00:00:00Z"),
    ];
    for (const now of samples) {
      const p = getCircuitProfileForNextGP(now);
      if (p) expect(p.dormant === true).toBe(false);
    }
  });

  it("covers every race GP in the 2026 calendar", () => {
    const raceGPs = new Set(
      F1_CALENDAR_2026.filter((s) => s.sessionType === "Gara").map((s) => s.gpName),
    );
    for (const gp of raceGPs) {
      expect(CIRCUIT_PROFILES[gp]).toBeDefined();
    }
  });

  it("includes the key circuits Monaco and Barcellona", () => {
    expect(CIRCUIT_PROFILES["Gran Premio di Monaco"]).toBeDefined();
    expect(CIRCUIT_PROFILES["Gran Premio di Barcellona-Catalunya"]).toBeDefined();
  });

  it("has all weights within [0,1]", () => {
    for (const p of Object.values(CIRCUIT_PROFILES)) {
      for (const k of WEIGHT_KEYS) {
        const v = p[k] as number;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("marks layout_estimate sources as low confidence", () => {
    for (const p of Object.values(CIRCUIT_PROFILES)) {
      if (p.source === "layout_estimate") {
        expect(p.confidence).toBe("low");
      }
    }
  });

  it("getCircuitProfile returns null for unknown GP", () => {
    expect(getCircuitProfile("Gran Premio di Atlantide")).toBeNull();
  });

  it("getCircuitProfileForNextGP returns Monaco profile when now is just before Monaco GP", () => {
    // Monaco 2026 race: 2026-06-07T13:00:00Z (round 6)
    const now = new Date("2026-06-01T00:00:00Z");
    const profile = getCircuitProfileForNextGP(now);
    expect(profile).not.toBeNull();
    // First upcoming session for that date is Monaco FP1.
    expect(profile?.gpName).toBe("Gran Premio di Monaco");
  });

  it("getCircuitProfileForNextGP returns null after the last session of the season", () => {
    const now = new Date("2027-01-01T00:00:00Z");
    expect(getCircuitProfileForNextGP(now)).toBeNull();
  });
});
