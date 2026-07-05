/**
 * Undercut Ledger — Fase 1
 * ────────────────────────
 * Misura empirica post-gara dell'efficacia reale dell'undercut nella sua
 * forma classica: A dietro anticipa la sosta, B davanti resta fuori 1-3
 * giri in più.
 *
 * Modulo PURO: nessuna fetch, nessun side effect, nessuna dipendenza dal VRE.
 * I distacchi sono derivati esclusivamente dai timestamp di passaggio sul
 * traguardo (Lap.date_start), coerente con la tecnica di lappedTraffic, e
 * mai dagli intervals. Lo swing è misurato su cicli pit chiusi: mai una
 * previsione.
 *
 * NOTE (fase 1):
 *   - Si misura SOLO la forma classica "A dietro anticipa".
 *     Il caso speculare "B davanti anticipa" NON è misurato in fase 1.
 *   - Il modulo non entra nello scoring strategico del VRE.
 */

import type { Driver, Lap, PitData, RaceControlMessage, StintData, WeatherData } from "./openf1";
import { classifyLapsTrackStatus, type TrackStatus } from "./trackStatusClassification";
import { classifyLapsWeather, type WeatherCondition } from "./weatherClassification";

export type UndercutConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";

export type UndercutExclusionReason =
  | "TRACK_STATUS_NON_GREEN"
  | "WEATHER_NON_DRY"
  | "MISSING_DATE_START"
  | "RETIREMENT_IN_WINDOW"
  | "ANOMALOUS_PIT_DURATION";

export interface UndercutCycle {
  attacker_driver_number: number;
  defender_driver_number: number;
  attacker_pit_lap: number;   // La
  defender_pit_lap: number;   // Lb (>= La+1, <= La+3)
  gap_before_seconds: number; // end of lap La-1
  gap_after_seconds: number;  // end of lap Lb+1
  swing_seconds: number;      // gap_before - gap_after (positive = attacker gained)
  overtake_completed: boolean;
  attacker_compound_before: string | null;
  attacker_compound_after: string | null;
  defender_compound_before: string | null;
  defender_compound_after: string | null;
}

export interface UndercutExcludedAttempt {
  attacker_driver_number: number;
  defender_driver_number: number;
  attacker_pit_lap: number;
  defender_pit_lap: number;
  reason: UndercutExclusionReason;
}

export interface UndercutLedgerAggregates {
  attempts_detected: number;
  valid_cycles: number;
  median_swing_seconds: number | null;
  min_swing_seconds: number | null;
  max_swing_seconds: number | null;
  positive_swing_share: number | null;   // frazione swing > 0
  overtake_share: number | null;         // frazione con sorpasso completato
  confidence: UndercutConfidence;
}

export interface UndercutLedgerResult {
  cycles: UndercutCycle[];
  excluded: UndercutExcludedAttempt[];
  aggregates: UndercutLedgerAggregates;
  method_declaration: string;
  measured_case_note: string;
}

export interface UndercutLedgerInput {
  allSessionLaps: Lap[];
  allPitStops: PitData[];
  allStints: StintData[];
  raceControlMessages: RaceControlMessage[];
  sessionWeather: WeatherData[];
  drivers: Driver[];
}

const METHOD_DECLARATION =
  "Distacchi derivati dai timestamp osservati (Lap.date_start); swing misurato su cicli pit chiusi. Non è una previsione.";

const MEASURED_CASE_NOTE =
  "Fase 1: viene misurata solo la forma classica dell'undercut (chi anticipa è dietro). Il caso della vettura davanti che anticipa la sosta non è ancora misurato.";

const MIN_GAP_BEFORE_S = 0;    // esclusivo
const MAX_GAP_BEFORE_S = 6;    // inclusivo
const MIN_PIT_DELTA_LAPS = 1;
const MAX_PIT_DELTA_LAPS = 3;
const PIT_DURATION_ANOMALY_FACTOR = 1.8;

/* ── Helpers ── */

function groupBy<T>(items: T[], key: (t: T) => number): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it); else m.set(k, [it]);
  }
  return m;
}

/** Timestamp of driver crossing the start/finish line at END of lap N.
 *  Uses date_start of lap N+1 (start of next lap). Returns null if unavailable. */
