import type {
  ChampionshipDriverStanding,
  ChampionshipTeamStanding,
} from "./openf1";

/** Race metadata enriched with championship snapshots for that race. */
export interface RaceChampionshipSnapshot {
  meetingKey: number;
  sessionKey: number;
  /** Used for chronological ordering and labeling. */
  raceLabel: string;
  countryName: string;
  dateStart: string;
  /** Driver standings AFTER this race (position_current). */
  driverStandings: ChampionshipDriverStanding[];
  /** Team standings AFTER this race. */
  teamStandings: ChampionshipTeamStanding[];
}

/** Single point on the timeline for one driver/team. */
export interface TimelinePoint {
  /** Race index (1-based, chronological). */
  raceIndex: number;
  raceLabel: string;
  pointsCurrent: number;
  positionCurrent: number;
  /** Delta points from previous race. 0 for first race or no-show. */
  pointsGained: number;
}

export interface DriverTimeline {
  driverNumber: number;
  totalPoints: number;
  currentPosition: number;
  /** negative = gained positions, positive = lost. 0 if first race or unknown. */
  positionDeltaVsPrevRace: number;
  points: TimelinePoint[];
}

export interface TeamTimeline {
  teamName: string;
  totalPoints: number;
  currentPosition: number;
  positionDeltaVsPrevRace: number;
  points: TimelinePoint[];
}

export interface ChampionshipResult {
  year: number;
  racesCompleted: number;
  races: RaceChampionshipSnapshot[];
  driverTimelines: DriverTimeline[];
  teamTimelines: TeamTimeline[];
  warnings: string[];
  /** Total Race sessions scheduled in the season (completed + future).
   *  Optional for backward compat: if undefined, narrative module falls back
   *  to a permissive default (no "matematicamente chiuso" claim). */
  totalRacesInSeason?: number;
}

/**
 * Pure aggregator. Given the per-race snapshots already fetched, produces the
 * complete timeline structures for both drivers' and teams' championships.
 *
 * Pre-conditions:
 *  - snapshots is in chronological order (caller responsibility)
 *  - each snapshot has consistent driverStandings/teamStandings
 *
 * Determinism: same inputs → identical output.
 */
export function buildChampionshipResult(
  year: number,
  snapshots: RaceChampionshipSnapshot[],
): ChampionshipResult {
  if (!snapshots.length) {
    return {
      year,
      racesCompleted: 0,
      races: [],
      driverTimelines: [],
      teamTimelines: [],
      warnings: ["Nessuna gara disputata"],
    };
  }

  const allDriverNumbers = new Set<number>();
  const allTeamNames = new Set<string>();
  for (const s of snapshots) {
    for (const d of s.driverStandings) allDriverNumbers.add(d.driver_number);
    for (const t of s.teamStandings) allTeamNames.add(t.team_name);
  }

  const driverTimelines: DriverTimeline[] = [];
  for (const driverNumber of allDriverNumbers) {
    const points: TimelinePoint[] = [];
    let prevPoints = 0;
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const standing = snap.driverStandings.find(
        (d) => d.driver_number === driverNumber,
      );
      if (standing) {
        points.push({
          raceIndex: i + 1,
          raceLabel: snap.raceLabel,
          pointsCurrent: standing.points_current,
          positionCurrent: standing.position_current,
          pointsGained: standing.points_current - prevPoints,
        });
        prevPoints = standing.points_current;
      } else {
        points.push({
          raceIndex: i + 1,
          raceLabel: snap.raceLabel,
          pointsCurrent: prevPoints,
          positionCurrent: 0,
          pointsGained: 0,
        });
      }
    }
    const last = points[points.length - 1];
    const prevLast = points[points.length - 2];
    const positionDelta =
      prevLast && prevLast.positionCurrent && last.positionCurrent
        ? last.positionCurrent - prevLast.positionCurrent
        : 0;
    driverTimelines.push({
      driverNumber,
      totalPoints: last.pointsCurrent,
      currentPosition: last.positionCurrent,
      positionDeltaVsPrevRace: positionDelta,
      points,
    });
  }

  // Sort primarily by points (the actual championship criterion).
  // OpenF1 sometimes returns position_current=null for top entries after a
  // sprint snapshot; relying on it would mis-rank the leaders.
  // position_current is used only as a tiebreaker when points are equal.
  driverTimelines.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    const ap = a.currentPosition || Number.POSITIVE_INFINITY;
    const bp = b.currentPosition || Number.POSITIVE_INFINITY;
    return ap - bp;
  });

  const teamTimelines: TeamTimeline[] = [];
  for (const teamName of allTeamNames) {
    const points: TimelinePoint[] = [];
    let prevPoints = 0;
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const standing = snap.teamStandings.find((t) => t.team_name === teamName);
      if (standing) {
        points.push({
          raceIndex: i + 1,
          raceLabel: snap.raceLabel,
          pointsCurrent: standing.points_current,
          positionCurrent: standing.position_current,
          pointsGained: standing.points_current - prevPoints,
        });
        prevPoints = standing.points_current;
      } else {
        points.push({
          raceIndex: i + 1,
          raceLabel: snap.raceLabel,
          pointsCurrent: prevPoints,
          positionCurrent: 0,
          pointsGained: 0,
        });
      }
    }
    const last = points[points.length - 1];
    const prevLast = points[points.length - 2];
    const positionDelta =
      prevLast && prevLast.positionCurrent && last.positionCurrent
        ? last.positionCurrent - prevLast.positionCurrent
        : 0;
    teamTimelines.push({
      teamName,
      totalPoints: last.pointsCurrent,
      currentPosition: last.positionCurrent,
      positionDeltaVsPrevRace: positionDelta,
      points,
    });
  }

  teamTimelines.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    const ap = a.currentPosition || Number.POSITIVE_INFINITY;
    const bp = b.currentPosition || Number.POSITIVE_INFINITY;
    return ap - bp;
  });

  return {
    year,
    racesCompleted: snapshots.length,
    races: snapshots,
    driverTimelines,
    teamTimelines,
    warnings: [],
  };
}
