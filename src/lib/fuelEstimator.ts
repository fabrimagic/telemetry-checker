/**
 * Fuel Estimator — Throttle×RPM integral proxy for fuel consumption.
 * ──────────────────────────────────────────────────────────────────
 *
 * Physical motivation:
 *   Mechanical work per lap ≈ ∫ (throttle × rpm) dt
 *   Fuel burned cumulatively ≈ Σ work_lap_i (over completed laps)
 *   Fuel remaining ≈ totalEstimatedWork − cumulativeWork
 *
 * This proxy is fed to the corrected degradation regression in place of the
 * collinear `laps_remaining` / `lap_number` proxies, which produce degenerate
 * multivariate fits because they are perfectly correlated with `tyre_life`.
 *
 * Anti-hallucination:
 *  - We DO NOT claim this equals real fuel consumption (mass per kg/lap).
 *  - We DO NOT call any new OpenF1 endpoint here — `getCarData` already exists.
 *  - This module is pure; it only consumes `Lap` and `CarData` types.
 *
 * Sample rate note: OpenF1 `/car_data` is documented at ~3.7 Hz, so the
 * nominal sample interval is ~0.27 s. The Riemann sum below uses the actual
 * Δt between consecutive samples (robust to gaps), and we report a `coverage`
 * ratio per lap so the caller can decide whether to trust the proxy.
 */

import type { Lap, CarData } from "./openf1";

/* ── Named constants (no magic numbers) ────────────────────────── */

/** Nominal sample interval for OpenF1 car_data (~3.7 Hz → ~0.27 s). */
export const SAMPLE_INTERVAL_SEC = 0.27;
/** Minimum coverage required to trust the per-lap proxy. */
export const MIN_COVERAGE_FOR_PROXY = 0.5;
/** Hard ceiling on Δt used in the Riemann sum (clip telemetry gaps). */
const MAX_DELTA_T_SEC = 1.0;

/* ── Public types ──────────────────────────────────────────────── */

export interface LapWorkEstimate {
  /** 1-indexed lap number from OpenF1. */
  lap_number: number;
  /** Cumulative ∫(throttle/100 × rpm) dt from race start through end of this lap. */
  cumulative_work: number;
  /** Fraction of expected samples actually present for this lap (0..1). */
  coverage: number;
}

/* ── Internal helpers ──────────────────────────────────────────── */

