import { describe, it, expect } from "vitest";
import {
  aggregateTimelineConfidence,
  estimateTyreThermalState,
  estimateTrackGripState,
  computeDegradationValidationContext,
  type SoftSensorsLapState,
  type SoftSensorConfidence,
  type SoftSensorsTimeline,
} from "../softSensors";
import type { StintAnalysis, PitStopAnalysis } from "../virtualRaceEngineer";
import type { BattleContext } from "../vreContext";
import type { WeatherCondition } from "../weatherClassification";
import type { TrackStatus } from "../trackStatusClassification";
import type { DegradationValidationResult } from "../degradationValidation";

function makeLap(overall: SoftSensorConfidence, lapNumber = 1): SoftSensorsLapState {
  return {
    lap_number: lapNumber,
    stint_number: 1,
    tyre_thermal: { label: "IN_WINDOW", score: 0.6, confidence: overall, reasons: [] },
    tyre_stress: { label: "LOW", score: 0.1, confidence: overall, reasons: [] },
    track_grip: { label: "STABLE", score: 0.7, confidence: overall, reasons: [] },
    overall_confidence: overall,
    reliability_notes: [],
  };
}

describe("aggregateTimelineConfidence (distributive)", () => {
  it("does not return LOW when only the final lap is LOW but >70% are HIGH", () => {
    const laps: SoftSensorsLapState[] = [];
    for (let i = 1; i <= 9; i++) laps.push(makeLap("HIGH", i));
    laps.push(makeLap("LOW", 10)); // last lap LOW (10% of laps)
    expect(aggregateTimelineConfidence(laps)).not.toBe("LOW");
    // 1/10 = 10% LOW ≤ 40%, and nonHigh 10% ≤ 30% → HIGH
    expect(aggregateTimelineConfidence(laps)).toBe("HIGH");
  });

  it("returns LOW when more than 40% of laps have LOW confidence", () => {
    const laps: SoftSensorsLapState[] = [];
    for (let i = 1; i <= 5; i++) laps.push(makeLap("LOW", i));
    for (let i = 6; i <= 10; i++) laps.push(makeLap("HIGH", i));
    // 5/10 = 50% LOW > 40%
    expect(aggregateTimelineConfidence(laps)).toBe("LOW");
  });

  it("returns MEDIUM when >30% are non-HIGH but LOW ≤40%", () => {
    const laps: SoftSensorsLapState[] = [];
    for (let i = 1; i <= 6; i++) laps.push(makeLap("HIGH", i));
    for (let i = 7; i <= 10; i++) laps.push(makeLap("MEDIUM", i));
    // 4/10 = 40% non-HIGH, 0% LOW
    expect(aggregateTimelineConfidence(laps)).toBe("MEDIUM");
  });

  it("returns LOW for empty timeline", () => {
    expect(aggregateTimelineConfidence([])).toBe("LOW");
  });
});

describe("estimateTyreThermalState — battle during warmup", () => {
  it("emits WARMING_UP with MEDIUM confidence when driver is in battle during warmup (not UNKNOWN)", () => {
    const stint: StintAnalysis = {
      stint_number: 2,
      compound: "MEDIUM",
      lap_start: 10,
      lap_end: 25,
      laps_count: 16,
      tyre_age_at_start: 0,
      avg_lap_time: null,
      degradation_slope: null,
      r_squared: null,
      excluded_laps: 0,
    };
    const pitStops: PitStopAnalysis[] = [];
    const weatherMap = new Map<number, WeatherCondition>();
    for (let l = 1; l <= 30; l++) weatherMap.set(l, "DRY");
    const trackStatusMap = new Map<number, TrackStatus>();
    for (let l = 1; l <= 30; l++) trackStatusMap.set(l, "GREEN");
    const battle: BattleContext = {
      total_episodes: 1,
      total_battle_laps: 3,
      attacking_episodes: 1,
      defending_episodes: 0,
      longest_episode: null,
      episodes: [],
      battle_laps: new Set<number>([11]),
    };

    // Second lap of stint (tyreAge = 1) with battle active
    const result = estimateTyreThermalState(stint, 11, pitStops, weatherMap, trackStatusMap, battle);
    expect(result.label).toBe("WARMING_UP");
    expect(result.confidence).toBe("MEDIUM");
    expect(result.contaminated_by ?? []).toContain("battaglia attiva");
  });
});

