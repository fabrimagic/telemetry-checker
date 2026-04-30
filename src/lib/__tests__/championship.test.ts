import { describe, it, expect } from "vitest";
import {
  buildChampionshipResult,
  type RaceChampionshipSnapshot,
} from "../championship";
import type {
  ChampionshipDriverStanding,
  ChampionshipTeamStanding,
} from "../openf1";

function ds(
  driver_number: number,
  position_current: number,
  points_current: number,
  session_key = 1,
): ChampionshipDriverStanding {
  return {
    driver_number,
    meeting_key: session_key,
    session_key,
    position_start: position_current,
    position_current,
    points_start: 0,
    points_current,
  };
}

function ts(
  team_name: string,
  position_current: number,
  points_current: number,
  session_key = 1,
): ChampionshipTeamStanding {
  return {
    team_name,
    meeting_key: session_key,
    session_key,
    position_start: position_current,
    position_current,
    points_start: 0,
    points_current,
  };
}

function mkSnap(
  sessionKey: number,
  label: string,
  drivers: ChampionshipDriverStanding[],
  teams: ChampionshipTeamStanding[],
): RaceChampionshipSnapshot {
  return {
    meetingKey: sessionKey,
    sessionKey,
    raceLabel: label,
    countryName: label,
    dateStart: `2026-0${sessionKey}-01T12:00:00Z`,
    driverStandings: drivers,
    teamStandings: teams,
  };
}

describe("buildChampionshipResult", () => {
  it("1. empty snapshots → racesCompleted=0 with warning", () => {
    const r = buildChampionshipResult(2026, []);
    expect(r.racesCompleted).toBe(0);
    expect(r.driverTimelines).toEqual([]);
    expect(r.teamTimelines).toEqual([]);
    expect(r.warnings).toContain("Nessuna gara disputata");
  });

  it("2. single race, 3 drivers sorted by position", () => {
    const snap = mkSnap(
      1,
      "AUS",
      [ds(1, 2, 18), ds(44, 1, 25), ds(16, 3, 15)],
      [ts("RB", 1, 43), ts("FER", 2, 15)],
    );
    const r = buildChampionshipResult(2026, [snap]);
    expect(r.racesCompleted).toBe(1);
    expect(r.driverTimelines.map((d) => d.driverNumber)).toEqual([44, 1, 16]);
    expect(r.driverTimelines[0].totalPoints).toBe(25);
    expect(r.driverTimelines[0].points).toHaveLength(1);
    expect(r.driverTimelines[0].positionDeltaVsPrevRace).toBe(0);
    expect(r.teamTimelines[0].teamName).toBe("RB");
  });

  it("3. multiple races: pointsGained per-race correct", () => {
    const s1 = mkSnap(1, "R1", [ds(1, 1, 25, 1)], [ts("RB", 1, 25, 1)]);
    const s2 = mkSnap(2, "R2", [ds(1, 1, 43, 2)], [ts("RB", 1, 43, 2)]);
    const s3 = mkSnap(3, "R3", [ds(1, 1, 68, 3)], [ts("RB", 1, 68, 3)]);
    const r = buildChampionshipResult(2026, [s1, s2, s3]);
    const tl = r.driverTimelines[0];
    expect(tl.points.map((p) => p.pointsGained)).toEqual([25, 18, 25]);
    expect(tl.points.map((p) => p.pointsCurrent)).toEqual([25, 43, 68]);
    expect(tl.totalPoints).toBe(68);
  });

  it("4. driver missing in middle race: carry-forward, position=0", () => {
    const s1 = mkSnap(1, "R1", [ds(1, 1, 25, 1)], [ts("RB", 1, 25, 1)]);
    const s2 = mkSnap(2, "R2", [], [ts("RB", 1, 25, 2)]);
    const s3 = mkSnap(3, "R3", [ds(1, 2, 40, 3)], [ts("RB", 1, 40, 3)]);
    const r = buildChampionshipResult(2026, [s1, s2, s3]);
    const tl = r.driverTimelines.find((d) => d.driverNumber === 1)!;
    expect(tl.points[1].pointsCurrent).toBe(25);
    expect(tl.points[1].positionCurrent).toBe(0);
    expect(tl.points[1].pointsGained).toBe(0);
    expect(tl.points[2].pointsGained).toBe(15);
  });

  it("5. position delta: from p3 to p1 → -2 (gained 2)", () => {
    const s1 = mkSnap(1, "R1", [ds(44, 3, 15, 1)], [ts("MER", 3, 15, 1)]);
    const s2 = mkSnap(2, "R2", [ds(44, 1, 40, 2)], [ts("MER", 1, 40, 2)]);
    const r = buildChampionshipResult(2026, [s1, s2]);
    expect(r.driverTimelines[0].positionDeltaVsPrevRace).toBe(-2);
  });

  it("6. determinismo: 3 chiamate identiche → output identico", () => {
    const s1 = mkSnap(
      1,
      "R1",
      [ds(1, 2, 18, 1), ds(44, 1, 25, 1)],
      [ts("RB", 1, 18, 1), ts("MER", 2, 25, 1)],
    );
    const s2 = mkSnap(
      2,
      "R2",
      [ds(1, 1, 43, 2), ds(44, 2, 43, 2)],
      [ts("RB", 1, 43, 2), ts("MER", 2, 43, 2)],
    );
    const a = JSON.stringify(buildChampionshipResult(2026, [s1, s2]));
    const b = JSON.stringify(buildChampionshipResult(2026, [s1, s2]));
    const c = JSON.stringify(buildChampionshipResult(2026, [s1, s2]));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
