import { describe, it, expect } from "vitest";
import { computeVirtualRaceEngineer } from "../virtualRaceEngineer";
import type { Lap, StintData, PitData, RaceControlMessage } from "../openf1";

const TOTAL = 44;
const PIT = 22;

function buildLaps(): Lap[] {
  const t0 = Date.parse("2026-01-01T13:00:00Z");
  let acc = 0;
  const laps: Lap[] = [];
  for (let n = 1; n <= TOTAL; n++) {
    let d = 90 + (n <= PIT ? n * 0.05 : (n - PIT) * 0.04);
    if (n === PIT + 1) d += 22;
    laps.push({
      driver_number: 63, lap_number: n, lap_duration: d,
      date_start: new Date(t0 + acc * 1000).toISOString(),
      duration_sector_1: null, duration_sector_2: null, duration_sector_3: null,
      is_pit_out_lap: n === PIT + 1,
    } as unknown as Lap);
    acc += d;
  }
  return laps;
}

const stints: StintData[] = [
  { driver_number: 63, stint_number: 1, compound: "MEDIUM", lap_start: 1, lap_end: PIT, tyre_age_at_start: 0 } as StintData,
  { driver_number: 63, stint_number: 2, compound: "HARD", lap_start: PIT + 1, lap_end: TOTAL, tyre_age_at_start: 0 } as StintData,
];

function rc(laps: Lap[], lap: number, message: string): RaceControlMessage {
  return {
    date: laps[lap - 1].date_start, lap_number: lap, category: "Flag",
    flag: null, scope: "Track", message,
  } as unknown as RaceControlMessage;
}

function run(mode: "RACE_ENGINEER" | "POST_RACE") {
  const laps = buildLaps();
  const pits: PitData[] = [{
    session_key: 1, driver_number: 63, lap_number: PIT, pit_duration: 24,
    lane_duration: 24, stop_duration: 2.4, date: laps[PIT - 1].date_start,
  } as unknown as PitData];
  const raceControl = [
    rc(laps, 30, "VIRTUAL SAFETY CAR DEPLOYED"),
    rc(laps, 34, "VSC ENDING"),
  ];
  return computeVirtualRaceEngineer(
    63, "RUS", 1, laps, stints, pits, [], raceControl,
    [], [], [], [], "BALANCED", [], null,
    "REAL_CONTEXT", null, null, null, mode,
  );
}

describe("alternativa ex-post: pit sotto neutralizzazione reale", () => {
  it("POST_RACE genera l'alternativa, RACE_ENGINEER no", () => {
    const ante = run("RACE_ENGINEER");
    const post = run("POST_RACE");
    expect(ante).not.toBeNull();
    expect(post).not.toBeNull();
    const match = (r: NonNullable<typeof post>) =>
      r.alternative_strategies.filter((a) => /Pit sotto/.test(a.name));
    expect(match(ante!)).toHaveLength(0);
    const found = match(post!);
    expect(found).toHaveLength(1);
    expect(found[0].pit_laps).toEqual([30]);
    expect(found[0].compounds).toEqual(["MEDIUM", "HARD"]);
  });
});
