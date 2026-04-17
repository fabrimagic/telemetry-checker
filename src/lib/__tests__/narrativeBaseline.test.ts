/**
 * Narrative baseline snapshot test
 * ─────────────────────────────────
 * Goal: lock down the EXACT narrative strings produced by computeVirtualRaceEngineer
 * for a small set of representative scenarios. Any subsequent refactor that does
 * NOT change user-visible text must keep these snapshots green.
 *
 * Fixtures are minimal but realistic enough to activate the categories migrated
 * in the first pass: mode_context, weather, neutralization. Coverage of other
 * categories (degradation_quality, pace_loss, etc.) emerges naturally from the
 * model output and is captured by the snapshot too — so future migrations of
 * those categories will be protected as well.
 *
 * Smoke nature: snapshots use `toMatchSnapshot()` so the first run records the
 * baseline; subsequent runs compare against it. This is by design — we are
 * guarding against UNINTENDED text changes during the refactor.
 */

import { describe, it, expect } from "vitest";
import { computeVirtualRaceEngineer } from "../virtualRaceEngineer";
import type {
  Lap, StintData, PitData, WeatherData, RaceControlMessage,
  IntervalData, PositionData, Driver,
} from "../openf1";

/* ── Fixture builders ─────────────────────────────────────────── */

function buildLap(driver: number, lap_number: number, lap_duration: number, opts: Partial<Lap> = {}): Lap {
  return {
    lap_number,
    lap_duration,
    duration_sector_1: lap_duration / 3,
    duration_sector_2: lap_duration / 3,
    duration_sector_3: lap_duration / 3,
    st_speed: 300,
    date_start: `2024-01-01T13:${String(lap_number).padStart(2, "0")}:00.000Z`,
    is_pit_out_lap: false,
    driver_number: driver,
    session_key: 9999,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    ...opts,
  };
}

function buildStint(driver: number, stint_number: number, compound: string, lap_start: number, lap_end: number): StintData {
  return {
    compound,
    driver_number: driver,
    lap_end,
    lap_start,
    meeting_key: 1,
    session_key: 9999,
    stint_number,
    tyre_age_at_start: 0,
  };
}

function buildPit(driver: number, lap_number: number, date: string): PitData {
  return {
    date,
    driver_number: driver,
    lane_duration: 22,
    lap_number,
    meeting_key: 1,
    pit_duration: 22,
    session_key: 9999,
    stop_duration: 2.5,
  };
}

const DRIVER: Driver = {
  driver_number: 16,
  broadcast_name: "C. LECLERC",
  full_name: "Charles Leclerc",
  name_acronym: "LEC",
  team_name: "Ferrari",
  team_colour: "E80020",
  headshot_url: null,
  session_key: 9999,
};

/* ── Scenario A: normal race, 1 pit, no SC, dry ──────────────── */

function scenarioNormal() {
  const driver = 16;
  // 30 laps, pit at lap 15. Stint 1: SOFT laps 1-15 (degrading 0.05s/lap).
  // Stint 2: HARD laps 16-30 (degrading 0.03s/lap).
  const laps: Lap[] = [];
  for (let i = 1; i <= 30; i++) {
    const inStint1 = i <= 15;
    const base = inStint1 ? 90 + (i - 1) * 0.05 : 91 + (i - 16) * 0.03;
    const isPitOut = i === 16;
    laps.push(buildLap(driver, i, base, { is_pit_out_lap: isPitOut }));
  }
  const stints: StintData[] = [
    buildStint(driver, 1, "SOFT", 1, 15),
    buildStint(driver, 2, "HARD", 16, 30),
  ];
  const pits: PitData[] = [buildPit(driver, 15, "2024-01-01T13:15:00.000Z")];
  const weather: WeatherData[] = [{
    air_temperature: 25, date: "2024-01-01T13:00:00.000Z", humidity: 50,
    meeting_key: 1, pressure: 1013, rainfall: 0, session_key: 9999,
    track_temperature: 35, wind_direction: 0, wind_speed: 5,
  }];
  const raceControl: RaceControlMessage[] = [];
  return { driver, laps, stints, pits, weather, raceControl };
}

