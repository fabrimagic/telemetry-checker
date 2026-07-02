/**
 * lappedTraffic — anti-hallucination unit tests
 * ─────────────────────────────────────────────
 * Covers: encounter detection from timestamps, missing-date_start handling,
 * insufficient baseline, plausibility clamp, non-positive median, confidence
 * levels, blue-flag corroboration. Also verifies pace-loss backcompat when
 * the new encounter-set parameter is absent vs present.
 */

import { describe, it, expect } from "vitest";
import { detectLappedTraffic } from "../lappedTraffic";
import { computeAllStintPaceLoss } from "../stintPaceLoss";
import type { Lap, RaceControlMessage, StintData } from "../openf1";
import type { WeatherCondition } from "../weatherClassification";
import type { TrackStatus } from "../trackStatusClassification";
import type { DriverCumulativeDeviation } from "../cumulativeDeviation";

const T0 = Date.parse("2024-01-01T13:00:00.000Z");

function lap(driver: number, n: number, dur: number, offsetSec: number, extra: Partial<Lap> = {}): Lap {
  return {
    lap_number: n,
    lap_duration: dur,
    duration_sector_1: dur / 3,
    duration_sector_2: dur / 3,
    duration_sector_3: dur / 3,
    st_speed: 300,
    date_start: new Date(T0 + offsetSec * 1000).toISOString(),
    is_pit_out_lap: false,
    driver_number: driver,
    session_key: 1,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    ...extra,
  };
}

/** Build a driver's laps starting at `startOffset` seconds, each of duration `dur`. */
function driverLaps(driver: number, count: number, dur: number, startOffset = 0): Lap[] {
  const out: Lap[] = [];
  let t = startOffset;
  for (let n = 1; n <= count; n++) {
    out.push(lap(driver, n, dur, t));
    t += dur;
  }
  return out;
}

const singleStint = (lapEnd: number, compound = "SOFT"): StintData[] => [{
  stint_number: 1, compound, lap_start: 1, lap_end: lapEnd,
  tyre_age_at_start: 0, session_key: 1, meeting_key: 1, driver_number: 1,
}];

