import type { Lap, IntervalData, PositionData, Driver } from "./openf1";

/* ── Types ── */

export type TrafficLevel = "CLEAN" | "LIGHT" | "HEAVY" | "UNKNOWN";

export interface TrafficPrediction {
  pit_lap: number;
  current_position: number;
  rejoin_position_estimated: number;
  rejoin_between: [string | null, string | null]; // [driver ahead, driver behind]
  gap_ahead_after_pit: number | null;
  gap_behind_after_pit: number | null;
  traffic_level: TrafficLevel;
  estimated_traffic_time_loss: number;
  estimated_traffic_laps: number;
}

/* ── Helpers ── */

/** Get the latest position for each driver at or before a given lap number */
function getPositionsAtLap(
  positions: PositionData[],
  lapsData: Map<number, Lap[]>,
  lapNumber: number,
): Map<number, number> {
  // Build a map: driver_number -> position at this lap
  // Use position data timestamps matched to lap timestamps
  const result = new Map<number, number>();

  // Group positions by driver
  const byDriver = new Map<number, PositionData[]>();
  for (const p of positions) {
    const arr = byDriver.get(p.driver_number) || [];
    arr.push(p);
    byDriver.set(p.driver_number, arr);
  }

  // For each driver, find the position record closest to this lap
  // We use the lap's date_start as reference
  for (const [driverNum, driverPositions] of byDriver) {
    const driverLaps = lapsData.get(driverNum);
    if (!driverLaps) continue;
    const lap = driverLaps.find(l => l.lap_number === lapNumber);
    if (!lap?.date_start) {
      // Fallback: find last position entry before this lap's approximate time
      // Use lap number ordering as proxy
      const prevLap = driverLaps
        .filter(l => l.lap_number <= lapNumber && l.date_start)
        .sort((a, b) => b.lap_number - a.lap_number)[0];
      if (prevLap?.date_start) {
        const refTime = new Date(prevLap.date_start).getTime();
        let closest: PositionData | null = null;
        let closestDiff = Infinity;
        for (const p of driverPositions) {
          const diff = Math.abs(new Date(p.date).getTime() - refTime);
          if (diff < closestDiff) { closestDiff = diff; closest = p; }
        }
        if (closest) result.set(driverNum, closest.position);
      }
      continue;
    }

    const refTime = new Date(lap.date_start).getTime();
    let closest: PositionData | null = null;
    let closestDiff = Infinity;
    for (const p of driverPositions) {
      const diff = Math.abs(new Date(p.date).getTime() - refTime);
      if (diff < closestDiff) { closestDiff = diff; closest = p; }
    }
    if (closest) result.set(driverNum, closest.position);
  }

  return result;
}

