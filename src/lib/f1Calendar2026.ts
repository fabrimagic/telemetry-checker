/**
 * 2026 F1 Official Calendar — session schedule.
 * Bahrain and Saudi Arabia are excluded per 2026 calendar update.
 * Session times are approximate UTC based on standard F1 scheduling patterns.
 * Sprint weekends use the sprint format where confirmed.
 */

export interface F1Session {
  gpName: string;
  round: number;
  sessionType: "FP1" | "FP2" | "FP3" | "Qualifiche" | "Gara" | "Sprint Shootout" | "Sprint";
  /** ISO 8601 UTC datetime */
  dateUtc: string;
  /** Approximate duration in minutes */
  durationMinutes: number;
}

// Helper to build sessions for a standard weekend
function stdWeekend(
  round: number,
  gpName: string,
  fri: string, // Friday date YYYY-MM-DD
  sat: string,
  sun: string,
  fp1Utc: string,
  fp2Utc: string,
  fp3Utc: string,
  qualiUtc: string,
  raceUtc: string,
): F1Session[] {
  return [
    { gpName, round, sessionType: "FP1", dateUtc: `${fri}T${fp1Utc}:00Z`, durationMinutes: 60 },
    { gpName, round, sessionType: "FP2", dateUtc: `${fri}T${fp2Utc}:00Z`, durationMinutes: 60 },
    { gpName, round, sessionType: "FP3", dateUtc: `${sat}T${fp3Utc}:00Z`, durationMinutes: 60 },
    { gpName, round, sessionType: "Qualifiche", dateUtc: `${sat}T${qualiUtc}:00Z`, durationMinutes: 60 },
    { gpName, round, sessionType: "Gara", dateUtc: `${sun}T${raceUtc}:00Z`, durationMinutes: 120 },
  ];
}

// Sprint weekend format
function sprintWeekend(
  round: number,
  gpName: string,
  fri: string,
  sat: string,
  sun: string,
  fp1Utc: string,
  sprintShootoutUtc: string,
  sprintUtc: string,
  qualiUtc: string,
  raceUtc: string,
): F1Session[] {
  return [
    { gpName, round, sessionType: "FP1", dateUtc: `${fri}T${fp1Utc}:00Z`, durationMinutes: 60 },
    { gpName, round, sessionType: "Sprint Shootout", dateUtc: `${fri}T${sprintShootoutUtc}:00Z`, durationMinutes: 30 },
    { gpName, round, sessionType: "Sprint", dateUtc: `${sat}T${sprintUtc}:00Z`, durationMinutes: 60 },
    { gpName, round, sessionType: "Qualifiche", dateUtc: `${sat}T${qualiUtc}:00Z`, durationMinutes: 60 },
    { gpName, round, sessionType: "Gara", dateUtc: `${sun}T${raceUtc}:00Z`, durationMinutes: 120 },
  ];
}

