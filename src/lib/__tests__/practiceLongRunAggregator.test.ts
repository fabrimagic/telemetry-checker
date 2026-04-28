import { describe, it, expect } from "vitest";
import type { Driver, Lap, StintData, PitData, SessionInfo } from "../openf1";
import {
  aggregatePreRaceLongRuns,
  type DriverSessionData,
} from "../practiceLongRunAggregator";

// ── Fixture helpers ──────────────────────────────────────────────────

function buildLap(driver: number, lap: number, dur: number, isPitOut = false): Lap {
  return {
    lap_number: lap,
    lap_duration: dur,
    duration_sector_1: null,
    duration_sector_2: null,
    duration_sector_3: null,
    st_speed: null,
    date_start: null,
    is_pit_out_lap: isPitOut,
    driver_number: driver,
    session_key: 1,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
  };
}

function buildStint(
  driver: number,
  n: number,
  compound: string,
  start: number,
  end: number,
): StintData {
  return {
    compound,
    driver_number: driver,
    lap_end: end,
    lap_start: start,
    meeting_key: 1,
    session_key: 1,
    stint_number: n,
    tyre_age_at_start: 0,
  };
}

function buildDriver(num: number, acronym: string, team = "Ferrari", colour = "DC0000"): Driver {
  return {
    driver_number: num,
    broadcast_name: acronym,
    full_name: acronym,
    name_acronym: acronym,
    team_name: team,
    team_colour: colour,
    headshot_url: null,
    session_key: 1,
  };
}

function buildSession(name: string, key: number, date: string): SessionInfo {
  return {
    session_key: key,
    session_type: "Practice",
    session_name: name,
    meeting_key: 1,
    date_start: date,
  };
}

/**
 * Builds a clean linear long-run sequence of `count` laps starting at lap 2
 * (lap 1 is the pit-out flagged), with given baseLap (s) and slope (s/lap).
 * Adds tiny deterministic jitter so MAD doesn't collapse to zero.
 */
function buildLongRunLaps(
  driver: number,
  count: number,
  baseLap: number,
  slope: number,
): Lap[] {
  const laps: Lap[] = [buildLap(driver, 1, baseLap + 5, true)]; // pit-out lap
  for (let i = 0; i < count; i++) {
    const lapNum = i + 2;
    const jitter = ((i * 37) % 7) * 0.01 - 0.03; // deterministic small noise
    laps.push(buildLap(driver, lapNum, baseLap + slope * i + jitter));
  }
  return laps;
}

