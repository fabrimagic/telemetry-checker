/**
 * Duel counter-move analysis (H2H only).
 * ──────────────────────────────────────
 * Extends the head-to-head alternative-strategy reasoning with RACE EPISODES:
 * when the driver who is behind stops for an undercut attempt, did the driver
 * ahead have a counter-move (a covering stop) available, did he execute it, and
 * what would it have cost?
 *
 * Pure module: every number is derived from the `ComparisonResult` inputs
 * (real pit stops, cumulative pace delta, and the alternative VRE pass).
 * Nothing is extrapolated: when no simulated alternative covers the required
 * lap window, the episode is reported as "not simulable" with the reason, and
 * no delta is invented.
 *
 * Conventions
 *  - `delta_a_minus_b` / `cumulative_delta` from `lap_by_lap_delta`:
 *    positive = A slower, i.e. A behind on cumulative pace.
 *  - `time_delta_vs_actual` (VRE): negative = faster than the real race.
 */

import type { ComparisonResult } from "./headToHeadComparison";
import type { AlternativeStrategy, VirtualRaceEngineerResult } from "./virtualRaceEngineer";

/** Max cumulative pace gap (s) for a stop to qualify as an undercut attempt. */
export const UNDERCUT_ATTEMPT_GAP_MAX = 3.5;
/** Laps after the attacker's stop within which a real stop counts as a cover. */
export const COVER_RESPONSE_WINDOW = 2;
/** Laps used to measure the gap swing after the episode. */
export const EPISODE_SETTLE_LAPS = 3;

export type DuelSide = "A" | "B";

export type CounterMoveStatus =
  /** The defender actually pitted inside the response window (real cover). */
  | "COVERED_IN_RACE"
  /** No real cover, but a simulated alternative covers the window. */
  | "COVER_SIMULATED"
  /** No real cover and no simulated alternative on that window. */
  | "NOT_SIMULABLE";

export interface CounterMoveEpisode {
  /** Lap on which the driver behind pitted (the undercut attempt). */
  attack_pit_lap: number;
  attacker: DuelSide;
  defender: DuelSide;
  attacker_acronym: string;
  defender_acronym: string;
  /** Cumulative pace gap (s, absolute) at the lap before the attack stop. */
  gap_before_seconds: number | null;
  /** Cumulative pace gap (s, signed A−B) after the episode settled. */
  gap_after_seconds: number | null;
  /** Gap swing in favour of the attacker (s). Positive = attacker gained. */
  attacker_swing_seconds: number | null;
  /** Fresh compound taken by the attacker, when known. */
  attacker_compound_after: string | null;
  /** Compound the defender was running at the attack lap, when known. */
  defender_compound_at_attack: string | null;
  status: CounterMoveStatus;
  /** Lap of the counter-move (real cover lap, or simulated alternative pit lap). */
  counter_pit_lap: number | null;
  /** Name of the simulated alternative used as counter-move (COVER_SIMULATED). */
  counter_strategy_name: string | null;
  /** Cost of the counter-move vs the defender's real race (negative = faster). */
  counter_delta_seconds: number | null;
  /** undercut_risk (0–1) attached to the counter-move alternative, when known. */
  counter_undercut_risk: number | null;
  /** Italian, user-facing sentence. Never fabricates missing numbers. */
  message: string;
  /** Why the counter-move could not be simulated (NOT_SIMULABLE only). */
  reason: string | null;
}

export interface DuelCounterMoveAnalysis {
  episodes: CounterMoveEpisode[];
  /** Episodes where the defender never answered an undercut attempt. */
  unanswered_attacks: number;
  /** Episodes where a covering stop was actually made in the race. */
  covered_attacks: number;
  disclaimer: string;
}

const DISCLAIMER =
  "Gli episodi sono ricavati dalle soste reali e dal distacco di passo cumulato; il costo della contromossa, quando presente, proviene da una strategia alternativa effettivamente simulata dal motore. Nessun valore è stimato in assenza di dati.";

