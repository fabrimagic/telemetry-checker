import type { SessionInfo } from "./openf1";

export type WeekendFormat = "STANDARD" | "SPRINT";

/**
 * Detects the format of a GP weekend based on the list of meeting sessions.
 *
 * - STANDARD weekend: 3 free practices (FP1, FP2, FP3), Qualifying, Race
 * - SPRINT weekend: 1 free practice (FP1), Sprint Qualifying, Sprint, Qualifying, Race
 *
 * Detection rule: if a session with session_name === "Sprint" is present, the
 * weekend is SPRINT. Note: "Sprint Qualifying" (the qualifying for the sprint)
 * does NOT count — only the actual Sprint race.
 */
export function detectWeekendFormat(sessions: SessionInfo[]): WeekendFormat {
  const hasSprintRace = sessions.some((s) => s.session_name === "Sprint");
  return hasSprintRace ? "SPRINT" : "STANDARD";
}

/**
 * Returns the sessions that are relevant for pre-race long-run analysis,
 * ordered chronologically (oldest first). The "most recent for driver" rule
 * downstream relies on this ordering.
 *
 * - STANDARD: FP1 + FP2 + FP3 (free practice sessions)
 * - SPRINT: Sprint (primary) + FP1 (fallback)
 *
 * Sessions that don't yet exist in the meeting (e.g. weekend in progress, FP3
 * not yet held) are silently absent — caller decides how to handle empty arrays.
 */
export function getDataSourcesForFormat(
  sessions: SessionInfo[],
  format: WeekendFormat,
): SessionInfo[] {
  const relevantNames =
    format === "STANDARD"
      ? new Set(["Practice 1", "Practice 2", "Practice 3"])
      : new Set(["Sprint", "Practice 1"]);

  const filtered = sessions.filter((s) => relevantNames.has(s.session_name));
  return [...filtered].sort((a, b) => a.date_start.localeCompare(b.date_start));
}
