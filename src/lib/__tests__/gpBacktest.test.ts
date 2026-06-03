import { describe, it, expect, vi } from "vitest";
import {
  runBacktest,
  spearman,
  topKHit,
  computeBaselineOrder,
  computeQualifyingOrderByTeam,
} from "../gpBacktest";
import type { CarProfile, ComputeCarProfilesResult } from "../carProfiles";
import type { CircuitProfile } from "../circuitProfiles";
import type { GpPrediction } from "../gpPrediction";
import type { Driver, Lap, SessionInfo } from "../openf1";

const teams = ["Alpha", "Bravo", "Charlie", "Delta"];

function profile(
  name: string,
  top: number,
  s: [number, number, number],
): CarProfile {
  return {
    team_name: name,
    top_speed_index: top,
    sector_strength: { s1: s[0], s2: s[1], s3: s[2] },
    sample_races: 3,
    effective_sample_races: 3,
    sample_laps: 100,
    confidence: "high",
  };
}

function circuit(name: string): CircuitProfile {
  return {
    gpName: name,
    top_speed: 0.5,
    slow_corner_traction: 0.5,
    medium_corner: 0.5,
    fast_corner: 0.5,
    tyre_deg: 0.5,
    overtaking_difficulty: 0.5,
    confidence: "high",
    source: "historical",
  };
}

function mkSession(
  meeting: number,
  session: number,
  date_start: string,
  date_end: string,
  location: string,
  session_name = "Race",
): SessionInfo {
  return {
    session_key: session,
    session_type: session_name === "Race" ? "Race" : "Qualifying",
    session_name,
    meeting_key: meeting,
    date_start,
    date_end,
    location,
    country_name: location,
  };
}

function mkDriver(num: number, team: string): Driver {
  return {
    driver_number: num,
    broadcast_name: `D${num}`,
    full_name: `Driver ${num}`,
    name_acronym: `D${num}`,
    team_name: team,
    team_colour: "FFFFFF",
    headshot_url: null,
    session_key: 0,
  };
}

function mkLap(driver: number, dur: number): Lap {
  return {
    lap_number: 1,
    lap_duration: dur,
    duration_sector_1: dur / 3,
    duration_sector_2: dur / 3,
    duration_sector_3: dur / 3,
    st_speed: 300,
    date_start: "2026-05-01T12:00:00Z",
    is_pit_out_lap: false,
    driver_number: driver,
    session_key: 0,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
  };
}

describe("spearman", () => {
  it("identical orders → 1", () => {
    expect(spearman(["a", "b", "c", "d"], ["a", "b", "c", "d"])).toBeCloseTo(1, 6);
  });
  it("inverse orders → -1", () => {
    expect(spearman(["a", "b", "c", "d"], ["d", "c", "b", "a"])).toBeCloseTo(-1, 6);
  });
  it("returns null when intersection < 2", () => {
    expect(spearman(["a"], ["a"])).toBeNull();
    expect(spearman(["a", "b"], ["c", "d"])).toBeNull();
  });
  it("uses only the intersection", () => {
    expect(spearman(["a", "b", "x"], ["a", "b", "y"])).toBeCloseTo(1, 6);
  });
});

describe("topKHit", () => {
  it("hit when pred #1 is in truth top-k", () => {
    expect(topKHit(["a", "b"], ["c", "a", "d"], 3)).toBe(true);
  });
  it("miss when pred #1 is outside truth top-k", () => {
    expect(topKHit(["a"], ["x", "y", "z", "a"], 3)).toBe(false);
  });
});