function cumulativeAt(comparison: ComparisonResult, lap: number): number | null {
  let last: number | null = null;
  for (const p of comparison.lap_by_lap_delta) {
    if (p.lap > lap) break;
    if (p.delta_a_minus_b != null) last = p.cumulative_delta;
  }
  return last;
}

function compoundAtLap(result: VirtualRaceEngineerResult, lap: number): string | null {
  for (const s of result.actual_strategy.stints ?? []) {
    if (lap >= s.lap_start && lap <= s.lap_end) return s.compound ?? null;
  }
  return null;
}

function compoundAfterPit(result: VirtualRaceEngineerResult, lap: number): string | null {
  const stop = (result.actual_strategy.pit_stops ?? []).find((p) => p.lap_number === lap);
  return stop?.compound_after ?? null;
}

/**
 * Pick the simulated alternative of `defender` that best represents a covering
 * stop on `attackLap`: a pit inside [attackLap − 1, attackLap + 1] that is not
 * one of the defender's real pit laps.
 */
function findCoverAlternative(
  alt: VirtualRaceEngineerResult | null,
  realPitLaps: number[],
  attackLap: number,
): { alt: AlternativeStrategy; lap: number } | null {
  if (!alt) return null;
  const real = new Set(realPitLaps);
  const lo = attackLap - 1;
  const hi = attackLap + 1;
  let best: { alt: AlternativeStrategy; lap: number; dist: number } | null = null;
  for (const a of alt.alternative_strategies ?? []) {
    for (const lap of a.pit_laps ?? []) {
      if (lap < lo || lap > hi) continue;
      if (real.has(lap)) continue;
      const dist = Math.abs(lap - attackLap);
      if (!best || dist < best.dist) best = { alt: a, lap, dist };
    }
  }
  return best ? { alt: best.alt, lap: best.lap } : null;
}

function fmt(v: number): string {
  return `${v.toFixed(2)}s`;
}

/**
 * Build the counter-move episode list for a head-to-head comparison.
 * Returns `null` when no undercut attempt can be identified.
 */