describe("estimateTrackGripState — earlier window at race start", () => {
  it("does not emit IMPROVING wet→dry transition when no earlier laps exist", () => {
    // Race just started (currentLap=3), only wet+dry mix in recent window
    const weatherMap = new Map<number, WeatherCondition>();
    weatherMap.set(1, "DRY");
    weatherMap.set(2, "DRY");
    weatherMap.set(3, "DRY");
    const trackStatusMap = new Map<number, TrackStatus>();
    const result = estimateTrackGripState(weatherMap, trackStatusMap, 3, 50);
    // With no earlier window and only dry data, IMPROVING dry-rubbering assumption
    // is allowed (early race) but wet→dry IMPROVING must not fire.
    expect(result.label).not.toBe("UNKNOWN");
    // The reasons must not reference wet→dry transition
    const joinedReasons = result.reasons.join(" ");
    expect(joinedReasons).not.toMatch(/asciugatura/);
  });

  it("still allows wet→dry IMPROVING when an earlier window with WET exists", () => {
    const weatherMap = new Map<number, WeatherCondition>();
    // Earlier window (laps 1-5): wet
    for (let l = 1; l <= 5; l++) weatherMap.set(l, "WET");
    // Recent window (laps 6-10): dry
    for (let l = 6; l <= 10; l++) weatherMap.set(l, "DRY");
    const trackStatusMap = new Map<number, TrackStatus>();
    const result = estimateTrackGripState(weatherMap, trackStatusMap, 10, 50);
    expect(result.label).toBe("IMPROVING");
    expect(result.reasons.some(r => /asciugatura/.test(r))).toBe(true);
  });
});

