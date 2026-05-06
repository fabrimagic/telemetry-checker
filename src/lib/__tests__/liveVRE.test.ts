import { describe, it, expect } from "vitest";
import { computeLiveStrategyAdvice, type PracticePrior } from "../liveVRE";
import type { LiveLap, LiveStint, LivePit } from "../livedataClient";

function makeStint(overrides: Partial<LiveStint> = {}): LiveStint {
  return {
    driver_number: 1,
    stint_number: 1,
    compound: "MEDIUM",
    tyre_age_at_start: 0,
    lap_start: 1,
    lap_end: null,
    ...overrides,
  };
}

function makeLap(lap_number: number, lap_duration: number, driver_number = 1): LiveLap {
  return {
    driver_number,
    lap_number,
    lap_duration,
    duration_sector_1: null,
    duration_sector_2: null,
    duration_sector_3: null,
    st_speed: null,
  };
}

const baseInput = {
  driverNumber: 1,
  acronym: "TST",
  racePits: [] as LivePit[],
  raceWeather: [],
  totalSessionLaps: 50,
  sessionKey: 9999,
};

describe("computeLiveStrategyAdvice", () => {
  it("Test 1: empty stints → low confidence, none source, null window", () => {
    const advice = computeLiveStrategyAdvice({
      ...baseInput,
      raceLaps: [],
      raceStints: [],
      currentLap: 0,
    });
    expect(advice.confidence).toBe("low");
    expect(advice.cliff_source).toBe("none");
    expect(advice.pit_window).toBeNull();
  });

  it("Test 2: few live laps, no prior → compound_default fallback, low confidence", () => {
    const stint = makeStint({ compound: "MEDIUM" });
    const laps = [1, 2, 3, 4].map((n) => makeLap(n, 90 + n * 0.05));
    const advice = computeLiveStrategyAdvice({
      ...baseInput,
      raceLaps: laps,
      raceStints: [stint],
      currentLap: 4,
    });
    expect(advice.cliff_source).toBe("compound_default");
    expect(advice.confidence).toBe("low");
    expect(advice.cliff_lap_estimate).toBe(30);
  });

  it("Test 3: practice prior + few live laps → practice_prior, medium confidence", () => {
    const stint = makeStint({ compound: "MEDIUM" });
    const laps = [1, 2, 3, 4].map((n) => makeLap(n, 90 + n * 0.05));
    const prior: PracticePrior = {
      byCompound: { MEDIUM: { cliffLapEstimate: 28, rSquared: 0.8 } },
    };
    const advice = computeLiveStrategyAdvice({
      ...baseInput,
      raceLaps: laps,
      raceStints: [stint],
      currentLap: 4,
      practicePrior: prior,
    });
    expect(advice.cliff_source).toBe("practice_prior");
    expect(advice.cliff_lap_estimate).toBe(28);
    expect(advice.confidence).toBe("medium");
  });

  it("Test 4: sufficient live data with degradation slope → live_model, high confidence", () => {
    const stint = makeStint({ compound: "MEDIUM", lap_start: 1 });
    // 10 laps, deterministic mild degradation: lap N = 90 + N*0.05
    const laps = Array.from({ length: 10 }, (_, i) => makeLap(i + 1, 90.0 + (i + 1) * 0.05));
    const advice = computeLiveStrategyAdvice({
      ...baseInput,
      raceLaps: laps,
      raceStints: [stint],
      currentLap: 10,
    });
    expect(advice.cliff_source).toBe("live_model");
    expect(advice.confidence).toBe("high");
    expect(advice.cliff_lap_estimate).not.toBeNull();
  });

  it("Test 5: caveats always include SC and latency", () => {
    const stint = makeStint({ compound: "MEDIUM" });
    const advice = computeLiveStrategyAdvice({
      ...baseInput,
      raceLaps: [makeLap(1, 90)],
      raceStints: [stint],
      currentLap: 1,
    });
    expect(advice.caveats.some((c) => c.includes("Safety Car"))).toBe(true);
    expect(advice.caveats.some((c) => c.includes("Latenza"))).toBe(true);
  });
});