function getLapStartTimeMs(lap: Lap): number | null {
  if (!lap.date_start) return null;
  const t = new Date(lap.date_start).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Compute the work integral over a contiguous slice of CarData samples
 * using a Riemann sum (left-rectangle), with a Δt clip to avoid huge
 * spikes when there are telemetry gaps.
 */
function integrateWork(samples: CarData[]): number {
  if (samples.length < 2) return 0;
  let work = 0;
  for (let i = 1; i < samples.length; i++) {
    const dtMs = new Date(samples[i].date).getTime() - new Date(samples[i - 1].date).getTime();
    if (!Number.isFinite(dtMs) || dtMs <= 0) continue;
    const dtSec = Math.min(dtMs / 1000, MAX_DELTA_T_SEC);
    const prev = samples[i - 1];
    // throttle is 0-100 → normalise to 0-1
    const throttle = Math.max(0, Math.min(100, prev.throttle ?? 0)) / 100;
    const rpm = Math.max(0, prev.rpm ?? 0);
    work += throttle * rpm * dtSec;
  }
  return work;
}

/* ── Public API ────────────────────────────────────────────────── */

/**
 * Build per-lap cumulative work estimates from raw CarData.
 *
 * Behaviour:
 *  - Empty / missing carData → returns one entry per lap with cumulative_work=0
 *    and coverage=0 (caller will fall back).
 *  - Lap with `date_start === null` → coverage=0 for that lap, cumulative carries
 *    over from the previous lap unchanged.
 *  - The slice for lap N is [date_start_N, date_start_{N+1}); for the LAST lap
 *    we use all remaining samples after its start.
 */
export function estimateLapWork(laps: Lap[], carData: CarData[]): LapWorkEstimate[] {
  // Always emit one entry per lap, in input order.
  const sortedLaps = [...laps].sort((a, b) => a.lap_number - b.lap_number);
  const out: LapWorkEstimate[] = [];

  if (!carData.length) {
    for (const l of sortedLaps) {
      out.push({ lap_number: l.lap_number, cumulative_work: 0, coverage: 0 });
    }
    return out;
  }

  // Sort samples once.
  const samples = [...carData].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const sampleTimes = samples.map((s) => new Date(s.date).getTime());

  let cumulative = 0;

  for (let i = 0; i < sortedLaps.length; i++) {
    const lap = sortedLaps[i];
    const tStart = getLapStartTimeMs(lap);

    if (tStart == null) {
      // Carry cumulative forward; coverage 0 marks this lap as untrusted.
      out.push({ lap_number: lap.lap_number, cumulative_work: cumulative, coverage: 0 });
      continue;
    }

    // End boundary: next lap's start, or +lap_duration for the final lap.
    let tEnd: number | null = null;
    for (let j = i + 1; j < sortedLaps.length; j++) {
      const tNext = getLapStartTimeMs(sortedLaps[j]);
      if (tNext != null && tNext > tStart) { tEnd = tNext; break; }
    }
    if (tEnd == null) {
      const dur = lap.lap_duration;
      tEnd = dur != null && dur > 0 ? tStart + dur * 1000 : tStart + 90_000;
    }

    // Slice samples in [tStart, tEnd) using binary-ish linear scan.
    let lo = 0;
    while (lo < sampleTimes.length && sampleTimes[lo] < tStart) lo++;
    let hi = lo;
    while (hi < sampleTimes.length && sampleTimes[hi] < tEnd) hi++;
    const slice = samples.slice(lo, hi);

    const expectedSamples = Math.max(1, Math.floor((tEnd - tStart) / 1000 / SAMPLE_INTERVAL_SEC));
    const coverage = Math.max(0, Math.min(1, slice.length / expectedSamples));

    const work = integrateWork(slice);
    cumulative += work;

    out.push({ lap_number: lap.lap_number, cumulative_work: cumulative, coverage });
  }

  return out;
}

/**
 * Build a per-lap "fuel remaining" proxy from a `LapWorkEstimate` series.
 *
 * proxy(lap) = totalEstimatedWork − cumulative_work(lap)
 *
 * Returns `null` when:
 *  - lapWorkEstimates is empty
 *  - the requested lap is missing
 *  - per-lap coverage is below `MIN_COVERAGE_FOR_PROXY`
 *  - totalEstimatedWork is non-finite or non-positive
 */
export function buildThrottleIntegralProxy(
  lap: Lap,
  lapWorkEstimates: LapWorkEstimate[],
  totalEstimatedWork: number,
): number | null {
  if (!lapWorkEstimates.length) return null;
  if (!Number.isFinite(totalEstimatedWork) || totalEstimatedWork <= 0) return null;

  const entry = lapWorkEstimates.find((e) => e.lap_number === lap.lap_number);
  if (!entry) return null;
  if (entry.coverage < MIN_COVERAGE_FOR_PROXY) return null;

  return totalEstimatedWork - entry.cumulative_work;
}

/**
 * Convenience: extrapolate `totalEstimatedWork` from a partial series of
 * lap-work estimates and the known total race length. Returns `null` when
 * the series carries no usable signal (all-zero cumulative or zero coverage).
 *
 * Used by the loader to build the `context` argument once per driver/session.
 */
export function estimateTotalWork(
  lapWorkEstimates: LapWorkEstimate[],
  totalLaps: number,
): number | null {
  if (!lapWorkEstimates.length || totalLaps <= 0) return null;
  // Find the last entry with non-zero coverage and positive cumulative.
  let lastIdx = -1;
  for (let i = lapWorkEstimates.length - 1; i >= 0; i--) {
    if (lapWorkEstimates[i].coverage > 0 && lapWorkEstimates[i].cumulative_work > 0) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx < 0) return null;
  const last = lapWorkEstimates[lastIdx];
  // Scale linearly: completed N laps → expected at totalLaps.
  const completedLaps = lastIdx + 1;
  if (completedLaps <= 0) return null;
  return (last.cumulative_work / completedLaps) * totalLaps;
}
