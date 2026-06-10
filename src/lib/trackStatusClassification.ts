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
 * Patterns that indicate the message is a penalty / stewards-procedure
 * mention rather than a real deployment. E.g. "SAFETY CAR INFRINGEMENT".
 * Kept here to be shared with raceDiary (track-wide detection).
 */
const PENALTY_OR_PROCEDURE_PATTERNS: RegExp[] = [
  /\bINFRINGEMENT\b/,
  /\bPENALTY\b/,
  /\bINVESTIGATION\b/,
  /\bNOTED\b/,
  /\bNO\s+FURTHER\s+ACTION\b/,
  /\bREVIEWED\b/,
];

export function isPenaltyOrProcedureContext(text: string): boolean {
  if (!text) return false;
  const upper = text.toUpperCase();
  return PENALTY_OR_PROCEDURE_PATTERNS.some((re) => re.test(upper));
}

/**
 * Real Safety Car *deployment* — not just a mention of the words.
 * Trusts the structured flag when set; otherwise requires an explicit
 * deployment phrase. Penalty/procedure contexts are excluded.
 */
export function isSafetyCarDeployment(text: string, flag: string | undefined | null): boolean {
  const upperFlag = (flag || "").toUpperCase();
  const upper = (text || "").toUpperCase();
  if (isPenaltyOrProcedureContext(upper)) return false;
  if (upper.includes("VIRTUAL") || upper.includes("VSC")) return false;
  if (upperFlag === "SAFETY CAR") return true;
  // Explicit deployment phrases, e.g. "SAFETY CAR DEPLOYED" / "SAFETY CAR (SC) DEPLOYED"
  return /\bSAFETY\s+CAR\b[^A-Z0-9]*(?:\([^)]*\)\s*)?DEPLOYED\b/.test(upper);
}

/**
 * Real Virtual Safety Car *deployment* — not a mention.
 */
export function isVirtualSafetyCarDeployment(text: string, flag: string | undefined | null): boolean {
  const upperFlag = (flag || "").toUpperCase();
  const upper = (text || "").toUpperCase();
  if (isPenaltyOrProcedureContext(upper)) return false;
  if (upperFlag === "VSC") return true;
  return /\bVIRTUAL\s+SAFETY\s+CAR\s+DEPLOYED\b/.test(upper)
    || /\bVSC\s+DEPLOYED\b/.test(upper);
}

/**
 * Real Red Flag *deployment* — not a mention (e.g. "RED FLAG INFRINGEMENT").
 * Trusts the structured flag when set; otherwise requires an explicit
 * suspension/deployment phrase. Penalty/procedure contexts are excluded.
 */
export function isRedFlagDeployment(text: string, flag: string | undefined | null): boolean {
  const upperFlag = (flag || "").toUpperCase();
  const upper = (text || "").toUpperCase();
  if (upperFlag === "RED") return true;
  if (isPenaltyOrProcedureContext(upper)) return false;
  return (
    /\bRED\s+FLAG\b[^A-Z0-9]*(?:-\s*)?(?:RACE|SESSION)?\s*SUSPENDED\b/.test(upper) ||
    /\bRED\s+FLAG\s+DEPLOYED\b/.test(upper) ||
    /\b(?:RACE|SESSION)\s+SUSPENDED\b/.test(upper)
  );
}

/**
 * True for any real track-wide neutralization deployment (SC / VSC / RED).
 * Used by consumers (e.g. race diary) to flag messages as track-wide.
 */
export function isNeutralizationDeployment(text: string, flag: string | undefined | null): boolean {
  if (isRedFlagDeployment(text, flag)) return true;
  if (isSafetyCarDeployment(text, flag)) return true;
  if (isVirtualSafetyCarDeployment(text, flag)) return true;
  return false;
}


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

    // Track-wide scope only (skip sector-specific yellows for simplicity)
    // But include them if no scope or scope is "Track"
    const scope = (msg.scope || "").toUpperCase();

    // Detect status from flag field and message text
    let detected: TrackStatus | "CLEAR" | null = null;

    // GREEN / CLEAR end-of-neutralization phrases take precedence over
    // mention-based SC/VSC matches (e.g. "SAFETY CAR IN THIS LAP").
    const isClearPhrase =
      flag === "GREEN" ||
      flag === "CLEAR" ||
      text.includes("GREEN LIGHT") ||
      text.includes("TRACK CLEAR") ||
      text.includes("VSC ENDING") ||
      text.includes("SAFETY CAR IN THIS LAP") ||
      text.includes("RESTART");

    // RED FLAG — deployment only (not penalty mentions like "RED FLAG INFRINGEMENT")
    if (isRedFlagDeployment(text, flag)) {
      detected = "RED";
    }

    // SAFETY CAR — deployment only (not penalty mentions like "SAFETY CAR INFRINGEMENT")
    else if (!isClearPhrase && isSafetyCarDeployment(text, flag)) {
      detected = "SC";
    }
    // VSC — deployment only
    else if (!isClearPhrase && isVirtualSafetyCarDeployment(text, flag)) {
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
    else if (isClearPhrase) {
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
