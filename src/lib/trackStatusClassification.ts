import type { RaceControlMessage, Lap } from "./openf1";

export type TrackStatus =
  | "GREEN"
  | "YELLOW"
  | "DOUBLE_YELLOW"
  | "VSC"
  | "SC"
  | "RED"
  | "MIXED";

interface StatusInterval {
  start: number; // ms timestamp
  end: number;   // ms timestamp (Infinity if not closed)
  status: TrackStatus;
}

const STATUS_PRIORITY: Record<TrackStatus, number> = {
  RED: 6,
  SC: 5,
  VSC: 4,
  DOUBLE_YELLOW: 3,
  YELLOW: 2,
  MIXED: 1,
  GREEN: 0,
};

/**
 * Parse race_control messages into status intervals.
 */
function buildStatusIntervals(messages: RaceControlMessage[]): StatusInterval[] {
  const sorted = [...messages].sort((a, b) => a.date.localeCompare(b.date));
  const intervals: StatusInterval[] = [];
  let current: { start: number; status: TrackStatus } | null = null;

  const closeInterval = (endTime: number) => {
    if (current) {
      intervals.push({ start: current.start, end: endTime, status: current.status });
      current = null;
    }
  };

  for (const msg of sorted) {
    const t = new Date(msg.date).getTime();
    if (isNaN(t)) continue;

    const flag = (msg.flag || "").toUpperCase();
    const text = (msg.message || "").toUpperCase();
    const category = (msg.category || "").toUpperCase();

    // Track-wide scope only (skip sector-specific yellows for simplicity)
    // But include them if no scope or scope is "Track"
    const scope = (msg.scope || "").toUpperCase();

    // Detect status from flag field and message text
    let detected: TrackStatus | "CLEAR" | null = null;

    // RED FLAG
    if (flag === "RED" || text.includes("RED FLAG")) {
      detected = "RED";
    }
    // SAFETY CAR (not virtual)
    else if (
      (flag === "SAFETY CAR" || text.includes("SAFETY CAR")) &&
      !text.includes("VIRTUAL") &&
      !text.includes("VSC")
    ) {
      detected = "SC";
    }
    // VSC
    else if (
      flag === "VSC" ||
      text.includes("VIRTUAL SAFETY CAR") ||
      text.includes("VSC DEPLOYED") ||
      text.includes("VSC ")
    ) {
      detected = "VSC";
    }
    // DOUBLE YELLOW (track-wide only — sector/driver scope is not race-wide)
    else if (
      (flag === "DOUBLE YELLOW" || text.includes("DOUBLE YELLOW")) &&
      scope !== "SECTOR" && scope !== "DRIVER"
    ) {
      detected = "DOUBLE_YELLOW";
    }
    // YELLOW (track-wide only — sector/driver scope does not contaminate full-lap pace)
    else if (
      flag === "YELLOW" &&
      scope !== "SECTOR" && scope !== "DRIVER"
    ) {
      detected = "YELLOW";
    }
    // GREEN / CLEAR
    else if (
      flag === "GREEN" ||
      flag === "CLEAR" ||
      text.includes("GREEN LIGHT") ||
      text.includes("TRACK CLEAR") ||
      text.includes("VSC ENDING") ||
      text.includes("SAFETY CAR IN THIS LAP") ||
      text.includes("RESTART")
    ) {
      detected = "CLEAR";
    }

    if (detected === "CLEAR") {
      closeInterval(t);
    } else if (detected) {
      const status = detected as TrackStatus;
      // If higher priority than current, close and start new
      if (current) {
        if (STATUS_PRIORITY[status] >= STATUS_PRIORITY[current.status]) {
          closeInterval(t);
          current = { start: t, status };
        }
        // else keep current higher-priority interval
      } else {
        current = { start: t, status: detected };
      }
    }
  }

  // Close any open interval
  if (current) {
    intervals.push({ start: current.start, end: Infinity, status: current.status });
  }

  return intervals;
}

/**
 * Classify each lap's track status by intersecting lap time windows with status intervals.
 */
export function classifyLapsTrackStatus(
  laps: Lap[],
  raceControlMessages: RaceControlMessage[]
): Map<number, TrackStatus> {
  const result = new Map<number, TrackStatus>();

  if (!raceControlMessages.length) return result;

  const intervals = buildStatusIntervals(raceControlMessages);
  if (!intervals.length) return result;

  for (const lap of laps) {
    if (!lap.date_start || !lap.lap_duration || lap.lap_duration <= 0) continue;

    const lapStart = new Date(lap.date_start).getTime();
    const lapEnd = lapStart + lap.lap_duration * 1000;

    // Find all intervals that overlap with this lap
    const overlapping = new Set<TrackStatus>();

    for (const iv of intervals) {
      // Check overlap: interval.start < lapEnd && interval.end > lapStart
      if (iv.start < lapEnd && iv.end > lapStart) {
        overlapping.add(iv.status);
      }
    }

    if (overlapping.size === 0) {
      // GREEN by default, don't add to map (consumer treats missing as GREEN)
      continue;
    }

    if (overlapping.size === 1) {
      result.set(lap.lap_number, [...overlapping][0]);
    } else {
      // Multiple different statuses during this lap
      result.set(lap.lap_number, "MIXED");
    }
  }

  return result;
}
