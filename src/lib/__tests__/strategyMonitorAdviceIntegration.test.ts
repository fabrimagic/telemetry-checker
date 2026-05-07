import { describe, it, expect } from "vitest";
import { computeLiveStrategyAdvice } from "../liveVRE";
import type { LiveLap, LiveStint } from "../livedataClient";

const stint: LiveStint = {
  driver_number: 1,
  stint_number: 1,
  compound: "MEDIUM",
  tyre_age_at_start: 0,
  lap_start: 1,
  lap_end: null,
};

const laps: LiveLap[] = [1, 2, 3].map((n) => ({
  driver_number: 1,
  lap_number: n,
  lap_duration: 90 + n * 0.05,
  duration_sector_1: null,
  duration_sector_2: null,
  duration_sector_3: null,
  st_speed: null,
}));

const baseInput = {
  driverNumber: 1,
  acronym: "TST",
  raceLaps: laps,
  raceStints: [stint],
  racePits: [],
  raceWeather: [],
  totalSessionLaps: 60,
  practicePrior: undefined,
  currentLap: 3,
  sessionKey: 1234,
};

describe("strategyMonitor advice integration smoke", () => {
  it("computeLiveStrategyAdvice produces advice with caveats from minimal data", () => {
    const advice = computeLiveStrategyAdvice(baseInput);
    expect(advice.caveats.length).toBeGreaterThanOrEqual(2);
    expect(advice.cliff_source).toBeDefined();
    expect(advice.confidence).not.toBeNull();
  });

  it("advice contains a non-empty Italian rationale", () => {
    const advice = computeLiveStrategyAdvice(baseInput);
    expect(typeof advice.rationale).toBe("string");
    expect(advice.rationale.length).toBeGreaterThan(0);
  });
});