export const F1_CALENDAR_2026: F1Session[] = [
  // Round 1 — Australia (Melbourne) — 6-8 Mar
  ...stdWeekend(1, "Gran Premio d'Australia", "2026-03-06", "2026-03-07", "2026-03-08",
    "01:30", "05:00", "00:30", "04:00", "04:00"),

  // Round 2 — China (Shanghai) — 13-15 Mar
  ...sprintWeekend(2, "Gran Premio della Cina", "2026-03-13", "2026-03-14", "2026-03-15",
    "03:30", "07:30", "03:00", "07:00", "07:00"),

  // Round 3 — Japan (Suzuka) — 27-29 Mar
  ...stdWeekend(3, "Gran Premio del Giappone", "2026-03-27", "2026-03-28", "2026-03-29",
    "02:30", "06:00", "02:00", "05:00", "05:00"),

  // Round 4 — Miami — 1-3 May (Sprint)
  ...sprintWeekend(4, "Gran Premio di Miami", "2026-05-01", "2026-05-02", "2026-05-03",
    "16:30", "20:30", "16:00", "20:00", "17:00"),

  // Round 5 — Canada (Montreal) — 22-24 May
  ...stdWeekend(5, "Gran Premio del Canada", "2026-05-22", "2026-05-23", "2026-05-24",
    "17:30", "21:00", "16:30", "20:00", "18:00"),

  // Round 6 — Monaco — 5-7 Jun
  ...stdWeekend(6, "Gran Premio di Monaco", "2026-06-05", "2026-06-06", "2026-06-07",
    "11:30", "15:00", "10:30", "14:00", "13:00"),

  // Round 7 — Barcelona-Catalunya — 12-14 Jun
  ...stdWeekend(7, "Gran Premio di Barcellona-Catalunya", "2026-06-12", "2026-06-13", "2026-06-14",
    "11:30", "15:00", "10:30", "14:00", "13:00"),

  // Round 8 — Austria (Spielberg) — 26-28 Jun (Sprint)
  ...sprintWeekend(8, "Gran Premio d'Austria", "2026-06-26", "2026-06-27", "2026-06-28",
    "10:30", "14:30", "10:00", "14:00", "13:00"),

  // Round 9 — Great Britain (Silverstone) — 3-5 Jul
  ...stdWeekend(9, "Gran Premio di Gran Bretagna", "2026-07-03", "2026-07-04", "2026-07-05",
    "11:30", "15:00", "10:30", "14:00", "14:00"),

  // Round 10 — Belgium (Spa) — 17-19 Jul
  ...stdWeekend(10, "Gran Premio del Belgio", "2026-07-17", "2026-07-18", "2026-07-19",
    "11:30", "15:00", "10:30", "14:00", "13:00"),

  // Round 11 — Hungary (Budapest) — 24-26 Jul
  ...stdWeekend(11, "Gran Premio d'Ungheria", "2026-07-24", "2026-07-25", "2026-07-26",
    "11:30", "15:00", "10:30", "14:00", "13:00"),

  // Round 12 — Netherlands (Zandvoort) — 21-23 Aug
  ...stdWeekend(12, "Gran Premio d'Olanda", "2026-08-21", "2026-08-22", "2026-08-23",
    "10:30", "14:00", "09:30", "13:00", "13:00"),

  // Round 13 — Italy (Monza) — 4-6 Sep
  ...stdWeekend(13, "Gran Premio d'Italia", "2026-09-04", "2026-09-05", "2026-09-06",
    "11:30", "15:00", "10:30", "14:00", "13:00"),

  // Round 14 — Spain (Madrid) — 11-13 Sep
  ...stdWeekend(14, "Gran Premio di Spagna", "2026-09-11", "2026-09-12", "2026-09-13",
    "11:30", "15:00", "10:30", "14:00", "13:00"),

  // Round 15 — Azerbaijan (Baku) — 24-26 Sep
  ...stdWeekend(15, "Gran Premio dell'Azerbaijan", "2026-09-25", "2026-09-26", "2026-09-27",
    "08:30", "12:00", "07:30", "11:00", "11:00"),

  // Round 16 — Singapore — 9-11 Oct
  ...stdWeekend(16, "Gran Premio di Singapore", "2026-10-09", "2026-10-10", "2026-10-11",
    "09:30", "13:00", "09:30", "13:00", "12:00"),

  // Round 17 — United States (COTA) — 23-25 Oct (Sprint)
  ...sprintWeekend(17, "Gran Premio degli Stati Uniti", "2026-10-23", "2026-10-24", "2026-10-25",
    "17:30", "21:30", "17:00", "21:00", "19:00"),

  // Round 18 — Mexico (CDMX) — 30 Oct - 1 Nov
  ...stdWeekend(18, "Gran Premio del Messico", "2026-10-30", "2026-10-31", "2026-11-01",
    "18:30", "22:00", "17:30", "21:00", "20:00"),

  // Round 19 — Brazil (São Paulo) — 6-8 Nov (Sprint)
  ...sprintWeekend(19, "Gran Premio del Brasile", "2026-11-06", "2026-11-07", "2026-11-08",
    "14:30", "18:30", "14:00", "18:00", "17:00"),

  // Round 20 — Las Vegas — 19-21 Nov
  ...stdWeekend(20, "Gran Premio di Las Vegas", "2026-11-19", "2026-11-20", "2026-11-21",
    "01:30", "05:00", "01:30", "05:00", "06:00"),

  // Round 21 — Qatar (Lusail) — 27-29 Nov (Sprint)
  ...sprintWeekend(21, "Gran Premio del Qatar", "2026-11-27", "2026-11-28", "2026-11-29",
    "13:30", "17:30", "13:00", "17:00", "17:00"),

  // Round 22 — Abu Dhabi (Yas Marina) — 4-6 Dec
  ...stdWeekend(22, "Gran Premio di Abu Dhabi", "2026-12-04", "2026-12-05", "2026-12-06",
    "09:30", "13:00", "10:30", "14:00", "13:00"),
];

/**
 * Returns the next upcoming session, or null if no sessions remain.
 * A session is considered "in progress" if now is between start and start+duration.
 * A session is "past" if now > start + duration.
 */
export function getNextSession(now: Date = new Date()): {
  session: F1Session;
  status: "upcoming" | "imminent" | "in_progress";
} | null {
  const nowMs = now.getTime();

  for (const session of F1_CALENDAR_2026) {
    const startMs = new Date(session.dateUtc).getTime();
    const endMs = startMs + session.durationMinutes * 60_000;

    if (nowMs < startMs) {
      const diffMs = startMs - nowMs;
      const isImminent = diffMs <= 60 * 60_000; // < 1 hour
      return { session, status: isImminent ? "imminent" : "upcoming" };
    }

    if (nowMs >= startMs && nowMs <= endMs) {
      return { session, status: "in_progress" };
    }
    // else: session is past, continue to next
  }

  return null;
}