describe("computeBaselineOrder", () => {
  it("orders by overall strength, ignores any external context", () => {
    const profiles = [
      profile("Slow", 0.1, [0.2, 0.2, 0.2]),
      profile("Fast", 0.9, [0.9, 0.9, 0.9]),
      profile("Mid", 0.5, [0.5, 0.5, 0.5]),
    ];
    expect(computeBaselineOrder(profiles)).toEqual(["Fast", "Mid", "Slow"]);
  });

  it("sectors_only mode ignores top_speed_index → McLaren-like climbs the order", async () => {
    const { computePersistenceScore } = await import("../gpPrediction");
    const profiles = [
      // top low, sectors high (McLaren-like)
      profile("McL", 0.36, [0.85, 0.80, 0.82]),
      // top high, sectors low (Audi-like)
      profile("Aud", 0.99, [0.40, 0.42, 0.41]),
      profile("Mid", 0.5, [0.5, 0.5, 0.5]),
    ];
    const topsec = computeBaselineOrder(profiles, "top_and_sectors");
    const sectors = computeBaselineOrder(profiles, "sectors_only");
    // top_and_sectors: Audi ahead of McLaren.
    expect(topsec.indexOf("Aud")).toBeLessThan(topsec.indexOf("McL"));
    // sectors_only: McLaren ahead of Audi.
    expect(sectors.indexOf("McL")).toBeLessThan(sectors.indexOf("Aud"));
    // Coherence: order matches computePersistenceScore(.,"sectors_only") sorted desc.
    const expected = [...profiles]
      .map((p) => ({ t: p.team_name, s: computePersistenceScore(p, "sectors_only") }))
      .sort((a, b) => b.s - a.s || a.t.localeCompare(b.t))
      .map((x) => x.t);
    expect(sectors).toEqual(expected);
  });
});

describe("computeQualifyingOrderByTeam", () => {
  it("orders teams by best lap across their drivers", () => {
    const drivers = [mkDriver(1, "A"), mkDriver(2, "A"), mkDriver(3, "B")];
    const laps = [mkLap(1, 90), mkLap(2, 88), mkLap(3, 87)];
    expect(computeQualifyingOrderByTeam(laps, drivers)).toEqual(["B", "A"]);
  });
  it("ignores pit-out and invalid laps", () => {
    const drivers = [mkDriver(1, "A")];
    const laps = [
      { ...mkLap(1, 80), is_pit_out_lap: true },
      mkLap(1, 90),
    ];
    expect(computeQualifyingOrderByTeam(laps, drivers)).toEqual(["A"]);
  });
});

// ---------------------------------------------------------------------------
// runBacktest integration with mocked deps.
// ---------------------------------------------------------------------------

function makeDeps(overrides: {
  races?: SessionInfo[];
  qualis?: SessionInfo[];
  computeImpl?: (opts: { now?: Date }) => Promise<ComputeCarProfilesResult>;
  predictImpl?: (
    c: CircuitProfile,
    p: CarProfile[],
  ) => GpPrediction;
  lapsBySession?: Map<number, Lap[]>;
  driversBySession?: Map<number, Driver[]>;
  circuitProfiles?: Record<string, CircuitProfile>;
}) {
  const lapsBySession = overrides.lapsBySession ?? new Map();
  const driversBySession = overrides.driversBySession ?? new Map();
  return {
    getRaceSessionsByYear: vi.fn(async () => overrides.races ?? []),
    getQualifyingSessionsByYear: vi.fn(async () => overrides.qualis ?? []),
    computeCarProfiles: vi.fn(async (opts: { now?: Date } = {}) => {
      if (overrides.computeImpl) return overrides.computeImpl(opts);
      return {
        profiles: [
          profile("Alpha", 0.9, [0.9, 0.9, 0.9]),
          profile("Bravo", 0.6, [0.6, 0.6, 0.6]),
          profile("Charlie", 0.3, [0.3, 0.3, 0.3]),
        ],
        races_used: [],
        aborted: false,
        races_diagnostics: [],
        races_considered: 1,
        total_past_races: 1,
      } as ComputeCarProfilesResult;
    }),
    predictGpAffinity: vi.fn((c: CircuitProfile, p: CarProfile[]): GpPrediction => {
      if (overrides.predictImpl) return overrides.predictImpl(c, p);
      const ranked = [...p]
        .sort((a, b) => b.top_speed_index - a.top_speed_index)
        .map((x) => ({
          team_name: x.team_name,
          affinity_score: x.top_speed_index,
          uncertainty: 0.05,
          confidence: "high" as const,
          contributions: { top_speed: 0.5, cornering: 0.5 },
        }));
      return {
        ranked,
        global_confidence: "high",
        indistinguishable_groups: [],
        notes: [],
      };
    }),
    getAllLaps: vi.fn(async (sk: number) => lapsBySession.get(sk) ?? []),
    getDrivers: vi.fn(async (sk: number) => driversBySession.get(sk) ?? []),
    resolveCalendarGpName: vi.fn(() => "Test GP"),
    circuitProfiles: overrides.circuitProfiles ?? { "Test GP": circuit("Test GP") },
  };
}

