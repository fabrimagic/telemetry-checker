/**
 * Tests for buildCompetitorMatrix (pure function).
 *
 * We construct minimal mocks containing ONLY the fields read by
 * buildCompetitorMatrix — see competitorTracking.ts:
 *   - results[i].driverNumber, vreResult, laps, diaryEvents, cumDevResult, error
 *   - vreResult.driver_acronym, confidence, actual_strategy.{pit_laps, stints, total_race_time},
 *     pace_loss_results
 *   - sessionResults[i].driver_number, position, dnf, dns, dsq
 *   - drivers[i].driver_number, name_acronym, team_colour
 *
 * Other fields are typed via `as any` casts to keep the mocks small.
 */

import { describe, it, expect } from "vitest";
import { buildCompetitorMatrix } from "../competitorTracking";
import type { VreLoaderOutput } from "../vreLoader";
import type { Driver, SessionResult, WeatherData, RaceControlMessage } from "../openf1";

/* ── Mock factory helpers ─────────────────────────────────────────────── */

function mockDriver(num: number, acronym: string): Driver {
  return {
    driver_number: num,
    broadcast_name: acronym,
    full_name: acronym,
    name_acronym: acronym,
    team_name: "Team",
    team_colour: "ff0000",
    headshot_url: null,
    session_key: 1,
  };
}

function mockSessionResult(
  num: number,
  position: number,
  flags: { dnf?: boolean; dns?: boolean; dsq?: boolean } = {},
): SessionResult {
  return {
    dnf: !!flags.dnf,
    dns: !!flags.dns,
    dsq: !!flags.dsq,
    driver_number: num,
    duration: null,
    gap_to_leader: null,
    number_of_laps: 50,
    meeting_key: 1,
    position,
    session_key: 1,
  };
}

interface BuildVreOpts {
  pitLaps: number[];
  compounds: string[]; // one per stint
}

function mockVreOutput(
  driverNumber: number,
  acronym: string,
  opts: BuildVreOpts | null, // null => DNF: no vreResult
): VreLoaderOutput {
  if (!opts) {
    return {
      driverNumber,
      vreResult: null,
      alternativeVreResult: null,
      kdmResult: null,
      diaryEvents: [],
      laps: [],
      stints: [],
      pits: [],
      intervals: [],
      positions: [],
      cumDevResult: null,
      error: "DNF / no data",
    };
  }

  // Build minimal stints from compounds + pit lap boundaries
  let lapStart = 1;
  const stints = opts.compounds.map((compound, idx) => {
    const lapEnd = opts.pitLaps[idx] ?? 50;
    const stint = {
      stint_number: idx + 1,
      compound,
      lap_start: lapStart,
      lap_end: lapEnd,
      laps_count: lapEnd - lapStart + 1,
      tyre_age_at_start: 0,
      avg_lap_time: 90,
      degradation_slope: 0.05,
      r_squared: 0.9,
      excluded_laps: 0,
    };
    lapStart = lapEnd + 1;
    return stint;
  });

  const vreResult = {
    driver_number: driverNumber,
    driver_acronym: acronym,
    session_key: 1,
    actual_strategy: {
      pit_laps: opts.pitLaps,
      stints,
      pit_stops: [],
      total_race_time: 5400,
    },
    pace_loss_results: [],
    confidence: "HIGH" as const,
  } as any;

  return {
    driverNumber,
    vreResult,
    alternativeVreResult: null,
    kdmResult: null,
    diaryEvents: [],
    laps: [{ lap_number: 50 } as any], // for total_laps inference
    stints: [],
    pits: [],
    intervals: [],
    positions: [],
    cumDevResult: null,
    error: null,
  };
}

