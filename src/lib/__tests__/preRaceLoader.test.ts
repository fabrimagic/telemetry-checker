import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Driver, Lap, StintData, SessionInfo, SessionResult } from "../openf1";

vi.mock("../openf1", async () => {
  return {
    getSessionsByMeetingKey: vi.fn(),
    getLaps: vi.fn(),
    getStints: vi.fn(),
    getPitStops: vi.fn(),
    getSessionResult: vi.fn(),
  };
});

import * as openf1 from "../openf1";
import { loadPreRaceAnalysis } from "../preRaceLoader";

const mocked = vi.mocked(openf1);

// ── Fixture builders ──────────────────────────────────────────────────

function buildDriver(num: number, acronym: string, team = "Ferrari", colour = "DC0000"): Driver {
  return {
    driver_number: num,
    broadcast_name: acronym,
    full_name: acronym,
    name_acronym: acronym,
    team_name: team,
    team_colour: colour,
    headshot_url: null,
    session_key: 1,
  };
}

function buildSession(name: string, key: number, date: string, type = "Practice"): SessionInfo {
  return {
    session_key: key,
    session_type: type,
    session_name: name,
    meeting_key: 1,
    date_start: date,
  };
}

function buildLap(driver: number, lap: number, dur: number, isPitOut = false): Lap {
  return {
    lap_number: lap,
    lap_duration: dur,
    duration_sector_1: null,
    duration_sector_2: null,
    duration_sector_3: null,
    st_speed: null,
    date_start: null,
    is_pit_out_lap: isPitOut,
    driver_number: driver,
    session_key: 1,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
  };
}

function buildStint(driver: number, n: number, compound: string, start: number, end: number): StintData {
  return {
    compound,
    driver_number: driver,
    lap_end: end,
    lap_start: start,
    meeting_key: 1,
    session_key: 1,
    stint_number: n,
    tyre_age_at_start: 0,
  };
}

function buildLongRunLaps(driver: number, count: number, baseLap: number, slope: number): Lap[] {
  const laps: Lap[] = [buildLap(driver, 1, baseLap + 5, true)];
  for (let i = 0; i < count; i++) {
    const lapNum = i + 2;
    const jitter = ((i * 37) % 7) * 0.01 - 0.03;
    laps.push(buildLap(driver, lapNum, baseLap + slope * i + jitter));
  }
  return laps;
}

beforeEach(() => {
  vi.clearAllMocks();
  // default: empty for everything
  mocked.getStints.mockResolvedValue([]);
  mocked.getPitStops.mockResolvedValue([]);
  mocked.getLaps.mockResolvedValue([]);
});

