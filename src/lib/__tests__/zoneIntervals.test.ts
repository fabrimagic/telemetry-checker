import { describe, it, expect } from "vitest";
import { groupDatesToIntervals } from "@/lib/zoneIntervals";

// Build a synthetic reference series of 10 samples at 0.1s intervals starting from t=0s.
const baseDate = new Date("2024-01-01T00:00:00.000Z").getTime();
const ref = Array.from({ length: 50 }, (_, i) => ({
  date: new Date(baseDate + i * 100).toISOString(), // 100ms apart
  time: i * 0.1,
}));

describe("groupDatesToIntervals", () => {
  it("returns empty array for empty input", () => {
    expect(groupDatesToIntervals([], "superclipping", ref)).toEqual([]);
  });

  it("returns empty when ref is empty", () => {
    expect(groupDatesToIntervals([ref[0].date], "superclipping", [])).toEqual([]);
  });

  it("groups consecutive samples into one interval", () => {
    const dates = [ref[2].date, ref[3].date, ref[4].date];
    const out = groupDatesToIntervals(dates, "superclipping", ref);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("superclipping");
    expect(out[0].startTime).toBeCloseTo(0.2, 5);
    expect(out[0].endTime).toBeCloseTo(0.4, 5);
  });

  it("splits when gap exceeds threshold", () => {
    // ref[2] @0.2s, ref[3] @0.3s … then ref[20] @2.0s, ref[21] @2.1s — big gap
    const dates = [ref[2].date, ref[3].date, ref[20].date, ref[21].date];
    const out = groupDatesToIntervals(dates, "liftcoast", ref, 0.5);
    expect(out).toHaveLength(2);
    expect(out[0].endTime).toBeCloseTo(0.3, 5);
    expect(out[1].startTime).toBeCloseTo(2.0, 5);
    expect(out.every((iv) => iv.type === "liftcoast")).toBe(true);
  });

  it("expands a single-sample episode to a visible minimum width", () => {
    const out = groupDatesToIntervals([ref[5].date], "superclipping", ref);
    expect(out).toHaveLength(1);
    expect(out[0].endTime - out[0].startTime).toBeGreaterThan(0);
  });
});
