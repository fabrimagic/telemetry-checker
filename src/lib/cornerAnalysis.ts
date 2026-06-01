/**
 * Corner Analysis — PROOF OF CONCEPT (ISOLATED).
 *
 * Classifies a circuit's corners (slow / medium / fast / straight) from its
 * GeoJSON layout, then measures the per-driver speed in each corner type
 * by aligning car telemetry (speed) with track positions.
 *
 * IMPORTANT — scope and limitations:
 *  - This module is EXPERIMENTAL and is NOT imported by carProfiles,
 *    gpPrediction, or any strategy engine. It exists to validate the
 *    pipeline on real data BEFORE any integration is considered.
 *  - Corner classification is HEURISTIC: it derives curvature from the
 *    circuit polyline geometry, not from the actual racing line (which
 *    typically cuts corners and travels with a larger effective radius).
 *    Expect a margin of error, especially on complex sequences and chicanes.
 *  - The GeoJSON outline is in [lon, lat] degrees: distances/angles in
 *    that space are distorted. We project to a local equirectangular
 *    metric frame centered on the circuit centroid before computing any
 *    geometry — accurate for the spatial extent of a single circuit.
 *  - LocationData (x, y) lives in a DIFFERENT coordinate system than the
 *    GeoJSON. We normalize both spaces (center + scale by bounding-box
 *    range) and snap each location to the nearest outline vertex. This
 *    is an APPROXIMATE spatial alignment; the X axis sign convention
 *    used by OpenF1 is also mirrored (TrackMap applies scale(-1,1)) so
 *    we mirror x on the location side before normalizing.
 *  - The /location endpoint is known to have gaps; results carry a
 *    `coverage` indicator (fraction of outline vertices touched by the
 *    driver's samples) so callers can judge data quality.
 *
 * Time alignment between speed and position reuses the exact pattern from
 * src/components/f1/TrackMap.tsx: nearest sample by |Δdate|. We do NOT
 * invent a new sync method.
 */

import { fetchCircuitOutline } from "./circuitGeometry";
import { getCarData, getLocation, type CarData, type LocationData } from "./openf1";

// ---------------------------------------------------------------------------
// Tunable thresholds (documented). Curvature κ has units of 1/m. A circle
// of radius R has κ = 1/R. Defaults are chosen so a typical F1 circuit
// yields a sensible split (Monaco mostly slow, Monza mostly fast/straight).
// ---------------------------------------------------------------------------
/**
 * Below this curvature the point is treated as a straight (R > ~600 m).
 *
 * Calibration note: raised to 1/600 so that real-world fast corners with
 * radius around 440 m (e.g. Copse at Silverstone) are classified as "fast"
 * rather than "straight". This is a heuristic based on the published track
 * geometry, not the racing line; expect a margin of error.
 */
export const CORNER_CURVATURE_STRAIGHT_MAX = 1 / 600;
/** At or above this curvature the corner is "slow" (R ≤ ~70 m). */
export const CORNER_CURVATURE_SLOW = 1 / 70;
/** At or above this curvature (but below SLOW) the corner is "medium". */
export const CORNER_CURVATURE_MEDIUM = 1 / 180;
// Below MEDIUM (but above STRAIGHT_MAX) the corner is "fast".

/** Minimum number of consecutive curve points to register as a corner. */
export const MIN_CORNER_POINTS = 3;

export type CornerType = "slow" | "medium" | "fast" | "straight";

export interface CornerSegment {
  index: number;
  start_idx: number; // inclusive index into the outline array
  end_idx: number;   // inclusive
  /** Peak (max) curvature in 1/m observed inside the segment. */
  curvature: number;
  type: CornerType;
}

