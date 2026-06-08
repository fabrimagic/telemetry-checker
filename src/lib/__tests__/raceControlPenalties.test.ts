import { describe, it, expect } from "vitest";
import { detectRaceControlPenalties, penaltiesForDriver } from "../raceControlPenalties";
import type { RaceControlMessage } from "../openf1";

function rc(message: string, date = "2025-01-01T00:00:00Z"): RaceControlMessage {
  return {
    date,
    category: "Other",
    flag: null,
    message,
    scope: null,
    sector: null,
    meeting_key: 1,
    session_key: 1,
  };
}

describe("detectRaceControlPenalties", () => {
  it("(a) parses 5-second time penalty with driver and seconds", () => {
    const out = detectRaceControlPenalties([
      rc("CAR 16 (LEC) 5 SECOND TIME PENALTY - TRACK LIMITS"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].driverNumber).toBe(16);
    expect(out[0].penaltyType).toBe("TIME_PENALTY");
    expect(out[0].seconds).toBe(5);
    expect(out[0].rawMessage).toContain("CAR 16");
  });

  it("(b) excludes UNDER INVESTIGATION / NO FURTHER ACTION procedural messages", () => {
    const out = detectRaceControlPenalties([
      rc("CAR 4 (NOR) UNDER INVESTIGATION - INCIDENT"),
      rc("CAR 4 (NOR) INCIDENT NOTED - NO FURTHER ACTION"),
      rc("REVIEWED - NO ACTION"),
      rc("INCIDENT NOTED"),
    ]);
    expect(out).toEqual([]);
  });

  it("(c) detects DRIVE THROUGH without applicable seconds", () => {
    const out = detectRaceControlPenalties([
      rc("CAR 44 (HAM) DRIVE THROUGH PENALTY"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].driverNumber).toBe(44);
    expect(out[0].penaltyType).toBe("DRIVE_THROUGH");
    expect(out[0].seconds).toBeUndefined();
  });

  it("(c2) detects STOP AND GO and STOP-GO variants", () => {
    const out = detectRaceControlPenalties([
      rc("CAR 1 STOP AND GO PENALTY"),
      rc("CAR 11 STOP-GO PENALTY 10 SECONDS"),
    ]);
    expect(out.map((p) => p.penaltyType)).toEqual(["STOP_GO", "STOP_GO"]);
  });

  it("(d) unexpected format containing PENALTY → generic detection, raw preserved, no crash", () => {
    const out = detectRaceControlPenalties([
      rc("STEWARDS IMPOSED A PENALTY FOLLOWING INCIDENT IN T3"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].penaltyType).toBe("UNKNOWN");
    expect(out[0].driverNumber).toBeUndefined();
    expect(out[0].seconds).toBeUndefined();
    expect(out[0].rawMessage).toContain("PENALTY");
  });

  it("(e) returns [] for empty / null input", () => {
    expect(detectRaceControlPenalties([])).toEqual([]);
    expect(detectRaceControlPenalties(null)).toEqual([]);
    expect(detectRaceControlPenalties(undefined)).toEqual([]);
  });

  it("does not throw on malformed entries", () => {
    expect(() =>
      detectRaceControlPenalties([
        // @ts-expect-error intentional malformed
        { date: "x" },
        // @ts-expect-error intentional malformed
        null,
        rc("CAR 16 5 SECOND TIME PENALTY"),
      ]),
    ).not.toThrow();
  });

  it("penaltiesForDriver filters by car number, excludes unattributed", () => {
    const all = detectRaceControlPenalties([
      rc("CAR 16 5 SECOND TIME PENALTY"),
      rc("CAR 44 DRIVE THROUGH PENALTY"),
      rc("STEWARDS IMPOSED A PENALTY"),
    ]);
    expect(penaltiesForDriver(all, 16)).toHaveLength(1);
    expect(penaltiesForDriver(all, 44)).toHaveLength(1);
    expect(penaltiesForDriver(all, 99)).toHaveLength(0);
  });
});
