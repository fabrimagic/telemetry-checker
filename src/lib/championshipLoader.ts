import {
  getRaceSessionsByYear,
  getSprintSessionsByYear,
  getChampionshipDrivers,
  getChampionshipTeams,
  type SessionInfo,
} from "./openf1";
import {
  buildChampionshipResult,
  type ChampionshipResult,
  type RaceChampionshipSnapshot,
} from "./championship";

export interface ChampionshipLoaderOutput {
  result: ChampionshipResult | null;
  /** Hard error that prevented loading. null on success. */
  error: string | null;
}

/**
 * Loads the championship timeline for the current calendar year.
 * Year is derived dynamically from new Date().getFullYear().
 *
 * Includes BOTH Grand Prix Races and Sprint races as standings checkpoints,
 * because OpenF1's championship_drivers/championship_teams endpoints publish
 * a fresh standings snapshot after each session that awards points.
 * Sessions are merged and ordered chronologically.
 */
export async function loadCurrentSeasonChampionship(): Promise<ChampionshipLoaderOutput> {
  const year = new Date().getFullYear();
  const warnings: string[] = [];

  let races: SessionInfo[];
  let sprints: SessionInfo[];
  try {
    [races, sprints] = await Promise.all([
      getRaceSessionsByYear(year),
      getSprintSessionsByYear(year).catch(() => [] as SessionInfo[]),
    ]);
  } catch (e: any) {
    return {
      result: null,
      error: e?.message ?? "Errore caricamento calendario stagione",
    };
  }

  const now = new Date().toISOString();
  // 2026 season: Bahrain and Saudi Arabia rounds are not held — exclude them
  // so they don't appear as "missing data" in the championship timeline.
  const EXCLUDED_2026 = new Set(["Sakhir", "Jeddah"]);

  type ScoringSession = SessionInfo & { isSprint: boolean };
  const allScoring: ScoringSession[] = [
    ...races.map((r) => ({ ...r, isSprint: false })),
    ...sprints.map((s) => ({ ...s, isSprint: true })),
  ];

  const completed = allScoring
    .filter((r) => r.date_end && r.date_end < now)
    .filter((r) => !(year === 2026 && EXCLUDED_2026.has(r.location ?? "")))
    .sort((a, b) => a.date_start.localeCompare(b.date_start));

  // Total scheduled Race sessions (completed + future), excluding 2026 cancellations.
  // Used by the narrative module to compute "mathematically closed" honestly.
  const totalRacesInSeason = races.filter(
    (r) => !(year === 2026 && EXCLUDED_2026.has(r.location ?? "")),
  ).length;

  if (!completed.length) {
    return {
      result: {
        year,
        racesCompleted: 0,
        races: [],
        driverTimelines: [],
        teamTimelines: [],
        warnings: ["Nessuna gara ancora disputata in questa stagione"],
        totalRacesInSeason,
      },
      error: null,
    };
  }

  const snapshots: RaceChampionshipSnapshot[] = [];
  for (const session of completed) {
    try {
      const [drivers, teams] = await Promise.all([
        getChampionshipDrivers(session.session_key),
        getChampionshipTeams(session.session_key),
      ]);
      const baseLabel =
        session.location ?? session.country_name ?? `Round ${session.session_key}`;
      snapshots.push({
        meetingKey: session.meeting_key,
        sessionKey: session.session_key,
        raceLabel: session.isSprint ? `${baseLabel} (Sprint)` : baseLabel,
        countryName: session.country_name ?? "",
        dateStart: session.date_start,
        driverStandings: drivers,
        teamStandings: teams,
      });
    } catch (e: any) {
      // Sprints often lack standings on OpenF1: skip silently rather than
      // surfacing a noisy warning. For full Races, surface the warning.
      if (!session.isSprint) {
        warnings.push(
          `Classifica non disponibile per ${session.location ?? session.country_name ?? session.session_key}: ${e?.message ?? "errore fetch"}`,
        );
      }
    }
  }

  const result = buildChampionshipResult(year, snapshots);
  result.warnings = [...warnings, ...result.warnings];
  result.totalRacesInSeason = totalRacesInSeason;

  return { result, error: null };
}
