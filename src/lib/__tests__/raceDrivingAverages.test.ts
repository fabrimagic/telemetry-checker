import { describe, it, expect, vi } from "vitest";
import {
  computeRaceDrivingAverages,
  pickComparableLaps,
  computeZones,
} from "../raceDrivingAverages";
import type { CarData, Lap } from "../openf1";
import type { TrackStatus } from "../trackStatusClassification";

function makeLap(n: number, opts: Partial<Lap> = {}): Lap {
  return {
    lap_number: n,
    date_start: new Date(Date.UTC(2024, 0, 1, 12, n, 0)).toISOString(),
    lap_duration: 90,
    is_pit_out_lap: false,
    driver_number: 1,
    session_key: 1,
    duration_sector_1: 30,
    duration_sector_2: 30,
    duration_sector_3: 30,
    i1_speed: null,
    i2_speed: null,
    st_speed: null,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    ...opts,
  } as Lap;
}

// Build a CarData lap with a single superclipping moment + one lift&coast window.
function syntheticLapData(baseIso: string): CarData[] {
  const t0 = new Date(baseIso).getTime();
  const sample = (offsetMs: number, partial: Partial<CarData>): CarData => ({
    date: new Date(t0 + offsetMs).toISOString(),
    speed: 0,
    throttle: 0,
    brake: 0,
    n_gear: 0,
    rpm: 0,
    drs: 0,
    driver_number: 1,
    session_key: 1,
    ...partial,
  });
  return [
    sample(0, { speed: 200, throttle: 100, brake: 0, rpm: 12000 }),
    sample(100, { speed: 205, throttle: 100, brake: 0, rpm: 11800 }), // superclip start (throttle=100, rpm↓)
    sample(200, { speed: 208, throttle: 100, brake: 0, rpm: 11600 }), // superclip continues
    sample(300, { speed: 210, throttle: 95, brake: 0, rpm: 12500 }),  // ends (throttle<100)
    sample(400, { speed: 210, throttle: 0, brake: 0, rpm: 12000 }),   // lift&coast start
    sample(500, { speed: 208, throttle: 0, brake: 0, rpm: 11800 }),   // lift&coast continues
    sample(600, { speed: 206, throttle: 0, brake: 50, rpm: 11500 }),  // ends
  ];

}

describe("pickComparableLaps", () => {
  it("excludes pit-out, pit-in (lap preceding pit-out), non-GREEN and invalid laps", () => {
    const laps: Lap[] = [
      makeLap(1),
      makeLap(2),
      makeLap(3), // pit-in (next is pit-out)
      makeLap(4, { is_pit_out_lap: true }),
      makeLap(5),
      makeLap(6), // SC
      makeLap(7),
      makeLap(8, { lap_duration: 0 }),
    ];
    const ts: Map<number, TrackStatus> = new Map([[6, "SC" as TrackStatus]]);
    const out = pickComparableLaps(laps, ts);
    expect(out.map((l) => l.lap_number)).toEqual([1, 2, 5, 7]);
  });
});

describe("computeRaceDrivingAverages", () => {
  it("aggregates over comparable laps only and calls onProgress", async () => {
    const laps: Lap[] = [
      makeLap(1),
      makeLap(2),
      makeLap(3),
      makeLap(4),
    ];
    const fetcher = vi.fn(async (_s: number, _d: number, start: string) =>
      syntheticLapData(start),
    );
    const onProgress = vi.fn();

    const res = await computeRaceDrivingAverages(1, 1, laps, new Map(), fetcher, {
      onProgress,
    });

    // All 4 laps are comparable (no pit-out, no track-status entries).
    expect(res.laps_total_comparable).toBe(4);
    expect(res.laps_used).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenLastCalledWith(4, 4);
    expect(res.low_sample).toBe(false);
    expect(res.aborted).toBe(false);
    expect(res.superclip_avg_duration).toBeGreaterThan(0);
    expect(res.liftcoast_avg_duration).toBeGreaterThan(0);
  });

  it("skips failed lap downloads and flags low_sample when <3 succeed", async () => {
    const laps: Lap[] = [makeLap(1), makeLap(2), makeLap(3)];
    let call = 0;
    const fetcher: getCarDataMock = async (_s, _d, start) => {
      call++;
      if (call === 2) throw new Error("boom");
      return syntheticLapData(start);
    };
    const res = await computeRaceDrivingAverages(1, 1, laps, new Map(), fetcher);
    expect(res.laps_total_comparable).toBe(3);
    expect(res.laps_used).toBe(2);
    expect(res.low_sample).toBe(true);
    expect(res.aborted).toBe(false);
  });

  it("populates per_lap with one ordered entry per successful lap, skipping failures", async () => {
    const laps: Lap[] = [makeLap(3), makeLap(1), makeLap(2), makeLap(4)];
    let call = 0;
    const fetcher: getCarDataMock = async (_s, _d, start) => {
      call++;
      if (call === 2) throw new Error("boom"); // 2nd comparable lap fails
      return syntheticLapData(start);
    };
    const res = await computeRaceDrivingAverages(1, 1, laps, new Map(), fetcher);
    expect(res.per_lap.length).toBe(3);
    // Sorted by lap_number
    expect(res.per_lap.map((p) => p.lap_number)).toEqual([...res.per_lap.map((p) => p.lap_number)].sort((a, b) => a - b));
    // Aggregate count matches succeeded laps
    expect(res.per_lap.length).toBe(res.laps_used);
    for (const p of res.per_lap) {
      expect(p.liftcoast_duration).toBeGreaterThan(0);
      expect(p.superclip_count).toBeGreaterThanOrEqual(1);
    }
  });

  it("honours AbortSignal and returns partial results with aborted=true", async () => {
    const laps: Lap[] = Array.from({ length: 6 }, (_, i) => makeLap(i + 1));
    const ctrl = new AbortController();
    let calls = 0;
    const fetcher: getCarDataMock = async (_s, _d, start) => {
      calls++;
      if (calls === 2) ctrl.abort();
      return syntheticLapData(start);
    };
    const res = await computeRaceDrivingAverages(1, 1, laps, new Map(), fetcher, {
      signal: ctrl.signal,
    });
    expect(res.aborted).toBe(true);
    expect(res.laps_used).toBeLessThan(res.laps_total_comparable);
  });
});

// Type alias used only to keep mock signatures honest.
type getCarDataMock = (
  sessionKey: number,
  driverNumber: number,
  dateStart: string,
  dateEnd: string,
) => Promise<CarData[]>;

describe("computeZones (regression — shared logic)", () => {
  it("still detects one superclip and one lift&coast in synthetic data", () => {
    const z = computeZones(syntheticLapData("2024-01-01T12:00:00.000Z"));
    expect(z.superclipping.count).toBeGreaterThanOrEqual(1);
    expect(z.liftcoast.count).toBe(1);
    expect(z.liftcoast.duration).toBeGreaterThan(0);
  });
});