describe("computeDegradationValidationContext — support/contradiction from source", () => {
  it("support+contradiction signals correspond exactly to notes produced by analyzers (source-based, not substring-based)", () => {
    // Build a synthetic timeline for one stint with signals that trigger
    // one support note (warmup coerente) and one contradiction note
    // (stress basso nonostante slope elevata).
    const stint: StintAnalysis = {
      stint_number: 1,
      compound: "MEDIUM",
      lap_start: 1,
      lap_end: 20,
      laps_count: 20,
      tyre_age_at_start: 0,
      avg_lap_time: null,
      degradation_slope: 0.15,
      r_squared: 0.8,
      excluded_laps: 0,
    };

    const byLap: SoftSensorsLapState[] = [];
    // First 3 laps warmup (coerente col modello, expectedWarmup=3)
    for (let l = 1; l <= 3; l++) {
      byLap.push({
        lap_number: l,
        stint_number: 1,
        tyre_thermal: { label: "WARMING_UP", score: 0.3, confidence: "HIGH", reasons: [] },
        tyre_stress: { label: "LOW", score: 0.1, confidence: "HIGH", reasons: [] },
        track_grip: { label: "STABLE", score: 0.7, confidence: "HIGH", reasons: [] },
        overall_confidence: "HIGH",
        reliability_notes: [],
      });
    }
    // Remaining 17 laps: IN_WINDOW + LOW stress (>70% low stress → triggers contradiction with high slope)
    for (let l = 4; l <= 20; l++) {
      byLap.push({
        lap_number: l,
        stint_number: 1,
        tyre_thermal: { label: "IN_WINDOW", score: 0.65, confidence: "HIGH", reasons: [] },
        tyre_stress: { label: "LOW", score: 0.1, confidence: "HIGH", reasons: [] },
        track_grip: { label: "STABLE", score: 0.7, confidence: "HIGH", reasons: [] },
        overall_confidence: "HIGH",
        reliability_notes: [],
      });
    }

    const timeline: SoftSensorsTimeline = {
      by_lap: byLap,
      summary: {
        latest_state: byLap[byLap.length - 1],
        first_high_stress_lap: null,
        first_critical_stress_lap: null,
        warmup_laps_by_stint: new Map(),
        grip_transitions: [],
        overall_confidence: "HIGH",
        reliability_notes: [],
      },
    };

    const dv = {
      original: { stint: 1 } as unknown,
      status: "VALID",
      effective_slope: 0.15,
    } as unknown as DegradationValidationResult;

    const ctx = computeDegradationValidationContext(timeline, [stint], [dv]);
    const stintCtx = ctx.by_stint[0];
    expect(stintCtx).toBeDefined();

    // Every signal in support or contradiction must appear in the aggregated notes,
    // and support/contradiction sets must be disjoint. This verifies the mapping
    // is source-driven and not derived by re-reading text.
    const all = new Set([
      ...stintCtx.thermal_notes,
      ...stintCtx.stress_notes,
      ...stintCtx.grip_notes,
    ]);
    for (const s of stintCtx.support_signals) expect(all.has(s)).toBe(true);
    for (const c of stintCtx.contradiction_signals) expect(all.has(c)).toBe(true);
    const sup = new Set(stintCtx.support_signals);
    for (const c of stintCtx.contradiction_signals) expect(sup.has(c)).toBe(false);

    // We expect at least one support and one contradiction from this fixture.
    expect(stintCtx.support_signals.length).toBeGreaterThan(0);
    expect(stintCtx.contradiction_signals.length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
 * computeStrategySoftSensorAdjustment — refinement corrections
 * ══════════════════════════════════════════════════════════════════ */

import { computeStrategySoftSensorAdjustment } from "../softSensors";

function makeState(
  lap: number,
  stintNumber: number,
  thermalLabel: SoftSensorsLapState["tyre_thermal"]["label"],
  stressLabel: SoftSensorsLapState["tyre_stress"]["label"],
  gripLabel: SoftSensorsLapState["track_grip"]["label"] = "STABLE",
  overall: SoftSensorConfidence = "HIGH",
): SoftSensorsLapState {
  return {
    lap_number: lap,
    stint_number: stintNumber,
    tyre_thermal: { label: thermalLabel, score: 0.5, confidence: overall, reasons: [] },
    tyre_stress: { label: stressLabel, score: 0.5, confidence: overall, reasons: [] },
    track_grip: { label: gripLabel, score: 0.5, confidence: overall, reasons: [] },
    overall_confidence: overall,
    reliability_notes: [],
  };
}

function makeStint(n: number, compound: string, lap_start: number, lap_end: number): StintAnalysis {
  return {
    stint_number: n,
    compound,
    lap_start,
    lap_end,
    laps_count: lap_end - lap_start + 1,
    tyre_age_at_start: 0,
    avg_lap_time: null,
    degradation_slope: null,
    r_squared: null,
    excluded_laps: 0,
  };
}

function makeTimeline(states: SoftSensorsLapState[]): SoftSensorsTimeline {
  return {
    by_lap: states,
    summary: {
      latest_state: states[states.length - 1] ?? null,
      first_high_stress_lap: null,
      first_critical_stress_lap: null,
      warmup_laps_by_stint: new Map(),
      grip_transitions: [],
      overall_confidence: "HIGH",
      reliability_notes: [],
    },
  };
}

describe("computeStrategySoftSensorAdjustment — grip removed from scoring", () => {
  it("grip_adjustment_total is always 0 and total excludes grip regardless of observed grip labels", () => {
    // Every observed lap is LOW_GRIP HIGH-confidence: previous impl would push grip up.
    const states: SoftSensorsLapState[] = [];
    for (let l = 1; l <= 30; l++) {
      states.push(makeState(l, l <= 15 ? 1 : 2, "IN_WINDOW", "LOW", "LOW_GRIP"));
    }
    const timeline = makeTimeline(states);
    const stints = [makeStint(1, "SOFT", 1, 15), makeStint(2, "HARD", 16, 30)];
    const adj = computeStrategySoftSensorAdjustment([15], ["SOFT", "HARD"], 30, timeline, stints);
    expect(adj.grip_adjustment_total).toBe(0);
    expect(adj.total_soft_sensor_adjustment).toBe(adj.thermal_adjustment_total + adj.stress_adjustment_total);
    expect(adj.adjustment_reasons.some(r => /grip/i.test(r))).toBe(false);
  });
});

describe("computeStrategySoftSensorAdjustment — mapping by tyre life, not absolute lap", () => {
  it("does not penalize a simulated old-tyre lap using warmup observed at real pit lap", () => {
    // Real race: stint 1 SOFT laps 1-10, stint 2 HARD laps 11-30. Real warmup on HARD at laps 11-13.
    const states: SoftSensorsLapState[] = [];
    for (let l = 1; l <= 10; l++) states.push(makeState(l, 1, l <= 3 ? "WARMING_UP" : "IN_WINDOW", "LOW"));
    for (let l = 11; l <= 30; l++) {
      const tyreLife = l - 11;
      states.push(makeState(l, 2, tyreLife < 3 ? "WARMING_UP" : "IN_WINDOW", "LOW"));
    }
    const timeline = makeTimeline(states);
    const realStints = [makeStint(1, "SOFT", 1, 10), makeStint(2, "HARD", 11, 30)];
    // Simulated strategy: SOFT 1-20, HARD 21-30. At absolute laps 11-13 the sim
    // tyre is SOFT with tyreLife 10-12 (old). Prior impl would transplant the
    // WARMING_UP from lap 11 (real HARD tyreLife=0) onto old SOFT → false penalty.
    const adj = computeStrategySoftSensorAdjustment([20], ["SOFT", "HARD"], 30, timeline, realStints);
    // Simulated stint 2 (HARD 21-30) has tyreLife 0..9. Real HARD warmup at
    // tyreLife 0-2 is available and maps correctly, but only for tyreLife<simLapsAffected
    // triggers no adj (WARMING_UP within model). So thermal must be 0.
    expect(adj.thermal_adjustment_total).toBe(0);
  });

  it("does emit thermal adjustment when observed WARMING_UP persists beyond model at correct compound+tyre life", () => {
    // Real race: MEDIUM stint at laps 1-20 with WARMING_UP persisting to tyreLife=4 (beyond model=3)
    const states: SoftSensorsLapState[] = [];
    for (let l = 1; l <= 20; l++) {
      const tyreLife = l - 1;
      // Extended warmup: WARMING_UP for tyreLife 0..4
      states.push(makeState(l, 1, tyreLife <= 4 ? "WARMING_UP" : "IN_WINDOW", "LOW"));
    }
    // Pad with dummy hard for laps 21-30
    for (let l = 21; l <= 30; l++) states.push(makeState(l, 2, "IN_WINDOW", "LOW"));
    const timeline = makeTimeline(states);
    const realStints = [makeStint(1, "MEDIUM", 1, 20), makeStint(2, "HARD", 21, 30)];
    // Simulated strategy: HARD 1-10, MEDIUM 11-30. Second stint MEDIUM tyreLife 0..4
    // maps to real MEDIUM tyreLife 0..4 (WARMING_UP). At tyreLife>=model(3)
    // still WARMING_UP → +0.08 penalty per lap for tyreLife=3,4 → thermal>0.
    const adj = computeStrategySoftSensorAdjustment([10], ["HARD", "MEDIUM"], 30, timeline, realStints);
    expect(adj.thermal_adjustment_total).toBeGreaterThan(0);
    expect(adj.adjustment_reasons.some(r => /vita gomma/i.test(r))).toBe(true);
  });

  it("skips simulated laps entirely when compound was never observed in the real race, without error", () => {
    // Real race: only SOFT and HARD observed.
    const states: SoftSensorsLapState[] = [];
    for (let l = 1; l <= 15; l++) states.push(makeState(l, 1, "IN_WINDOW", "LOW"));
    for (let l = 16; l <= 30; l++) states.push(makeState(l, 2, "IN_WINDOW", "LOW"));
    const timeline = makeTimeline(states);
    const realStints = [makeStint(1, "SOFT", 1, 15), makeStint(2, "HARD", 16, 30)];
    // Simulated uses INTERMEDIATE — never observed.
    const adj = computeStrategySoftSensorAdjustment([15], ["INTERMEDIATE", "INTERMEDIATE"], 30, timeline, realStints);
    expect(adj.thermal_adjustment_total).toBe(0);
    expect(adj.stress_adjustment_total).toBe(0);
    expect(adj.total_soft_sensor_adjustment).toBe(0);
    // All 30 laps unmatched (>50%) → LOW confidence
    expect(adj.confidence).toBe("HIGH"); // total<0.05 forces HIGH per rule
  });
});
