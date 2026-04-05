import type { Lap, IntervalData, PositionData, Driver } from "./openf1";

/* ══════════════════════════════════════════════════════════════════════════
   Traffic Predictor – Professional Strategy-Engineering Grade
   
   Estimates post-pit rejoin position, traffic density, pack structure,
   and time-loss due to traffic for candidate pit laps.
   
   Key improvements over baseline:
   - Time-projection based rejoin (not just gap-to-leader offset)
   - Pack / compressed-train detection
   - Compound & warmup awareness
   - Dirty-air & overtake-difficulty modelling
   - Confidence & release-quality scoring
   - Centralized configuration
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Types ── */

export type TrafficLevel = "CLEAN" | "LIGHT" | "HEAVY" | "UNKNOWN";

export type CompressedTrainRisk = "LOW" | "MEDIUM" | "HIGH";
export type ReleaseQuality = "EXCELLENT" | "GOOD" | "MARGINAL" | "POOR";
/** Simplified release classification for strategy engine consumption */
export type ReleaseClassification = "CLEAN" | "TRAFFIC" | "PACK";
export type PredictionConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface TrafficPrediction {
  pit_lap: number;
  current_position: number;
  rejoin_position_estimated: number;
  rejoin_between: [string | null, string | null];
  gap_ahead_after_pit: number | null;
  gap_behind_after_pit: number | null;
  traffic_level: TrafficLevel;
  estimated_traffic_time_loss: number;
  estimated_traffic_laps: number;

  /* ── Extended fields (backward-compatible, all optional) ── */
  pack_size_ahead?: number;
  pack_size_total?: number;
  pack_size_behind?: number;
  compressed_train_risk?: CompressedTrainRisk;
  local_density_score?: number;
  release_quality?: ReleaseQuality;
  /** Simplified release classification: CLEAN (>3s), TRAFFIC (1-3s), PACK (<1s or in pack) */
  release_classification?: ReleaseClassification;
  release_risk_score?: number;
  rejoin_is_in_pack?: boolean;
  estimated_clear_lap?: number | null;
  stuck_risk_score?: number;
  overtake_difficulty_score?: number;
  /** Estimated laps stuck in traffic before clearing (alias for estimated_traffic_laps with richer logic) */
  traffic_persistence_laps?: number;
  /** Total time loss from traffic including dirty air, pack density, and warmup handicap */
  traffic_time_loss_total?: number;
  prediction_confidence?: PredictionConfidence;
  confidence_reasons?: string[];
  compound_delta_effect?: number;
  warmup_handicap_estimate?: number;
  clear_air_advantage_estimate?: number;
  model_notes?: string[];

  /* ── Release gap shortcuts (mirrors gap_ahead/behind but with explicit naming) ── */
  release_gap_ahead?: number | null;
  release_gap_behind?: number | null;
}

/* ── Centralized Configuration ── */

const TRAFFIC_CONFIG = {
  /** Gap thresholds for traffic classification (seconds) */
  gap_thresholds: {
    clean: 3.0,       // > 3s → CLEAN air
    light: 1.5,       // 1.5–3s → LIGHT traffic
    // < 1.5s → HEAVY traffic
  },

  /** Pack / cluster detection */
  cluster: {
    window_seconds: 2.0,       // cars within 2s form a cluster
    compressed_threshold: 1.0,  // average inter-car gap < 1s → compressed
    max_scan_positions: 8,      // how many positions ahead to scan for packs
  },

  /** Time loss per lap in traffic */
  time_loss_per_lap: {
    heavy: 0.8,
    light: 0.3,
    clean: 0.0,
  },

  /** Dirty air penalty factor (multiplier on base time loss) */
  dirty_air_factor: 1.15,

  /** Track overtake difficulty (default; could be per-track in future) */
  default_overtake_difficulty: 0.6, // 0 = easy, 1 = very hard

  /** Compressed train multiplier on time loss */
  compressed_pack_factor: 1.4,

  /** Warmup handicap by compound (seconds of reduced pace advantage in first laps) */
  warmup_handicap: {
    SOFT: 0.3,
    MEDIUM: 0.5,
    HARD: 0.8,
    UNKNOWN: 0.5,
  } as Record<string, number>,

  /** Clear air advantage once past traffic (seconds per lap faster) */
  clear_air_advantage: {
    SOFT: 0.6,
    MEDIUM: 0.4,
    HARD: 0.3,
    UNKNOWN: 0.4,
  } as Record<string, number>,

  /** Pace window for representative pace calculation */
  pace_window: 5,
  pace_outlier_threshold: 1.07, // 107% of median

  /** Default stuck laps when data is insufficient */
  default_stuck_laps: {
    heavy: 3,
    light: 2,
    clean: 0,
  },

  /** Min gap advantage needed to complete an overtake (seconds) */
  overtake_gap_threshold: 1.2,
} as const;