const noWeather: WeatherData[] = [];
const noRC: RaceControlMessage[] = [];

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("buildCompetitorMatrix", () => {
  it("orders drivers by final_position with DNF placed at the end", () => {
    const drivers: Driver[] = [
      mockDriver(1, "VER"),
      mockDriver(16, "LEC"),
      mockDriver(44, "HAM"),
    ];
    const sessionResults: SessionResult[] = [
      mockSessionResult(16, 1),                  // LEC: P1
      mockSessionResult(1, 2),                   // VER: P2
      mockSessionResult(44, 20, { dnf: true }), // HAM: DNF
    ];
    const results: VreLoaderOutput[] = [
      mockVreOutput(1, "VER", { pitLaps: [25], compounds: ["MEDIUM", "HARD"] }),
      mockVreOutput(16, "LEC", { pitLaps: [22], compounds: ["SOFT", "MEDIUM"] }),
      mockVreOutput(44, "HAM", null), // DNF → no vreResult
    ];

    const matrix = buildCompetitorMatrix(results, sessionResults, drivers, noWeather, noRC, 1);

    expect(matrix.drivers.map((d) => d.driver_acronym)).toEqual(["LEC", "VER", "HAM"]);
    expect(matrix.drivers[0].final_position).toBe(1);
    expect(matrix.drivers[1].final_position).toBe(2);
    // DNF entry: had_issues true and vreResult missing path used
    expect(matrix.drivers[2].had_issues).toBe(true);
    expect(matrix.drivers[2].error).not.toBeNull();
  });

  it("groups pit stops at laps 20/21/22 into a single cluster [20,22]", () => {
    const drivers: Driver[] = [
      mockDriver(1, "VER"),
      mockDriver(16, "LEC"),
      mockDriver(44, "HAM"),
    ];
    const sessionResults: SessionResult[] = [
      mockSessionResult(1, 1),
      mockSessionResult(16, 2),
      mockSessionResult(44, 3),
    ];
    const results: VreLoaderOutput[] = [
      mockVreOutput(1, "VER",  { pitLaps: [20], compounds: ["SOFT", "HARD"] }),
      mockVreOutput(16, "LEC", { pitLaps: [21], compounds: ["SOFT", "HARD"] }),
      mockVreOutput(44, "HAM", { pitLaps: [22], compounds: ["SOFT", "HARD"] }),
    ];

    const matrix = buildCompetitorMatrix(results, sessionResults, drivers, noWeather, noRC, 1);

    expect(matrix.pit_clusters).toHaveLength(1);
    expect(matrix.pit_clusters[0].lap_range).toEqual([20, 22]);
    expect(matrix.pit_clusters[0].driver_numbers.sort()).toEqual([1, 16, 44]);
  });

  it("buckets {SOFT, SOFT, MEDIUM} starting compounds into 2 groups", () => {
    const drivers: Driver[] = [
      mockDriver(1, "VER"),
      mockDriver(16, "LEC"),
      mockDriver(44, "HAM"),
    ];
    const sessionResults: SessionResult[] = [
      mockSessionResult(1, 1),
      mockSessionResult(16, 2),
      mockSessionResult(44, 3),
    ];
    const results: VreLoaderOutput[] = [
      mockVreOutput(1, "VER",  { pitLaps: [25], compounds: ["SOFT", "HARD"] }),
      mockVreOutput(16, "LEC", { pitLaps: [25], compounds: ["SOFT", "HARD"] }),
      mockVreOutput(44, "HAM", { pitLaps: [25], compounds: ["MEDIUM", "HARD"] }),
    ];

    const matrix = buildCompetitorMatrix(results, sessionResults, drivers, noWeather, noRC, 1);

    expect(matrix.compound_divergence_at_start).toHaveLength(2);
    const soft = matrix.compound_divergence_at_start.find((g) => g.compound === "SOFT");
    const med = matrix.compound_divergence_at_start.find((g) => g.compound === "MEDIUM");
    expect(soft?.driver_numbers.sort()).toEqual([1, 16]);
    expect(med?.driver_numbers).toEqual([44]);
  });
});