export function computeDuelCounterMoves(
  comparison: ComparisonResult,
  driverAAcronym: string,
  driverBAcronym: string,
): DuelCounterMoveAnalysis | null {
  const acr: Record<DuelSide, string> = { A: driverAAcronym, B: driverBAcronym };
  const results: Record<DuelSide, VirtualRaceEngineerResult> = {
    A: comparison.driver_a,
    B: comparison.driver_b,
  };
  const alts: Record<DuelSide, VirtualRaceEngineerResult | null> = {
    A: comparison.alternative_a,
    B: comparison.alternative_b,
  };

  const episodes: CounterMoveEpisode[] = [];

  const candidates: { lap: number; side: DuelSide }[] = [];
  for (const lap of results.A.actual_strategy.pit_laps ?? []) candidates.push({ lap, side: "A" });
  for (const lap of results.B.actual_strategy.pit_laps ?? []) candidates.push({ lap, side: "B" });
  candidates.sort((x, y) => x.lap - y.lap);

  for (const { lap, side } of candidates) {
    const before = cumulativeAt(comparison, lap - 1);
    if (before == null) continue;

    // Who is behind on cumulative pace right before the stop?
    // before > 0 → A behind. The stop is an undercut attempt only if the
    // driver who pits is the one behind, and the gap is within striking range.
    const behind: DuelSide = before > 0 ? "A" : "B";
    if (behind !== side) continue;
    const gapBefore = Math.abs(before);
    if (gapBefore > UNDERCUT_ATTEMPT_GAP_MAX) continue;

    const attacker = side;
    const defender: DuelSide = side === "A" ? "B" : "A";

    const defenderRealPits = results[defender].actual_strategy.pit_laps ?? [];
    const realCover = defenderRealPits.find((p) => p >= lap && p <= lap + COVER_RESPONSE_WINDOW) ?? null;

    const after = cumulativeAt(comparison, lap + EPISODE_SETTLE_LAPS);
    // Swing in favour of the attacker: attacker gains when the signed gap moves
    // toward him (A attacker → cumulative decreases; B attacker → increases).
    const swing =
      after == null
        ? null
        : attacker === "A"
          ? before - after
          : after - before;

    const attackerCompound = compoundAfterPit(results[attacker], lap);
    const defenderCompound = compoundAtLap(results[defender], lap);

    const base: CounterMoveEpisode = {
      attack_pit_lap: lap,
      attacker,
      defender,
      attacker_acronym: acr[attacker],
      defender_acronym: acr[defender],
      gap_before_seconds: gapBefore,
      gap_after_seconds: after,
      attacker_swing_seconds: swing,
      attacker_compound_after: attackerCompound,
      defender_compound_at_attack: defenderCompound,
      status: "NOT_SIMULABLE",
      counter_pit_lap: null,
      counter_strategy_name: null,
      counter_delta_seconds: null,
      counter_undercut_risk: null,
      message: "",
      reason: null,
    };

    if (realCover != null) {
      const swingTxt =
        swing == null
          ? "distacco successivo non misurabile"
          : swing > 0
            ? `${acr[attacker]} ha guadagnato ${fmt(swing)}`
            : `${acr[defender]} ha tenuto ${fmt(Math.abs(swing))}`;
      episodes.push({
        ...base,
        status: "COVERED_IN_RACE",
        counter_pit_lap: realCover,
        message: `Giro ${lap}: ${acr[attacker]} tenta l'undercut da ${fmt(gapBefore)}; ${acr[defender]} copre al giro ${realCover} (${swingTxt}).`,
      });
      continue;
    }

    const cover = findCoverAlternative(alts[defender], defenderRealPits, lap);
    if (cover) {
      const delta = Number.isFinite(cover.alt.time_delta_vs_actual) ? cover.alt.time_delta_vs_actual : null;
      const risk = cover.alt.analysis?.competitor_context?.undercut_risk ?? null;
      const costTxt =
        delta == null
          ? "costo non disponibile"
          : delta <= 0
            ? `guadagno stimato ${fmt(Math.abs(delta))}`
            : `costo stimato ${fmt(delta)}`;
      const riskTxt = risk != null ? `, rischio undercut ${Math.round(risk * 100)}%` : "";
      episodes.push({
        ...base,
        status: "COVER_SIMULATED",
        counter_pit_lap: cover.lap,
        counter_strategy_name: cover.alt.name,
        counter_delta_seconds: delta,
        counter_undercut_risk: risk,
        message: `Giro ${lap}: ${acr[attacker]} tenta l'undercut da ${fmt(gapBefore)} e ${acr[defender]} non risponde. Contromossa disponibile: sosta di copertura al giro ${cover.lap} (${cover.alt.name}, ${costTxt}${riskTxt}).`,
      });
      continue;
    }

    episodes.push({
      ...base,
      status: "NOT_SIMULABLE",
      reason: alts[defender]
        ? `Nessuna alternativa simulata prevede una sosta tra il giro ${lap - 1} e il giro ${lap + 1}.`
        : `Strategia alternativa di ${acr[defender]} non disponibile per questa sessione.`,
      message: `Giro ${lap}: ${acr[attacker]} tenta l'undercut da ${fmt(gapBefore)} e ${acr[defender]} non risponde; la contromossa non è simulabile con i dati disponibili.`,
    });
  }

  if (!episodes.length) return null;

  return {
    episodes,
    unanswered_attacks: episodes.filter((e) => e.status !== "COVERED_IN_RACE").length,
    covered_attacks: episodes.filter((e) => e.status === "COVERED_IN_RACE").length,
    disclaimer: DISCLAIMER,
  };
}
