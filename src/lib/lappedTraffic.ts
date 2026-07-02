/**
 * Lapped-Traffic Cost Analysis (anti-hallucination)
 * ─────────────────────────────────────────────────
 *
 * Detects race laps in which the analyzed driver lapped one or more cars,
 * and ESTIMATES the time cost of those laps by comparing them against a
 * clean-laps baseline from the same stint.
 *
 * Design principles (anti-hallucination):
 *   1. Detection is derived EXCLUSIVELY from observed lap timestamps
 *      (`date_start`). Blue flags are used ONLY as corroboration (raise
 *      confidence) and NEVER as a primary source: their absence does not
 *      eliminate an encounter.
 *   2. Missing `date_start` values are interpolated only when both a prior
 *      and a next known value exist for the same driver; otherwise that
 *      driver is excluded from the specific comparison — no invention.
 *   3. Cost is estimated by difference from a per-stint clean baseline.
 *      It is NEVER presented as a direct measurement.
 *   4. A plausibility clamp (>5s) excludes deltas likely contaminated by
 *      other causes (spin, mistake, blue-flag chain), coherent with the
 *      presentation clamp used in the alternative-strategy engine.
 *   5. Median ≤ 0 is reported as "not distinguishable from noise" — no
 *      cost is claimed.
 *   6. Confidence is explicit (HIGH ≥5, MEDIUM 3–4, LOW 1–2,
 *      INSUFFICIENT_DATA 0) based on the number of usable deltas.
 *
 * This module is a PURE function: no fetching, no side effects.
 */

import type { Lap, RaceControlMessage, StintData } from "./openf1";
import type { WeatherCondition } from "./weatherClassification";
import type { TrackStatus } from "./trackStatusClassification";
import type { BattleContext } from "./vreContext";

/* ── Types ── */

export type LappedTrafficConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
export type EncounterCostStatus = "USED" | "NO_BASELINE" | "IMPLAUSIBLE" | "NON_POSITIVE";

export interface EncounterLap {
  lap_number: number;
  lapped_drivers: number[];
  raw_delta_seconds: number | null;
  cost_seconds: number | null;
  cost_status: EncounterCostStatus;
  cost_reason: string;
  corroborated_by_blue_flag: boolean;
  baseline_seconds: number | null;
  baseline_sample_size: number;
}

export interface LappedTrafficResult {
  encounter_laps: EncounterLap[];
  encounter_lap_numbers: Set<number>;
  encounter_lap_count: number;
  total_lapped_count: number;
  median_cost_seconds: number | null;
  total_time_lost_seconds: number | null;
  blue_flag_corroboration_ratio: number;
  valid_delta_count: number;
  confidence: LappedTrafficConfidence;
  cost_distinguishable_from_noise: boolean;
  method_declaration: string;
}

export interface LappedTrafficInput {
  allSessionLaps: Lap[];
  driverLaps: Lap[];
  driverNumber: number;
  stints: StintData[];
  raceControl: RaceControlMessage[];
  weatherMap: Map<number, WeatherCondition>;
  trackStatusMap: Map<number, TrackStatus>;
  battleContext: BattleContext | null;
}

/* ── Config ── */

const PLAUSIBILITY_CLAMP_S = 5;
const MIN_BASELINE_LAPS = 3;
const BLUE_FLAG_WINDOW_MS = 30_000;

const METHOD_DECLARATION =
  "Rilevamento derivato dai timestamp osservati (date_start); costo stimato per differenza dalla baseline pulita dello stint, non è una misura diretta.";

/* ── Timestamp helpers ── */

interface LapStart {
  lap_number: number;
  t: number; // epoch ms
  interpolated: boolean;
}

/**
 * Build a driver's ordered lap-start timestamps, interpolating missing
 * `date_start` values ONLY when both a previous and a next known value
 * exist. Laps that cannot be resolved are omitted (no invention).
 */
