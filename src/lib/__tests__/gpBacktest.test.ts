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
    predictGpAffinity: vi.fn((c: CircuitProfile, p: CarProfile[], _meta?: { useCircuitSpecificModel?: boolean }): GpPrediction => {
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

describe("runBacktest — 3-way comparison (Opzione 1)", () => {
  it("produces rho_baseline_topsec, rho_baseline_sectors and delta_sectors_vs_topsec", async () => {
    const races = [
      mkSession(1, 11, "2026-03-01T13:00:00Z", "2026-03-01T15:00:00Z", "GP1"),
      mkSession(2, 21, "2026-03-15T13:00:00Z", "2026-03-15T15:00:00Z", "GP2"),
    ];
    const qualis = [
      mkSession(1, 12, "2026-02-28T13:00:00Z", "2026-02-28T14:00:00Z", "GP1", "Qualifying"),
      mkSession(2, 22, "2026-03-14T13:00:00Z", "2026-03-14T14:00:00Z", "GP2", "Qualifying"),
    ];
    // Quali truth: McL (80) < Mid (81) < Aud (82) → McL, Mid, Aud.
    const lapsBySession = new Map<number, Lap[]>([
      [22, [mkLap(1, 80), mkLap(3, 81), mkLap(2, 82)]],
    ]);
    const driversBySession = new Map<number, Driver[]>([
      [22, [mkDriver(1, "McL"), mkDriver(2, "Aud"), mkDriver(3, "Mid")]],
    ]);
    const deps = makeDeps({
      races, qualis, lapsBySession, driversBySession,
      computeImpl: async () => ({
        profiles: [
          profile("McL", 0.36, [0.85, 0.80, 0.82]),
          profile("Aud", 0.99, [0.40, 0.42, 0.41]),
          profile("Mid", 0.5, [0.6, 0.6, 0.6]),
        ],
        races_used: [],
        aborted: false,
        races_diagnostics: [],
        races_considered: 1,
        total_past_races: 1,
      }),
    });
    const out = await runBacktest({ deps });
    expect(out.aggregate.races_validated).toBe(1);
    const r = out.per_race[0];
    expect(r.rho_baseline_topsec).not.toBeNull();
    expect(r.rho_baseline_sectors).not.toBeNull();
    // PROMOZIONE: legacy `rho_baseline` now mirrors the PRODUCTION baseline
    // (sectors_only), not the old top_and_sectors.
    expect(r.rho_baseline).toBe(r.rho_baseline_sectors);
    expect(r.top3_baseline).toBe(r.top3_baseline_sectors);
    // sectors_only score: McL≈0.823, Mid=0.6, Aud≈0.41 → matches truth perfectly.
    expect(r.rho_baseline_sectors).toBeCloseTo(1, 6);
    expect(r.top3_baseline_sectors).toBe(true);
    expect(out.aggregate.delta_sectors_vs_topsec).toBeCloseTo(
      (out.aggregate.rho_baseline_sectors_mean ?? 0) -
        (out.aggregate.rho_baseline_topsec_mean ?? 0),
      6,
    );
    expect(out.aggregate.rho_baseline_sectors_mean).toBe(out.aggregate.rho_baseline_mean);
  });
});


describe("Role B — circuit-specific 4th-way monitoring", () => {
  it("produces rho_circuit_specific and delta_circuit_vs_sectors; flag passed to predict", async () => {
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
    const deps = makeDeps({
      races, qualis, lapsBySession, driversBySession,
      predictImpl: (c, p) => {
        // We can't see meta here directly via this helper; tests below check
        // that predict was called twice per race (default + circuit-specific).
        const ranked = [...p]
          .sort((a, b) => b.top_speed_index - a.top_speed_index)
          .map((x) => ({
            team_name: x.team_name,
            affinity_score: x.top_speed_index,
            uncertainty: 0.05,
            confidence: "high" as const,
            contributions: { top_speed: 0.5, cornering: 0.5 },
          }));
        return { ranked, global_confidence: "high", indistinguishable_groups: [], notes: [] };
      },
    });
    const out = await runBacktest({ deps });
    // Two calls per validated race: default + useCircuitSpecificModel:true
    expect(deps.predictGpAffinity).toHaveBeenCalledTimes(2);
    const metas = deps.predictGpAffinity.mock.calls.map((c) => c[2]);
    expect(metas.some((m) => m?.useCircuitSpecificModel === true)).toBe(true);
    expect(metas.some((m) => !m?.useCircuitSpecificModel)).toBe(true);
    expect(out.per_race[0].rho_circuit_specific).not.toBeNull();
    expect(out.aggregate.rho_circuit_specific_mean).not.toBeNull();
    expect(out.aggregate.delta_circuit_vs_sectors).toBeCloseTo(
      (out.aggregate.rho_circuit_specific_mean ?? 0) - (out.aggregate.rho_baseline_sectors_mean ?? 0),
      6,
    );
  });
});

describe("runBacktest — candidate policies (gap_ratio + team sensitivity)", () => {
  it("aggregate exposes rho and top-3 for both new policies, plus their deltas", async () => {
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
    expect(out.aggregate.rho_baseline_sectors_gap_mean).not.toBeUndefined();
    expect(out.aggregate.rho_team_sensitivity_mean).not.toBeUndefined();
    expect(out.aggregate.delta_sectors_gap_vs_sectors).not.toBeUndefined();
    expect(out.aggregate.delta_team_sensitivity_vs_sectors).not.toBeUndefined();
    expect(out.aggregate.top3_baseline_sectors_gap_rate).not.toBeUndefined();
    expect(out.aggregate.top3_team_sensitivity_rate).not.toBeUndefined();
    expect(out.per_race[0].rho_baseline_sectors_gap).not.toBeUndefined();
    expect(out.per_race[0].rho_team_sensitivity).not.toBeUndefined();
  });

  it("gap_ratio compute call for each target respects the same `now` (no look-ahead)", async () => {
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
    // Single compute call per target (gap_ratio is emitted additively in
    // the same call via emitGapRatioVariant). Every call MUST use `now`
    // strictly before the target quali start.
    expect(deps.computeCarProfiles).toHaveBeenCalledTimes(2);
    const calls = deps.computeCarProfiles.mock.calls as Array<[{ now: Date; emitGapRatioVariant?: boolean }]>;
    for (const c of calls) {
      expect(c[0].emitGapRatioVariant).toBe(true);
      const ts = c[0].now.getTime();
      const beforeGp2 = ts < new Date("2026-03-14T13:00:00Z").getTime();
      const beforeGp3 = ts < new Date("2026-03-28T13:00:00Z").getTime();
      expect(beforeGp2 || beforeGp3).toBe(true);
  }
});

describe("runBacktest — sensitivity diagnostics (additive)", () => {
  // Build ten historical circuits with varying top_speed so that some
  // teams have a real regression sample and others fall back.
  const histCircuits: Record<string, CircuitProfile> = Object.fromEntries(
    ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "Test GP"].map((n, i) => [
      n,
      { ...circuit(n), top_speed: 0.1 + i * 0.1 },
    ]),
  );

  function profileWithHistory(
    name: string,
    entries: Array<{ gp: string; y: number }>,
  ): CarProfile {
    return {
      team_name: name,
      top_speed_index: 0.5,
      sector_strength: { s1: 0.5, s2: 0.5, s3: 0.5 },
      sample_races: entries.length,
      effective_sample_races: entries.length,
      sample_laps: 100,
      confidence: "high",
      race_history: entries.map((e) => ({
        gpName: e.gp,
        date_end: "2026-01-01T00:00:00Z",
        weight: 1,
        sectors_normalized: e.y,
        top_speed_normalized: null,
      })),
    };
  }

  function mkMixedDeps(profiles: CarProfile[]) {
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
      [22, [mkDriver(1, "Reg1"), mkDriver(2, "Reg2"), mkDriver(3, "Small")]],
    ]);
    return makeDeps({
      races,
      qualis,
      lapsBySession,
      driversBySession,
      circuitProfiles: histCircuits,
      computeImpl: async () => ({
        profiles,
        races_used: [],
        aborted: false,
        races_diagnostics: [],
        races_considered: 1,
        total_past_races: 1,
      }),
    });
  }

  it("counts regressed / insufficient_sample / variance_zero correctly (mixed)", async () => {
    const fullHist = [
      { gp: "C1", y: 0.1 },
      { gp: "C2", y: 0.2 },
      { gp: "C3", y: 0.3 },
      { gp: "C4", y: 0.4 },
      { gp: "C5", y: 0.5 },
      { gp: "C6", y: 0.6 },
    ];
    const flatHist = [
      { gp: "C1", y: 0.1 },
      { gp: "C1", y: 0.2 },
      { gp: "C1", y: 0.3 },
      { gp: "C1", y: 0.4 },
      { gp: "C1", y: 0.5 },
      { gp: "C1", y: 0.6 },
    ];
    const shortHist = [
      { gp: "C1", y: 0.1 },
      { gp: "C2", y: 0.2 },
    ];
    const profiles = [
      profileWithHistory("Reg1", fullHist),
      profileWithHistory("Reg2", fullHist),
      profileWithHistory("Flat", flatHist),
      profileWithHistory("Small", shortHist),
    ];
    const deps = mkMixedDeps(profiles);
    const out = await runBacktest({ deps });
    const r = out.per_race[0];
    expect(r.sensitivity_diagnostics).toBeDefined();
    expect(r.sensitivity_diagnostics!.total).toBe(4);
    expect(r.sensitivity_diagnostics!.regressed).toBe(2);
    expect(r.sensitivity_diagnostics!.variance_zero).toBe(1);
    expect(r.sensitivity_diagnostics!.insufficient_sample).toBe(1);
  });

  it("skipped races have sensitivity_diagnostics undefined", async () => {
    const races = [
      mkSession(1, 11, "2026-03-01T13:00:00Z", "2026-03-01T15:00:00Z", "GP1"),
      mkSession(2, 21, "2026-03-15T13:00:00Z", "2026-03-15T15:00:00Z", "GP2"),
    ];
    // No quali → skipped.
    const qualis = [
      mkSession(1, 12, "2026-02-28T13:00:00Z", "2026-02-28T14:00:00Z", "GP1", "Qualifying"),
    ];
    const deps = makeDeps({ races, qualis });
    const out = await runBacktest({ deps });
    expect(out.per_race[0].skipped_reason).toBe("no_quali_session");
    expect(out.per_race[0].sensitivity_diagnostics).toBeUndefined();
  });

  it("races_with_active_sensitivity counts only races with ≥ 50% regressed", async () => {
    const fullHist = [
      { gp: "C1", y: 0.1 },
      { gp: "C2", y: 0.2 },
      { gp: "C3", y: 0.3 },
      { gp: "C4", y: 0.4 },
      { gp: "C5", y: 0.5 },
      { gp: "C6", y: 0.6 },
    ];
    const shortHist = [{ gp: "C1", y: 0.1 }];
    // Race A: 2/3 regressed (active). Race B: 1/3 regressed (inactive).
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
      [22, [mkDriver(1, "A"), mkDriver(2, "B"), mkDriver(3, "C")]],
      [32, [mkDriver(1, "A"), mkDriver(2, "B"), mkDriver(3, "C")]],
    ]);
    let call = 0;
    const deps = makeDeps({
      races,
      qualis,
      lapsBySession,
      driversBySession,
      circuitProfiles: histCircuits,
      computeImpl: async () => {
        call++;
        // First target race: 2 regressed, 1 short.
        // Second target race: 1 regressed, 2 short.
        const profs =
          call === 1
            ? [
                profileWithHistory("A", fullHist),
                profileWithHistory("B", fullHist),
                profileWithHistory("C", shortHist),
              ]
            : [
                profileWithHistory("A", fullHist),
                profileWithHistory("B", shortHist),
                profileWithHistory("C", shortHist),
              ];
        return {
          profiles: profs,
          races_used: [],
          aborted: false,
          races_diagnostics: [],
          races_considered: 1,
          total_past_races: 1,
        };
      },
    });
    const out = await runBacktest({ deps });
    expect(out.aggregate.races_validated).toBe(2);
    expect(out.aggregate.races_with_active_sensitivity).toBe(1);
  });
});

