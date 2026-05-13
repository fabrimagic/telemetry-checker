import { describe, it, expect } from "vitest";
import {
  resolveAdjacentDrivers,
  computeLocationWindow,
  pickPrePostTimestamps,
} from "../trackProjectionResolver";
import type { Lap, PositionData, Driver } from "../openf1";

const drv = (n: number, acr: string): Driver => ({
  driver_number: n,
  broadcast_name: acr,
  full_name: acr,
  name_acronym: acr,
  team_name: "T",
  team_colour: "fff",
  headshot_url: null,
  session_key: 1,
});

const lap = (n: number, d: number, dateStart: string | null): Lap => ({
  lap_number: n,
  lap_duration: 90,
  duration_sector_1: null,
  duration_sector_2: null,
  duration_sector_3: null,
  st_speed: null,
  date_start: dateStart,
  is_pit_out_lap: false,
  driver_number: d,
  session_key: 1,
  segments_sector_1: null,
  segments_sector_2: null,
  segments_sector_3: null,
});

describe("trackProjectionResolver", () => {
  it("resolveAdjacentDrivers identifies ahead/behind correctly", () => {
    const allDrivers = [drv(1, "AAA"), drv(2, "BBB"), drv(3, "CCC")];
    const positions: PositionData[] = [
      { date: "2024-01-01T00:00:00Z", driver_number: 1, meeting_key: 1, position: 1, session_key: 1 },
      { date: "2024-01-01T00:00:00Z", driver_number: 2, meeting_key: 1, position: 2, session_key: 1 },
      { date: "2024-01-01T00:00:00Z", driver_number: 3, meeting_key: 1, position: 3, session_key: 1 },
    ];
    const laps: Lap[] = [lap(10, 2, "2024-01-01T00:01:00Z")];
    const r = resolveAdjacentDrivers(2, 10, laps, positions, allDrivers);
    expect(r.ahead?.driver_number).toBe(1);
    expect(r.behind?.driver_number).toBe(3);
  });

  it("leader has no ahead, last has no behind", () => {
    const allDrivers = [drv(1, "AAA"), drv(2, "BBB"), drv(3, "CCC")];
    const positions: PositionData[] = [
      { date: "2024-01-01T00:00:00Z", driver_number: 1, meeting_key: 1, position: 1, session_key: 1 },
      { date: "2024-01-01T00:00:00Z", driver_number: 2, meeting_key: 1, position: 2, session_key: 1 },
      { date: "2024-01-01T00:00:00Z", driver_number: 3, meeting_key: 1, position: 3, session_key: 1 },
    ];
    const laps: Lap[] = [
      lap(10, 1, "2024-01-01T00:01:00Z"),
      lap(10, 3, "2024-01-01T00:01:00Z"),
    ];
    const leader = resolveAdjacentDrivers(1, 10, laps, positions, allDrivers);
    expect(leader.ahead).toBeNull();
    expect(leader.behind?.driver_number).toBe(2);
    const last = resolveAdjacentDrivers(3, 10, laps, positions, allDrivers);
    expect(last.behind).toBeNull();
    expect(last.ahead?.driver_number).toBe(2);
  });

  it("computeLocationWindow returns coherent window", () => {
    const laps: Lap[] = [
      lap(10, 5, "2024-01-01T12:00:00Z"),
      lap(11, 5, "2024-01-01T12:01:30Z"),
    ];
    const w = computeLocationWindow(5, 10, laps);
    expect(w).not.toBeNull();
    expect(new Date(w!.dateStart).getTime()).toBeLessThan(new Date(w!.dateEnd).getTime());
    expect(new Date(w!.dateEnd).getTime() - new Date(w!.dateStart).getTime()).toBeGreaterThanOrEqual(90_000);
  });

  it("pickPrePostTimestamps: postPit - prePit ≈ 30000 ms", () => {
    const laps: Lap[] = [
      lap(10, 5, "2024-01-01T12:00:00Z"),
      lap(11, 5, "2024-01-01T12:01:30Z"),
    ];
    const ts = pickPrePostTimestamps(5, 10, laps);
    expect(ts).not.toBeNull();
    const delta = new Date(ts!.postPit).getTime() - new Date(ts!.prePit).getTime();
    expect(delta).toBe(30_000);
  });
});