/* ── Scenario B: race with Safety Car around pit window ───────── */

function scenarioWithSC() {
  const base = scenarioNormal();
  // SC deployed lap 14, ends lap 16 → covers actual pit
  const raceControl: RaceControlMessage[] = [
    { date: "2024-01-01T13:14:00.000Z", category: "SafetyCar", flag: null,
      message: "SAFETY CAR DEPLOYED", scope: "Track", sector: null,
      meeting_key: 1, session_key: 9999 },
    { date: "2024-01-01T13:17:00.000Z", category: "SafetyCar", flag: null,
      message: "SAFETY CAR IN THIS LAP", scope: "Track", sector: null,
      meeting_key: 1, session_key: 9999 },
  ];
  return { ...base, raceControl };
}

/* ── Scenario C: invalid degradation (negative slope) ─────────── */

function scenarioInvalidDeg() {
  const driver = 16;
  // Stint 1 has DECREASING lap times (faster over time → invalid degradation)
  const laps: Lap[] = [];
  for (let i = 1; i <= 30; i++) {
    const inStint1 = i <= 15;
    const base = inStint1 ? 92 - (i - 1) * 0.1 : 91 + (i - 16) * 0.03;
    laps.push(buildLap(driver, i, base, { is_pit_out_lap: i === 16 }));
  }
  const stints: StintData[] = [
    buildStint(driver, 1, "MEDIUM", 1, 15),
    buildStint(driver, 2, "HARD", 16, 30),
  ];
  const pits: PitData[] = [buildPit(driver, 15, "2024-01-01T13:15:00.000Z")];
  const weather: WeatherData[] = [{
    air_temperature: 25, date: "2024-01-01T13:00:00.000Z", humidity: 50,
    meeting_key: 1, pressure: 1013, rainfall: 0, session_key: 9999,
    track_temperature: 35, wind_direction: 0, wind_speed: 5,
  }];
  return { driver, laps, stints, pits, weather, raceControl: [] };
}

/* ── Snapshot extractor ────────────────────────────────────────── */

function extractNarrativeSnapshot(result: ReturnType<typeof computeVirtualRaceEngineer>) {
  if (!result) return { ok: false };
  return {
    ok: true,
    narrative_insights: result.narrative_insights,
    recommended: {
      pros: result.recommended_strategy.pros ?? [],
      cons: result.recommended_strategy.cons ?? [],
      reason: result.recommended_strategy.reason,
      description: result.recommended_strategy.description ?? null,
    },
    alternatives: result.alternative_strategies.map((a) => ({
      name: a.name,
      pros: a.pros,
      cons: a.cons,
      description: a.description,
    })),
  };
}

function runVRE(s: ReturnType<typeof scenarioNormal>) {
  const intervals: IntervalData[] = [];
  const positions: PositionData[] = [];
  return computeVirtualRaceEngineer(
    s.driver,
    "LEC",
    9999,
    s.laps,
    s.stints,
    s.pits,
    s.weather,
    s.raceControl,
    intervals,
    positions,
    [DRIVER],
  );
}

/* ── Tests ─────────────────────────────────────────────────────── */

describe("VRE narrative baseline (pre-refactor snapshot)", () => {
  it("scenario A — normal race, 1 pit, dry, no SC", () => {
    const result = runVRE(scenarioNormal());
    expect(extractNarrativeSnapshot(result)).toMatchSnapshot();
  });

  it("scenario B — Safety Car around the pit window", () => {
    const result = runVRE(scenarioWithSC());
    expect(extractNarrativeSnapshot(result)).toMatchSnapshot();
  });

  it("scenario C — invalid degradation (negative slope on stint 1)", () => {
    const result = runVRE(scenarioInvalidDeg());
    expect(extractNarrativeSnapshot(result)).toMatchSnapshot();
  });
});
