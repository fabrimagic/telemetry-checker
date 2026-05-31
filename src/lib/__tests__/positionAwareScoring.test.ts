/**
 * Position-aware ranking adjustment
 * ─────────────────────────────────
 * Covers `computePositionAdjustment` and verifies that:
 *  (a) high undercut_opportunity → NEGATIVE position_score_adjustment (bonus)
 *  (b) high undercut_risk → POSITIVE adjustment (penalty)
 *  (c) null competitor_context → 0 (backward compat: empty intervals/positions
 *      ⇒ no behavioral change in ranking)
 *  (d) End-to-end: with empty intervals/positions, all alternatives have
 *      position_score_adjustment = 0 and the ranking matches the pure-pace
 *      baseline (snapshot lock from scenarioNeutralizationBonus).
 */

import { describe, it, expect } from "vitest";
import {
  computePositionAdjustment,
  computeVirtualRaceEngineer,
  sortAlternativesByPositionAwareScore,
  POSITION_ADJUSTMENT_MAX,
} from "../virtualRaceEngineer";
import type {
  Lap, StintData, PitData, WeatherData, RaceControlMessage,
  IntervalData, PositionData, Driver,
} from "../openf1";

describe("computePositionAdjustment", () => {
  it("returns 0 for null context", () => {
    expect(computePositionAdjustment(null, "BALANCED")).toBe(0);
    expect(computePositionAdjustment(undefined, "BALANCED")).toBe(0);
  });

  it("returns 0 when opportunity == risk (balanced)", () => {
    expect(
      computePositionAdjustment({ undercut_opportunity: 0.5, undercut_risk: 0.5 }, "BALANCED"),
    ).toBe(0);
  });

  it("returns NEGATIVE when opportunity dominates (attack bonus)", () => {
    const v = computePositionAdjustment(
      { undercut_opportunity: 0.8, undercut_risk: 0.1 }, "BALANCED",
    );
    expect(v).toBeLessThan(0);
  });

  it("returns POSITIVE when risk dominates (exposed penalty)", () => {
    const v = computePositionAdjustment(
      { undercut_opportunity: 0.1, undercut_risk: 0.8 }, "BALANCED",
    );
    expect(v).toBeGreaterThan(0);
  });

  it("AGGRESSIVE weights opportunity more than CONSERVATIVE", () => {
    const ctx = { undercut_opportunity: 0.7, undercut_risk: 0.3 };
    const aggr = computePositionAdjustment(ctx, "AGGRESSIVE");
    const cons = computePositionAdjustment(ctx, "CONSERVATIVE");
    expect(aggr).toBeLessThan(cons); // aggressive → more negative (bigger bonus)
  });

  it("clamps to ±POSITION_ADJUSTMENT_MAX", () => {
    const huge = computePositionAdjustment(
      { undercut_opportunity: 1, undercut_risk: 0 }, "AGGRESSIVE",
    );
    expect(huge).toBeGreaterThanOrEqual(-POSITION_ADJUSTMENT_MAX);
    const hugePos = computePositionAdjustment(
      { undercut_opportunity: 0, undercut_risk: 1 }, "CONSERVATIVE",
    );
    expect(hugePos).toBeLessThanOrEqual(POSITION_ADJUSTMENT_MAX);
  });
});

/* ── Backward-compat integration test ── */

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
  return { compound, driver_number: driver, lap_end, lap_start, meeting_key: 1, session_key: 9999, stint_number, tyre_age_at_start: 0 };
}
function buildPit(driver: number, lap_number: number): PitData {
  return { date: `2024-01-01T13:${String(lap_number).padStart(2, "0")}:00.000Z`, driver_number: driver, lane_duration: 22, lap_number, meeting_key: 1, pit_duration: 22, session_key: 9999, stop_duration: 2.5 };
}
const DRIVER: Driver = {
  driver_number: 16, broadcast_name: "C. LECLERC", full_name: "Charles Leclerc",
  name_acronym: "LEC", team_name: "Ferrari", team_colour: "E80020",
  headshot_url: null, session_key: 9999,
};