describe("loadPreRaceAnalysis", () => {
  it("1. empty drivers list returns hard error", async () => {
    const out = await loadPreRaceAnalysis({ meetingKey: 1, drivers: [], narrativeSessionKey: 1 });
    expect(out.error).toMatch(/Nessun pilota/);
    expect(out.preRaceAnalysis.ranking).toEqual([]);
  });

  it("2. getSessionsByMeetingKey throws → hard error returned", async () => {
    mocked.getSessionsByMeetingKey.mockRejectedValueOnce(new Error("network down"));
    const out = await loadPreRaceAnalysis({
      meetingKey: 1,
      drivers: [buildDriver(1, "VER")],
      narrativeSessionKey: 1,
    });
    expect(out.error).toBe("network down");
  });

  it("3. STANDARD weekend, 3 drivers, valid FP2 data → ranking has 3 entries", async () => {
    const drivers = [buildDriver(1, "VER"), buildDriver(11, "PER"), buildDriver(16, "LEC")];
    const fp2 = buildSession("Practice 2", 200, "2024-09-06T15:00:00");
    const sessions: SessionInfo[] = [
      buildSession("Practice 1", 100, "2024-09-06T11:00:00"),
      fp2,
      buildSession("Practice 3", 300, "2024-09-07T11:00:00"),
      buildSession("Qualifying", 400, "2024-09-07T15:00:00", "Qualifying"),
      buildSession("Race", 500, "2024-09-08T13:00:00", "Race"),
    ];
    mocked.getSessionsByMeetingKey.mockResolvedValueOnce(sessions);
    // Only FP2 returns laps; FP1 and FP3 return [] so no long-run there.
    mocked.getLaps.mockImplementation(async (sessionKey: number, driverNum: number) => {
      if (sessionKey !== 200) return [];
      const base = driverNum === 1 ? 90 : driverNum === 11 ? 90.5 : 91;
      return buildLongRunLaps(driverNum, 10, base, 0.05);
    });
    mocked.getStints.mockImplementation(async (_k, dn) => [buildStint(dn, 1, "MEDIUM", 1, 11)]);
    mocked.getSessionResult.mockResolvedValueOnce([]);

    const out = await loadPreRaceAnalysis({ meetingKey: 1, drivers, narrativeSessionKey: 500 });
    expect(out.error).toBeNull();
    expect(out.weekendFormat).toBe("STANDARD");
    expect(out.preRaceAnalysis.ranking).toHaveLength(3);
    expect(out.preRaceAnalysis.ranking[0].acronym).toBe("VER");
    expect(out.practiceSessionsUsed.map((s) => s.session_name)).toEqual([
      "Practice 1",
      "Practice 2",
      "Practice 3",
    ]);
  });

  it("4. SPRINT weekend → format=SPRINT, 2 practice sources used", async () => {
    const drivers = [buildDriver(1, "VER")];
    const sessions: SessionInfo[] = [
      buildSession("Practice 1", 100, "2024-09-06T11:00:00"),
      buildSession("Sprint Qualifying", 150, "2024-09-06T15:00:00", "Qualifying"),
      buildSession("Sprint", 200, "2024-09-07T11:00:00", "Race"),
      buildSession("Qualifying", 400, "2024-09-07T15:00:00", "Qualifying"),
      buildSession("Race", 500, "2024-09-08T13:00:00", "Race"),
    ];
    mocked.getSessionsByMeetingKey.mockResolvedValueOnce(sessions);
    mocked.getLaps.mockResolvedValue([]);
    mocked.getSessionResult.mockResolvedValueOnce([]);

    const out = await loadPreRaceAnalysis({ meetingKey: 1, drivers, narrativeSessionKey: 500 });
    expect(out.error).toBeNull();
    expect(out.weekendFormat).toBe("SPRINT");
    expect(out.practiceSessionsUsed).toHaveLength(2);
    const names = out.practiceSessionsUsed.map((s) => s.session_name);
    expect(names).toContain("Sprint");
    expect(names).toContain("Practice 1");
  });

  it("5. Quali present with valid data → qualifyingDataAvailable=true", async () => {
    const drivers = [buildDriver(1, "VER"), buildDriver(11, "PER")];
    const sessions: SessionInfo[] = [
      buildSession("Practice 2", 200, "2024-09-06T15:00:00"),
      buildSession("Qualifying", 400, "2024-09-07T15:00:00", "Qualifying"),
      buildSession("Race", 500, "2024-09-08T13:00:00", "Race"),
    ];
    mocked.getSessionsByMeetingKey.mockResolvedValueOnce(sessions);
    mocked.getLaps.mockImplementation(async (sk, dn) => {
      if (sk !== 200) return [];
      return buildLongRunLaps(dn, 10, dn === 1 ? 90 : 90.5, 0.05);
    });
    mocked.getStints.mockImplementation(async (_k, dn) => [buildStint(dn, 1, "MEDIUM", 1, 11)]);
    const qualiResults: SessionResult[] = [
      { dnf: false, dns: false, dsq: false, driver_number: 1, duration: [85.1, 84.8, 84.2], gap_to_leader: 0, number_of_laps: 1, meeting_key: 1, position: 1, session_key: 400 },
      { dnf: false, dns: false, dsq: false, driver_number: 11, duration: 85.0, gap_to_leader: 0.5, number_of_laps: 1, meeting_key: 1, position: 2, session_key: 400 },
    ];
    mocked.getSessionResult.mockResolvedValueOnce(qualiResults);

    const out = await loadPreRaceAnalysis({ meetingKey: 1, drivers, narrativeSessionKey: 500 });
    expect(out.error).toBeNull();
    expect(out.qualifyingFingerprint.qualifyingDataAvailable).toBe(true);
    expect(out.qualifyingFingerprint.entries.length).toBeGreaterThan(0);
  });

  it("6. Quali session absent → warning + qualifyingDataAvailable=false", async () => {
    const drivers = [buildDriver(1, "VER")];
    const sessions: SessionInfo[] = [
      buildSession("Practice 2", 200, "2024-09-06T15:00:00"),
      buildSession("Race", 500, "2024-09-08T13:00:00", "Race"),
    ];
    mocked.getSessionsByMeetingKey.mockResolvedValueOnce(sessions);
    mocked.getLaps.mockResolvedValue([]);

    const out = await loadPreRaceAnalysis({ meetingKey: 1, drivers, narrativeSessionKey: 500 });
    expect(out.error).toBeNull();
    expect(out.qualifyingFingerprint.qualifyingDataAvailable).toBe(false);
    expect(out.warnings.some((w) => /qualifica non trovata/.test(w))).toBe(true);
  });

  it("7. Driver DNF in Quali → qualifyingPosition=null, classification=NO_QUALI_DATA", async () => {
    const drivers = [buildDriver(1, "VER"), buildDriver(11, "PER")];
    const sessions: SessionInfo[] = [
      buildSession("Practice 2", 200, "2024-09-06T15:00:00"),
      buildSession("Qualifying", 400, "2024-09-07T15:00:00", "Qualifying"),
      buildSession("Race", 500, "2024-09-08T13:00:00", "Race"),
    ];
    mocked.getSessionsByMeetingKey.mockResolvedValueOnce(sessions);
    mocked.getLaps.mockImplementation(async (sk, dn) => {
      if (sk !== 200) return [];
      return buildLongRunLaps(dn, 10, dn === 1 ? 90 : 90.5, 0.05);
    });
    mocked.getStints.mockImplementation(async (_k, dn) => [buildStint(dn, 1, "MEDIUM", 1, 11)]);
    const qualiResults: SessionResult[] = [
      { dnf: false, dns: false, dsq: false, driver_number: 1, duration: 84.5, gap_to_leader: 0, number_of_laps: 1, meeting_key: 1, position: 1, session_key: 400 },
      { dnf: true, dns: false, dsq: false, driver_number: 11, duration: null, gap_to_leader: null, number_of_laps: 0, meeting_key: 1, position: 20, session_key: 400 },
    ];
    mocked.getSessionResult.mockResolvedValueOnce(qualiResults);

    const out = await loadPreRaceAnalysis({ meetingKey: 1, drivers, narrativeSessionKey: 500 });
    expect(out.error).toBeNull();
    const perEntry = out.qualifyingFingerprint.entries.find((e) => e.driverNumber === 11);
    expect(perEntry).toBeDefined();
    expect(perEntry!.qualifyingPosition).toBeNull();
    expect(perEntry!.classification).toBe("NO_QUALI_DATA");
  });
});
