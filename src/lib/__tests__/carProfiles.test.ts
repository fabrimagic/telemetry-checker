import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../openf1", () => ({
  getRaceSessionsByYear: vi.fn(),
  getAllLaps: vi.fn(),
  getDrivers: vi.fn(),
}));

import { computeCarProfiles } from "../carProfiles";
import {
  getRaceSessionsByYear,
  getAllLaps,
  getDrivers,
  type Driver,
  type Lap,
  type SessionInfo,
} from "../openf1";

const mockedSessions = getRaceSessionsByYear as unknown as ReturnType<typeof vi.fn>;
const mockedLaps = getAllLaps as unknown as ReturnType<typeof vi.fn>;
const mockedDrivers = getDrivers as unknown as ReturnType<typeof vi.fn>;

function mkSession(key: number, dateEnd: string): SessionInfo {
  return {
    session_key: key,
    session_type: "Race",
    session_name: "Race",
    meeting_key: key,
    date_start: dateEnd,
    date_end: dateEnd,
  };
}

function mkDriver(num: number, team: string): Driver {
  return {
    driver_number: num,
    broadcast_name: `D${num}`,
    full_name: `Driver ${num}`,
    name_acronym: `D${num}`,
    team_name: team,
    team_colour: "fff",
    headshot_url: null,
    session_key: 0,
  };
}

function mkLap(
  driver: number,
  opts: {
    speed?: number | null;
    s1?: number | null;
    s2?: number | null;
    s3?: number | null;
    pitOut?: boolean;
    invalid?: boolean;
    lap?: number;
  } = {},
): Lap {
  return {
    lap_number: opts.lap ?? 1,
    lap_duration: opts.invalid ? null : 90,
    duration_sector_1: opts.s1 ?? 30,
    duration_sector_2: opts.s2 ?? 30,
    duration_sector_3: opts.s3 ?? 30,
    st_speed: opts.speed ?? 300,
    date_start: null,
    is_pit_out_lap: !!opts.pitOut,
    driver_number: driver,
    session_key: 0,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
  };
}

beforeEach(() => {
  mockedSessions.mockReset();
  mockedLaps.mockReset();
  mockedDrivers.mockReset();
});

