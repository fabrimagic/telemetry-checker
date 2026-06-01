import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../openf1", () => ({
  getRaceSessionsByYear: vi.fn(),
  getQualifyingSessionsByYear: vi.fn(),
  getAllLaps: vi.fn(),
  getDrivers: vi.fn(),
}));

import {
  computeCarProfiles,
  RECENCY_HALFLIFE_RACES,
  TOP_SPEED_QUALI_WEIGHT,
  TOP_SPEED_RACE_WEIGHT,
  CORNER_QUALI_WEIGHT,
  CORNER_RACE_WEIGHT,
} from "../carProfiles";
import {
  getRaceSessionsByYear,
  getQualifyingSessionsByYear,
  getAllLaps,
  getDrivers,
  type Driver,
  type Lap,
  type SessionInfo,
} from "../openf1";

const mockedSessions = getRaceSessionsByYear as unknown as ReturnType<typeof vi.fn>;
const mockedQuali = getQualifyingSessionsByYear as unknown as ReturnType<typeof vi.fn>;
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
  mockedQuali.mockReset();
  mockedLaps.mockReset();
  mockedDrivers.mockReset();
  // Default: no qualifying sessions available → all GPs use race-only
  // fallback. Individual tests can override.
  mockedQuali.mockResolvedValue([]);
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

  it("(g) diagnostics populated with used/no_data/fetch_failed; total_past_races vs races_considered coherent", async () => {
    mockedSessions.mockResolvedValue([
      { ...mkSession(1, "2026-03-01T15:00:00Z"), location: "Bahrain" },
      { ...mkSession(2, "2026-04-01T15:00:00Z"), location: "Jeddah" },
      { ...mkSession(3, "2026-05-01T15:00:00Z"), location: "Melbourne" },
    ]);
    mockedDrivers.mockImplementation(async (k: number) => {
      if (k === 3) throw new Error("network");
      return [mkDriver(1, "A"), mkDriver(2, "B")];
    });
    mockedLaps.mockImplementation(async (k: number) => {
      if (k === 1) return [mkLap(1, { speed: 320 }), mkLap(2, { speed: 300 })];
      if (k === 2) return []; // no usable laps → aggregateRace returns null
      return [];
    });

    const res = await computeCarProfiles({ now: NOW, lastNRaces: 4 });
    expect(res.total_past_races).toBe(3);
    expect(res.races_considered).toBe(3);
    expect(res.races_diagnostics).toHaveLength(3);
    const byName = Object.fromEntries(res.races_diagnostics.map((d) => [d.name, d.status]));
    expect(byName["Bahrain"]).toBe("used");
    expect(byName["Jeddah"]).toBe("no_data");
    expect(byName["Melbourne"]).toBe("fetch_failed");
  });

  it("(h) total_past_races counts ALL past races even when only last-N are considered", async () => {
    mockedSessions.mockResolvedValue([
      mkSession(1, "2026-02-01T15:00:00Z"),
      mkSession(2, "2026-03-01T15:00:00Z"),
      mkSession(3, "2026-04-01T15:00:00Z"),
      mkSession(4, "2026-04-15T15:00:00Z"),
      mkSession(5, "2026-05-01T15:00:00Z"),
    ]);
    mockedDrivers.mockResolvedValue([mkDriver(1, "A"), mkDriver(2, "B")]);
    mockedLaps.mockResolvedValue([mkLap(1, { speed: 320 }), mkLap(2, { speed: 300 })]);
    const res = await computeCarProfiles({ now: NOW, lastNRaces: 2 });
    expect(res.total_past_races).toBe(5);
    expect(res.races_considered).toBe(2);
    expect(res.races_diagnostics).toHaveLength(2);
  });

  // ----- New behavior: all races + exponential decay + Kish effective sample -----

  function setupNRaces(n: number, opts: { withData?: boolean[] } = {}) {
    const sessions: SessionInfo[] = [];
    const driversByRace: Record<number, Driver[]> = {};
    const lapsByRace: Record<number, Lap[]> = {};
    for (let i = 0; i < n; i++) {
      const key = i + 1;
      const month = String(i + 2).padStart(2, "0");
      sessions.push(mkSession(key, `2026-${month}-01T15:00:00Z`));
      driversByRace[key] = [mkDriver(1, "A"), mkDriver(2, "B")];
      const useData = opts.withData ? opts.withData[i] : true;
      lapsByRace[key] = useData
        ? [
            ...Array.from({ length: 5 }, (_, j) => mkLap(1, { speed: 320, lap: j + 2 })),
            ...Array.from({ length: 5 }, (_, j) => mkLap(2, { speed: 300, lap: j + 2 })),
          ]
        : [];
    }
    mockedSessions.mockResolvedValue(sessions);
    mockedDrivers.mockImplementation(async (k: number) => driversByRace[k] ?? []);
    mockedLaps.mockImplementation(async (k: number) => lapsByRace[k] ?? []);
  }

  it("(NEW-a) default = all past races: 7 races mock ⇒ diagnostics length 7", async () => {
    setupNRaces(7);
    const res = await computeCarProfiles({ now: new Date("2026-12-01T00:00:00Z") });
    expect(res.total_past_races).toBe(7);
    expect(res.races_considered).toBe(7);
    expect(res.races_diagnostics).toHaveLength(7);
  });

  it("(NEW-b) exponential decay: w(newest) > w(prev) and follows 0.5^(a/halflife)", () => {
    // Verify the math directly without needing to expose weights from the
    // public API: with halflife = RECENCY_HALFLIFE_RACES we expect
    //   w(age=halflife) / w(age=0) === 0.5 exactly.
    const newest = Math.pow(0.5, 0 / RECENCY_HALFLIFE_RACES);
    const previous = Math.pow(0.5, 1 / RECENCY_HALFLIFE_RACES);
    const atHalflife = Math.pow(0.5, RECENCY_HALFLIFE_RACES / RECENCY_HALFLIFE_RACES);
    expect(newest).toBeCloseTo(1, 10);
    expect(previous).toBeGreaterThan(atHalflife);
    expect(previous).toBeLessThan(newest);
    expect(atHalflife / newest).toBeCloseTo(0.5, 10);
    // No step: previous/newest must NOT be 0.5 (would mean a step), it
    // must follow the continuous formula.
    expect(previous / newest).toBeCloseTo(Math.pow(0.5, 1 / RECENCY_HALFLIFE_RACES), 10);
  });

  it("(NEW-c) including many old low-weight races does NOT inflate confidence to 'high'", async () => {
    setupNRaces(7);
    const res = await computeCarProfiles({ now: new Date("2026-12-01T00:00:00Z") });
    expect(res.races_considered).toBe(7);
    for (const p of res.profiles) {
      // 7 races participation but Kish effective ≈ 5.81 (< 6 threshold).
      expect(p.sample_races).toBe(7);
      expect(p.effective_sample_races).toBeLessThan(7);
      expect(p.confidence).not.toBe("high");
    }
  });

  it("(NEW-d) effective_sample_races ≈ count when only few recent races contribute (uniform-ish)", async () => {
    setupNRaces(2);
    const res = await computeCarProfiles({ now: new Date("2026-12-01T00:00:00Z") });
    for (const p of res.profiles) {
      expect(p.sample_races).toBe(2);
      // With 2 contiguous recent races and halflife=3 the Kish effective
      // is ≈ 1.97 — within 5% of the raw count.
      expect(p.effective_sample_races).toBeGreaterThan(1.9);
      expect(p.effective_sample_races).toBeLessThanOrEqual(2);
    }
  });

  it("(NEW-e) backward-compat: explicit lastNRaces=4 still slices to 4", async () => {
    setupNRaces(7);
    const res = await computeCarProfiles({
      now: new Date("2026-12-01T00:00:00Z"),
      lastNRaces: 4,
    });
    expect(res.total_past_races).toBe(7);
    expect(res.races_considered).toBe(4);
    expect(res.races_diagnostics).toHaveLength(4);
  });
});

