/**
 * Head-to-head comparison between two VirtualRaceEngineerResults.
 *
 * Pure function module: takes two precomputed VRE results (from `vreLoader`)
 * plus their aligned Lap arrays and produces a `ComparisonResult` describing
 * lap-by-lap delta, stint alignment, strategic divergence and a verdict.
 *
 * Anti-hallucination: every field is derived deterministically from inputs.
 * If a piece of data is missing (e.g. positions for swap detection), the
 * relevant divergence type is silently omitted rather than fabricated.
 */

import type { VirtualRaceEngineerResult, Confidence } from "./virtualRaceEngineer";
import type { Lap, PositionData, SessionResult } from "./openf1";

export type DivergenceEventType =
  | "PIT_A_ONLY"
  | "PIT_B_ONLY"
  | "COMPOUND_DIVERGENCE"
  | "POSITION_SWAP";

export interface LapDeltaPoint {
  lap: number;
  delta_a_minus_b: number | null; // positive = A slower; null if either lap invalid
  cumulative_delta: number;
}

export interface StintAlignmentSegment {
  lap_range: [number, number];
  driver_a_stint: number | null;
  driver_b_stint: number | null;
  driver_a_compound: string | null;
  driver_b_compound: string | null;
}

export interface DivergencePoint {
  lap: number;
  event_type: DivergenceEventType;
  description: string;
}

export interface HeadToHeadVerdict {
  faster_driver: "A" | "B" | "TIE";
  delta_total_seconds: number; // |sum of lap deltas where both valid|
  key_factors: string[];
}

/**
 * Outcome of a single counterfactual scenario.
 *  - "only_a": only driver A switches to their alternative strategy.
 *  - "only_b": only driver B switches to their alternative strategy.
 *  - "both"  : both drivers switch to their respective alternatives.
 *
 * Convention (motorsport): negative seconds = faster than actual.
 *   new (A − B) = realDelta + (appliedGainA − appliedGainB)
 *
 * `applicable=false` means the inputs required to compute this scenario are
 * missing (e.g. alternative_b not available for "only_b" / "both"). When false,
 * the numeric fields are null and the UI should show a disabled / fallback state.
 */
export interface CounterfactualScenarioOutcome {
  applicable: boolean;
  gain_a_seconds: number | null;
  gain_b_seconds: number | null;
  counterfactual_h2h_delta_seconds: number | null;
  counterfactual_faster: "A" | "B" | "TIE" | null;
  outcome_changed: boolean;
}

export type CounterfactualScenarioId = "only_a" | "only_b" | "both";

/**
 * Counterfactual analysis: what would have happened under three independent
 * scenarios (only A switches, only B switches, both switch) to the "ex-ante
 * balanced" alternative strategy from the second VRE pass.
 *
 * Backward-compatible top-level fields (`gain_a_seconds`, `gain_b_seconds`,
 * `counterfactual_h2h_delta_seconds`, `counterfactual_faster`,
 * `outcome_changed`) mirror the "both" scenario when applicable, otherwise the
 * first applicable scenario.
 */
export interface CounterfactualAnalysis {
  gain_a_seconds: number | null;
  gain_b_seconds: number | null;
  real_h2h_delta_seconds: number;
  counterfactual_h2h_delta_seconds: number | null;
  counterfactual_faster: "A" | "B" | "TIE" | null;
  outcome_changed: boolean;
  confidence: Confidence;
  disclaimer: string;
  scenarios: {
    only_a: CounterfactualScenarioOutcome;
    only_b: CounterfactualScenarioOutcome;
    both: CounterfactualScenarioOutcome;
  };
}

export interface ComparisonResult {
  driver_a: VirtualRaceEngineerResult;
  driver_b: VirtualRaceEngineerResult;
  /** Optional alternative VRE results (POST_RACE + BALANCED). Null when not requested or unavailable. */
  alternative_a: VirtualRaceEngineerResult | null;
  alternative_b: VirtualRaceEngineerResult | null;
  session_key: number;
  total_laps: number;
  lap_by_lap_delta: LapDeltaPoint[];
  stint_alignment: StintAlignmentSegment[];
  strategic_divergence_points: DivergencePoint[];
  head_to_head_verdict: HeadToHeadVerdict;
  /** Counterfactual analysis. Null when no alternatives provided. */
  counterfactual_analysis: CounterfactualAnalysis | null;
  common_confidence: Confidence;
}

/**
 * Filter laps suitable for direct pace comparison. Mirrors `cleanLapsForStint`
 * intent (no pit-out, valid duration) without weather/track filters — the
 * delta itself naturally absorbs shared neutralisations.
 */
function isComparableLap(l: Lap): boolean {
  return l.lap_duration != null && l.lap_duration > 0 && !l.is_pit_out_lap;
}