function buildSession_DriverData(
  driver: Driver,
  sessionInfo: SessionInfo,
  laps: Lap[],
  stints: StintData[],
  pits: PitData[] = [],
): DriverSessionData {
  return { driver, sessionInfo, laps, stints, pits };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("aggregatePreRaceLongRuns", () => {
  it("1. empty input returns empty result with lowSampleCaveat=true", () => {
    const result = aggregatePreRaceLongRuns([]);
    expect(result.ranking).toEqual([]);
    expect(result.compoundStress).toEqual([]);
    expect(result.watchList).toEqual([]);
    expect(result.totalDriversWithLongRun).toBe(0);
    expect(result.lowSampleCaveat).toBe(true);
  });

  it("2. single driver, single session, valid long run", () => {
    const drv = buildDriver(1, "VER");
    const session = buildSession("Practice 2", 100, "2024-09-06T15:00:00");
    const laps = buildLongRunLaps(1, 10, 90.0, 0.05);
    const stints = [buildStint(1, 1, "MEDIUM", 1, 11)];
    const ds = [buildSession_DriverData(drv, session, laps, stints)];

    const result = aggregatePreRaceLongRuns(ds);
    expect(result.ranking).toHaveLength(1);
    expect(result.ranking[0].paceRank).toBe(1);
    expect(result.ranking[0].acronym).toBe("VER");
    expect(result.ranking[0].sessionName).toBe("Practice 2");
    expect(result.ranking[0].longRun.isValidLongRun).toBe(true);
    expect(result.compoundStress).toHaveLength(1);
    expect(result.compoundStress[0].compound).toBe("MEDIUM");
    expect(result.compoundStress[0].sampleConfidence).toBe("LOW");
    expect(result.watchList).toEqual([]);
    expect(result.lowSampleCaveat).toBe(true);
  });

  it("3. three drivers same compound, ranking sorted by pace, watchlist flags better-than-median slope", () => {
    const session = buildSession("Practice 2", 100, "2024-09-06T15:00:00");
    // Driver A: pace 90, slope 0.10
    // Driver B: pace 91, slope 0.10
    // Driver C: pace 92, slope 0.02 (much better slope → POSITIVE flag, delta=0.08>0.03)
    const ds: DriverSessionData[] = [
      buildSession_DriverData(
        buildDriver(1, "AAA"), session,
        buildLongRunLaps(1, 10, 90.0, 0.10),
        [buildStint(1, 1, "MEDIUM", 1, 11)],
      ),
      buildSession_DriverData(
        buildDriver(2, "BBB"), session,
        buildLongRunLaps(2, 10, 91.0, 0.10),
        [buildStint(2, 1, "MEDIUM", 1, 11)],
      ),
      buildSession_DriverData(
        buildDriver(3, "CCC"), session,
        buildLongRunLaps(3, 10, 92.0, 0.02),
        [buildStint(3, 1, "MEDIUM", 1, 11)],
      ),
    ];

    const result = aggregatePreRaceLongRuns(ds);
    expect(result.ranking).toHaveLength(3);
    expect(result.ranking.map((r) => r.acronym)).toEqual(["AAA", "BBB", "CCC"]);
    expect(result.ranking[0].paceRank).toBe(1);
    expect(result.compoundStress).toHaveLength(1);
    expect(result.compoundStress[0].sampleConfidence).toBe("MEDIUM");
    // CCC has slope ~0.02 vs median 0.10 → POSITIVE
    const ccc = result.watchList.find((w) => w.acronym === "CCC");
    expect(ccc).toBeDefined();
    expect(ccc!.signal).toBe("POSITIVE");
  });

  it("4. same driver in two sessions, more recent session wins", () => {
    const drv = buildDriver(1, "VER");
    const fp2 = buildSession("Practice 2", 100, "2024-09-06T15:00:00");
    const fp3 = buildSession("Practice 3", 101, "2024-09-07T11:30:00");

    const ds: DriverSessionData[] = [
      buildSession_DriverData(drv, fp2,
        buildLongRunLaps(1, 10, 90.0, 0.05),
        [buildStint(1, 1, "MEDIUM", 1, 11)]),
      buildSession_DriverData(drv, fp3,
        buildLongRunLaps(1, 10, 89.5, 0.04),
        [buildStint(1, 1, "SOFT", 1, 11)]),
    ];

    const result = aggregatePreRaceLongRuns(ds);
    expect(result.ranking).toHaveLength(1);
    expect(result.ranking[0].sessionName).toBe("Practice 3");
    expect(result.ranking[0].longRun.compound).toBe("SOFT");
  });

  it("5. driver with stint shorter than MIN_LAPS=7 is excluded", () => {
    const drv = buildDriver(1, "VER");
    const session = buildSession("Practice 2", 100, "2024-09-06T15:00:00");
    // Only 6 valid laps after pit-out
    const laps = buildLongRunLaps(1, 6, 90.0, 0.05);
    const stints = [buildStint(1, 1, "MEDIUM", 1, 7)];
    const ds = [buildSession_DriverData(drv, session, laps, stints)];

    const result = aggregatePreRaceLongRuns(ds);
    expect(result.ranking).toEqual([]);
    expect(result.totalDriversWithLongRun).toBe(0);
  });

  it("6. six drivers across SOFT/MEDIUM, compoundStress ordered SOFT then MEDIUM with sampleConfidence=MEDIUM", () => {
    const session = buildSession("Practice 2", 100, "2024-09-06T15:00:00");
    const ds: DriverSessionData[] = [];
    // 3 SOFT
    for (let i = 0; i < 3; i++) {
      const num = i + 1;
      ds.push(buildSession_DriverData(
        buildDriver(num, `S${num}`), session,
        buildLongRunLaps(num, 10, 89.0 + i * 0.1, 0.08),
        [buildStint(num, 1, "SOFT", 1, 11)],
      ));
    }
    // 3 MEDIUM
    for (let i = 0; i < 3; i++) {
      const num = i + 10;
      ds.push(buildSession_DriverData(
        buildDriver(num, `M${num}`), session,
        buildLongRunLaps(num, 10, 90.5 + i * 0.1, 0.05),
        [buildStint(num, 1, "MEDIUM", 1, 11)],
      ));
    }

    const result = aggregatePreRaceLongRuns(ds);
    expect(result.ranking).toHaveLength(6);
    expect(result.compoundStress).toHaveLength(2);
    expect(result.compoundStress[0].compound).toBe("SOFT");
    expect(result.compoundStress[1].compound).toBe("MEDIUM");
    expect(result.compoundStress[0].sampleConfidence).toBe("MEDIUM");
    expect(result.compoundStress[1].sampleConfidence).toBe("MEDIUM");
  });

  it("7. driver with very long stint (15 laps) is flagged NEUTRAL in watch list", () => {
    const session = buildSession("Practice 2", 100, "2024-09-06T15:00:00");
    const ds: DriverSessionData[] = [
      buildSession_DriverData(
        buildDriver(1, "AAA"), session,
        buildLongRunLaps(1, 10, 90.0, 0.05),
        [buildStint(1, 1, "MEDIUM", 1, 11)],
      ),
      buildSession_DriverData(
        buildDriver(2, "BBB"), session,
        buildLongRunLaps(2, 10, 90.5, 0.05),
        [buildStint(2, 1, "MEDIUM", 1, 11)],
      ),
      // CCC: very long 15-lap stint, pace average so no slope flag
      buildSession_DriverData(
        buildDriver(3, "CCC"), session,
        buildLongRunLaps(3, 15, 90.3, 0.05),
        [buildStint(3, 1, "MEDIUM", 1, 16)],
      ),
    ];

    const result = aggregatePreRaceLongRuns(ds);
    const ccc = result.watchList.find((w) => w.acronym === "CCC");
    expect(ccc).toBeDefined();
    expect(ccc!.signal).toBe("NEUTRAL");
    expect(ccc!.reason).toContain("15 giri");
  });

  it("8. determinism: same input three times yields identical output", () => {
    const session = buildSession("Practice 2", 100, "2024-09-06T15:00:00");
    const buildInput = (): DriverSessionData[] => [
      buildSession_DriverData(
        buildDriver(1, "AAA"), session,
        buildLongRunLaps(1, 10, 90.0, 0.05),
        [buildStint(1, 1, "MEDIUM", 1, 11)],
      ),
      buildSession_DriverData(
        buildDriver(2, "BBB"), session,
        buildLongRunLaps(2, 10, 91.0, 0.10),
        [buildStint(2, 1, "SOFT", 1, 11)],
      ),
    ];

    const r1 = aggregatePreRaceLongRuns(buildInput());
    const r2 = aggregatePreRaceLongRuns(buildInput());
    const r3 = aggregatePreRaceLongRuns(buildInput());
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r3));
  });
});