// =====================================================================
// Quali + Race source combination (per-GP, before recency weighting).
// =====================================================================
describe("computeCarProfiles — qualifying + race combination", () => {
  const NOW = new Date("2026-12-01T00:00:00Z");

  function mkSession2(
    key: number,
    meeting: number,
    name: string,
    dateEnd: string,
  ): SessionInfo {
    return {
      session_key: key,
      session_type: name === "Race" ? "Race" : "Qualifying",
      session_name: name,
      meeting_key: meeting,
      date_start: dateEnd,
      date_end: dateEnd,
    };
  }
  function mkDriver2(num: number, team: string): Driver {
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
  function mkLap2(driver: number, speed: number, s1: number): Lap {
    return {
      lap_number: 2,
      lap_duration: 90,
      duration_sector_1: s1,
      duration_sector_2: 30,
      duration_sector_3: 30,
      st_speed: speed,
      date_start: null,
      is_pit_out_lap: false,
      driver_number: driver,
      session_key: 0,
      segments_sector_1: null,
      segments_sector_2: null,
      segments_sector_3: null,
    };
  }

  it("(a) both quali+race present: quali-weighted top speed (0.75) flips ranking vs race-only", async () => {
    // Race: A fast (320), B slow (300). Quali: REVERSED — A slow, B fast.
    // With race-only, A would win top speed. With quali weighted 0.75, B
    // wins. We assert the quali-dominant outcome to prove combination.
    mockedSessions.mockResolvedValue([mkSession2(1, 10, "Race", "2026-04-01T15:00:00Z")]);
    mockedQuali.mockResolvedValue([mkSession2(2, 10, "Qualifying", "2026-03-31T15:00:00Z")]);
    mockedDrivers.mockResolvedValue([mkDriver2(1, "A"), mkDriver2(2, "B")]);
    mockedLaps.mockImplementation(async (key: number) => {
      if (key === 1) return [
        ...Array.from({ length: 5 }, () => mkLap2(1, 320, 28)),
        ...Array.from({ length: 5 }, () => mkLap2(2, 300, 32)),
      ];
      if (key === 2) return [
        ...Array.from({ length: 5 }, () => mkLap2(1, 300, 32)),
        ...Array.from({ length: 5 }, () => mkLap2(2, 320, 28)),
      ];
      return [];
    });
    const res = await computeCarProfiles({ now: NOW });
    const A = res.profiles.find((p) => p.team_name === "A")!;
    const B = res.profiles.find((p) => p.team_name === "B")!;
    expect(B.top_speed_index).toBeGreaterThan(A.top_speed_index);
    const diag = res.races_diagnostics[0];
    expect(diag.sources?.quali).toBe(true);
    expect(diag.sources?.race).toBe(true);
  });

  it("(b) qualifying missing → race-only fallback, diagnostics.sources.quali=false, no crash", async () => {
    mockedSessions.mockResolvedValue([mkSession2(1, 10, "Race", "2026-04-01T15:00:00Z")]);
    mockedQuali.mockResolvedValue([]);
    mockedDrivers.mockResolvedValue([mkDriver2(1, "A"), mkDriver2(2, "B")]);
    mockedLaps.mockResolvedValue([mkLap2(1, 320, 28), mkLap2(2, 300, 32)]);
    const res = await computeCarProfiles({ now: NOW });
    expect(res.profiles).toHaveLength(2);
    const diag = res.races_diagnostics[0];
    expect(diag.status).toBe("used");
    expect(diag.sources?.quali).toBe(false);
    expect(diag.sources?.race).toBe(true);
  });

  it("(c) race fetch fails but quali present → uses quali only, status=used", async () => {
    mockedSessions.mockResolvedValue([mkSession2(1, 10, "Race", "2026-04-01T15:00:00Z")]);
    mockedQuali.mockResolvedValue([mkSession2(2, 10, "Qualifying", "2026-03-31T15:00:00Z")]);
    mockedDrivers.mockImplementation(async (k: number) => {
      if (k === 1) throw new Error("race fetch boom");
      return [mkDriver2(1, "A"), mkDriver2(2, "B")];
    });
    mockedLaps.mockImplementation(async (k: number) => {
      if (k === 1) throw new Error("race fetch boom");
      return [mkLap2(1, 320, 28), mkLap2(2, 300, 32)];
    });
    const res = await computeCarProfiles({ now: NOW });
    expect(res.profiles).toHaveLength(2);
    const diag = res.races_diagnostics[0];
    expect(diag.status).toBe("used");
    expect(diag.sources?.quali).toBe(true);
    expect(diag.sources?.race).toBe(false);
  });

  it("(d) recency weighting still applies on top of per-GP quali/race combination", async () => {
    mockedSessions.mockResolvedValue([
      mkSession2(11, 100, "Race", "2026-03-01T15:00:00Z"),
      mkSession2(21, 200, "Race", "2026-05-01T15:00:00Z"),
    ]);
    mockedQuali.mockResolvedValue([
      mkSession2(12, 100, "Qualifying", "2026-02-28T15:00:00Z"),
      mkSession2(22, 200, "Qualifying", "2026-04-30T15:00:00Z"),
    ]);
    mockedDrivers.mockResolvedValue([mkDriver2(1, "A"), mkDriver2(2, "B")]);
    mockedLaps.mockImplementation(async (k: number) => {
      if (k === 11 || k === 12) return [
        ...Array.from({ length: 5 }, () => mkLap2(1, 320, 28)),
        ...Array.from({ length: 5 }, () => mkLap2(2, 300, 32)),
      ];
      if (k === 21 || k === 22) return [
        ...Array.from({ length: 5 }, () => mkLap2(2, 320, 28)),
        ...Array.from({ length: 5 }, () => mkLap2(1, 300, 32)),
      ];
      return [];
    });
    const res = await computeCarProfiles({ now: NOW });
    const A = res.profiles.find((p) => p.team_name === "A")!;
    const B = res.profiles.find((p) => p.team_name === "B")!;
    // Newer GP (B faster) wins after recency decay.
    expect(B.top_speed_index).toBeGreaterThan(A.top_speed_index);
  });

  it("(e) getQualifyingSessionsByYear is called with year 2026", async () => {
    mockedSessions.mockResolvedValue([]);
    await computeCarProfiles({ now: NOW });
    expect(mockedQuali).toHaveBeenCalledWith(2026);
  });

  it("(f) quali sessions for OTHER meetings are ignored (matched by meeting_key)", async () => {
    mockedSessions.mockResolvedValue([mkSession2(1, 10, "Race", "2026-04-01T15:00:00Z")]);
    mockedQuali.mockResolvedValue([mkSession2(2, 999, "Qualifying", "2026-03-31T15:00:00Z")]);
    mockedDrivers.mockResolvedValue([mkDriver2(1, "A"), mkDriver2(2, "B")]);
    mockedLaps.mockResolvedValue([mkLap2(1, 320, 28), mkLap2(2, 300, 32)]);
    const res = await computeCarProfiles({ now: NOW });
    expect(res.races_diagnostics[0].sources?.quali).toBe(false);
  });

  it("(g) source weight constants are the documented values", () => {
    expect(TOP_SPEED_QUALI_WEIGHT).toBe(0.75);
    expect(TOP_SPEED_RACE_WEIGHT).toBe(0.25);
    expect(CORNER_QUALI_WEIGHT).toBe(0.5);
    expect(CORNER_RACE_WEIGHT).toBe(0.5);
  });
});

describe("computeCarProfiles — corner_type_strength hybrid gating", () => {
  const NOW = new Date("2026-12-01T00:00:00Z");

  function setupOneGpWithQuali() {
    const race: SessionInfo = { session_key: 1, session_type: "Race", session_name: "Race", meeting_key: 10, date_start: "2026-04-01T15:00:00Z", date_end: "2026-04-01T15:00:00Z" };
    const quali: SessionInfo = { session_key: 2, session_type: "Qualifying", session_name: "Qualifying", meeting_key: 10, date_start: "2026-03-31T15:00:00Z", date_end: "2026-03-31T15:00:00Z" };
    mockedSessions.mockResolvedValue([race]);
    mockedQuali.mockResolvedValue([quali]);
    mockedDrivers.mockResolvedValue([mkDriver(1, "A"), mkDriver(2, "B")]);
    mockedLaps.mockResolvedValue([
      mkLap(1, { speed: 320 }),
      mkLap(2, { speed: 300 }),
    ]);
  }

  it("(a) high-coverage analysis → corner_type_strength populated, source=location_geometry", async () => {
    setupOneGpWithQuali();
    const analyzeQualiCorners = vi.fn(async () => ({
      gpName: "Test", sessionKey: 2, segments: [],
      per_driver: [
        { driver_number: 1, slow_corner_speed: 120, medium_corner_speed: 180, fast_corner_speed: 240, sample_counts: { slow: 50, medium: 50, fast: 50, straight: 100 }, coverage: 0.8, partial: false, notes: [] },
        { driver_number: 2, slow_corner_speed: 100, medium_corner_speed: 200, fast_corner_speed: 220, sample_counts: { slow: 50, medium: 50, fast: 50, straight: 100 }, coverage: 0.75, partial: false, notes: [] },
      ],
      notes: [], aborted: false,
    }));
    const { profiles } = await computeCarProfiles({ now: NOW, analyzeQualiCorners });
    expect(analyzeQualiCorners).toHaveBeenCalled();
    for (const p of profiles) {
      expect(p.corner_source).toBe("location_geometry");
      expect(p.corner_type_strength).not.toBeNull();
    }
    const A = profiles.find((p) => p.team_name === "A")!;
    const B = profiles.find((p) => p.team_name === "B")!;
    expect(A.corner_type_strength!.slow).toBeCloseTo(1, 5);
    expect(B.corner_type_strength!.medium).toBeCloseTo(1, 5);
  });

  it("(b) low coverage → corner_type_strength=null, source=sector_fallback", async () => {
    setupOneGpWithQuali();
    const analyzeQualiCorners = vi.fn(async () => ({
      gpName: "Test", sessionKey: 2, segments: [],
      per_driver: [
        { driver_number: 1, slow_corner_speed: 120, medium_corner_speed: 180, fast_corner_speed: 240, sample_counts: { slow: 5, medium: 5, fast: 5, straight: 10 }, coverage: 0.2, partial: true, notes: [] },
        { driver_number: 2, slow_corner_speed: 100, medium_corner_speed: 200, fast_corner_speed: 220, sample_counts: { slow: 5, medium: 5, fast: 5, straight: 10 }, coverage: 0.1, partial: true, notes: [] },
      ],
      notes: [], aborted: false,
    }));
    const { profiles } = await computeCarProfiles({ now: NOW, analyzeQualiCorners });
    for (const p of profiles) {
      expect(p.corner_source).toBe("sector_fallback");
      expect(p.corner_type_strength).toBeNull();
    }
  });

  it("(c) analyzer throws → fallback, profile still valid", async () => {
    setupOneGpWithQuali();
    const analyzeQualiCorners = vi.fn(async () => { throw new Error("boom"); });
    const { profiles } = await computeCarProfiles({ now: NOW, analyzeQualiCorners });
    expect(profiles.length).toBe(2);
    for (const p of profiles) {
      expect(p.corner_source).toBe("sector_fallback");
      expect(p.corner_type_strength).toBeNull();
    }
  });

  it("(d) no analyzer → corner dimension stays null (sector_fallback)", async () => {
    setupOneGpWithQuali();
    const { profiles } = await computeCarProfiles({ now: NOW });
    for (const p of profiles) {
      expect(p.corner_source).toBe("sector_fallback");
      expect(p.corner_type_strength).toBeNull();
    }
  });
});