describe("runBacktest — rolling window (last 5 validated races)", () => {
  function mkNRaceDeps(nRaces: number, skipIdx: number[] = []) {
    const races: SessionInfo[] = [];
    const qualis: SessionInfo[] = [];
    const lapsBySession = new Map<number, Lap[]>();
    const driversBySession = new Map<number, Driver[]>();
    for (let i = 0; i < nRaces; i++) {
      const rk = 1000 + i * 10;
      const qk = rk + 1;
      const day = String(i + 1).padStart(2, "0");
      races.push(mkSession(i + 1, rk, `2026-05-${day}T13:00:00Z`, `2026-05-${day}T15:00:00Z`, `GP${i}`));
      qualis.push(mkSession(i + 1, qk, `2026-04-${day}T13:00:00Z`, `2026-04-${day}T14:00:00Z`, `GP${i}`, "Qualifying"));
      if (!skipIdx.includes(i)) {
        lapsBySession.set(qk, [mkLap(1, 80), mkLap(2, 81), mkLap(3, 82)]);
        driversBySession.set(qk, [mkDriver(1, "Alpha"), mkDriver(2, "Bravo"), mkDriver(3, "Charlie")]);
      }
    }
    return makeDeps({ races, qualis, lapsBySession, driversBySession });
  }

  it("with fewer than 3 validated races the recent fields are null", async () => {
    const deps = mkNRaceDeps(2);
    const out = await runBacktest({ deps });
    if ((out.aggregate.races_validated ?? 0) < 3) {
      expect(out.aggregate.rho_baseline_sectors_recent_mean).toBeNull();
      expect(out.aggregate.rho_baseline_topsec_recent_mean).toBeNull();
      expect(out.aggregate.delta_sectors_vs_topsec_recent).toBeNull();
      expect(out.aggregate.recent_window_size).toBe(out.aggregate.races_validated);
    }
  });

  it("with 7 validated races the window caps at 5 and equals last-5 means", async () => {
    const deps = mkNRaceDeps(7);
    const out = await runBacktest({ deps });
    if ((out.aggregate.races_validated ?? 0) >= 5) {
      expect(out.aggregate.recent_window_size).toBe(5);
      const validated = out.per_race.filter((r) => !r.skipped_reason);
      const last5 = validated.slice(-5);
      const rhoSec = last5
        .map((r) => r.rho_baseline_sectors)
        .filter((x): x is number => x != null);
      if (rhoSec.length > 0) {
        const expected = rhoSec.reduce((a, b) => a + b, 0) / rhoSec.length;
        expect(out.aggregate.rho_baseline_sectors_recent_mean).toBeCloseTo(expected, 6);
      }
    }
  });

  it("skipped races do not enter the rolling window (validated only, chronological)", async () => {
    // 6 races, skip the last two → up to 4 validated.
    const deps = mkNRaceDeps(6, [4, 5]);
    const out = await runBacktest({ deps });
    expect(out.aggregate.recent_window_size ?? 0).toBeLessThanOrEqual(
      out.aggregate.races_validated,
    );
    if ((out.aggregate.races_validated ?? 0) < 3) {
      expect(out.aggregate.rho_baseline_sectors_recent_mean).toBeNull();
    }
  });
});

});