function lapByNumber(laps: Lap[]): Map<number, Lap> {
  const m = new Map<number, Lap>();
  for (const l of laps) m.set(l.lap_number, l);
  return m;
}

function confidenceMin(a: Confidence, b: Confidence): Confidence {
  const order: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return order[a] <= order[b] ? a : b;
}

function detectPositionSwaps(
  positions: PositionData[] | null,
  driverA: number,
  driverB: number,
  lapsA: Lap[],
  lapsB: Lap[],
): DivergencePoint[] {
  if (!positions || !positions.length) return [];

  // Build lap → date_start for each driver to map positions (which are time-series) to laps
  const lapStartA = new Map<number, number>();
  const lapStartB = new Map<number, number>();
  for (const l of lapsA) if (l.date_start) lapStartA.set(l.lap_number, new Date(l.date_start).getTime());
  for (const l of lapsB) if (l.date_start) lapStartB.set(l.lap_number, new Date(l.date_start).getTime());

  // Position at a given timestamp for a driver (last known ≤ ts)
  const posA = positions
    .filter((p) => p.driver_number === driverA && p.date)
    .map((p) => ({ t: new Date(p.date).getTime(), pos: p.position }))
    .sort((a, b) => a.t - b.t);
  const posB = positions
    .filter((p) => p.driver_number === driverB && p.date)
    .map((p) => ({ t: new Date(p.date).getTime(), pos: p.position }))
    .sort((a, b) => a.t - b.t);

  if (!posA.length || !posB.length) return [];

  function posAt(arr: { t: number; pos: number }[], ts: number): number | null {
    let lo = 0, hi = arr.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].t <= ts) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best >= 0 ? arr[best].pos : null;
  }

  const swaps: DivergencePoint[] = [];
  let prevSign: number | null = null;
  const allLapNums = [...new Set([...lapsA.map((l) => l.lap_number), ...lapsB.map((l) => l.lap_number)])].sort((a, b) => a - b);
  for (const lap of allLapNums) {
    const tA = lapStartA.get(lap);
    const tB = lapStartB.get(lap);
    if (tA == null || tB == null) continue;
    const ts = Math.max(tA, tB);
    const pA = posAt(posA, ts);
    const pB = posAt(posB, ts);
    if (pA == null || pB == null) continue;
    const sign = Math.sign(pA - pB); // negative = A ahead
    if (prevSign != null && sign !== 0 && prevSign !== 0 && sign !== prevSign) {
      const ahead = sign < 0 ? "A" : "B";
      const behind = sign < 0 ? "B" : "A";
      swaps.push({
        lap,
        event_type: "POSITION_SWAP",
        description: `Sorpasso al giro ${lap}: ${ahead} passa ${behind}`,
      });
    }
    if (sign !== 0) prevSign = sign;
  }
  return swaps;
}

export interface HeadToHeadInput {
  resultA: VirtualRaceEngineerResult;
  resultB: VirtualRaceEngineerResult;
  lapsA: Lap[];
  lapsB: Lap[];
  /** Optional: shared session positions for swap detection. Pass null to skip. */
  positions?: PositionData[] | null;
  /** Optional: alternative VRE result for driver A (POST_RACE + BALANCED). */
  alternativeA?: VirtualRaceEngineerResult | null;
  /** Optional: alternative VRE result for driver B (POST_RACE + BALANCED). */
  alternativeB?: VirtualRaceEngineerResult | null;
}