describe("computeVirtualRaceEngineer — position-aware integration", () => {
  it("with empty intervals/positions: every alternative has position_score_adjustment = 0", () => {
    const driver = 16;
    const laps: Lap[] = [];
    for (let i = 1; i <= 30; i++) {
      const inStint1 = i <= 15;
      const base = inStint1 ? 90 + (i - 1) * 0.05 : 91 + (i - 16) * 0.03;
      laps.push(buildLap(driver, i, base, { is_pit_out_lap: i === 16 }));
    }
    const stints: StintData[] = [
      buildStint(driver, 1, "SOFT", 1, 15),
      buildStint(driver, 2, "HARD", 16, 30),
    ];
    const pits: PitData[] = [buildPit(driver, 15)];
    const weather: WeatherData[] = [{
      air_temperature: 25, date: "2024-01-01T13:00:00.000Z", humidity: 50,
      meeting_key: 1, pressure: 1013, rainfall: 0, session_key: 9999,
      track_temperature: 35, wind_direction: 0, wind_speed: 5,
    }];
    const intervals: IntervalData[] = [];
    const positions: PositionData[] = [];
    const raceControl: RaceControlMessage[] = [];

    const result = computeVirtualRaceEngineer(
      driver, "LEC", 9999, laps, stints, pits, weather, raceControl,
      intervals, positions, [DRIVER], [], "BALANCED",
      null, null, "REAL_CONTEXT", null, null, null, "POST_RACE",
    );

    expect(result).not.toBeNull();
    for (const alt of result!.alternative_strategies) {
      expect(alt.position_score_adjustment ?? 0).toBe(0);
    }
  });
});

/* ── Real sort path: exercises sortAlternativesByPositionAwareScore ── */

describe("sortAlternativesByPositionAwareScore — real sort path", () => {
  type Alt = {
    name: string;
    estimated_delta_vs_actual: number;
    position_score_adjustment?: number;
  };

  function mkAlts(): Alt[] {
    // Three pure-pace-equivalent alternatives (same delta).
    return [
      { name: "Undercut L18", estimated_delta_vs_actual: 5.0 },
      { name: "Overcut L24",  estimated_delta_vs_actual: 5.0 },
      { name: "Stay out",     estimated_delta_vs_actual: 5.0 },
    ];
  }
  const scoringInput = [
    { name: "Undercut L18", isRecommended: false },
    { name: "Overcut L24",  isRecommended: false },
    { name: "Stay out",     isRecommended: false },
  ];

  it("with empty position adjustments + identical scores: preserves original order (stable)", () => {
    const alts = mkAlts();
    const altScores = new Map([
      [0, { adjusted_score: 5.0 }],
      [1, { adjusted_score: 5.0 }],
      [2, { adjusted_score: 5.0 }],
    ]);
    sortAlternativesByPositionAwareScore(alts, altScores, scoringInput);
    expect(alts.map(a => a.name)).toEqual(["Undercut L18", "Overcut L24", "Stay out"]);
  });

  it("attack opportunity on Overcut L24 promotes it above tied siblings", () => {
    const neutral = mkAlts();
    const altScores = new Map([
      [0, { adjusted_score: 5.0 }],
      [1, { adjusted_score: 5.0 }],
      [2, { adjusted_score: 5.0 }],
    ]);
    sortAlternativesByPositionAwareScore(neutral, altScores, scoringInput);
    const neutralOrder = neutral.map(a => a.name);

    const withOpp = mkAlts();
    // Negative position_score_adjustment = attack bonus → should move UP.
    withOpp[1].position_score_adjustment = -6;
    // Apply a NEGATIVE adjustment to Overcut L24 specifically.
    const idxBefore = withOpp.findIndex(a => a.name === "Overcut L24");
    expect(idxBefore).toBeGreaterThan(0);

    sortAlternativesByPositionAwareScore(withOpp, altScores, scoringInput);
    const idxAfter = withOpp.findIndex(a => a.name === "Overcut L24");
    expect(idxAfter).toBe(0); // promoted to top
    expect(neutralOrder).not.toEqual(withOpp.map(a => a.name)); // order changed
  });

  it("exposed defense (positive adjustment) pushes the alternative DOWN", () => {
    const alts = mkAlts();
    const altScores = new Map([
      [0, { adjusted_score: 5.0 }],
      [1, { adjusted_score: 5.0 }],
      [2, { adjusted_score: 5.0 }],
    ]);
    alts[0].position_score_adjustment = +6; // penalty on Undercut L18
    sortAlternativesByPositionAwareScore(alts, altScores, scoringInput);
    // Undercut L18 should now be LAST.
    expect(alts[alts.length - 1].name).toBe("Undercut L18");
  });

  it("missing altScores entry: fallback (estimated_delta_vs_actual) is HIGHER=BETTER and stable", () => {
    const alts: Alt[] = [
      { name: "Fast missing",  estimated_delta_vs_actual: 10.0 }, // no altScores
      { name: "Slow scored",   estimated_delta_vs_actual: 2.0  },
    ];
    const altScores = new Map([
      // idx 0 missing on purpose
      [1, { adjusted_score: 2.0 }],
    ]);
    const si = [
      { name: "Fast missing", isRecommended: false },
      { name: "Slow scored",  isRecommended: false },
    ];
    sortAlternativesByPositionAwareScore(alts, altScores, si);
    // Fallback must keep higher=better convention → Fast missing first.
    expect(alts[0].name).toBe("Fast missing");
  });
});
