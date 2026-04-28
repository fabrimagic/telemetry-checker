import { describe, it, expect } from "vitest";
import type { SessionInfo } from "../openf1";
import { detectWeekendFormat, getDataSourcesForFormat } from "../weekendFormat";

function s(name: string, type: string, dateStart: string, sessionKey = 1): SessionInfo {
  return {
    session_key: sessionKey,
    session_type: type,
    session_name: name,
    meeting_key: 1,
    date_start: dateStart,
  };
}

describe("detectWeekendFormat", () => {
  it("returns STANDARD for a standard weekend", () => {
    const sessions = [
      s("Practice 1", "Practice", "2024-09-06T11:30:00"),
      s("Practice 2", "Practice", "2024-09-06T15:00:00"),
      s("Practice 3", "Practice", "2024-09-07T11:30:00"),
      s("Qualifying", "Qualifying", "2024-09-07T15:00:00"),
      s("Race", "Race", "2024-09-08T15:00:00"),
    ];
    expect(detectWeekendFormat(sessions)).toBe("STANDARD");
  });

  it("returns SPRINT when a Sprint race is present", () => {
    const sessions = [
      s("Practice 1", "Practice", "2024-10-18T11:30:00"),
      s("Sprint Qualifying", "Qualifying", "2024-10-18T15:30:00"),
      s("Sprint", "Race", "2024-10-19T11:00:00"),
      s("Qualifying", "Qualifying", "2024-10-19T15:00:00"),
      s("Race", "Race", "2024-10-20T15:00:00"),
    ];
    expect(detectWeekendFormat(sessions)).toBe("SPRINT");
  });

  it("returns STANDARD for an empty array (conservative default)", () => {
    expect(detectWeekendFormat([])).toBe("STANDARD");
  });

  it("returns STANDARD if only Sprint Qualifying is present without Sprint", () => {
    const sessions = [
      s("Practice 1", "Practice", "2024-10-18T11:30:00"),
      s("Sprint Qualifying", "Qualifying", "2024-10-18T15:30:00"),
    ];
    expect(detectWeekendFormat(sessions)).toBe("STANDARD");
  });
});

describe("getDataSourcesForFormat", () => {
  it("STANDARD: returns FP1, FP2, FP3 in chronological order", () => {
    const sessions = [
      s("Race", "Race", "2024-09-08T15:00:00", 5),
      s("Practice 3", "Practice", "2024-09-07T11:30:00", 3),
      s("Practice 1", "Practice", "2024-09-06T11:30:00", 1),
      s("Qualifying", "Qualifying", "2024-09-07T15:00:00", 4),
      s("Practice 2", "Practice", "2024-09-06T15:00:00", 2),
    ];
    const result = getDataSourcesForFormat(sessions, "STANDARD");
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.session_name)).toEqual([
      "Practice 1",
      "Practice 2",
      "Practice 3",
    ]);
  });

  it("SPRINT: returns Sprint + FP1 in chronological order", () => {
    const sessions = [
      s("Sprint", "Race", "2024-10-19T11:00:00", 3),
      s("Practice 1", "Practice", "2024-10-18T11:30:00", 1),
      s("Sprint Qualifying", "Qualifying", "2024-10-18T15:30:00", 2),
      s("Qualifying", "Qualifying", "2024-10-19T15:00:00", 4),
      s("Race", "Race", "2024-10-20T15:00:00", 5),
    ];
    const result = getDataSourcesForFormat(sessions, "SPRINT");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.session_name)).toEqual(["Practice 1", "Sprint"]);
  });

  it("STANDARD: handles partial weekend (only FP1 + FP2)", () => {
    const sessions = [
      s("Practice 1", "Practice", "2024-09-06T11:30:00"),
      s("Practice 2", "Practice", "2024-09-06T15:00:00"),
    ];
    const result = getDataSourcesForFormat(sessions, "STANDARD");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.session_name)).toEqual(["Practice 1", "Practice 2"]);
  });

  it("returns [] for empty input", () => {
    expect(getDataSourcesForFormat([], "STANDARD")).toEqual([]);
    expect(getDataSourcesForFormat([], "SPRINT")).toEqual([]);
  });
});