describe("runBacktest — look-ahead protection", () => {
  it("computeCarProfiles is called with `now` strictly before each target's quali start", async () => {
    const races = [
      mkSession(1, 11, "2026-03-01T13:00:00Z", "2026-03-01T15:00:00Z", "GP1"),
      mkSession(2, 21, "2026-03-15T13:00:00Z", "2026-03-15T15:00:00Z", "GP2"),
      mkSession(3, 31, "2026-03-29T13:00:00Z", "2026-03-29T15:00:00Z", "GP3"),
    ];
    const qualis = [
      mkSession(1, 12, "2026-02-28T13:00:00Z", "2026-02-28T14:00:00Z", "GP1", "Qualifying"),
      mkSession(2, 22, "2026-03-14T13:00:00Z", "2026-03-14T14:00:00Z", "GP2", "Qualifying"),
      mkSession(3, 32, "2026-03-28T13:00:00Z", "2026-03-28T14:00:00Z", "GP3", "Qualifying"),
    ];
    const lapsBySession = new Map<number, Lap[]>([
      [22, [mkLap(1, 80), mkLap(2, 81), mkLap(3, 82)]],
      [32, [mkLap(1, 80), mkLap(2, 81), mkLap(3, 82)]],
    ]);
    const driversBySession = new Map<number, Driver[]>([
      [22, [mkDriver(1, "Alpha"), mkDriver(2, "Bravo"), mkDriver(3, "Charlie")]],
      [32, [mkDriver(1, "Alpha"), mkDriver(2, "Bravo"), mkDriver(3, "Charlie")]],
    ]);
    const deps = makeDeps({ races, qualis, lapsBySession, driversBySession });
    await runBacktest({ deps });

    // computeCarProfiles called twice (targets = races[1:]).
    expect(deps.computeCarProfiles).toHaveBeenCalledTimes(2);
    const call1 = deps.computeCarProfiles.mock.calls[0][0] as { now: Date };
    const call2 = deps.computeCarProfiles.mock.calls[1][0] as { now: Date };
    expect(call1.now.getTime()).toBeLessThan(new Date("2026-03-14T13:00:00Z").getTime());
    expect(call2.now.getTime()).toBeLessThan(new Date("2026-03-28T13:00:00Z").getTime());
    // And strictly after the previous race's date_end, so N-1 IS included.
    expect(call1.now.getTime()).toBeGreaterThan(new Date("2026-03-01T15:00:00Z").getTime());
    expect(call2.now.getTime()).toBeGreaterThan(new Date("2026-03-15T15:00:00Z").getTime());
  });

  it("fails (detects look-ahead) if quali data of N would influence the prediction", async () => {
    // If a buggy implementation passed `now` AFTER N's quali start, then
    // computeCarProfiles would observe N's data. We assert here that the
    // recorded now is strictly BEFORE the target quali start, which is the
    // contract the look-ahead test enforces. A regression would flip this.
    const races = [
      mkSession(1, 11, "2026-03-01T13:00:00Z", "2026-03-01T15:00:00Z", "GP1"),
      mkSession(2, 21, "2026-03-15T13:00:00Z", "2026-03-15T15:00:00Z", "GP2"),
    ];
    const qualis = [
      mkSession(1, 12, "2026-02-28T13:00:00Z", "2026-02-28T14:00:00Z", "GP1", "Qualifying"),
      mkSession(2, 22, "2026-03-14T13:00:00Z", "2026-03-14T14:00:00Z", "GP2", "Qualifying"),
    ];
    const lapsBySession = new Map<number, Lap[]>([
      [22, [mkLap(1, 80), mkLap(2, 81), mkLap(3, 82)]],
    ]);
    const driversBySession = new Map<number, Driver[]>([
      [22, [mkDriver(1, "Alpha"), mkDriver(2, "Bravo"), mkDriver(3, "Charlie")]],
    ]);
    const deps = makeDeps({ races, qualis, lapsBySession, driversBySession });
    await runBacktest({ deps, marginMs: 60_000 });
    const callNow = (deps.computeCarProfiles.mock.calls[0][0] as { now: Date }).now;
    expect(callNow.getTime()).toBeLessThan(
      new Date("2026-03-14T13:00:00Z").getTime(),
    );
  });
});