function buildLapStarts(laps: Lap[]): LapStart[] {
  const sorted = [...laps].sort((a, b) => a.lap_number - b.lap_number);
  const known: Array<{ idx: number; t: number }> = [];
  const parsed: Array<{ lap_number: number; t: number | null }> = sorted.map((l, idx) => {
    const t = l.date_start ? Date.parse(l.date_start) : NaN;
    const ok = Number.isFinite(t);
    if (ok) known.push({ idx, t: t as number });
    return { lap_number: l.lap_number, t: ok ? (t as number) : null };
  });

  const out: LapStart[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    if (p.t != null) {
      out.push({ lap_number: p.lap_number, t: p.t, interpolated: false });
      continue;
    }
    // Interpolate: find nearest known before and after by index in sorted array
    const before = [...known].reverse().find((k) => k.idx < i);
    const after = known.find((k) => k.idx > i);
    if (!before || !after) continue; // cannot interpolate — omit
    const beforeLap = sorted[before.idx].lap_number;
    const afterLap = sorted[after.idx].lap_number;
    if (afterLap === beforeLap) continue;
    const t = before.t + ((p.lap_number - beforeLap) * (after.t - before.t)) / (afterLap - beforeLap);
    out.push({ lap_number: p.lap_number, t, interpolated: true });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Number of laps completed by driver by time `t` (last start <= t means running that lap → completed = lap_number - 1). */
function completedAt(starts: LapStart[], t: number): number | null {
  if (!starts.length) return null;
  // Find largest start with t' <= t
  let lo = 0, hi = starts.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return 0; // driver has not started any lap yet
  return starts[best].lap_number - 1;
}

/* ── Baseline ── */

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  const m = Math.floor(n / 2);
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function findStint(lap: number, stints: StintData[]): StintData | null {
  return stints.find((s) => lap >= s.lap_start && lap <= s.lap_end) ?? null;
}

function computeBaseline(
  driverLaps: Lap[],
  stint: StintData,
  encounterLapSet: Set<number>,
  weatherMap: Map<number, WeatherCondition>,
  trackStatusMap: Map<number, TrackStatus>,
  battleContext: BattleContext | null,
): { baseline: number | null; sample: number } {
  const clean: number[] = [];
  for (const l of driverLaps) {
    if (l.lap_number < stint.lap_start || l.lap_number > stint.lap_end) continue;
    if (l.lap_duration == null || !Number.isFinite(l.lap_duration)) continue;
    // Exclusions
    if (encounterLapSet.has(l.lap_number)) continue;
    if (l.lap_number === stint.lap_start && stint.stint_number > 1) continue; // pit-out
    if (l.lap_number === stint.lap_end) {
      // pit-in unless this is the very last stint (no pit at the end);
      // best-effort: exclude last lap of stint always — safer for baseline.
      continue;
    }
    if (l.is_pit_out_lap) continue;
    const wc = weatherMap.get(l.lap_number);
    if (wc === "WET" || wc === "MIXED") continue;
    const ts = trackStatusMap.get(l.lap_number);
    if (ts && ts !== "GREEN") continue;
    if (battleContext?.battle_laps.has(l.lap_number)) continue;
    clean.push(l.lap_duration);
  }
  if (clean.length < MIN_BASELINE_LAPS) return { baseline: null, sample: clean.length };
  return { baseline: median(clean), sample: clean.length };
}

/* ── Main entry ── */

export function detectLappedTraffic(input: LappedTrafficInput): LappedTrafficResult {
  const {
    allSessionLaps, driverLaps, driverNumber, stints,
    raceControl, weatherMap, trackStatusMap, battleContext,
  } = input;

  const empty = (reason: string): LappedTrafficResult => ({
    encounter_laps: [],
    encounter_lap_numbers: new Set(),
    encounter_lap_count: 0,
    total_lapped_count: 0,
    median_cost_seconds: null,
    total_time_lost_seconds: null,
    blue_flag_corroboration_ratio: 0,
    valid_delta_count: 0,
    confidence: "INSUFFICIENT_DATA",
    cost_distinguishable_from_noise: false,
    method_declaration: `${METHOD_DECLARATION} ${reason}`.trim(),
  });

  if (!allSessionLaps.length || !driverLaps.length) {
    return empty("Dati di sessione insufficienti.");
  }

  // Group all session laps by driver
  const byDriver = new Map<number, Lap[]>();
  for (const l of allSessionLaps) {
    if (l.driver_number == null) continue;
    const arr = byDriver.get(l.driver_number) ?? [];
    arr.push(l);
    byDriver.set(l.driver_number, arr);
  }

  const analyzedStarts = buildLapStarts(driverLaps);
  if (analyzedStarts.length < 2) return empty("Timestamp del pilota analizzato insufficienti.");

  // Precompute other drivers' starts
  const othersStarts = new Map<number, LapStart[]>();
  for (const [dn, dLaps] of byDriver.entries()) {
    if (dn === driverNumber) continue;
    othersStarts.set(dn, buildLapStarts(dLaps));
  }

  // Blue flag messages for corroboration
  const blueFlags = raceControl.filter((m) => (m.flag ?? "").toUpperCase() === "BLUE");

  // Detect encounters lap by lap
  const analyzedLapDurations = new Map<number, number | null>();
  driverLaps.forEach((l) => analyzedLapDurations.set(l.lap_number, l.lap_duration ?? null));

  const encounterLaps: EncounterLap[] = [];
  for (let i = 0; i < analyzedStarts.length; i++) {
    const cur = analyzedStarts[i];
    const next = analyzedStarts[i + 1];
    const tStart = cur.t;
    // End of lap L = start of lap L+1, else fallback to start + lap_duration*1000
    let tEnd: number;
    if (next) {
      tEnd = next.t;
    } else {
      const dur = analyzedLapDurations.get(cur.lap_number);
      if (dur == null || !Number.isFinite(dur)) continue;
      tEnd = tStart + dur * 1000;
    }
    if (!(tEnd > tStart)) continue;

    // Analyzed completed laps: L-1 at tStart, L at tEnd (by definition of window).
    const laps_A_start = cur.lap_number - 1;
    const laps_A_end = cur.lap_number;

    const lappedInThisLap: number[] = [];
    for (const [dn, starts] of othersStarts.entries()) {
      const cStart = completedAt(starts, tStart);
      const cEnd = completedAt(starts, tEnd);
      if (cStart == null || cEnd == null) continue; // driver not in this window
      // Guard: if driver has no starts before tStart AND none before tEnd, skip
      if (starts[0].t > tEnd) continue;
      const deficitStart = laps_A_start - cStart;
      const deficitEnd = laps_A_end - cEnd;
      if (deficitEnd >= 1 && deficitEnd === deficitStart + 1) {
        lappedInThisLap.push(dn);
      }
    }

    if (lappedInThisLap.length === 0) continue;

    // Blue flag corroboration for at least one lapped driver
    const winStart = tStart - BLUE_FLAG_WINDOW_MS;
    const winEnd = tEnd + BLUE_FLAG_WINDOW_MS;
    let corroborated = false;
    for (const dn of lappedInThisLap) {
      const hit = blueFlags.some((m) => {
        if (m.driver_number != null && m.driver_number !== dn) return false;
        if (m.lap_number != null && m.lap_number !== cur.lap_number) return false;
        const t = Date.parse(m.date);
        if (!Number.isFinite(t)) return m.driver_number === dn || m.lap_number === cur.lap_number;
        return t >= winStart && t <= winEnd;
      });
      if (hit) { corroborated = true; break; }
    }

    encounterLaps.push({
      lap_number: cur.lap_number,
      lapped_drivers: lappedInThisLap,
      raw_delta_seconds: null,
      cost_seconds: null,
      cost_status: "NO_BASELINE",
      cost_reason: "",
      corroborated_by_blue_flag: corroborated,
      baseline_seconds: null,
      baseline_sample_size: 0,
    });
  }

  const encounterLapSet = new Set(encounterLaps.map((e) => e.lap_number));

  // Cost estimation per encounter
  for (const enc of encounterLaps) {
    const stint = findStint(enc.lap_number, stints);
    const analyzedLap = driverLaps.find((l) => l.lap_number === enc.lap_number);
    if (!stint || !analyzedLap || analyzedLap.lap_duration == null) {
      enc.cost_status = "NO_BASELINE";
      enc.cost_reason = "Baseline non calcolabile (dati stint/giro mancanti).";
      continue;
    }
    const { baseline, sample } = computeBaseline(
      driverLaps, stint, encounterLapSet, weatherMap, trackStatusMap, battleContext,
    );
    enc.baseline_seconds = baseline;
    enc.baseline_sample_size = sample;
    if (baseline == null) {
      enc.cost_status = "NO_BASELINE";
      enc.cost_reason = `Meno di ${MIN_BASELINE_LAPS} giri puliti nello stint: costo escluso dalla stima.`;
      continue;
    }
    const delta = analyzedLap.lap_duration - baseline;
    enc.raw_delta_seconds = Math.round(delta * 1000) / 1000;
    if (Math.abs(delta) > PLAUSIBILITY_CLAMP_S) {
      enc.cost_status = "IMPLAUSIBLE";
      enc.cost_reason = `Delta ${enc.raw_delta_seconds}s oltre la soglia di plausibilità (${PLAUSIBILITY_CLAMP_S}s): escluso.`;
      continue;
    }
    enc.cost_seconds = enc.raw_delta_seconds;
    enc.cost_status = "USED";
    enc.cost_reason = "Delta vs baseline dello stint entro la soglia di plausibilità.";
  }

  const usedDeltas = encounterLaps
    .filter((e) => e.cost_status === "USED" && e.cost_seconds != null)
    .map((e) => e.cost_seconds as number);

  const totalLappedCount = encounterLaps.reduce((s, e) => s + e.lapped_drivers.length, 0);
  const corroboratedCount = encounterLaps.filter((e) => e.corroborated_by_blue_flag).length;
  const corroborationRatio = encounterLaps.length > 0 ? corroboratedCount / encounterLaps.length : 0;

  let confidence: LappedTrafficConfidence;
  if (usedDeltas.length === 0) confidence = "INSUFFICIENT_DATA";
  else if (usedDeltas.length <= 2) confidence = "LOW";
  else if (usedDeltas.length <= 4) confidence = "MEDIUM";
  else confidence = "HIGH";

  const med = usedDeltas.length ? median(usedDeltas) : NaN;
  const medRounded = Number.isFinite(med) ? Math.round(med * 1000) / 1000 : null;
  const distinguishable = medRounded != null && medRounded > 0;

  const total = usedDeltas.reduce((s, v) => s + v, 0);
  const totalRounded = usedDeltas.length ? Math.round(total * 1000) / 1000 : null;

  return {
    encounter_laps: encounterLaps,
    encounter_lap_numbers: encounterLapSet,
    encounter_lap_count: encounterLaps.length,
    total_lapped_count: totalLappedCount,
    median_cost_seconds: distinguishable ? medRounded : null,
    total_time_lost_seconds: distinguishable ? totalRounded : null,
    blue_flag_corroboration_ratio: Math.round(corroborationRatio * 100) / 100,
    valid_delta_count: usedDeltas.length,
    confidence,
    cost_distinguishable_from_noise: distinguishable,
    method_declaration: distinguishable
      ? METHOD_DECLARATION
      : `${METHOD_DECLARATION} Mediana ≤ 0: costo non distinguibile dal rumore, non dichiarato.`,
  };
}