/** Get recent average lap time for a driver around a given lap */
function getRecentPace(
  driverLaps: Lap[],
  aroundLap: number,
  windowSize: number = 3,
): number | null {
  const recent = driverLaps
    .filter(l =>
      l.lap_number >= aroundLap - windowSize &&
      l.lap_number <= aroundLap &&
      l.lap_duration != null &&
      l.lap_duration > 0 &&
      !l.is_pit_out_lap
    )
    .map(l => l.lap_duration!);
  if (recent.length === 0) return null;
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

/** Get gap to leader for a driver at a lap (from intervals data) */
function getGapToLeaderAtLap(
  intervals: IntervalData[],
  driverNumber: number,
  lapsData: Map<number, Lap[]>,
  lapNumber: number,
): number | null {
  const driverLaps = lapsData.get(driverNumber);
  if (!driverLaps) return null;
  const lap = driverLaps.find(l => l.lap_number === lapNumber);
  if (!lap?.date_start) return null;

  const refTime = new Date(lap.date_start).getTime();
  const driverIntervals = intervals.filter(iv => iv.driver_number === driverNumber);

  let closest: IntervalData | null = null;
  let closestDiff = Infinity;
  for (const iv of driverIntervals) {
    const diff = Math.abs(new Date(iv.date).getTime() - refTime);
    if (diff < closestDiff) { closestDiff = diff; closest = iv; }
  }

  if (!closest) return null;
  const gap = closest.gap_to_leader;
  if (gap == null) return null;
  if (typeof gap === "number") return gap;
  const parsed = parseFloat(String(gap).replace("+", ""));
  return isNaN(parsed) ? null : parsed;
}

/** Classify traffic level based on gap */
function classifyTraffic(gapAhead: number | null, gapBehind: number | null): TrafficLevel {
  const minGap = Math.min(
    gapAhead != null ? Math.abs(gapAhead) : Infinity,
    gapBehind != null ? Math.abs(gapBehind) : Infinity,
  );
  if (minGap === Infinity) return "UNKNOWN";
  if (minGap >= 3.0) return "CLEAN";
  if (minGap >= 1.5) return "LIGHT";
  return "HEAVY";
}

/** Estimate time lost per lap in traffic */
function trafficTimeLossPerLap(level: TrafficLevel): number {
  switch (level) {
    case "HEAVY": return 1.0;
    case "LIGHT": return 0.4;
    default: return 0;
  }
}

/** Estimate laps stuck in traffic based on pace differential */
function estimateTrafficLaps(
  driverPace: number | null,
  aheadPace: number | null,
  level: TrafficLevel,
  remainingLaps: number,
): number {
  if (level === "CLEAN" || level === "UNKNOWN") return 0;
  if (!driverPace || !aheadPace) {
    // Default: 3 laps for heavy, 2 for light
    return level === "HEAVY" ? Math.min(3, remainingLaps) : Math.min(2, remainingLaps);
  }
  const paceDiff = driverPace - aheadPace; // negative means driver is faster
  if (paceDiff >= 0) {
    // Driver is same speed or slower - stuck for a while
    return level === "HEAVY" ? Math.min(5, remainingLaps) : Math.min(3, remainingLaps);
  }
  // Driver is faster - estimate laps to pass (need ~1.5s gap advantage)
  const lapsToPass = Math.ceil(1.5 / Math.abs(paceDiff));
  return Math.min(lapsToPass, remainingLaps);
}

/* ── Main predictor ── */

export function predictTrafficForPitLaps(
  driverNumber: number,
  candidatePitLaps: number[],
  pitLoss: number,
  totalLaps: number,
  allLaps: Map<number, Lap[]>, // driver_number -> laps
  positions: PositionData[],
  intervals: IntervalData[],
  drivers: Driver[],
): TrafficPrediction[] {
  if (positions.length === 0 && intervals.length === 0) {
    // No data available - return unknown for all
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
    }));
  }

  const driverAcronymMap = new Map<number, string>();
  for (const d of drivers) driverAcronymMap.set(d.driver_number, d.name_acronym);

  const predictions: TrafficPrediction[] = [];

  for (const pitLap of candidatePitLaps) {
    // Step 1: Get current positions at pit lap
    const posAtLap = getPositionsAtLap(positions, allLaps, pitLap);
    const currentPos = posAtLap.get(driverNumber) ?? 0;

    // Step 2: Get gap to leader for all drivers
    const gapsToLeader = new Map<number, number>();
    for (const [dn] of posAtLap) {
      const gap = getGapToLeaderAtLap(intervals, dn, allLaps, pitLap);
      if (gap != null) gapsToLeader.set(dn, gap);
    }

    const driverGap = gapsToLeader.get(driverNumber);

    // Step 3: Estimate rejoin gap (driver's gap + pit loss)
    // After pit, the driver's effective gap to leader increases by pitLoss
    const driverGapAfterPit = driverGap != null ? driverGap + pitLoss : null;

    // Step 4: Find rejoin position
    // Sort other drivers by gap to leader (ascending = closer to leader = better position)
    const otherDriverGaps: { driverNumber: number; gap: number; position: number }[] = [];
    for (const [dn, gap] of gapsToLeader) {
      if (dn === driverNumber) continue;
      const pos = posAtLap.get(dn) ?? 99;
      otherDriverGaps.push({ driverNumber: dn, gap, position: pos });
    }
    otherDriverGaps.sort((a, b) => a.gap - b.gap);

    let rejoinPos = currentPos;
    let driverAhead: number | null = null;
    let driverBehind: number | null = null;
    let gapAhead: number | null = null;
    let gapBehind: number | null = null;

    if (driverGapAfterPit != null && otherDriverGaps.length > 0) {
      // Find where driver slots in
      let insertIdx = otherDriverGaps.length; // default: last
      for (let i = 0; i < otherDriverGaps.length; i++) {
        if (otherDriverGaps[i].gap > driverGapAfterPit) {
          insertIdx = i;
          break;
        }
      }

      rejoinPos = insertIdx + 1; // 1-indexed position

      // Driver ahead (smaller gap = ahead on track)
      if (insertIdx > 0) {
        const ahead = otherDriverGaps[insertIdx - 1];
        driverAhead = ahead.driverNumber;
        gapAhead = driverGapAfterPit - ahead.gap;
      }

      // Driver behind (larger gap = behind on track)
      if (insertIdx < otherDriverGaps.length) {
        const behind = otherDriverGaps[insertIdx];
        driverBehind = behind.driverNumber;
        gapBehind = behind.gap - driverGapAfterPit;
      }
    }

    // Step 5: Classify traffic
    const trafficLevel = classifyTraffic(gapAhead, gapBehind);

    // Step 6: Estimate traffic time loss
    const driverPace = getRecentPace(allLaps.get(driverNumber) || [], pitLap);
    const aheadPace = driverAhead ? getRecentPace(allLaps.get(driverAhead) || [], pitLap) : null;
    const remainingLaps = totalLaps - pitLap;

    const trafficLaps = estimateTrafficLaps(driverPace, aheadPace, trafficLevel, remainingLaps);
    const lossPerLap = trafficTimeLossPerLap(trafficLevel);
    const totalTrafficLoss = Math.round(trafficLaps * lossPerLap * 10) / 10;

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
      estimated_traffic_laps: trafficLaps,
    });
  }

  return predictions;
}
