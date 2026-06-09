/**
 * Performance Radar — Pentagonal radar (5 SOLID axes only).
 *
 * Strada 1: NO "corner type" axes (lente/medie/veloci): not measurable
 * honestly from current data. We expose ONLY axes we can compute from
 * raw timing telemetry, plus a degradation axis that gracefully marks
 * itself "not available" when not statistically validated.
 *
 * Axes (all normalized 0..1, 1 = best of the reference set):
 *   1) trap        — p90 of st_speed (HIGHER is better)
 *   2) sector1     — robust aggregate of duration_sector_1 (LOWER is better)
 *   3) sector2     — robust aggregate of duration_sector_2 (LOWER is better)
 *   4) sector3     — robust aggregate of duration_sector_3 (LOWER is better)
 *   5) degradation — slope from validated long runs (LOWER slope is better);
 *                    marked unavailable if no validated long run for the driver
 *
 * Normalization: RELATIVE-TO-BEST (preserves magnitudes, NOT min-max):
 *   - higher-is-better axis (trap):   score = v / max
 *   - lower-is-better axis (sectors): score = min / v
 *   This means the best driver in the reference set gets exactly 1.0 and
 *   the relative gaps are preserved.
 *
 * Filters (REUSING existing engines, not reinventing):
 *   - exclude out/in-laps (is_pit_out_lap, pit-in lap when provided)
 *   - exclude laps under neutralization (SC / VSC / RED / MIXED) via the
 *     pre-computed trackStatusMap from `classifyLapsTrackStatus`
 *   - exclude outliers per-axis via the SAME MAD-based filter philosophy
 *     used by `correctedDegradation` (median ± k * MAD, MAD floor)
 */

import type { Lap, PitData } from "./openf1";
import type { TrackStatus } from "./trackStatusClassification";
import type { LongRunResult } from "./longRunDetector";

/* ──────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────── */

export type RadarAxisKey = "trap" | "sector1" | "sector2" | "sector3" | "degradation";

export interface RadarAxisValue {
  /** Aggregated raw value (km/h for trap, seconds for sectors, s/lap for degradation). */
  raw: number | null;
  /** Score 0..1 relative-to-best in the reference set; null when unavailable. */
  score: number | null;
  /** Number of clean laps used for aggregation (0 for degradation when n/a). */
  sampleSize: number;
  /** Human-readable note about availability / honesty caveats. */
  note?: string;
}

export interface DriverRadar {
  driverNumber: number;
  acronym: string;
  color: string;
  axes: Record<RadarAxisKey, RadarAxisValue>;
}

export interface RadarInputDriver {
  driverNumber: number;
  acronym: string;
  color: string;
  laps: Lap[];
  /** Pre-computed via `classifyLapsTrackStatus(laps, raceControlMessages)`. */
  trackStatusMap?: Map<number, TrackStatus>;
  /** Pit-in lap numbers (excluded). */
  pitInLaps?: number[];
  /** Optional: detected long runs for THIS driver (any session-level set is fine). */
  longRuns?: LongRunResult[];
}

export interface PerformanceRadarResult {
  drivers: DriverRadar[];
  /** Reference values: the best value per axis in the input set (or null when no data). */
  reference: Record<RadarAxisKey, number | null>;
}

/* ──────────────────────────────────────────────────────────────────
 * Robust helpers (same philosophy as correctedDegradation)
 * ────────────────────────────────────────────────────────────────── */

/** Default MAD multiplier — matches the canonical "moderate" tyre profile. */
const SECTOR_MAD_MULTIPLIER = 3.5;
const TRAP_MAD_MULTIPLIER = 3.5;
/** MAD floor (seconds for sectors). Trap uses km/h floor below. */
const SECTOR_MAD_FLOOR_S = 0.05;
const TRAP_MAD_FLOOR_KMH = 1.0;
/** Maximum slope (s/lap) for degradation score scale (matches max_plausible_slope). */
const MAX_DEG_SLOPE = 0.30;
/** Minimum slope (s/lap). Slopes <= this all map to score 1.0. */
const MIN_DEG_SLOPE = 0.0;
/** Minimum number of clean samples to compute a sector / trap axis. */
const MIN_SECTOR_SAMPLES = 3;
const MIN_TRAP_SAMPLES = 3;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Percentile (linear interp, 0..1). */
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * MAD outlier removal — same logic as `filterOutliersMADCorrected` in
 * correctedDegradation.ts, generalized over a numeric series.
 */
