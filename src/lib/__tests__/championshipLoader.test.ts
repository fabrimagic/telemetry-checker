import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../openf1", () => ({
  getRaceSessionsByYear: vi.fn(),
  getSprintSessionsByYear: vi.fn().mockResolvedValue([]),
  getChampionshipDrivers: vi.fn(),
  getChampionshipTeams: vi.fn(),
}));

import {
  getRaceSessionsByYear,
  getSprintSessionsByYear,
  getChampionshipDrivers,
  getChampionshipTeams,
  type SessionInfo,
} from "../openf1";
import { loadCurrentSeasonChampionship } from "../championshipLoader";

const past = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString();
const future = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString();

function mkSession(
  session_key: number,
  daysAgo: number,
  location: string,
): SessionInfo {
  return {
    session_key,
    session_type: "Race",
    session_name: "Race",
    meeting_key: 1000 + session_key,
    date_start: past(daysAgo),
    date_end: past(daysAgo - 1) > new Date().toISOString() ? future(1) : past(daysAgo - 1),
    location,
    country_name: location,
  };
}

function mkFuture(session_key: number, daysAhead: number, loc: string): SessionInfo {
  return {
    session_key,
    session_type: "Race",
    session_name: "Race",
    meeting_key: 1000 + session_key,
    date_start: future(daysAhead),
    date_end: future(daysAhead + 1),
    location: loc,
    country_name: loc,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getSprintSessionsByYear as any).mockResolvedValue([]);
});

describe("loadCurrentSeasonChampionship", () => {
  it("1. getRaceSessionsByYear throws → hard error", async () => {
    (getRaceSessionsByYear as any).mockRejectedValue(new Error("boom"));
    const out = await loadCurrentSeasonChampionship();
    expect(out.result).toBeNull();
    expect(out.error).toBe("boom");
  });

  it("2. all races in future → racesCompleted=0 with warning", async () => {
    (getRaceSessionsByYear as any).mockResolvedValue([
      mkFuture(1, 10, "Bahrain"),
      mkFuture(2, 20, "Saudi"),
    ]);
    const out = await loadCurrentSeasonChampionship();
    expect(out.error).toBeNull();
    expect(out.result?.racesCompleted).toBe(0);
    expect(out.result?.warnings[0]).toMatch(/Nessuna gara/);
  });

  it("3. 3 completed races → 3 snapshots in chronological order", async () => {
    (getRaceSessionsByYear as any).mockResolvedValue([
      mkSession(2, 20, "Cina"),
      mkSession(1, 30, "Australia"),
      mkSession(3, 10, "Giappone"),
    ]);
    (getChampionshipDrivers as any).mockImplementation((sk: number) => [
      { driver_number: 1, meeting_key: sk, session_key: sk, position_start: 1, position_current: 1, points_start: 0, points_current: sk * 10 },
    ]);
    (getChampionshipTeams as any).mockImplementation((sk: number) => [
      { team_name: "RB", meeting_key: sk, session_key: sk, position_start: 1, position_current: 1, points_start: 0, points_current: sk * 10 },
    ]);
    const out = await loadCurrentSeasonChampionship();
    expect(out.error).toBeNull();
    expect(out.result?.racesCompleted).toBe(3);
    expect(out.result?.races.map((r) => r.raceLabel)).toEqual([
      "Australia",
      "Cina",
      "Giappone",
    ]);
  });

  it("4. one race fails → snapshot skipped, warning added", async () => {
    (getRaceSessionsByYear as any).mockResolvedValue([
      mkSession(1, 30, "Australia"),
      mkSession(2, 20, "Cina"),
      mkSession(3, 10, "Giappone"),
    ]);
    (getChampionshipDrivers as any).mockImplementation((sk: number) => {
      if (sk === 2) return Promise.reject(new Error("404"));
      return Promise.resolve([
        { driver_number: 1, meeting_key: sk, session_key: sk, position_start: 1, position_current: 1, points_start: 0, points_current: 25 },
      ]);
    });
    (getChampionshipTeams as any).mockImplementation((sk: number) =>
      Promise.resolve([
        { team_name: "RB", meeting_key: sk, session_key: sk, position_start: 1, position_current: 1, points_start: 0, points_current: 25 },
      ]),
    );
    const out = await loadCurrentSeasonChampionship();
    expect(out.result?.racesCompleted).toBe(2);
    expect(out.result?.warnings.some((w) => w.includes("Cina"))).toBe(true);
  });

  it("5. determinismo: due chiamate identical mocks → output identico", async () => {
    const races = [
      mkSession(1, 30, "Australia"),
      mkSession(2, 20, "Cina"),
    ];
    (getRaceSessionsByYear as any).mockResolvedValue(races);
    (getChampionshipDrivers as any).mockImplementation((sk: number) => [
      { driver_number: 1, meeting_key: sk, session_key: sk, position_start: 1, position_current: 1, points_start: 0, points_current: sk * 10 },
    ]);
    (getChampionshipTeams as any).mockImplementation((sk: number) => [
      { team_name: "RB", meeting_key: sk, session_key: sk, position_start: 1, position_current: 1, points_start: 0, points_current: sk * 10 },
    ]);
    const a = await loadCurrentSeasonChampionship();
    const b = await loadCurrentSeasonChampionship();
    // Strip races[].dateStart since it depends on Date.now() snapshot at mkSession time;
    // but mkSession was called once above, so the same SessionInfo objects are reused → identical.
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
  });
});
