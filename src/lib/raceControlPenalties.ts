/**
 * Race Control penalty detector.
 *
 * Scope: read-only detection of penalties ACTUALLY ISSUED to drivers from
 * RaceControlMessage[] text. Used purely to surface an honest WARNING in the
 * strategy analysis UI — NEVER to modify any computation (pace, pit-loss,
 * counterfactuals, verdicts). See VRE card for the user-facing disclaimer
 * about why we do not subtract penalties from the strategic calculations.
 *
 * Keywords used (case-insensitive, applied on `message`):
 *   Penalty types (INCLUDE):
 *     - "TIME PENALTY"               → TIME_PENALTY
 *     - "SECOND PENALTY" / "SECONDS PENALTY" / "N SECOND ... PENALTY"
 *                                    → TIME_PENALTY (with parsed seconds)
 *     - "DRIVE THROUGH" / "DRIVE-THROUGH"  → DRIVE_THROUGH
 *     - "STOP AND GO" / "STOP-GO" / "STOP/GO" / "STOP & GO" → STOP_GO
 *     - generic "PENALTY" with no above match → UNKNOWN (detail not parsed)
 *
 *   Procedure-only messages (EXCLUDE, not a penalty):
 *     - "UNDER INVESTIGATION"
 *     - "NOTED"
 *     - "NO FURTHER ACTION"
 *     - "REVIEWED" combined with "NO ACTION"
 *     - "INCIDENT NOT INVESTIGATED"
 *
 * Robustness: on uncertain parses we still emit a detection with rawMessage
 * and penaltyType="UNKNOWN" (seconds undefined). We never invent data and
 * never throw on unexpected formats.
 */

import type { RaceControlMessage } from "./openf1";

export type PenaltyType =
  | "TIME_PENALTY"
  | "DRIVE_THROUGH"
  | "STOP_GO"
  | "UNKNOWN";

export interface DetectedPenalty {
  /** Driver/car number when extractable from "CAR <n>" pattern. */
  driverNumber?: number;
  /** Penalty type when recognizable; UNKNOWN when only the word "PENALTY" was found. */
  penaltyType: PenaltyType;
  /** Seconds for time penalties when stated (e.g. "5 SECOND TIME PENALTY"). */
  seconds?: number;
  /** Original race control message text (always preserved). */
  rawMessage: string;
  /** Timestamp from the race control message. */
  date: string;
}

const EXCLUSION_PATTERNS: RegExp[] = [
  /UNDER\s+INVESTIGATION/i,
  /\bNOTED\b/i,
  /NO\s+FURTHER\s+ACTION/i,
  /REVIEWED[^A-Z]*NO\s+ACTION/i,
  /INCIDENT\s+NOT\s+INVESTIGATED/i,
];

function isProcedureOnly(msg: string): boolean {
  return EXCLUSION_PATTERNS.some((re) => re.test(msg));
}

function detectType(msg: string): PenaltyType | null {
  const upper = msg.toUpperCase();
  // Order matters: more specific first.
  if (/DRIVE[\s-]THROUGH/i.test(upper)) return "DRIVE_THROUGH";
  if (/STOP[\s\-/&]+(AND\s+)?GO/i.test(upper)) return "STOP_GO";
  if (/TIME\s+PENALTY/i.test(upper)) return "TIME_PENALTY";
  if (/\d+\s*SECONDS?\s+PENALTY/i.test(upper)) return "TIME_PENALTY";
  if (/\d+\s*SECONDS?\b/i.test(upper) && /PENALTY/i.test(upper)) return "TIME_PENALTY";
  if (/\bPENALTY\b/i.test(upper)) return "UNKNOWN";
  return null;
}

function extractDriverNumber(msg: string): number | undefined {
  const m = msg.match(/CAR\s+(\d{1,3})\b/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

function extractSeconds(msg: string): number | undefined {
  const m = msg.match(/(\d+)\s*SECONDS?\b/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 && n < 600 ? n : undefined;
}

/**
 * Extract penalties ACTUALLY ISSUED from race control messages.
 * Returns [] when input is empty/invalid; never throws.
 */
export function detectRaceControlPenalties(
  messages: RaceControlMessage[] | null | undefined,
): DetectedPenalty[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const out: DetectedPenalty[] = [];
  for (const m of messages) {
    if (!m || typeof m.message !== "string") continue;
    const raw = m.message;
    if (isProcedureOnly(raw)) continue;
    const type = detectType(raw);
    if (!type) continue;
    const driverNumber = extractDriverNumber(raw);
    const seconds = type === "TIME_PENALTY" ? extractSeconds(raw) : undefined;
    out.push({
      driverNumber,
      penaltyType: type,
      seconds,
      rawMessage: raw,
      date: typeof m.date === "string" ? m.date : "",
    });
  }
  return out;
}

/** Filter detected penalties by driver number. Unmatched (no driverNumber) are excluded. */
export function penaltiesForDriver(
  penalties: DetectedPenalty[],
  driverNumber: number,
): DetectedPenalty[] {
  return penalties.filter((p) => p.driverNumber === driverNumber);
}

/** Human-friendly label for a penalty type (Italian, matches UI tone). */
export function penaltyTypeLabel(t: PenaltyType): string {
  switch (t) {
    case "TIME_PENALTY": return "Time penalty";
    case "DRIVE_THROUGH": return "Drive-through";
    case "STOP_GO": return "Stop & go";
    case "UNKNOWN": return "Penalità (dettaglio non parsificato)";
  }
}