function madFilter(values: number[], multiplier: number, madFloor: number): number[] {
  if (values.length < 3) return values;
  const med = median(values);
  const absDevs = values.map((v) => Math.abs(v - med));
  const mad = Math.max(median(absDevs), madFloor);
  const threshold = multiplier * mad;
  return values.filter((v) => Math.abs(v - med) <= threshold);
}

/** True if the lap should be EXCLUDED from clean aggregation. */
function shouldExcludeLap(
  lap: Lap,
  pitInSet: Set<number>,
  trackStatusMap?: Map<number, TrackStatus>,
): boolean {
  if (lap.is_pit_out_lap) return true;
  if (pitInSet.has(lap.lap_number)) return true;
  const status = trackStatusMap?.get(lap.lap_number);
  if (status && status !== "GREEN" && status !== "YELLOW" && status !== "DOUBLE_YELLOW") {
    // Exclude neutralized laps: SC / VSC / RED / MIXED.
    // Plain yellow (track-wide) does not neutralize pace meaningfully.
    return true;
  }
  return false;
}

/* ──────────────────────────────────────────────────────────────────
 * Per-axis aggregation
 * ────────────────────────────────────────────────────────────────── */

/** Aggregate one sector across a driver's clean laps. Returns null on insufficient data. */
function aggregateSector(
  laps: Lap[],
  pitInSet: Set<number>,
  trackStatusMap: Map<number, TrackStatus> | undefined,
  pickSector: (l: Lap) => number | null,
): { raw: number | null; sampleSize: number } {
  const raw: number[] = [];
  for (const lap of laps) {
    if (shouldExcludeLap(lap, pitInSet, trackStatusMap)) continue;
    const v = pickSector(lap);
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    raw.push(v);
  }
  if (raw.length < MIN_SECTOR_SAMPLES) return { raw: null, sampleSize: raw.length };
  const filtered = madFilter(raw, SECTOR_MAD_MULTIPLIER, SECTOR_MAD_FLOOR_S);
  if (filtered.length < MIN_SECTOR_SAMPLES) return { raw: null, sampleSize: filtered.length };
  return { raw: median(filtered), sampleSize: filtered.length };
}

function aggregateTrap(
  laps: Lap[],
  pitInSet: Set<number>,
  trackStatusMap: Map<number, TrackStatus> | undefined,
): { raw: number | null; sampleSize: number } {
  const raw: number[] = [];
  for (const lap of laps) {
    if (shouldExcludeLap(lap, pitInSet, trackStatusMap)) continue;
    const v = lap.st_speed;
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    raw.push(v);
  }
  if (raw.length < MIN_TRAP_SAMPLES) return { raw: null, sampleSize: raw.length };
  const filtered = madFilter(raw, TRAP_MAD_MULTIPLIER, TRAP_MAD_FLOOR_KMH);
  if (filtered.length < MIN_TRAP_SAMPLES) return { raw: null, sampleSize: filtered.length };
  // p90 for robustness against single corrupt readings while preserving the
  // "what the car actually reached on a clean lap" character of the trap axis.
  return { raw: percentile(filtered, 0.9), sampleSize: filtered.length };
}

/**
 * Extract the best (lowest) validated degradation slope for a driver.
 * Returns null when no validated long run exists.
 */
function pickValidatedDegradation(longRuns: LongRunResult[] | undefined): {
  slope: number | null;
  sampleSize: number;
} {
  if (!longRuns || !longRuns.length) return { slope: null, sampleSize: 0 };
  const validated = longRuns.filter((lr) => lr.isValidLongRun);
  if (!validated.length) return { slope: null, sampleSize: 0 };
  // Use the BEST (lowest) validated slope — represents the car's tyre management
  // ceiling. Sum laps for context.
  let best = validated[0];
  for (const lr of validated) if (lr.degradationSlope < best.degradationSlope) best = lr;
  const totalLaps = validated.reduce((acc, lr) => acc + lr.lapsCount, 0);
  return { slope: best.degradationSlope, sampleSize: totalLaps };
}

/* ──────────────────────────────────────────────────────────────────
 * Normalization (relative-to-best, preserves magnitudes)
 * ────────────────────────────────────────────────────────────────── */

function scoreHigherBetter(v: number | null, ref: number | null): number | null {
  if (v == null || ref == null || ref <= 0) return null;
  const s = v / ref;
  return Math.max(0, Math.min(1, s));
}