describe("runBacktest — baseline ignores target circuit", () => {
  it("baseline order is identical regardless of which circuit is used", async () => {
    const races = [
      mkSession(1, 11, "2026-03-01T13:00:00Z", "2026-03-01T15:00:00Z", "GP1"),
      mkSession(2, 21, "2026-03-15T13:00:00Z", "2026-03-15T15:00:00Z", "GP2"),
    ];
    const qualis = [
      mkSession(1, 12, "2026-02-28T13:00:00Z", "2026-02-28T14:00:00Z", "GP1", "Qualifying"),
      mkSession(2, 22, "2026-03-14T13:00:00Z", "2026-03-14T14:00:00Z", "GP2", "Qualifying"),
    ];
    // Quali truth order: Alpha (80) < Bravo (81) < Charlie (82) → Alpha,Bravo,Charlie.
    const lapsBySession = new Map<number, Lap[]>([
      [22, [mkLap(1, 80), mkLap(2, 81), mkLap(3, 82)]],
    ]);
    const driversBySession = new Map<number, Driver[]>([
      [22, [mkDriver(1, "Alpha"), mkDriver(2, "Bravo"), mkDriver(3, "Charlie")]],
    ]);
    // Two backtests with DIFFERENT circuit profiles for "Test GP" → baseline
    // must stay invariant (it ignores the circuit by construction).
    const circuitA: Record<string, CircuitProfile> = {
      "Test GP": { ...circuit("Test GP"), top_speed: 0.1, fast_corner: 0.9 },
    };
    const circuitB: Record<string, CircuitProfile> = {
      "Test GP": { ...circuit("Test GP"), top_speed: 0.9, fast_corner: 0.1 },
    };
    const depsA = makeDeps({
      races, qualis, lapsBySession, driversBySession,
      circuitProfiles: circuitA,
    });
    const depsB = makeDeps({
      races, qualis, lapsBySession, driversBySession,
      circuitProfiles: circuitB,
    });
    const a = await runBacktest({ deps: depsA });
    const b = await runBacktest({ deps: depsB });
    // Baseline rho must match across the two runs.
    expect(a.per_race[0].rho_baseline).toBeCloseTo(b.per_race[0].rho_baseline ?? NaN, 6);
  });
});

