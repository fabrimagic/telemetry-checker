import { describe, it, expect } from "vitest";
import { meanStintLap } from "../strategyMonitorHelpers";
import type { LiveLap, LiveStint } from "@/lib/livedataClient";

const stint = (overrides: Partial<LiveStint>): LiveStint => ({
  driver_number: 1,
  stint_number: 1,
  compound: "MEDIUM",
  tyre_age_at_start: 0,
  lap_start: 10,
  lap_end: null,
  ...overrides,
});

const lap = (n: number, d: number | null): LiveLap => ({
  driver_number: 1,
  lap_number: n,
  lap_duration: d,
  duration_sector_1: null,
  duration_sector_2: null,
  duration_sector_3: null,
  st_speed: null,
});

describe("meanStintLap", () => {
  it("computes mean excluding out-lap", () => {
    const s = stint({ lap_start: 10, lap_end: null });
    const laps = [
      lap(10, null),
      lap(11, 90.0),
      lap(12, 91.0),
      lap(13, 92.0),
      lap(14, 91.5),
      lap(15, 90.5),
    ];
    expect(meanStintLap(s, laps)).toBeCloseTo(91.0, 5);
  });

  it("returns null with fewer than 3 valid laps", () => {
    const s = stint({ lap_start: 10 });
    const laps = [lap(11, 90), lap(12, 91)];
    expect(meanStintLap(s, laps)).toBeNull();
  });

  it("excludes laps after lap_end", () => {
    const s = stint({ lap_start: 10, lap_end: 14 });
    const laps = [
      lap(11, 90),
      lap(12, 90),
      lap(13, 90),
      lap(14, 90),
      lap(15, 200), // outside stint, must be excluded
    ];
    expect(meanStintLap(s, laps)).toBeCloseTo(90, 5);
  });
});