function scoreLowerBetter(v: number | null, ref: number | null): number | null {
  if (v == null || ref == null || v <= 0) return null;
  const s = ref / v;
  return Math.max(0, Math.min(1, s));
}

/** Degradation score: 1.0 at slope <= 0, 0.0 at slope >= MAX_DEG_SLOPE, linear in between. */
function scoreDegradation(slope: number | null): number | null {
  if (slope == null || !Number.isFinite(slope)) return null;
  if (slope <= MIN_DEG_SLOPE) return 1;
  if (slope >= MAX_DEG_SLOPE) return 0;
  return 1 - (slope - MIN_DEG_SLOPE) / (MAX_DEG_SLOPE - MIN_DEG_SLOPE);
}

/* ──────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────── */

/**
 * Build per-axis aggregates for each driver, then normalize relative-to-best
 * within the provided set (used both for single-driver mode — passing the
 * whole session field — and for H2H — passing just the two drivers).
 */
export function computePerformanceRadar(
  drivers: RadarInputDriver[],
): PerformanceRadarResult {
  const perDriver = drivers.map((d) => {
    const pitInSet = new Set<number>(d.pitInLaps ?? []);
    const trap = aggregateTrap(d.laps, pitInSet, d.trackStatusMap);
    const s1 = aggregateSector(d.laps, pitInSet, d.trackStatusMap, (l) => l.duration_sector_1);
    const s2 = aggregateSector(d.laps, pitInSet, d.trackStatusMap, (l) => l.duration_sector_2);
    const s3 = aggregateSector(d.laps, pitInSet, d.trackStatusMap, (l) => l.duration_sector_3);
    const deg = pickValidatedDegradation(d.longRuns);
    return {
      driverNumber: d.driverNumber,
      acronym: d.acronym,
      color: d.color,
      trap, s1, s2, s3, deg,
    };
  });

  // Reference (best per axis) across input set.
  const trapVals = perDriver.map((p) => p.trap.raw).filter((v): v is number => v != null);
  const s1Vals = perDriver.map((p) => p.s1.raw).filter((v): v is number => v != null);
  const s2Vals = perDriver.map((p) => p.s2.raw).filter((v): v is number => v != null);
  const s3Vals = perDriver.map((p) => p.s3.raw).filter((v): v is number => v != null);
  const reference: Record<RadarAxisKey, number | null> = {
    trap: trapVals.length ? Math.max(...trapVals) : null,
    sector1: s1Vals.length ? Math.min(...s1Vals) : null,
    sector2: s2Vals.length ? Math.min(...s2Vals) : null,
    sector3: s3Vals.length ? Math.min(...s3Vals) : null,
    degradation: null, // degradation uses an absolute scale, not relative
  };

  const out: DriverRadar[] = perDriver.map((p) => {
    const degSlope = p.deg.slope;
    const degScore = scoreDegradation(degSlope);
    const axes: Record<RadarAxisKey, RadarAxisValue> = {
      trap: {
        raw: p.trap.raw,
        score: scoreHigherBetter(p.trap.raw, reference.trap),
        sampleSize: p.trap.sampleSize,
        note: "Velocità massima rilevata (trap): dipende anche dall'assetto aerodinamico scelto per il GP, non solo dalla potenza.",
      },
      sector1: {
        raw: p.s1.raw,
        score: scoreLowerBetter(p.s1.raw, reference.sector1),
        sampleSize: p.s1.sampleSize,
        note: "Settore 1 geografico del circuito (non un \"tipo di curva\").",
      },
      sector2: {
        raw: p.s2.raw,
        score: scoreLowerBetter(p.s2.raw, reference.sector2),
        sampleSize: p.s2.sampleSize,
        note: "Settore 2 geografico del circuito (non un \"tipo di curva\").",
      },
      sector3: {
        raw: p.s3.raw,
        score: scoreLowerBetter(p.s3.raw, reference.sector3),
        sampleSize: p.s3.sampleSize,
        note: "Settore 3 geografico del circuito (non un \"tipo di curva\").",
      },
      degradation: {
        raw: degSlope,
        score: degScore,
        sampleSize: p.deg.sampleSize,
        note:
          degSlope == null
            ? "Degrado non stimabile con affidabilità in questa sessione (long run non validato)."
            : `Degrado validato ${degSlope.toFixed(3)} s/giro su ${p.deg.sampleSize} giri.`,
      },
    };
    return {
      driverNumber: p.driverNumber,
      acronym: p.acronym,
      color: p.color,
      axes,
    };
  });

  return { drivers: out, reference };
}