/* ── Pre-indexed data structures for efficient lookups ── */

interface DriverTimeline {
  positions: PositionData[];
  intervals: IntervalData[];
  laps: Lap[];
}

/** Build per-driver indexed data for efficient temporal lookups */
function buildDriverIndex(
  positions: PositionData[],
  intervals: IntervalData[],
  allLaps: Map<number, Lap[]>,
): Map<number, DriverTimeline> {
  const index = new Map<number, DriverTimeline>();

  // Initialize from all known drivers in laps
  for (const [dn, laps] of allLaps) {
    index.set(dn, { positions: [], intervals: [], laps });
  }

  // Index positions by driver
  for (const p of positions) {
    let entry = index.get(p.driver_number);
    if (!entry) {
      entry = { positions: [], intervals: [], laps: [] };
      index.set(p.driver_number, entry);
    }
    entry.positions.push(p);
  }

  // Index intervals by driver
  for (const iv of intervals) {
    let entry = index.get(iv.driver_number);
    if (!entry) {
      entry = { positions: [], intervals: [], laps: [] };
      index.set(iv.driver_number, entry);
    }
    entry.intervals.push(iv);
  }

  return index;
}

/* ── Temporal Helpers ── */

/** Find the data record closest to a reference timestamp */
function findClosestByTime<T extends { date: string }>(
  records: T[],
  refTimeMs: number,
  maxDeltaMs: number = 120_000,
): T | null {
  let best: T | null = null;
  let bestDiff = Infinity;
  for (const r of records) {
    const diff = Math.abs(new Date(r.date).getTime() - refTimeMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best && bestDiff <= maxDeltaMs ? best : null;
}

/** Get reference timestamp for a driver at a given lap */
function getLapRefTime(timeline: DriverTimeline, lapNumber: number): number | null {
  const lap = timeline.laps.find(l => l.lap_number === lapNumber);
  if (lap?.date_start) return new Date(lap.date_start).getTime();

  // Fallback: find closest lap with date_start
  const candidates = timeline.laps
    .filter(l => l.lap_number <= lapNumber && l.date_start)
    .sort((a, b) => b.lap_number - a.lap_number);
  if (candidates.length > 0 && candidates[0].date_start) {
    return new Date(candidates[0].date_start).getTime();
  }
  return null;
}

/** Get position for a driver at a given lap */
function getPositionAtLap(
  timeline: DriverTimeline,
  lapNumber: number,
): number | null {
  const refTime = getLapRefTime(timeline, lapNumber);
  if (refTime == null) return null;
  const closest = findClosestByTime(timeline.positions, refTime);
  return closest?.position ?? null;
}

/** Parse gap value (handles string/number/null from OpenF1 API) */
function parseGap(gap: number | string | null): number | null {
  if (gap == null) return null;
  if (typeof gap === "number") return gap;
  const parsed = parseFloat(String(gap).replace("+", ""));
  return isNaN(parsed) ? null : parsed;
}

/** Get gap-to-leader for a driver near a reference time */
function getGapToLeader(
  timeline: DriverTimeline,
  refTimeMs: number,
): number | null {
  const closest = findClosestByTime(timeline.intervals, refTimeMs);
  if (!closest) return null;
  return parseGap(closest.gap_to_leader);
}

/** Get interval (gap to car ahead) for a driver near a reference time */
function getInterval(
  timeline: DriverTimeline,
  refTimeMs: number,
): number | null {
  const closest = findClosestByTime(timeline.intervals, refTimeMs);
  if (!closest) return null;
  return parseGap(closest.interval);
}

/* ── Pace Helpers ── */

/** 
 * Compute representative recent pace using trimmed median.
 * Excludes pit-out laps and outliers for robustness.
 */
function getCleanRecentPace(
  laps: Lap[],
  aroundLap: number,
  windowSize: number = TRAFFIC_CONFIG.pace_window,
): { pace: number | null; quality: "GOOD" | "FAIR" | "POOR" } {
  const candidates = laps
    .filter(l =>
      l.lap_number >= aroundLap - windowSize &&
      l.lap_number <= aroundLap &&
      l.lap_duration != null &&
      l.lap_duration > 0 &&
      !l.is_pit_out_lap
    )
    .map(l => l.lap_duration!)
    .sort((a, b) => a - b);

  if (candidates.length === 0) return { pace: null, quality: "POOR" };

  // Compute median
  const mid = Math.floor(candidates.length / 2);
  const median = candidates.length % 2 === 0
    ? (candidates[mid - 1] + candidates[mid]) / 2
    : candidates[mid];

  // Filter outliers using median threshold
  const threshold = median * TRAFFIC_CONFIG.pace_outlier_threshold;
  const clean = candidates.filter(t => t <= threshold);

  if (clean.length === 0) return { pace: median, quality: "POOR" };

  // Use trimmed mean of clean laps
  const pace = clean.reduce((a, b) => a + b, 0) / clean.length;
  const quality = clean.length >= 3 ? "GOOD" : clean.length >= 2 ? "FAIR" : "POOR";

  return { pace, quality };
}

/* ── Compound helpers ── */

/** Infer compound from stint data if available */
function inferCompoundAtLap(laps: Lap[], lapNumber: number): string {
  // The Lap type doesn't carry compound info; return UNKNOWN
  // In real usage, the VRE passes stint data separately
  return "UNKNOWN";
}

function getWarmupHandicap(compound: string): number {
  return TRAFFIC_CONFIG.warmup_handicap[compound] ?? TRAFFIC_CONFIG.warmup_handicap.UNKNOWN;
}

function getClearAirAdvantage(compound: string): number {
  return TRAFFIC_CONFIG.clear_air_advantage[compound] ?? TRAFFIC_CONFIG.clear_air_advantage.UNKNOWN;
}

/* ── Traffic Classification ── */

function classifyTraffic(gapAhead: number | null, gapBehind: number | null): TrafficLevel {
  const minGap = Math.min(
    gapAhead != null ? Math.abs(gapAhead) : Infinity,
    gapBehind != null ? Math.abs(gapBehind) : Infinity,
  );
  if (minGap === Infinity) return "UNKNOWN";
  if (minGap >= TRAFFIC_CONFIG.gap_thresholds.clean) return "CLEAN";
  if (minGap >= TRAFFIC_CONFIG.gap_thresholds.light) return "LIGHT";
  return "HEAVY";
}

/** Time loss per lap based on traffic level, dirty air, and pack structure */
function computeTimeLossPerLap(
  level: TrafficLevel,
  inCompressedTrain: boolean,
  overtakeDifficulty: number,
): number {
  let base: number;
  switch (level) {
    case "HEAVY": base = TRAFFIC_CONFIG.time_loss_per_lap.heavy; break;
    case "LIGHT": base = TRAFFIC_CONFIG.time_loss_per_lap.light; break;
    default: return 0;
  }

  // Dirty air factor
  base *= TRAFFIC_CONFIG.dirty_air_factor;

  // Compressed train makes passing harder
  if (inCompressedTrain) {
    base *= TRAFFIC_CONFIG.compressed_pack_factor;
  }

  // Scale by overtake difficulty (0–1)
  base *= (0.5 + 0.5 * overtakeDifficulty);

  return Math.round(base * 100) / 100;
}

/* ── Pack / Cluster Detection ── */

interface PackAnalysis {
  pack_size_ahead: number;
  pack_size_total: number;
  compressed_train_risk: CompressedTrainRisk;
  local_density_score: number; // 0–1, higher = denser
  rejoin_is_in_pack: boolean;
}

/**
 * Analyze traffic cluster structure around the rejoin point.
 * Looks at sorted gap-to-leader values for all drivers and identifies
 * how many cars are clustered near the rejoin gap.
 */
function analyzePackStructure(
  rejoinGap: number,
  sortedDriverGaps: { driverNumber: number; gap: number }[],
): PackAnalysis {
  const cfg = TRAFFIC_CONFIG.cluster;

  // Count cars within cluster window ahead of rejoin
  let packAhead = 0;
  let packTotal = 0;
  const gapsInWindow: number[] = [];

  for (const d of sortedDriverGaps) {
    const delta = Math.abs(d.gap - rejoinGap);
    if (delta <= cfg.window_seconds) {
      packTotal++;
      if (d.gap < rejoinGap) packAhead++;
      gapsInWindow.push(d.gap);
    }
  }

  // Limit ahead count to scan range
  packAhead = Math.min(packAhead, cfg.max_scan_positions);

  // Compute average inter-car gap within the cluster
  gapsInWindow.sort((a, b) => a - b);
  let avgInterGap = Infinity;
  if (gapsInWindow.length >= 2) {
    let totalInterGap = 0;
    for (let i = 1; i < gapsInWindow.length; i++) {
      totalInterGap += gapsInWindow[i] - gapsInWindow[i - 1];
    }
    avgInterGap = totalInterGap / (gapsInWindow.length - 1);
  }

  // Classify compressed train risk
  let trainRisk: CompressedTrainRisk = "LOW";
  if (packTotal >= 4 && avgInterGap < cfg.compressed_threshold) {
    trainRisk = "HIGH";
  } else if (packTotal >= 3 && avgInterGap < cfg.compressed_threshold * 1.5) {
    trainRisk = "MEDIUM";
  } else if (packTotal >= 2 && avgInterGap < cfg.compressed_threshold) {
    trainRisk = "MEDIUM";
  }

  // Density score: 0–1 based on pack size and inter-car gap
  const sizeFactor = Math.min(packTotal / 6, 1);
  const gapFactor = avgInterGap === Infinity ? 0 : Math.max(0, 1 - avgInterGap / cfg.window_seconds);
  const densityScore = Math.round((sizeFactor * 0.5 + gapFactor * 0.5) * 100) / 100;

  return {
    pack_size_ahead: packAhead,
    pack_size_total: packTotal,
    compressed_train_risk: trainRisk,
    local_density_score: densityScore,
    rejoin_is_in_pack: packTotal >= 3,
  };
}

/* ── Release Quality ── */

function evaluateReleaseQuality(
  gapAhead: number | null,
  gapBehind: number | null,
  pack: PackAnalysis,
): { quality: ReleaseQuality; score: number } {
  // Score from 0 (worst) to 1 (best)
  let score = 1.0;

  const aheadGap = gapAhead != null ? Math.abs(gapAhead) : 10;
  const behindGap = gapBehind != null ? Math.abs(gapBehind) : 10;

  // Penalize small gap ahead
  if (aheadGap < 1.0) score -= 0.35;
  else if (aheadGap < 2.0) score -= 0.15;

  // Penalize small gap behind (pressure)
  if (behindGap < 1.0) score -= 0.2;
  else if (behindGap < 2.0) score -= 0.1;

  // Penalize pack rejoin
  if (pack.rejoin_is_in_pack) score -= 0.2;
  if (pack.compressed_train_risk === "HIGH") score -= 0.15;
  else if (pack.compressed_train_risk === "MEDIUM") score -= 0.05;

  score = Math.max(0, Math.min(1, score));

  let quality: ReleaseQuality;
  if (score >= 0.8) quality = "EXCELLENT";
  else if (score >= 0.55) quality = "GOOD";
  else if (score >= 0.3) quality = "MARGINAL";
  else quality = "POOR";

  return { quality, score: Math.round(score * 100) / 100 };
}

/* ── Stuck / Traffic Laps Estimation ── */

function estimateTrafficLaps(
  driverPace: number | null,
  aheadPace: number | null,
  level: TrafficLevel,
  remainingLaps: number,
  pack: PackAnalysis,
  warmupHandicap: number,
  overtakeDifficulty: number,
): { laps: number; clearLap: number | null; stuckScore: number } {
  if (level === "CLEAN" || level === "UNKNOWN") {
    return { laps: 0, clearLap: null, stuckScore: 0 };
  }

  const defaults = level === "HEAVY"
    ? TRAFFIC_CONFIG.default_stuck_laps.heavy
    : TRAFFIC_CONFIG.default_stuck_laps.light;

  if (!driverPace || !aheadPace) {
    const laps = Math.min(defaults, remainingLaps);
    return {
      laps,
      clearLap: null,
      stuckScore: level === "HEAVY" ? 0.7 : 0.4,
    };
  }

  // Pace advantage (negative = driver is faster)
  let paceDelta = driverPace - aheadPace;

  // Warmup reduces initial pace advantage
  // Model: warmup handicap reduces effective delta for first ~2 laps
  // Amortized effect on overtake calculation
  const warmupAmortized = warmupHandicap * 0.5; // half-effect spread
  paceDelta += warmupAmortized; // makes delta worse (closer to 0 or positive)

  if (paceDelta >= 0) {
    // Driver is same speed or slower → stuck for a while
    let baseLaps = level === "HEAVY" ? 5 : 3;

    // Pack makes it worse
    if (pack.compressed_train_risk === "HIGH") baseLaps += 2;
    else if (pack.compressed_train_risk === "MEDIUM") baseLaps += 1;

    // Overtake difficulty extends stuck duration
    baseLaps = Math.ceil(baseLaps * (0.7 + 0.6 * overtakeDifficulty));

    const laps = Math.min(baseLaps, remainingLaps);
    return {
      laps,
      clearLap: null,
      stuckScore: Math.min(1, 0.6 + pack.local_density_score * 0.4),
    };
  }

  // Driver is faster → estimate laps to pass
  const effectiveDelta = Math.abs(paceDelta);
  let lapsToPass = Math.ceil(TRAFFIC_CONFIG.overtake_gap_threshold / effectiveDelta);

  // Pack: need to clear multiple cars
  if (pack.pack_size_ahead > 1) {
    lapsToPass = Math.ceil(lapsToPass * (1 + (pack.pack_size_ahead - 1) * 0.4));
  }

  // Overtake difficulty factor
  lapsToPass = Math.ceil(lapsToPass * (0.8 + 0.4 * overtakeDifficulty));

  const finalLaps = Math.min(lapsToPass, remainingLaps);
  const stuckScore = Math.min(1, finalLaps / 8);

  return {
    laps: finalLaps,
    clearLap: finalLaps < remainingLaps ? finalLaps : null,
    stuckScore: Math.round(stuckScore * 100) / 100,
  };
}

/* ── Overtake Difficulty Score ── */

function computeOvertakeDifficultyScore(
  pack: PackAnalysis,
  overtakeDifficulty: number,
  warmupHandicap: number,
): number {
  // 0 = easy to pass, 1 = very hard
  let score = overtakeDifficulty * 0.4;
  score += pack.local_density_score * 0.3;
  if (pack.compressed_train_risk === "HIGH") score += 0.2;
  else if (pack.compressed_train_risk === "MEDIUM") score += 0.1;
  score += Math.min(warmupHandicap / 2, 0.15);
  return Math.round(Math.min(1, score) * 100) / 100;
}

/* ── Confidence ── */

function computeConfidence(
  hasTimestamps: boolean,
  hasPositions: boolean,
  hasIntervals: boolean,
  paceQualityDriver: "GOOD" | "FAIR" | "POOR",
  paceQualityAhead: "GOOD" | "FAIR" | "POOR",
  packDataAvailable: boolean,
): { confidence: PredictionConfidence; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (hasTimestamps) { score += 2; }
  else { reasons.push("No reliable timestamps for time projection"); }

  if (hasPositions) { score += 2; }
  else { reasons.push("No position data available"); }

  if (hasIntervals) { score += 2; }
  else { reasons.push("No interval data available"); }

  if (paceQualityDriver === "GOOD") score += 1;
  else if (paceQualityDriver === "POOR") reasons.push("Driver pace sample is poor");

  if (paceQualityAhead === "GOOD") score += 1;
  else if (paceQualityAhead === "POOR") reasons.push("Ahead driver pace sample is poor");

  if (packDataAvailable) score += 1;

  let confidence: PredictionConfidence;
  if (score >= 7) confidence = "HIGH";
  else if (score >= 4) confidence = "MEDIUM";
  else confidence = "LOW";

  if (reasons.length === 0) reasons.push("All data sources available");

  return { confidence, reasons };
}

/* ══════════════════════════════════════════════════════════════════════════
   Main Predictor
   ══════════════════════════════════════════════════════════════════════════ */

export function predictTrafficForPitLaps(
  driverNumber: number,
  candidatePitLaps: number[],
  pitLoss: number,
  totalLaps: number,
  allLaps: Map<number, Lap[]>,
  positions: PositionData[],
  intervals: IntervalData[],
  drivers: Driver[],
): TrafficPrediction[] {
  // No-data fast path
  if (positions.length === 0 && intervals.length === 0) {
    return candidatePitLaps.map(pl => ({
      pit_lap: pl,
      current_position: 0,
      rejoin_position_estimated: 0,
      rejoin_between: [null, null],
      gap_ahead_after_pit: null,
      gap_behind_after_pit: null,
      traffic_level: "UNKNOWN" as TrafficLevel,
      estimated_traffic_time_loss: 0,
      estimated_traffic_laps: 0,
      prediction_confidence: "LOW" as PredictionConfidence,
      confidence_reasons: ["No position or interval data available"],
      model_notes: ["Fallback: no data available for traffic prediction"],
    }));
  }

  // Build indexes
  const driverIndex = buildDriverIndex(positions, intervals, allLaps);
  const driverAcronymMap = new Map<number, string>();
  for (const d of drivers) driverAcronymMap.set(d.driver_number, d.name_acronym);

  const overtakeDifficulty = TRAFFIC_CONFIG.default_overtake_difficulty;

  const predictions: TrafficPrediction[] = [];

  for (const pitLap of candidatePitLaps) {
    const notes: string[] = [];

    // ── Step 1: Get driver reference time at pit lap ──
    const driverTimeline = driverIndex.get(driverNumber);
    const driverRefTime = driverTimeline ? getLapRefTime(driverTimeline, pitLap) : null;
    const hasTimestamps = driverRefTime != null;

    // Estimate pit exit time
    const pitExitTimeMs = driverRefTime != null ? driverRefTime + pitLoss * 1000 : null;

    // ── Step 2: Get current position ──
    const currentPos = driverTimeline ? (getPositionAtLap(driverTimeline, pitLap) ?? 0) : 0;

    // ── Step 3: Build gap-to-leader snapshot for all drivers ──
    // Use time projection: project each driver's gap at pit exit time
    const driverGapSnapshots: { driverNumber: number; gap: number; position: number }[] = [];
    let driverGapToLeader: number | null = null;

    const refTimeForQuery = pitExitTimeMs ?? (driverRefTime ?? Date.now());

    for (const [dn, timeline] of driverIndex) {
      const dnRefTime = getLapRefTime(timeline, pitLap);
      if (dnRefTime == null) continue;

      const gap = getGapToLeader(timeline, dnRefTime);
      if (gap == null) continue;

      if (dn === driverNumber) {
        driverGapToLeader = gap;
        continue;
      }

      // Time projection: if we have pit exit time, project where this driver
      // will be at that moment by checking their pace trend
      let projectedGap = gap;
      if (pitExitTimeMs != null && dnRefTime != null) {
        // Approximate: the gap-to-leader changes slowly over a pit window
        // For nearby timestamps, the snapshot is a good approximation
        // For better accuracy, check a later interval record if available
        const laterRecord = findClosestByTime(timeline.intervals, pitExitTimeMs, 30_000);
        if (laterRecord) {
          const laterGap = parseGap(laterRecord.gap_to_leader);
          if (laterGap != null) projectedGap = laterGap;
        }
      }

      const pos = getPositionAtLap(timeline, pitLap) ?? 99;
      driverGapSnapshots.push({ driverNumber: dn, gap: projectedGap, position: pos });
    }

    // Sort by gap ascending (leader first)
    driverGapSnapshots.sort((a, b) => a.gap - b.gap);

    // ── Step 4: Estimate rejoin gap ──
    const driverGapAfterPit = driverGapToLeader != null ? driverGapToLeader + pitLoss : null;

    // ── Step 5: Find rejoin position and neighbors ──
    let rejoinPos = currentPos;
    let driverAhead: number | null = null;
    let driverBehind: number | null = null;
    let gapAhead: number | null = null;
    let gapBehind: number | null = null;

    if (driverGapAfterPit != null && driverGapSnapshots.length > 0) {
      let insertIdx = driverGapSnapshots.length;
      for (let i = 0; i < driverGapSnapshots.length; i++) {
        if (driverGapSnapshots[i].gap > driverGapAfterPit) {
          insertIdx = i;
          break;
        }
      }

      rejoinPos = insertIdx + 1;

      if (insertIdx > 0) {
        const ahead = driverGapSnapshots[insertIdx - 1];
        driverAhead = ahead.driverNumber;
        gapAhead = driverGapAfterPit - ahead.gap;
      }
      if (insertIdx < driverGapSnapshots.length) {
        const behind = driverGapSnapshots[insertIdx];
        driverBehind = behind.driverNumber;
        gapBehind = behind.gap - driverGapAfterPit;
      }
    }

    // ── Step 6: Pack / cluster analysis ──
    let pack: PackAnalysis = {
      pack_size_ahead: 0, pack_size_total: 0,
      compressed_train_risk: "LOW", local_density_score: 0,
      rejoin_is_in_pack: false,
    };

    if (driverGapAfterPit != null && driverGapSnapshots.length > 0) {
      pack = analyzePackStructure(driverGapAfterPit, driverGapSnapshots);
    }

    // ── Step 7: Traffic classification ──
    const trafficLevel = classifyTraffic(gapAhead, gapBehind);

    // ── Step 8: Compound & warmup awareness ──
    const driverCompound = driverTimeline
      ? inferCompoundAtLap(driverTimeline.laps, pitLap)
      : "UNKNOWN";
    const warmupHandicap = getWarmupHandicap(driverCompound);
    const clearAirAdv = getClearAirAdvantage(driverCompound);

    // ── Step 9: Pace analysis ──
    const driverPaceResult = driverTimeline
      ? getCleanRecentPace(driverTimeline.laps, pitLap)
      : { pace: null, quality: "POOR" as const };
    const aheadTimeline = driverAhead != null ? driverIndex.get(driverAhead) : null;
    const aheadPaceResult = aheadTimeline
      ? getCleanRecentPace(aheadTimeline.laps, pitLap)
      : { pace: null, quality: "POOR" as const };

    // ── Step 10: Estimate traffic laps and time loss ──
    const remainingLaps = totalLaps - pitLap;
    const inCompressedTrain = pack.compressed_train_risk !== "LOW";

    const trafficEst = estimateTrafficLaps(
      driverPaceResult.pace, aheadPaceResult.pace,
      trafficLevel, remainingLaps, pack,
      warmupHandicap, overtakeDifficulty,
    );

    const lossPerLap = computeTimeLossPerLap(trafficLevel, inCompressedTrain, overtakeDifficulty);
    const totalTrafficLoss = Math.round(trafficEst.laps * lossPerLap * 10) / 10;

    // ── Step 11: Release quality ──
    const release = evaluateReleaseQuality(gapAhead, gapBehind, pack);

    // ── Step 12: Overtake difficulty ──
    const overtakeScore = computeOvertakeDifficultyScore(pack, overtakeDifficulty, warmupHandicap);

    // ── Step 13: Compound delta effect ──
    // Positive means advantage (e.g. fresh tyres), negative means disadvantage
    const compoundDelta = clearAirAdv - warmupHandicap;

    // ── Step 14: Confidence ──
    const hasPositionData = driverTimeline ? driverTimeline.positions.length > 0 : false;
    const hasIntervalData = driverTimeline ? driverTimeline.intervals.length > 0 : false;
    const packDataAvailable = driverGapSnapshots.length >= 3;

    const conf = computeConfidence(
      hasTimestamps, hasPositionData, hasIntervalData,
      driverPaceResult.quality, aheadPaceResult.quality,
      packDataAvailable,
    );

    // ── Step 15: Model notes ──
    if (pack.compressed_train_risk === "HIGH") {
      notes.push("Rejoin into compressed traffic cluster — high time loss risk");
    }
    if (release.quality === "POOR") {
      notes.push("Poor release quality — close gaps both ahead and behind");
    }
    if (warmupHandicap >= 0.7) {
      notes.push("Significant warmup handicap reduces initial pace advantage");
    }
    if (!hasTimestamps) {
      notes.push("Time projection unavailable — using gap-offset fallback");
    }

    predictions.push({
      pit_lap: pitLap,
      current_position: currentPos,
      rejoin_position_estimated: rejoinPos,
      rejoin_between: [
        driverAhead ? driverAcronymMap.get(driverAhead) ?? null : null,
        driverBehind ? driverAcronymMap.get(driverBehind) ?? null : null,
      ],
      gap_ahead_after_pit: gapAhead != null ? Math.round(gapAhead * 10) / 10 : null,
      gap_behind_after_pit: gapBehind != null ? Math.round(gapBehind * 10) / 10 : null,
      traffic_level: trafficLevel,
      estimated_traffic_time_loss: totalTrafficLoss,
      estimated_traffic_laps: trafficEst.laps,

      // Extended fields
      pack_size_ahead: pack.pack_size_ahead,
      pack_size_total: pack.pack_size_total,
      compressed_train_risk: pack.compressed_train_risk,
      local_density_score: pack.local_density_score,
      release_quality: release.quality,
      release_risk_score: 1 - release.score,
      rejoin_is_in_pack: pack.rejoin_is_in_pack,
      estimated_clear_lap: trafficEst.clearLap != null ? pitLap + trafficEst.clearLap : null,
      stuck_risk_score: trafficEst.stuckScore,
      overtake_difficulty_score: overtakeScore,
      prediction_confidence: conf.confidence,
      confidence_reasons: conf.reasons,
      compound_delta_effect: Math.round(compoundDelta * 100) / 100,
      warmup_handicap_estimate: warmupHandicap,
      clear_air_advantage_estimate: clearAirAdv,
      model_notes: notes.length > 0 ? notes : undefined,
    });
  }

  return predictions;
}
