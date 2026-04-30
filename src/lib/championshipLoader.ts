import {
  getRaceSessionsByYear,
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
 */
export async function loadCurrentSeasonChampionship(): Promise<ChampionshipLoaderOutput> {
  const year = new Date().getFullYear();
  const warnings: string[] = [];

  let allRaces: SessionInfo[];
  try {
    allRaces = await getRaceSessionsByYear(year);
  } catch (e: any) {
    return {
      result: null,
      error: e?.message ?? "Errore caricamento calendario stagione",
    };
  }

  const now = new Date().toISOString();
  const completedRaces = allRaces
    .filter((r) => r.date_end && r.date_end < now)
    .sort((a, b) => a.date_start.localeCompare(b.date_start));

  if (!completedRaces.length) {
    return {
      result: {
        year,
        racesCompleted: 0,
        races: [],
        driverTimelines: [],
        teamTimelines: [],
        warnings: ["Nessuna gara ancora disputata in questa stagione"],
      },
      error: null,
    };
  }

  const snapshots: RaceChampionshipSnapshot[] = [];
  for (const race of completedRaces) {
    try {
      const [drivers, teams] = await Promise.all([
        getChampionshipDrivers(race.session_key),
        getChampionshipTeams(race.session_key),
      ]);
      snapshots.push({
        meetingKey: race.meeting_key,
        sessionKey: race.session_key,
        raceLabel:
          race.location ?? race.country_name ?? `Round ${race.session_key}`,
        countryName: race.country_name ?? "",
        dateStart: race.date_start,
        driverStandings: drivers,
        teamStandings: teams,
      });
    } catch (e: any) {
      warnings.push(
        `Classifica non disponibile per ${race.location ?? race.country_name ?? race.session_key}: ${e?.message ?? "errore fetch"}`,
      );
    }
  }

  const result = buildChampionshipResult(year, snapshots);
  result.warnings = [...warnings, ...result.warnings];

  return { result, error: null };
}