describe("computeCarProfiles", () => {
  const NOW = new Date("2026-06-01T00:00:00Z");

  function setupTwoRaces() {
    // Race 1 (older): Team A faster on top speed
    // Race 2 (newer): Team B faster on top speed
    mockedSessions.mockResolvedValue([
      mkSession(1, "2026-04-01T15:00:00Z"),
      mkSession(2, "2026-05-01T15:00:00Z"),
      mkSession(99, "2026-12-01T15:00:00Z"), // future, excluded
    ]);

    const driversByRace: Record<number, Driver[]> = {
      1: [mkDriver(1, "A"), mkDriver(2, "B")],
      2: [mkDriver(1, "A"), mkDriver(2, "B")],
    };
    const lapsByRace: Record<number, Lap[]> = {
      1: [
        // Team A: higher st_speed, faster s1
        ...Array.from({ length: 10 }, (_, i) => mkLap(1, { speed: 320, s1: 28, s2: 30, s3: 30, lap: i + 2 })),
        // Team B: lower st_speed, slower s1
        ...Array.from({ length: 10 }, (_, i) => mkLap(2, { speed: 300, s1: 32, s2: 30, s3: 30, lap: i + 2 })),
        // pit-out lap (excluded)
        mkLap(1, { speed: 999, pitOut: true }),
        // invalid lap_duration (excluded)
        mkLap(2, { speed: 999, invalid: true }),
      ],
      2: [
        // Team B faster
        ...Array.from({ length: 10 }, (_, i) => mkLap(2, { speed: 330, s1: 27, s2: 30, s3: 30, lap: i + 2 })),
        ...Array.from({ length: 10 }, (_, i) => mkLap(1, { speed: 310, s1: 31, s2: 30, s3: 30, lap: i + 2 })),
      ],
    };
    mockedLaps.mockImplementation(async (key: number) => lapsByRace[key] ?? []);
    mockedDrivers.mockImplementation(async (key: number) => driversByRace[key] ?? []);
  }

  it("(a) join driver→team, excludes pit-out/invalid laps, normalizes 0..1", async () => {
    setupTwoRaces();
    const { profiles, races_used } = await computeCarProfiles({ now: NOW, lastNRaces: 4 });
    expect(races_used).toHaveLength(2);
    expect(profiles.map((p) => p.team_name).sort()).toEqual(["A", "B"]);
    for (const p of profiles) {
      expect(p.top_speed_index).toBeGreaterThanOrEqual(0);
      expect(p.top_speed_index).toBeLessThanOrEqual(1);
      expect(p.sector_strength.s1).toBeGreaterThanOrEqual(0);
      expect(p.sector_strength.s1).toBeLessThanOrEqual(1);
    }
    // At least one team is at the max (1) in top speed.
    const tops = profiles.map((p) => p.top_speed_index);
    expect(Math.max(...tops)).toBeCloseTo(1, 5);
    expect(Math.min(...tops)).toBeCloseTo(0, 5);
  });

  it("(b) recent race weighs more: B (winner of newer race) outranks A in top speed", async () => {
    setupTwoRaces();
    const { profiles } = await computeCarProfiles({ now: NOW, lastNRaces: 4 });
    const a = profiles.find((p) => p.team_name === "A")!;
    const b = profiles.find((p) => p.team_name === "B")!;
    expect(b.top_speed_index).toBeGreaterThan(a.top_speed_index);
  });

  it("(c) a race that fails to fetch is skipped, others processed", async () => {
    mockedSessions.mockResolvedValue([
      mkSession(1, "2026-04-01T15:00:00Z"),
      mkSession(2, "2026-05-01T15:00:00Z"),
    ]);
    mockedDrivers.mockImplementation(async (k: number) => {
      if (k === 1) throw new Error("boom");
      return [mkDriver(1, "A"), mkDriver(2, "B")];
    });
    mockedLaps.mockImplementation(async (k: number) => {
      if (k === 1) return [];
      return [
        mkLap(1, { speed: 320 }),
        mkLap(2, { speed: 300 }),
      ];
    });
    const onProgress = vi.fn();
    const { profiles, races_used } = await computeCarProfiles({ now: NOW, onProgress });
    expect(races_used).toHaveLength(1);
    expect(profiles).toHaveLength(2);
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it("(d) few races/laps → confidence low", async () => {
    mockedSessions.mockResolvedValue([mkSession(1, "2026-04-01T15:00:00Z")]);
    mockedDrivers.mockResolvedValue([mkDriver(1, "A"), mkDriver(2, "B")]);
    mockedLaps.mockResolvedValue([mkLap(1, { speed: 320 }), mkLap(2, { speed: 300 })]);
    const { profiles } = await computeCarProfiles({ now: NOW });
    for (const p of profiles) {
      expect(p.confidence).toBe("low");
      expect(p.sample_races).toBe(1);
    }
  });

  it("(e) abort → partial results with aborted=true", async () => {
    mockedSessions.mockResolvedValue([
      mkSession(1, "2026-04-01T15:00:00Z"),
      mkSession(2, "2026-05-01T15:00:00Z"),
    ]);
    mockedDrivers.mockResolvedValue([mkDriver(1, "A")]);
    mockedLaps.mockResolvedValue([mkLap(1, { speed: 320 })]);
    const ctrl = new AbortController();
    let calls = 0;
    mockedLaps.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        ctrl.abort();
        return [mkLap(1, { speed: 320 })];
      }
      return [];
    });
    const res = await computeCarProfiles({ now: NOW, signal: ctrl.signal });
    expect(res.aborted).toBe(true);
    expect(res.races_used.length).toBeLessThanOrEqual(1);
  });

  it("(f) no team data → empty array, no throw", async () => {
    mockedSessions.mockResolvedValue([]);
    const res = await computeCarProfiles({ now: NOW });
    expect(res.profiles).toEqual([]);
    expect(res.races_used).toEqual([]);
  });
});