export interface PerDriverCornerSpeeds {
  driver_number: number;
  /** Min apex speed in km/h across all slow corners, or null if no samples. */
  slow_corner_speed: number | null;
  medium_corner_speed: number | null;
  fast_corner_speed: number | null;
  sample_counts: Record<CornerType, number>;
  /** Fraction of outline vertices touched by at least one location sample. */
  coverage: number;
  /**
   * Fraction of CORNER vertices (slow/medium/fast segments only, straights
   * excluded) touched by at least one location sample. Diagnostic metric:
   * compare with the global `coverage` — corners may be covered much better
   * than the whole track. `null` when there are no corner vertices.
   */
  corner_coverage: number | null;
  /** True when /location or /car_data returned empty or fetch failed. */
  partial: boolean;
  notes: string[];
}

export interface SessionCornerAnalysis {
  gpName: string;
  sessionKey: number;
  segments: CornerSegment[];
  per_driver: PerDriverCornerSpeeds[];
  notes: string[];
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

/**
 * Project [lon, lat] degrees to local meters using an equirectangular
 * approximation centered on the centroid of the outline.
 * Accurate to ~0.1% within a few km of the center — fine for a circuit.
 */
export function lonLatToMeters(outline: [number, number][]): { x: number; y: number }[] {
  if (outline.length === 0) return [];
  let sLon = 0;
  let sLat = 0;
  for (const [lon, lat] of outline) {
    sLon += lon;
    sLat += lat;
  }
  const cLon = sLon / outline.length;
  const cLat = sLat / outline.length;
  const R = 6_371_000; // Earth radius in meters
  const cosLat = Math.cos((cLat * Math.PI) / 180);
  return outline.map(([lon, lat]) => ({
    x: ((lon - cLon) * Math.PI) / 180 * R * cosLat,
    y: ((lat - cLat) * Math.PI) / 180 * R,
  }));
}

/**
 * Local curvature at index i using three consecutive points (i-1, i, i+1).
 * Returns κ = 4 * Area(triangle) / (|a|*|b|*|c|) where a,b,c are side lengths.
 * Equivalent to 1/R of the circle through the three points.
 */
function curvatureAt(pts: { x: number; y: number }[], i: number): number {
  if (i <= 0 || i >= pts.length - 1) return 0;
  const p0 = pts[i - 1];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const ax = p1.x - p0.x, ay = p1.y - p0.y;
  const bx = p2.x - p1.x, by = p2.y - p1.y;
  const cx = p2.x - p0.x, cy = p2.y - p0.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  const lc = Math.hypot(cx, cy);
  if (la === 0 || lb === 0 || lc === 0) return 0;
  // 2 * signed area = cross(a, b)
  const cross = ax * by - ay * bx;
  return (2 * Math.abs(cross)) / (la * lb * lc);
}

/**
 * Classify a circuit outline into corner segments.
 *
 * HEURISTIC: derives curvature from the polyline geometry of the track
 * (centerline as published in the GeoJSON), not from the racing line.
 * Real apex speeds depend on the driver's chosen line; this is a layout-
 * based approximation. Returns an empty array if the outline is too short.
 *
 * @param outline Array of [lon, lat] vertices.
 */
export function classifyCircuitCorners(outline: [number, number][]): CornerSegment[] {
  if (!outline || outline.length < MIN_CORNER_POINTS + 2) return [];
  const pts = lonLatToMeters(outline);

  // Per-point curvature with a tiny smoothing window (avg of 3 raw samples)
  // to reduce noise from densely-sampled GeoJSONs.
  const raw: number[] = pts.map((_, i) => curvatureAt(pts, i));
  const smooth: number[] = raw.map((_, i) => {
    const a = raw[i - 1] ?? raw[i];
    const b = raw[i];
    const c = raw[i + 1] ?? raw[i];
    return (a + b + c) / 3;
  });

  const segments: CornerSegment[] = [];
  let i = 0;
  const n = smooth.length;
  while (i < n) {
    if (smooth[i] > CORNER_CURVATURE_STRAIGHT_MAX) {
      let j = i;
      let peak = 0;
      while (j < n && smooth[j] > CORNER_CURVATURE_STRAIGHT_MAX) {
        if (smooth[j] > peak) peak = smooth[j];
        j++;
      }
      const length = j - i;
      if (length >= MIN_CORNER_POINTS) {
        const type: CornerType =
          peak >= CORNER_CURVATURE_SLOW
            ? "slow"
            : peak >= CORNER_CURVATURE_MEDIUM
              ? "medium"
              : "fast";
        segments.push({
          index: segments.length,
          start_idx: i,
          end_idx: j - 1,
          curvature: peak,
          type,
        });
      }
      i = j;
    } else {
      i++;
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Spatial alignment GeoJSON <-> LocationData
// ---------------------------------------------------------------------------

interface NormalizedPoint { x: number; y: number; }

function normalizeBox(points: NormalizedPoint[]): NormalizedPoint[] {
  if (points.length === 0) return [];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const range = Math.max(maxX - minX, maxY - minY) || 1;
  return points.map((p) => ({ x: (p.x - cx) / range, y: (p.y - cy) / range }));
}

/**
 * For each LocationData point, return the index of the closest outline
 * vertex (or -1 when no outline). Both spaces are normalized to the unit
 * box around their respective bounding-box centers. OpenF1 LocationData
 * X is mirrored (TrackMap renders with scale(-1,1)); we mirror here too.
 *
 * APPROXIMATE alignment: rotation between the two frames is not estimated,
 * so heavily rotated layouts may snap to wrong neighbours on shared
 * straights. Acceptable for a PoC; flagged in the JSDoc and surfaced via
 * `coverage` so the caller can judge.
 */
export function mapLocationsToOutlineIndices(
  locations: { x: number; y: number }[],
  outlineMeters: { x: number; y: number }[],
): number[] {
  if (outlineMeters.length === 0 || locations.length === 0) return [];
  const normOutline = normalizeBox(outlineMeters);
  const normLocs = normalizeBox(locations.map((l) => ({ x: -l.x, y: l.y })));
  const result: number[] = new Array(normLocs.length);
  for (let i = 0; i < normLocs.length; i++) {
    let best = 0;
    let bestD = Infinity;
    const lx = normLocs[i].x, ly = normLocs[i].y;
    for (let j = 0; j < normOutline.length; j++) {
      const dx = normOutline[j].x - lx;
      const dy = normOutline[j].y - ly;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = j; }
    }
    result[i] = best;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Telemetry alignment + aggregation
// ---------------------------------------------------------------------------

/**
 * Build a map outline_index -> segment_index (or -1 for straight).
 */
function buildIndexToSegmentMap(outlineLength: number, segments: CornerSegment[]): Int32Array {
  const arr = new Int32Array(outlineLength).fill(-1);
  for (const s of segments) {
    for (let i = s.start_idx; i <= s.end_idx && i < outlineLength; i++) arr[i] = s.index;
  }
  return arr;
}

/**
 * For each car-data sample, find the nearest location by timestamp (TrackMap
 * pattern), then read the corner type at that position. Aggregate per type
 * using the MINIMUM speed observed (apex speed — the physically meaningful
 * indicator of how much the car "holds" the corner). Samples without a
 * position within a reasonable time window are skipped.
 */
export function aggregateDriverCornerSpeeds(params: {
  driver_number: number;
  locations: LocationData[];
  carData: CarData[];
  segments: CornerSegment[];
  outline: [number, number][];
  /** Max allowed |Δt| in ms between a speed sample and its position. */
  maxSyncGapMs?: number;
}): PerDriverCornerSpeeds {
  const { driver_number, locations, carData, segments, outline } = params;
  const maxGap = params.maxSyncGapMs ?? 500;
  const notes: string[] = [];
  const empty: PerDriverCornerSpeeds = {
    driver_number,
    slow_corner_speed: null,
    medium_corner_speed: null,
    fast_corner_speed: null,
    sample_counts: { slow: 0, medium: 0, fast: 0, straight: 0 },
    coverage: 0,
    corner_coverage: null,
    partial: true,
    notes,
  };

  if (!locations.length) { notes.push("no_location_data"); return empty; }
  if (!carData.length) { notes.push("no_car_data"); return empty; }
  if (!outline.length) { notes.push("no_outline"); return empty; }

  // Pre-compute position→segment mapping for this driver's locations.
  const outlineM = lonLatToMeters(outline);
  const locIdxToOutlineIdx = mapLocationsToOutlineIndices(locations, outlineM);
  const idxToSeg = buildIndexToSegmentMap(outline.length, segments);

  // Coverage: unique outline vertices touched.
  const touched = new Set<number>();
  for (const v of locIdxToOutlineIdx) touched.add(v);
  const coverage = outline.length > 0 ? touched.size / outline.length : 0;

  // Corner-only coverage: fraction of CORNER vertices (slow/medium/fast)
  // touched. Straights excluded. `null` when no corner vertices exist.
  let cornerVerticesTotal = 0;
  let cornerVerticesTouched = 0;
  for (let v = 0; v < outline.length; v++) {
    const segIdx = idxToSeg[v];
    if (segIdx < 0) continue;
    const segType = segments[segIdx]?.type;
    if (segType !== "slow" && segType !== "medium" && segType !== "fast") continue;
    cornerVerticesTotal++;
    if (touched.has(v)) cornerVerticesTouched++;
  }
  const corner_coverage = cornerVerticesTotal > 0
    ? cornerVerticesTouched / cornerVerticesTotal
    : null;

  // Sort locations by timestamp once for binary search.
  const locTimes = locations
    .map((l, idx) => ({ t: new Date(l.date).getTime(), idx }))
    .filter((o) => Number.isFinite(o.t))
    .sort((a, b) => a.t - b.t);

  const findNearestLocIdx = (t: number): { idx: number; gap: number } | null => {
    if (locTimes.length === 0) return null;
    let lo = 0, hi = locTimes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (locTimes[mid].t < t) lo = mid + 1; else hi = mid;
    }
    const candidates = [lo - 1, lo].filter((i) => i >= 0 && i < locTimes.length);
    let best = candidates[0];
    let bestGap = Math.abs(locTimes[best].t - t);
    for (const c of candidates) {
      const g = Math.abs(locTimes[c].t - t);
      if (g < bestGap) { bestGap = g; best = c; }
    }
    return { idx: locTimes[best].idx, gap: bestGap };
  };

  const minSpeed: Record<CornerType, number | null> = {
    slow: null, medium: null, fast: null, straight: null,
  };
  const counts: Record<CornerType, number> = { slow: 0, medium: 0, fast: 0, straight: 0 };

  let skippedGap = 0;
  for (const cd of carData) {
    const t = new Date(cd.date).getTime();
    if (!Number.isFinite(t)) continue;
    if (cd.speed == null || !Number.isFinite(cd.speed)) continue;
    const near = findNearestLocIdx(t);
    if (!near || near.gap > maxGap) { skippedGap++; continue; }
    const outlineIdx = locIdxToOutlineIdx[near.idx];
    const segIdx = outlineIdx >= 0 ? idxToSeg[outlineIdx] : -1;
    const type: CornerType = segIdx >= 0 ? segments[segIdx].type : "straight";
    counts[type]++;
    const prev = minSpeed[type];
    if (prev == null || cd.speed < prev) minSpeed[type] = cd.speed;
  }

  if (skippedGap > 0) notes.push(`skipped_${skippedGap}_samples_no_position_within_${maxGap}ms`);
  if (coverage < 0.5) notes.push(`low_coverage_${coverage.toFixed(2)}`);

  return {
    driver_number,
    slow_corner_speed: minSpeed.slow,
    medium_corner_speed: minSpeed.medium,
    fast_corner_speed: minSpeed.fast,
    sample_counts: counts,
    coverage,
    partial: coverage < 0.5 || counts.slow + counts.medium + counts.fast === 0,
    notes,
  };
}

// ---------------------------------------------------------------------------
// High-level PoC entry point
// ---------------------------------------------------------------------------

export interface AnalyzeCornersOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** ISO date range to bound /location and /car_data queries. */
  dateStart: string;
  dateEnd: string;
  /** Override outline (useful for tests). */
  outlineOverride?: [number, number][] | null;
}

/**
 * Analyze corner speeds for a set of drivers on ONE session. On-demand,
 * sequential per driver to play nicely with the global rate limiter.
 * Never throws: data gaps degrade `coverage` and set `partial=true`.
 */
export async function analyzeCornersForSession(
  gpName: string,
  sessionKey: number,
  driverNumbers: number[],
  opts: AnalyzeCornersOptions,
): Promise<SessionCornerAnalysis> {
  const notes: string[] = [];
  const outline = opts.outlineOverride !== undefined
    ? opts.outlineOverride
    : await fetchCircuitOutline(gpName);

  if (!outline || outline.length < MIN_CORNER_POINTS + 2) {
    notes.push("no_circuit_layout_available");
    return { gpName, sessionKey, segments: [], per_driver: [], notes, aborted: false };
  }

  const segments = classifyCircuitCorners(outline);
  if (segments.length === 0) notes.push("no_corners_classified");

  const perDriver: PerDriverCornerSpeeds[] = [];
  let done = 0;
  let aborted = false;

  for (const driver_number of driverNumbers) {
    if (opts.signal?.aborted) { aborted = true; break; }
    try {
      const [locations, carData] = await Promise.all([
        getLocation(sessionKey, driver_number, opts.dateStart, opts.dateEnd).catch(() => []),
        getCarData(sessionKey, driver_number, opts.dateStart, opts.dateEnd).catch(() => []),
      ]);
      perDriver.push(
        aggregateDriverCornerSpeeds({
          driver_number,
          locations,
          carData,
          segments,
          outline,
        }),
      );
    } catch {
      perDriver.push({
        driver_number,
        slow_corner_speed: null,
        medium_corner_speed: null,
        fast_corner_speed: null,
        sample_counts: { slow: 0, medium: 0, fast: 0, straight: 0 },
        coverage: 0,
        partial: true,
        notes: ["fetch_error"],
      });
    }
    done++;
    opts.onProgress?.(done, driverNumbers.length);
  }

  return { gpName, sessionKey, segments, per_driver: perDriver, notes, aborted };
}

// ---------------------------------------------------------------------------
// Human-readable summary (for manual inspection of the PoC results).
// ---------------------------------------------------------------------------

export function summarizeAnalysis(a: SessionCornerAnalysis): string[] {
  const lines: string[] = [];
  lines.push(`GP: ${a.gpName} · session ${a.sessionKey}`);
  const byType = { slow: 0, medium: 0, fast: 0 } as Record<Exclude<CornerType, "straight">, number>;
  for (const s of a.segments) byType[s.type as Exclude<CornerType, "straight">]++;
  lines.push(`Corners classified: ${a.segments.length} (slow=${byType.slow}, medium=${byType.medium}, fast=${byType.fast})`);
  if (a.notes.length) lines.push(`Notes: ${a.notes.join("; ")}`);
  if (a.aborted) lines.push("ABORTED before completion.");
  for (const d of a.per_driver) {
    const fmt = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)} km/h`);
    lines.push(
      `Driver #${d.driver_number}: slow=${fmt(d.slow_corner_speed)} medium=${fmt(d.medium_corner_speed)} fast=${fmt(d.fast_corner_speed)} ` +
      `· coverage=${(d.coverage * 100).toFixed(0)}% · samples slow/med/fast/straight = ${d.sample_counts.slow}/${d.sample_counts.medium}/${d.sample_counts.fast}/${d.sample_counts.straight}` +
      (d.partial ? " · PARTIAL" : "") +
      (d.notes.length ? ` · ${d.notes.join(", ")}` : ""),
    );
  }
  return lines;
}