/* ──────────────────────────────────────────────────────────────────
 * Narrative (per axis, honest)
 * ────────────────────────────────────────────────────────────────── */

export const AXIS_LABELS: Record<RadarAxisKey, string> = {
  trap: "Velocità massima rilevata (trap)",
  sector1: "Settore 1",
  sector2: "Settore 2",
  sector3: "Settore 3",
  degradation: "Degrado gomme",
};

/** Per-axis narrative for a single driver (used in single-driver analysis). */
export function buildAxisNarrative(driver: DriverRadar): Record<RadarAxisKey, string> {
  const a = driver.axes;
  const sectorLine = (key: RadarAxisKey, n: 1 | 2 | 3): string => {
    const v = a[key];
    if (v.raw == null || v.score == null) {
      return `Settore ${n}: dati insufficienti (giri puliti < soglia minima).`;
    }
    const pct = Math.round(v.score * 100);
    const tone = v.score >= 0.99 ? "il migliore" : v.score >= 0.97 ? "vicino al migliore" : v.score >= 0.93 ? "competitivo" : "in deficit";
    return `Settore ${n}: ${v.raw.toFixed(3)}s (${pct}% del migliore — ${tone} nel settore geografico ${n}).`;
  };
  return {
    trap:
      a.trap.raw == null || a.trap.score == null
        ? "Velocità massima rilevata: dati insufficienti."
        : `Velocità massima rilevata ${a.trap.raw.toFixed(1)} km/h (${Math.round(a.trap.score * 100)}% del migliore). Riflette anche la scelta di ala per questo GP, non solo la potenza.`,
    sector1: sectorLine("sector1", 1),
    sector2: sectorLine("sector2", 2),
    sector3: sectorLine("sector3", 3),
    degradation:
      a.degradation.raw == null
        ? "Degrado gomme: non stimabile con affidabilità in questa sessione (nessun long run validato)."
        : `Degrado gomme ${a.degradation.raw.toFixed(3)} s/giro su ${a.degradation.sampleSize} giri validati (punteggio ${Math.round((a.degradation.score ?? 0) * 100)}%, scala 0→${MAX_DEG_SLOPE.toFixed(2)} s/giro).`,
  };
}

/** Comparative narrative per axis between two drivers (H2H). */
export function buildH2HAxisNarrative(
  a: DriverRadar,
  b: DriverRadar,
): Record<RadarAxisKey, string> {
  const out = {} as Record<RadarAxisKey, string>;
  (Object.keys(AXIS_LABELS) as RadarAxisKey[]).forEach((key) => {
    const va = a.axes[key];
    const vb = b.axes[key];
    if (va.raw == null && vb.raw == null) {
      out[key] = `${AXIS_LABELS[key]}: dati insufficienti per entrambi.`;
      return;
    }
    if (va.raw == null) {
      out[key] = `${AXIS_LABELS[key]}: ${a.acronym} senza dati; ${b.acronym} riferimento.`;
      return;
    }
    if (vb.raw == null) {
      out[key] = `${AXIS_LABELS[key]}: ${b.acronym} senza dati; ${a.acronym} riferimento.`;
      return;
    }
    if (key === "trap") {
      const diff = va.raw - vb.raw;
      const leader = diff > 0 ? a.acronym : b.acronym;
      out[key] = `${AXIS_LABELS[key]}: ${a.acronym} ${va.raw.toFixed(1)} km/h vs ${b.acronym} ${vb.raw.toFixed(1)} km/h. Migliore: ${leader} (Δ ${Math.abs(diff).toFixed(1)} km/h). Dipende anche dalla scelta di ala.`;
      return;
    }
    if (key === "degradation") {
      const diff = va.raw - vb.raw;
      const leader = diff < 0 ? a.acronym : b.acronym;
      out[key] = `${AXIS_LABELS[key]}: ${a.acronym} ${va.raw.toFixed(3)} s/giro vs ${b.acronym} ${vb.raw.toFixed(3)} s/giro. Migliore (meno degrado): ${leader}.`;
      return;
    }
    // sector: lower is better
    const diff = va.raw - vb.raw;
    const leader = diff < 0 ? a.acronym : b.acronym;
    out[key] = `${AXIS_LABELS[key]}: ${a.acronym} ${va.raw.toFixed(3)}s vs ${b.acronym} ${vb.raw.toFixed(3)}s. Migliore: ${leader} (Δ ${Math.abs(diff).toFixed(3)}s).`;
  });
  return out;
}