export function computeHeadToHead(input: HeadToHeadInput): ComparisonResult {
  const {
    resultA, resultB, lapsA, lapsB,
    positions = null,
    alternativeA = null,
    alternativeB = null,
  } = input;

  if (resultA.session_key !== resultB.session_key) {
    throw new Error(
      `session_key mismatch: A=${resultA.session_key} vs B=${resultB.session_key}. Cannot compare drivers across different sessions.`,
    );
  }
  const sessionKey = resultA.session_key;

  const totalLaps = Math.max(
    0,
    ...lapsA.map((l) => l.lap_number),
    ...lapsB.map((l) => l.lap_number),
  );

  // Lap-by-lap delta
  const mapA = lapByNumber(lapsA);
  const mapB = lapByNumber(lapsB);
  const deltas: LapDeltaPoint[] = [];
  let cum = 0;
  for (let lap = 1; lap <= totalLaps; lap++) {
    const la = mapA.get(lap);
    const lb = mapB.get(lap);
    let delta: number | null = null;
    if (la && lb && isComparableLap(la) && isComparableLap(lb)) {
      delta = la.lap_duration! - lb.lap_duration!;
      cum += delta;
    }
    deltas.push({ lap, delta_a_minus_b: delta, cumulative_delta: cum });
  }

  // Stint alignment — segment the race on union of both drivers' breakpoints
  const stintsA = resultA.actual_strategy.stints;
  const stintsB = resultB.actual_strategy.stints;
  const breakpoints = new Set<number>([1, totalLaps + 1]);
  for (const s of stintsA) { breakpoints.add(s.lap_start); breakpoints.add(s.lap_end + 1); }
  for (const s of stintsB) { breakpoints.add(s.lap_start); breakpoints.add(s.lap_end + 1); }
  const sortedBp = [...breakpoints].filter((n) => n >= 1 && n <= totalLaps + 1).sort((a, b) => a - b);

  function findStint(stints: typeof stintsA, lap: number) {
    return stints.find((s) => lap >= s.lap_start && lap <= s.lap_end) ?? null;
  }

  const alignment: StintAlignmentSegment[] = [];
  for (let i = 0; i < sortedBp.length - 1; i++) {
    const start = sortedBp[i];
    const end = sortedBp[i + 1] - 1;
    if (end < start) continue;
    const sA = findStint(stintsA, start);
    const sB = findStint(stintsB, start);
    alignment.push({
      lap_range: [start, end],
      driver_a_stint: sA?.stint_number ?? null,
      driver_b_stint: sB?.stint_number ?? null,
      driver_a_compound: sA?.compound ?? null,
      driver_b_compound: sB?.compound ?? null,
    });
  }

  // Divergence points
  const divergence: DivergencePoint[] = [];
  const pitsA = new Set(resultA.actual_strategy.pit_laps);
  const pitsB = new Set(resultB.actual_strategy.pit_laps);
  const allPitLaps = [...new Set([...pitsA, ...pitsB])].sort((a, b) => a - b);
  for (const lap of allPitLaps) {
    if (pitsA.has(lap) && !pitsB.has(lap)) {
      divergence.push({ lap, event_type: "PIT_A_ONLY", description: `${resultA.driver_acronym} pit al giro ${lap}, ${resultB.driver_acronym} resta in pista` });
    } else if (!pitsA.has(lap) && pitsB.has(lap)) {
      divergence.push({ lap, event_type: "PIT_B_ONLY", description: `${resultB.driver_acronym} pit al giro ${lap}, ${resultA.driver_acronym} resta in pista` });
    }
  }
  // Compound divergence per aligned segment
  for (const seg of alignment) {
    if (seg.driver_a_compound && seg.driver_b_compound && seg.driver_a_compound !== seg.driver_b_compound) {
      divergence.push({
        lap: seg.lap_range[0],
        event_type: "COMPOUND_DIVERGENCE",
        description: `Giri ${seg.lap_range[0]}–${seg.lap_range[1]}: ${resultA.driver_acronym} su ${seg.driver_a_compound}, ${resultB.driver_acronym} su ${seg.driver_b_compound}`,
      });
    }
  }
  // Position swaps (best-effort)
  if (positions && positions.length) {
    divergence.push(...detectPositionSwaps(positions, resultA.driver_number, resultB.driver_number, lapsA, lapsB));
  }
  divergence.sort((a, b) => a.lap - b.lap);

  // Verdict
  const validDeltas = deltas.filter((d) => d.delta_a_minus_b != null);
  const totalDelta = validDeltas.length ? validDeltas[validDeltas.length - 1].cumulative_delta : 0;
  let faster: "A" | "B" | "TIE" = "TIE";
  if (Math.abs(totalDelta) > 0.5) faster = totalDelta < 0 ? "A" : "B";

  // Key factors: derive 3-5 narrative strings from VRE results + measurable deltas
  const factors: string[] = [];
  const ptsA = resultA.actual_strategy.pit_stops.length;
  const ptsB = resultB.actual_strategy.pit_stops.length;
  if (ptsA !== ptsB) {
    factors.push(`Strategie diverse: ${resultA.driver_acronym} ${ptsA} pit vs ${resultB.driver_acronym} ${ptsB} pit`);
  }
  const compoundsA = stintsA.map((s) => s.compound).join("→");
  const compoundsB = stintsB.map((s) => s.compound).join("→");
  if (compoundsA && compoundsB && compoundsA !== compoundsB) {
    factors.push(`Sequenza mescole: ${resultA.driver_acronym} ${compoundsA} vs ${resultB.driver_acronym} ${compoundsB}`);
  }
  if (Math.abs(totalDelta) > 0.5) {
    const sign = totalDelta > 0 ? resultA.driver_acronym : resultB.driver_acronym;
    const other = totalDelta > 0 ? resultB.driver_acronym : resultA.driver_acronym;
    factors.push(`${other} più veloce di ${Math.abs(totalDelta).toFixed(2)}s sul totale dei giri confrontabili rispetto a ${sign}`);
  }
  if (resultA.weather_impact && resultA.weather_impact === resultB.weather_impact) {
    factors.push(`Condizioni meteo condivise: ${resultA.weather_impact}`);
  } else if (resultA.weather_impact || resultB.weather_impact) {
    if (resultA.weather_impact) factors.push(`${resultA.driver_acronym}: ${resultA.weather_impact}`);
    if (resultB.weather_impact) factors.push(`${resultB.driver_acronym}: ${resultB.weather_impact}`);
  }
  // Pull top narrative if we still have room
  if (factors.length < 5) {
    const niA = resultA.narrative_insights?.[0];
    if (niA) factors.push(`${resultA.driver_acronym}: ${niA}`);
  }
  if (factors.length < 5) {
    const niB = resultB.narrative_insights?.[0];
    if (niB) factors.push(`${resultB.driver_acronym}: ${niB}`);
  }

  // Counterfactual analysis (rendered when at least one alternative is provided)
  let counterfactual: CounterfactualAnalysis | null = null;
  if (alternativeA || alternativeB) {
    const gainA = alternativeA && Number.isFinite(alternativeA.recommended_strategy.time_delta_vs_actual)
      ? (alternativeA.recommended_strategy.time_delta_vs_actual as number) : null;
    const gainB = alternativeB && Number.isFinite(alternativeB.recommended_strategy.time_delta_vs_actual)
      ? (alternativeB.recommended_strategy.time_delta_vs_actual as number) : null;

    const realDelta = totalDelta; // signed (A − B); negative = A faster

    const buildScenario = (applyA: boolean, applyB: boolean): CounterfactualScenarioOutcome => {
      const needAOk = !applyA || (alternativeA != null && gainA != null);
      const needBOk = !applyB || (alternativeB != null && gainB != null);
      const applicable = needAOk && needBOk;
      if (!applicable) {
        return {
          applicable: false,
          gain_a_seconds: applyA ? gainA : 0,
          gain_b_seconds: applyB ? gainB : 0,
          counterfactual_h2h_delta_seconds: null,
          counterfactual_faster: null,
          outcome_changed: false,
        };
      }
      const appliedGainA = applyA ? (gainA as number) : 0;
      const appliedGainB = applyB ? (gainB as number) : 0;
      const cfDelta = realDelta + (appliedGainA - appliedGainB);
      const cfFaster: "A" | "B" | "TIE" =
        Math.abs(cfDelta) <= 0.5 ? "TIE" : (cfDelta < 0 ? "A" : "B");
      return {
        applicable: true,
        gain_a_seconds: applyA ? (gainA as number) : 0,
        gain_b_seconds: applyB ? (gainB as number) : 0,
        counterfactual_h2h_delta_seconds: cfDelta,
        counterfactual_faster: cfFaster,
        outcome_changed: cfFaster !== faster,
      };
    };

    const scenarios = {
      only_a: buildScenario(true, false),
      only_b: buildScenario(false, true),
      both: buildScenario(true, true),
    };

    const primary: CounterfactualScenarioOutcome =
      scenarios.both.applicable ? scenarios.both
      : scenarios.only_a.applicable ? scenarios.only_a
      : scenarios.only_b.applicable ? scenarios.only_b
      : { applicable: false, gain_a_seconds: gainA, gain_b_seconds: gainB,
          counterfactual_h2h_delta_seconds: null, counterfactual_faster: null, outcome_changed: false };

    const confidenceVal: Confidence =
      alternativeA && alternativeB
        ? confidenceMin(alternativeA.confidence, alternativeB.confidence)
        : (alternativeA?.confidence ?? alternativeB?.confidence ?? "LOW");

    counterfactual = {
      gain_a_seconds: gainA,
      gain_b_seconds: gainB,
      real_h2h_delta_seconds: realDelta,
      counterfactual_h2h_delta_seconds: primary.counterfactual_h2h_delta_seconds,
      counterfactual_faster: primary.counterfactual_faster,
      outcome_changed: primary.outcome_changed,
      confidence: confidenceVal,
      disclaimer: "Stima teorica: assume che le alternative siano applicate in modo indipendente. Non considera le reazioni avversarie, l'effetto undercut/overcut sui rivali esterni al confronto, né la disponibilità reale di mescole nuove.",
      scenarios,
    };
  }

  return {
    driver_a: resultA,
    driver_b: resultB,
    alternative_a: alternativeA,
    alternative_b: alternativeB,
    session_key: sessionKey,
    total_laps: totalLaps,
    lap_by_lap_delta: deltas,
    stint_alignment: alignment,
    strategic_divergence_points: divergence,
    head_to_head_verdict: {
      faster_driver: faster,
      delta_total_seconds: Math.abs(totalDelta),
      key_factors: factors.slice(0, 5),
    },
    counterfactual_analysis: counterfactual,
    common_confidence: confidenceMin(resultA.confidence, resultB.confidence),
  };
}