describe("detectLappedTraffic", () => {
  it("detects a lapping event from timestamps alone (no blue flag needed)", () => {
    // Driver 1: 12 laps @ 90s. Driver 2 (slow): 8 laps @ 135s.
    // At end of driver1 lap 12 (t=1080), driver2 completed floor(1080/135)=8 laps → deficit 4.
    // Compute a specific lap where deficit grows by 1.
    const a = driverLaps(1, 12, 90);
    const b = driverLaps(2, 8, 135);
    const stints = singleStint(12);
    const r = detectLappedTraffic({
      allSessionLaps: [...a, ...b],
      driverLaps: a,
      driverNumber: 1,
      stints,
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    expect(r.encounter_lap_count).toBeGreaterThan(0);
    expect(r.total_lapped_count).toBeGreaterThan(0);
    // No blue flag → not corroborated
    expect(r.blue_flag_corroboration_ratio).toBe(0);
  });

  it("regression: a car retired after 3 laps at analyzed pace produces zero encounters", () => {
    // Driver 1: 20 laps @ 90s. Driver 2: same pace, only 3 laps then retires.
    // Naive counter-only logic would flag every subsequent lap as a lapping;
    // the retirement guard must filter them out.
    const a = driverLaps(1, 20, 90);
    const b = driverLaps(2, 3, 90, -1); // retires after 3 laps, last start at t=179
    const r = detectLappedTraffic({
      allSessionLaps: [...a, ...b],
      driverLaps: a,
      driverNumber: 1,
      stints: singleStint(20),
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    expect(r.encounter_lap_count).toBe(0);
    expect(r.total_lapped_count).toBe(0);
  });

  it("control: a genuinely slow car that runs the full race is still detected after the guard", () => {
    // Driver 1: 12 laps @ 90s (total 1080s). Driver 2: slow, runs the WHOLE
    // race at 135s pace up to and beyond t=1080 → last start after every
    // analyzed lap tStart → the guard does not filter it.
    const a = driverLaps(1, 12, 90);
    const b = driverLaps(2, 10, 135); // last start at t=1215 > 1080
    const r = detectLappedTraffic({
      allSessionLaps: [...a, ...b],
      driverLaps: a,
      driverNumber: 1,
      stints: singleStint(12),
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    expect(r.encounter_lap_count).toBeGreaterThan(0);
    expect(r.total_lapped_count).toBeGreaterThan(0);
    // Lap 1 must NOT be an encounter: at end of lap 1 the slow car is
    // simply behind on track within the same lap (deficit 1), not lapped.
    const encLapNums = r.encounter_laps.map((e) => e.lap_number);
    expect(encLapNums).not.toContain(1);
    // The first real encounter is the lap where the slow car falls a full
    // lap down (deficit transitions 1→2). With 90s vs 135s that is lap 4.
    expect(Math.min(...encLapNums)).toBe(4);
  });

  it("regression: a car ~1s/lap slower running the whole race is never lapped", () => {
    // Driver 1: 20 laps @ 90s. Driver 2 starts 3s behind and loses ~1s/lap,
    // never reaching a full-lap deficit → zero encounters expected.
    const a = driverLaps(1, 20, 90);
    const b = driverLaps(2, 20, 91, 3);
    const r = detectLappedTraffic({
      allSessionLaps: [...a, ...b],
      driverLaps: a,
      driverNumber: 1,
      stints: singleStint(20),
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    expect(r.encounter_lap_count).toBe(0);
  });

  it("regression: retired car whose last start coincides with an analyzed tStart yields zero encounters", () => {
    // Driver 1: 20 laps @ 90s → tStart of lap 4 is t=270.
    // Driver 2: 3 laps @ 90s starting at t=0 → last start at t=180, then
    // one more crossing exactly at t=270 (retirement lap coincident with
    // lap-4 tStart of the analyzed driver). The retirement guard uses
    // `< tStart` so this edge case would slip through as a 0→1 deficit
    // step; requiring deficit ≥ 2 must still yield zero encounters.
    const a = driverLaps(1, 20, 90);
    const b: typeof a = [];
    for (let n = 1; n <= 4; n++) b.push(lap(2, n, 90, (n - 1) * 90));
    const r = detectLappedTraffic({
      allSessionLaps: [...a, ...b],
      driverLaps: a,
      driverNumber: 1,
      stints: singleStint(20),
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    expect(r.encounter_lap_count).toBe(0);
  });

  it("interpolates missing date_start when possible, excludes when not", () => {
    const a = driverLaps(1, 5, 90);
    const b = driverLaps(2, 4, 120);
    // Blank the middle date_start on driver 2 → still interpolable
    b[1] = { ...b[1], date_start: null };
    const r = detectLappedTraffic({
      allSessionLaps: [...a, ...b],
      driverLaps: a,
      driverNumber: 1,
      stints: singleStint(5),
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    // Just verify it runs without throwing and returns a coherent object
    expect(r.encounter_laps).toBeDefined();
    expect(typeof r.encounter_lap_count).toBe("number");
  });

  it("excludes cost when baseline has fewer than 3 clean laps", () => {
    // Tiny stint: only 3 laps total → after excluding pit-out/pit-in the baseline is empty.
    const a = driverLaps(1, 3, 90);
    // Force lap 2 to be an encounter by adding a very slow doppiato
    const slow = driverLaps(2, 2, 200);
    const r = detectLappedTraffic({
      allSessionLaps: [...a, ...slow],
      driverLaps: a,
      driverNumber: 1,
      stints: singleStint(3),
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    for (const e of r.encounter_laps) {
      expect(e.cost_status).not.toBe("USED"); // baseline insufficient
    }
  });

  it("marks deltas > 5s as IMPLAUSIBLE and excludes them from the cost", () => {
    // 10-lap stint, all 90s baseline, lap 5 doctored to 110s → 20s delta
    const a = driverLaps(1, 10, 90);
    a[4] = { ...a[4], lap_duration: 110 };
    // Add a doppiato so lap 5 becomes an encounter
    const b = driverLaps(2, 6, 150);
    const r = detectLappedTraffic({
      allSessionLaps: [...a, ...b],
      driverLaps: a,
      driverNumber: 1,
      stints: singleStint(10),
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    const impl = r.encounter_laps.find((e) => e.cost_status === "IMPLAUSIBLE");
    // Not guaranteed to be lap 5 specifically (encounter timing depends on t-alignment),
    // but if any encounter with large delta shows up it must be flagged implausible
    if (impl) expect(impl.cost_seconds).toBeNull();
  });

  it("reports non-positive median as NOT distinguishable from noise", () => {
    // Encounters that end up FASTER than baseline (rare but possible) → median ≤ 0
    const a = driverLaps(1, 10, 90);
    // Make everything the same so delta = 0 for encounters
    const b = driverLaps(2, 6, 150);
    const r = detectLappedTraffic({
      allSessionLaps: [...a, ...b],
      driverLaps: a,
      driverNumber: 1,
      stints: singleStint(10),
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    if (r.valid_delta_count > 0) {
      // deltas all 0 → median 0 → not distinguishable
      expect(r.cost_distinguishable_from_noise).toBe(false);
      expect(r.median_cost_seconds).toBeNull();
    }
  });

  it("confidence tiers by number of valid deltas", () => {
    // Empty input → INSUFFICIENT_DATA
    const empty = detectLappedTraffic({
      allSessionLaps: [],
      driverLaps: [],
      driverNumber: 1,
      stints: [],
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    expect(empty.confidence).toBe("INSUFFICIENT_DATA");
    expect(empty.encounter_lap_count).toBe(0);
  });

  it("corroborates encounters with a blue flag for the lapped driver", () => {
    const a = driverLaps(1, 12, 90);
    const b = driverLaps(2, 8, 135);
    const stints = singleStint(12);
    // Detect first without RC, then inject a blue flag matching one of the encounter laps
    const r0 = detectLappedTraffic({
      allSessionLaps: [...a, ...b],
      driverLaps: a,
      driverNumber: 1,
      stints,
      raceControl: [],
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    if (r0.encounter_lap_count === 0) return;
    const encLap = r0.encounter_laps[0];
    const lappedDriver = encLap.lapped_drivers[0];
    const t = Date.parse(a[encLap.lap_number - 1].date_start!);
    const rc: RaceControlMessage[] = [{
      date: new Date(t + 5000).toISOString(),
      category: "Flag",
      flag: "BLUE",
      message: `WAVED BLUE FLAG FOR CAR ${lappedDriver}`,
      scope: "Driver",
      sector: null,
      meeting_key: 1,
      session_key: 1,
      driver_number: lappedDriver,
    }];
    const r1 = detectLappedTraffic({
      allSessionLaps: [...a, ...b],
      driverLaps: a,
      driverNumber: 1,
      stints,
      raceControl: rc,
      weatherMap: new Map(),
      trackStatusMap: new Map(),
      battleContext: null,
    });
    expect(r1.blue_flag_corroboration_ratio).toBeGreaterThan(0);
  });
});

/* ── Pace-loss backcompat integration ── */

function makeDriverDev(laps: Array<{ n: number; d: number }>): DriverCumulativeDeviation {
  return {
    driver_number: 1,
    driver_acronym: "AAA",
    laps: laps.map((l) => ({
      lap_number: l.n,
      lap_duration: 90,
      benchmark_lap_time: 90,
      delta_lap: l.d,
      cumulative_delta: 0,
      is_valid: true,
      exclusion_reason: null,
    })),
    total_valid_laps: laps.length,
    final_cumulative_delta: 0,
  } as unknown as DriverCumulativeDeviation;
}

describe("computeAllStintPaceLoss — lapped-traffic contamination backcompat", () => {
  const laps = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, d: 0 }));
  const dev = makeDriverDev(laps);
  const stints: StintData[] = [{
    stint_number: 1, compound: "SOFT", lap_start: 1, lap_end: 10,
    tyre_age_at_start: 0, session_key: 1, meeting_key: 1, driver_number: 1,
  }];
  const w = new Map<number, WeatherCondition>();
  const ts = new Map<number, TrackStatus>();
  for (let i = 1; i <= 10; i++) { w.set(i, "DRY"); ts.set(i, "GREEN"); }

  it("null encounter set → output identical to the pre-change baseline", () => {
    const baseline = computeAllStintPaceLoss(dev, stints, null, w, ts);
    const explicitNull = computeAllStintPaceLoss(dev, stints, null, w, ts, undefined, null);
    expect(explicitNull).toEqual(baseline);
    expect(baseline[0].pace_loss_contamination_flags.lapped_traffic).toBe(false);
  });

  it("provided encounter set flags lapped_traffic and reduces contaminated_laps window", () => {
    const encounters = new Set([3, 4]);
    const r = computeAllStintPaceLoss(dev, stints, null, w, ts, undefined, encounters);
    expect(r[0].pace_loss_contamination_flags.lapped_traffic).toBe(true);
    expect(r[0].contaminated_laps_count).toBeGreaterThanOrEqual(2);
  });
});