describe("runBacktest — robustness", () => {
  it("skips races without a Qualifying session and reports them", async () => {
    const races = [
      mkSession(1, 11, "2026-03-01T13:00:00Z", "2026-03-01T15:00:00Z", "GP1"),
      mkSession(2, 21, "2026-03-15T13:00:00Z", "2026-03-15T15:00:00Z", "GP2"),
    ];
    // No quali for meeting 2 → must be skipped.
    const qualis = [
      mkSession(1, 12, "2026-02-28T13:00:00Z", "2026-02-28T14:00:00Z", "GP1", "Qualifying"),
    ];
    const deps = makeDeps({ races, qualis });
    const out = await runBacktest({ deps });
    expect(out.per_race).toHaveLength(1);
    expect(out.per_race[0].skipped_reason).toBe("no_quali_session");
    expect(out.aggregate.races_validated).toBe(0);
    expect(out.aggregate.rho_model_mean).toBeNull();
    expect(out.aggregate.delta_mean).toBeNull();
  });

  it("output structure: per-race + aggregate + delta when validated", async () => {
    const races = [
      mkSession(1, 11, "2026-03-01T13:00:00Z", "2026-03-01T15:00:00Z", "GP1"),
      mkSession(2, 21, "2026-03-15T13:00:00Z", "2026-03-15T15:00:00Z", "GP2"),
    ];
    const qualis = [
      mkSession(1, 12, "2026-02-28T13:00:00Z", "2026-02-28T14:00:00Z", "GP1", "Qualifying"),
      mkSession(2, 22, "2026-03-14T13:00:00Z", "2026-03-14T14:00:00Z", "GP2", "Qualifying"),
    ];
    const lapsBySession = new Map<number, Lap[]>([
      [22, [mkLap(1, 80), mkLap(2, 81), mkLap(3, 82)]],
    ]);
    const driversBySession = new Map<number, Driver[]>([
      [22, [mkDriver(1, "Alpha"), mkDriver(2, "Bravo"), mkDriver(3, "Charlie")]],
    ]);
    const deps = makeDeps({ races, qualis, lapsBySession, driversBySession });
    const out = await runBacktest({ deps });
    expect(out.total_races).toBe(1);
    expect(out.per_race[0].gpName).toBe("Test GP");
    expect(out.per_race[0].rho_model).not.toBeNull();
    expect(out.per_race[0].rho_baseline).not.toBeNull();
    expect(out.aggregate.races_validated).toBe(1);
    expect(out.aggregate.delta_mean).toBe(
      (out.aggregate.rho_model_mean ?? 0) - (out.aggregate.rho_baseline_mean ?? 0),
    );
    expect(out.aggregate.top3_model_rate).not.toBeNull();
  });

  it("does not alter production state — computeCarProfiles is only CALLED", async () => {
    const races = [
      mkSession(1, 11, "2026-03-01T13:00:00Z", "2026-03-01T15:00:00Z", "GP1"),
      mkSession(2, 21, "2026-03-15T13:00:00Z", "2026-03-15T15:00:00Z", "GP2"),
    ];
    const qualis = [
      mkSession(1, 12, "2026-02-28T13:00:00Z", "2026-02-28T14:00:00Z", "GP1", "Qualifying"),
      mkSession(2, 22, "2026-03-14T13:00:00Z", "2026-03-14T14:00:00Z", "GP2", "Qualifying"),
    ];
    const lapsBySession = new Map<number, Lap[]>([
      [22, [mkLap(1, 80)]],
    ]);
    const driversBySession = new Map<number, Driver[]>([
      [22, [mkDriver(1, "Alpha")]],
    ]);
    const deps = makeDeps({ races, qualis, lapsBySession, driversBySession });
    await runBacktest({ deps });
    // computeCarProfiles is just a function call; deps are mocks, so nothing
    // could be mutated outside their closure. Verify call counts to confirm
    // the engine is only INVOKED, not patched.
    expect(deps.computeCarProfiles).toHaveBeenCalled();
    expect(deps.predictGpAffinity).toHaveBeenCalled();
    // Re-running yields identical results → no hidden state.
    const out2 = await runBacktest({ deps });
    expect(out2.total_races).toBe(1);
  });
});
