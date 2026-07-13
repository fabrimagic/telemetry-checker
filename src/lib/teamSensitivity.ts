/**
 * Team sensitivity — candidate diagnostic policy for the GP Preview
 * backtest. NOT wired into production.
 *
 * For each team we run a WEIGHTED linear regression of the per-race
 * normalized sector score (mean of s1/s2/s3, in [0,1] — the same
 * quantity that drives the production "sectors_only" persistence
 * score) against the `top_speed` weight of the circuit profile of
 * that race. Weights are the recency weights already assigned by
 * `carProfiles` (identical to the ones that drive persistence, so the
 * time-decay model stays consistent).
 *
 * The prediction for the TARGET circuit is `intercept + slope * target.top_speed`,
 * clamped to [0,1].
 *
 * STRICT GATING (never fabricate a slope):
 *  - If a team has fewer than {@link MIN_SAMPLE_SIZE} usable races (with
 *    a known circuit profile providing `top_speed`) → fall back to the
 *    persistence score with `fallback_reason = "insufficient_sample"`.
 *  - If the weighted variance of `top_speed` in the sample is near zero
 *    → the slope is not meaningfully identifiable → fall back to the
 *    persistence score with `fallback_reason = "top_speed_variance_near_zero"`.
 *
 * Pure module: no fetch, no side effects, deterministic. Alphabetical
 * tie-break on team name in the ranked order for reproducibility.
 */

import type { CarProfile } from "./carProfiles";
import type { CircuitProfile } from "./circuitProfiles";

export type TeamSensitivityFallback =
  | "insufficient_sample"
  | "top_speed_variance_near_zero"
  | null;

export interface TeamSensitivityEntry {
  team_name: string;
  /** Predicted sector-normalized score on the target circuit, in [0,1]. */
  predicted_score: number;
  /** Null when regression was applied; otherwise the fallback reason. */
  fallback_reason: TeamSensitivityFallback;
  slope: number | null;
  intercept: number | null;
  /** Number of usable history entries with a matching circuit profile. */
  sample_size: number;
}

export interface TeamSensitivityInput {
  profiles: readonly CarProfile[];
  target: CircuitProfile;
  /** Historical circuit profiles keyed by GP name (as produced by `resolveCalendarGpName`). */
  circuitProfiles: Record<string, CircuitProfile>;
}

export interface TeamSensitivityResult {
  by_team: TeamSensitivityEntry[];
  /** Ranking best→worst by predicted score, alphabetical tie-break. */
  ranked: string[];
}

/** Minimum number of usable races before the regression is attempted. */
export const MIN_SAMPLE_SIZE = 6;

/** Weighted variance threshold on `top_speed` below which the slope is not identifiable. */
export const TOP_SPEED_VARIANCE_EPS = 1e-4;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function persistenceScore(p: CarProfile): number {
  return (
    (p.sector_strength.s1 + p.sector_strength.s2 + p.sector_strength.s3) / 3
  );
}

export function computeTeamSensitivity(
  input: TeamSensitivityInput,
): TeamSensitivityResult {
  const { profiles, target, circuitProfiles } = input;
  const by_team: TeamSensitivityEntry[] = [];

  for (const p of profiles) {
    const persistence = clamp01(persistenceScore(p));
    const history = p.race_history ?? [];

    const points: Array<{ x: number; y: number; w: number }> = [];
    for (const h of history) {
      const cp = circuitProfiles[h.gpName];
      if (!cp) continue;
      if (!Number.isFinite(cp.top_speed)) continue;
      if (!Number.isFinite(h.sectors_normalized)) continue;
      if (!Number.isFinite(h.weight) || h.weight <= 0) continue;
      points.push({ x: cp.top_speed, y: h.sectors_normalized, w: h.weight });
    }

    if (points.length < MIN_SAMPLE_SIZE) {
      by_team.push({
        team_name: p.team_name,
        predicted_score: persistence,
        fallback_reason: "insufficient_sample",
        slope: null,
        intercept: null,
        sample_size: points.length,
      });
      continue;
    }

    let sumW = 0;
    let sumWX = 0;
    let sumWY = 0;
    for (const pt of points) {
      sumW += pt.w;
      sumWX += pt.w * pt.x;
      sumWY += pt.w * pt.y;
    }
    const xbar = sumWX / sumW;
    const ybar = sumWY / sumW;
    let varX = 0;
    let cov = 0;
    for (const pt of points) {
      const dx = pt.x - xbar;
      varX += pt.w * dx * dx;
      cov += pt.w * dx * (pt.y - ybar);
    }
    varX /= sumW;
    cov /= sumW;

    if (varX < TOP_SPEED_VARIANCE_EPS) {
      by_team.push({
        team_name: p.team_name,
        predicted_score: persistence,
        fallback_reason: "top_speed_variance_near_zero",
        slope: null,
        intercept: null,
        sample_size: points.length,
      });
      continue;
    }

    const slope = cov / varX;
    const intercept = ybar - slope * xbar;
    const predicted = clamp01(intercept + slope * target.top_speed);
    by_team.push({
      team_name: p.team_name,
      predicted_score: predicted,
      fallback_reason: null,
      slope,
      intercept,
      sample_size: points.length,
    });
  }

  const ranked = [...by_team]
    .sort(
      (a, b) =>
        b.predicted_score - a.predicted_score ||
        a.team_name.localeCompare(b.team_name),
    )
    .map((e) => e.team_name);

  return { by_team, ranked };
}
