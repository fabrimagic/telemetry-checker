/**
 * Domain-distance reliability check for the "Anteprima GP".
 *
 * Production scoring (sectors_only persistence) was validated on the fast
 * circuits actually run in 2026 (qualifying mean speed ≈ 216–253 km/h).
 * When the NEXT GP has a qualifying-speed character very different from the
 * already-run set, the prediction is an EXTRAPOLATION outside the data we
 * have, not an interpolation. This module computes that distance objectively
 * (via `quali_speed_kmh` declared on each CircuitProfile) so the UI can
 * surface an honest, self-updating disclosure.
 *
 * IMPORTANT — this is informational ONLY: it does NOT modify the score nor
 * the uncertainty band in this step. When more circuits with different
 * character are run, the "out_of_domain" warning disappears automatically.
 */

import {
  CIRCUIT_PROFILES,
  resolveGpNameByCircuitKey,
  type CircuitProfile,
} from "./circuitProfiles";
import type { SessionInfo } from "./openf1";

/** Distance from the data domain to the target circuit. */
export type DomainStatus = "in_domain" | "out_of_domain" | "unknown";

export interface DomainReliability {
  status: DomainStatus;
  /** Quali mean speed of the target circuit (km/h), when known. */
  target_speed?: number;
  /** Quali speeds (km/h) of the already-run circuits that had a value. */
  reference_speeds: number[];
  /** Mean of `reference_speeds`. */
  mean?: number;
  /** Standard deviation of `reference_speeds` (population, biased). */
  sd?: number;
  /** |target − mean| / sd. Undefined if sd is 0 or undefined. */
  sigma?: number;
  /** Min/max of the reference window. */
  min?: number;
  max?: number;
  /**
   * Signed gap from the nearest reference circuit:
   *   - negative when the target is slower than the slowest reference
   *     (e.g. Monaco 172 vs min 217 → -45);
   *   - positive when faster than the fastest reference;
   *   - 0 when inside the [min, max] range.
   * Undefined when references are empty.
   */
  gap_from_nearest?: number;
  /** Free-form reason for "unknown" (no warning shown). */
  reason?: "no_target_speed" | "no_reference_speeds";
  /**
   * INFORMATIVE-ONLY, additive: signals that the target circuit's
   * `top_speed` weight (how much the layout rewards straight-line efficiency)
   * lies strictly outside the min/max range of the already-run circuits.
   * Independent from `status`, does NOT alter the score or the bands. When
   * present, the narrative surfaces an extra cautionary sentence because the
   * production score (sector-only persistence) never captures straight-line
   * efficiency and cannot compensate for this out-of-range character.
   */
  top_speed_out_of_range?: {
    target: number;
    min: number;
    max: number;
  };
}

/**
 * Soft band around the reference set: a target within `IN_DOMAIN_SIGMA`
 * standard deviations from the mean is considered in-domain even if slightly
 * outside the observed [min, max] range. Keeps the gate from triggering on
 * marginal cases.
 */
export const IN_DOMAIN_SIGMA = 1.5;

/**
 * Trigger threshold for "out_of_domain". The target must be BOTH outside
 * the observed [min, max] range AND beyond this many standard deviations
 * from the mean. Both conditions must hold so we never flag a marginal case.
 */
export const OUT_OF_DOMAIN_SIGMA = 2.0;

function meanOf(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function sdOf(xs: number[], mu: number): number {
  if (xs.length <= 1) return 0;
  let s = 0;
  for (const x of xs) s += (x - mu) * (x - mu);
  return Math.sqrt(s / xs.length);
}

/**
 * Compute the reliability of applying the production engine — validated on
 * the circuits already run — to `target`. Uses `racesUsed` (the actual list
 * of sessions that fed the CarProfiles, exposed by computeCarProfiles) so
 * the gate self-updates as the season progresses.
 *
 * Returns "unknown" (no warning) when either side lacks `quali_speed_kmh`:
 * we never fire a false alarm on missing data.
 */
export function computeDomainReliability(
  target: CircuitProfile | null | undefined,
  racesUsed: SessionInfo[] | null | undefined,
): DomainReliability {
  const referenceSpeeds: number[] = [];
  const referenceTopSpeeds: number[] = [];
  const seenGp = new Set<string>();
  for (const s of racesUsed ?? []) {
    const gpName = resolveGpNameByCircuitKey(s.circuit_key);
    if (!gpName || seenGp.has(gpName)) continue;
    // Avoid double-counting a GP that contributed multiple sessions.
    seenGp.add(gpName);
    const profile = CIRCUIT_PROFILES[gpName];
    const v = profile?.quali_speed_kmh;
    if (typeof v === "number" && Number.isFinite(v)) referenceSpeeds.push(v);
    const ts = profile?.top_speed;
    if (typeof ts === "number" && Number.isFinite(ts)) referenceTopSpeeds.push(ts);
  }

  const targetSpeed = target?.quali_speed_kmh;
  if (typeof targetSpeed !== "number" || !Number.isFinite(targetSpeed)) {
    return {
      status: "unknown",
      reference_speeds: referenceSpeeds,
      reason: "no_target_speed",
    };
  }
  if (referenceSpeeds.length === 0) {
    return {
      status: "unknown",
      target_speed: targetSpeed,
      reference_speeds: referenceSpeeds,
      reason: "no_reference_speeds",
    };
  }

  const mu = meanOf(referenceSpeeds);
  const sd = sdOf(referenceSpeeds, mu);
  const min = Math.min(...referenceSpeeds);
  const max = Math.max(...referenceSpeeds);
  const sigma = sd > 0 ? Math.abs(targetSpeed - mu) / sd : undefined;
  const gap =
    targetSpeed < min
      ? targetSpeed - min // negative
      : targetSpeed > max
      ? targetSpeed - max // positive
      : 0;

  const insideRange = targetSpeed >= min && targetSpeed <= max;
  let status: DomainStatus;
  if (insideRange) {
    status = "in_domain";
  } else if (sigma !== undefined && sigma >= OUT_OF_DOMAIN_SIGMA) {
    status = "out_of_domain";
  } else if (sigma !== undefined && sigma <= IN_DOMAIN_SIGMA) {
    // Outside the observed range but within the soft sigma band → still in.
    status = "in_domain";
  } else {
    // Borderline: outside range but not far enough in σ — treat as in-domain
    // to avoid noisy warnings (the threshold is the OUT_OF_DOMAIN_SIGMA gate).
    status = "in_domain";
  }

  // Additive top_speed-weight range check: purely informative, independent
  // from `status`. Only applies when the target circuit exposes top_speed
  // and at least one reference profile does too. Strict inequality: exactly
  // at the boundary is still considered inside.
  let topSpeedOutOfRange: DomainReliability["top_speed_out_of_range"];
  const targetTop = target?.top_speed;
  if (
    typeof targetTop === "number" &&
    Number.isFinite(targetTop) &&
    referenceTopSpeeds.length > 0
  ) {
    const tsMin = Math.min(...referenceTopSpeeds);
    const tsMax = Math.max(...referenceTopSpeeds);
    if (targetTop > tsMax || targetTop < tsMin) {
      topSpeedOutOfRange = { target: targetTop, min: tsMin, max: tsMax };
    }
  }

  return {
    status,
    target_speed: targetSpeed,
    reference_speeds: referenceSpeeds,
    mean: mu,
    sd,
    sigma,
    min,
    max,
    gap_from_nearest: gap,
    ...(topSpeedOutOfRange ? { top_speed_out_of_range: topSpeedOutOfRange } : {}),
  };
}