function crossingEndOfLap(lapsByNumber: Map<number, Lap>, lapN: number): number | null {
  const next = lapsByNumber.get(lapN + 1);
  if (next?.date_start) {
    const t = Date.parse(next.date_start);
    if (Number.isFinite(t)) return t;
  }
  // Fallback: date_start of lap N + lap_duration
  const cur = lapsByNumber.get(lapN);
  if (cur?.date_start && cur.lap_duration != null && cur.lap_duration > 0) {
    const t = Date.parse(cur.date_start);
    if (Number.isFinite(t)) return t + cur.lap_duration * 1000;
  }
  return null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function confidenceOf(n: number): UndercutConfidence {
  if (n >= 5) return "HIGH";
  if (n >= 3) return "MEDIUM";
  if (n >= 1) return "LOW";
  return "INSUFFICIENT_DATA";
}

function compoundsAroundPit(stints: StintData[], pitLap: number): { before: string | null; after: string | null } {
  let before: string | null = null;
  let after: string | null = null;
  for (const s of stints) {
    if (s.lap_end === pitLap) before = s.compound ?? null;
    if (s.lap_start === pitLap + 1) after = s.compound ?? null;
  }
  return { before, after };
}

/** True if the driver has at least one lap with lap_number >= minLap (proxy for "not retired before minLap"). */
function reachedLap(laps: Lap[], minLap: number): boolean {
  for (const l of laps) if (l.lap_number >= minLap) return true;
  return false;
}

/* ── Main ── */

export function computeUndercutLedger(input: UndercutLedgerInput): UndercutLedgerResult {
  const { allSessionLaps, allPitStops, allStints, raceControlMessages, sessionWeather } = input;

  const cycles: UndercutCycle[] = [];
  const excluded: UndercutExcludedAttempt[] = [];

  // Group by driver
  const lapsByDriver = groupBy(allSessionLaps, (l) => l.driver_number);
  const pitsByDriver = groupBy(allPitStops, (p) => p.driver_number);
  const stintsByDriver = groupBy(allStints, (s) => s.driver_number);

  // Per-driver lap maps & classifications
  const lapsMapByDriver = new Map<number, Map<number, Lap>>();
  const trackStatusByDriver = new Map<number, Map<number, TrackStatus>>();
  const weatherByDriver = new Map<number, Map<number, WeatherCondition>>();
  for (const [dn, laps] of lapsByDriver) {
    const m = new Map<number, Lap>();
    for (const l of laps) m.set(l.lap_number, l);
    lapsMapByDriver.set(dn, m);
    trackStatusByDriver.set(dn, classifyLapsTrackStatus(laps, raceControlMessages));
    weatherByDriver.set(dn, classifyLapsWeather(laps, sessionWeather));
  }

  // Session-wide median pit_duration (only positive values)
  const pitDurations = allPitStops
    .map((p) => (typeof p.pit_duration === "number" ? p.pit_duration : NaN))
    .filter((v) => Number.isFinite(v) && v > 0) as number[];
  const medPit = median(pitDurations);
  const pitAnomalyThreshold = medPit != null ? medPit * PIT_DURATION_ANOMALY_FACTOR : null;

  const drivers = Array.from(pitsByDriver.keys());

  // Iterate every pit of every attacker candidate (A)
  for (const attackerDn of drivers) {
    const aPits = pitsByDriver.get(attackerDn) ?? [];
    const aLapsMap = lapsMapByDriver.get(attackerDn);
    const aLaps = lapsByDriver.get(attackerDn) ?? [];
    if (!aLapsMap) continue;

    for (const aPit of aPits) {
      const La = aPit.lap_number;
      if (!Number.isFinite(La) || La <= 1) continue;

      // Gap-before: crossing at end of lap La-1
      const tA_before = crossingEndOfLap(aLapsMap, La - 1);
      if (tA_before == null) continue;

      for (const defenderDn of drivers) {
        if (defenderDn === attackerDn) continue;
        const bLapsMap = lapsMapByDriver.get(defenderDn);
        const bLaps = lapsByDriver.get(defenderDn) ?? [];
        if (!bLapsMap) continue;

        const tB_before = crossingEndOfLap(bLapsMap, La - 1);
        if (tB_before == null) continue;

        // gap = A - B; positive when B is ahead (A crosses later)
        const gapBeforeMs = tA_before - tB_before;
        const gapBefore = gapBeforeMs / 1000;
        if (!(gapBefore > MIN_GAP_BEFORE_S && gapBefore <= MAX_GAP_BEFORE_S)) continue;

        // Find B's pit at Lb such that La+1 <= Lb <= La+3
        const bPits = pitsByDriver.get(defenderDn) ?? [];
        const bPit = bPits.find(
          (p) => p.lap_number >= La + MIN_PIT_DELTA_LAPS && p.lap_number <= La + MAX_PIT_DELTA_LAPS,
        );
        if (!bPit) continue;

        const Lb = bPit.lap_number;

        // Exclusions (recorded as attempts detected but excluded)
        // 1) missing date_start on measurement laps
        const tA_after = crossingEndOfLap(aLapsMap, Lb + 1);
        const tB_after = crossingEndOfLap(bLapsMap, Lb + 1);

        const pushExcluded = (reason: UndercutExclusionReason) => {
          excluded.push({
            attacker_driver_number: attackerDn,
            defender_driver_number: defenderDn,
            attacker_pit_lap: La,
            defender_pit_lap: Lb,
            reason,
          });
        };

        if (tA_after == null || tB_after == null) {
          pushExcluded("MISSING_DATE_START");
          continue;
        }

        // 2) retirement in window (need both to have reached Lb+2)
        if (!reachedLap(aLaps, Lb + 2) || !reachedLap(bLaps, Lb + 2)) {
          pushExcluded("RETIREMENT_IN_WINDOW");
          continue;
        }

        // 3) track status non-GREEN in [La-1, Lb+1] for either driver
        const aTs = trackStatusByDriver.get(attackerDn)!;
        const bTs = trackStatusByDriver.get(defenderDn)!;
        let neutralized = false;
        for (let ln = La - 1; ln <= Lb + 1; ln++) {
          const sa = aTs.get(ln);
          const sb = bTs.get(ln);
          if ((sa && sa !== "GREEN") || (sb && sb !== "GREEN")) { neutralized = true; break; }
        }
        if (neutralized) { pushExcluded("TRACK_STATUS_NON_GREEN"); continue; }

        // 4) weather WET or MIXED in window
        const aW = weatherByDriver.get(attackerDn)!;
        const bW = weatherByDriver.get(defenderDn)!;
        let wetOrMixed = false;
        for (let ln = La - 1; ln <= Lb + 1; ln++) {
          const wa = aW.get(ln);
          const wb = bW.get(ln);
          if (wa === "WET" || wa === "MIXED" || wb === "WET" || wb === "MIXED") { wetOrMixed = true; break; }
        }
        if (wetOrMixed) { pushExcluded("WEATHER_NON_DRY"); continue; }

        // 5) anomalous pit_duration on either stop
        if (pitAnomalyThreshold != null) {
          const aDur = typeof aPit.pit_duration === "number" ? aPit.pit_duration : NaN;
          const bDur = typeof bPit.pit_duration === "number" ? bPit.pit_duration : NaN;
          if (
            (Number.isFinite(aDur) && aDur > pitAnomalyThreshold) ||
            (Number.isFinite(bDur) && bDur > pitAnomalyThreshold)
          ) {
            pushExcluded("ANOMALOUS_PIT_DURATION");
            continue;
          }
        }

        // Valid cycle
        const gapAfter = (tA_after - tB_after) / 1000;
        const swing = gapBefore - gapAfter;
        const overtake = gapAfter < 0; // A ora davanti a B

        const aStints = stintsByDriver.get(attackerDn) ?? [];
        const bStints = stintsByDriver.get(defenderDn) ?? [];
        const aC = compoundsAroundPit(aStints, La);
        const bC = compoundsAroundPit(bStints, Lb);

        cycles.push({
          attacker_driver_number: attackerDn,
          defender_driver_number: defenderDn,
          attacker_pit_lap: La,
          defender_pit_lap: Lb,
          gap_before_seconds: gapBefore,
          gap_after_seconds: gapAfter,
          swing_seconds: swing,
          overtake_completed: overtake,
          attacker_compound_before: aC.before,
          attacker_compound_after: aC.after,
          defender_compound_before: bC.before,
          defender_compound_after: bC.after,
        });
      }
    }
  }

  const attemptsDetected = cycles.length + excluded.length;
  const validCount = cycles.length;
  const swings = cycles.map((c) => c.swing_seconds);

  const aggregates: UndercutLedgerAggregates = {
    attempts_detected: attemptsDetected,
    valid_cycles: validCount,
    median_swing_seconds: median(swings),
    min_swing_seconds: swings.length ? Math.min(...swings) : null,
    max_swing_seconds: swings.length ? Math.max(...swings) : null,
    positive_swing_share: swings.length ? swings.filter((s) => s > 0).length / swings.length : null,
    overtake_share: cycles.length ? cycles.filter((c) => c.overtake_completed).length / cycles.length : null,
    confidence: confidenceOf(validCount),
  };

  return {
    cycles,
    excluded,
    aggregates,
    method_declaration: METHOD_DECLARATION,
    measured_case_note: MEASURED_CASE_NOTE,
  };
}
