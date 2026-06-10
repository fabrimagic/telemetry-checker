import { describe, it, expect } from "vitest";
import { estimatePitLoss, computeEffectiveLastLap } from "../virtualRaceEngineer";
import type { PitData } from "../openf1";
import type { TrackStatus } from "../trackStatusClassification";

function pit(lap: number, lane: number, stop: number | null): PitData {
  return { date: "2024-01-01T13:00:00.000Z", driver_number: 12, lap_number: lap,
    lane_duration: lane, pit_duration: lane, stop_duration: stop as unknown as number,
    session_key: 9999, meeting_key: 1 } as PitData;
}

describe("estimatePitLoss — esclude transiti pit sotto Safety Car", () => {
  it("usa solo gli stop reali quando presenti (stop_duration non null)", () => {
    const pits = [pit(14, 23.32, 2.4), pit(38, 23.42, 2.2), pit(67, 18.2, null), pit(68, 18.9, null), pit(69, 18.2, null)];
    expect(estimatePitLoss(pits)).toBeGreaterThan(22);
  });
  it("fallback: senza stop reali usa tutti i lane_duration", () => {
    expect(estimatePitLoss([pit(67, 18.2, null), pit(68, 18.9, null)])).toBeLessThan(20);
  });
});

describe("computeEffectiveLastLap — trim della coda neutralizzata di fine gara", () => {
  function statusMap(entries: [number, TrackStatus][]): Map<number, TrackStatus> {
    return new Map<number, TrackStatus>(entries);
  }
  it("giri finali in regime di SC: esclude i giri SC finali (Canada 2025)", () => {
    const m = statusMap([[67, "SC"], [68, "SC"], [69, "SC"], [70, "SC"]]);
    expect(computeEffectiveLastLap(70, m)).toBe(66);
  });
  it("gara che finisce verde: nessun trim", () => {
    const m = statusMap([[40, "VSC"], [41, "VSC"]]);
    expect(computeEffectiveLastLap(58, m)).toBe(58);
  });
  it("coda mista SC+RED: trimma tutta la coda non-GREEN", () => {
    const m = statusMap([[64, "VSC"], [65, "SC"], [66, "SC"], [67, "RED"]]);
    expect(computeEffectiveLastLap(67, m)).toBe(63);
  });
});
