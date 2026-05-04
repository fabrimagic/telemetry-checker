import type {
  ChampionshipResult,
  DriverTimeline,
  TeamTimeline,
} from "./championship";

/** Tunable thresholds (kept as named consts to ease tuning). */
const GAP_MARKED_THRESHOLD = 50;
const CONSOLIDATION_MIN_GAIN = 30;
const HOT_DRIVER_MIN_GAIN = 25;
const POSITION_MOVEMENT_MIN = 3;
const TEAMMATE_GAP_MIN = 15;
const LEADER_MIN_WINS = 2;
const HOT_TEAM_MIN_GAIN = 30;
const CLOSED_MIN_RACES = 18;
const ASSUMED_MAX_RACES_IN_SEASON = 24;
const MAX_POINTS_PER_RACE = 25;

function gainInLastN(timeline: DriverTimeline | TeamTimeline, n: number): number {
  const slice = timeline.points.slice(-n);
  return slice.reduce((s, p) => s + (p.pointsGained || 0), 0);
}

function isMathematicallyClosed(
  drivers: DriverTimeline[],
  racesCompleted: number,
): boolean {
  if (racesCompleted < CLOSED_MIN_RACES) return false;
  if (drivers.length < 2) return false;
  const racesLeft = Math.max(0, ASSUMED_MAX_RACES_IN_SEASON - racesCompleted);
  const maxPointsRemaining = racesLeft * MAX_POINTS_PER_RACE;
  const delta = drivers[0].totalPoints - drivers[1].totalPoints;
  return delta > maxPointsRemaining;
}

function countWinsAndPodiums(timeline: DriverTimeline): { wins: number; podiums: number } {
  let wins = 0;
  let podiums = 0;
  for (const p of timeline.points) {
    if (p.pointsGained === 25 || p.pointsGained === 26) wins++;
    if (p.pointsGained >= 15) podiums++;
  }
  return { wins, podiums };
}

function positionMovement(
  timeline: DriverTimeline,
  lookback = 3,
): { from: number; to: number; delta: number } | null {
  const pts = timeline.points;
  if (pts.length < lookback + 1) return null;
  const from = pts[pts.length - 1 - lookback].positionCurrent;
  const to = pts[pts.length - 1].positionCurrent;
  if (!from || !to) return null;
  return { from, to, delta: from - to }; // positive = gained positions
}

/**
 * Pure narrative generator for the Championship page.
 * NO LLM, NO randomness, NO Date access — fully deterministic.
 *
 * Sentence order (fixed):
 *  [1] Leader piloti + punti
 *  [2] Distacco sul 2°
 *  [N1=A6] Campionato chiuso
 *  [3] Leadership change / consolidamento
 *  [N2=A1] Pilota del momento
 *  [N3=A2] Sorpassi in classifica
 *  [N4=A3] Asimmetria teammates
 *  [N5=A5] Vittorie/podi del leader
 *  [4] Leader costruttori + delta
 *  [N6=A4] Trend team
 */
export function buildChampionshipNarrative(
  result: ChampionshipResult,
  driverNameMap: Map<number, string>,
  driverTeamMap?: Map<number, string>,
): string[] {
  if (!result || result.racesCompleted === 0) {
    return [`Mondiale ${result?.year ?? ""} non ancora iniziato.`.replace(/\s+/g, " ").trim()];
  }

  const sentences: string[] = [];
  const drivers = result.driverTimelines;
  const teams = result.teamTimelines;
  const races = result.racesCompleted;

  const leader = drivers[0];
  const leaderName = leader
    ? driverNameMap.get(leader.driverNumber) ?? `#${leader.driverNumber}`
    : null;

  // [1] Leader piloti + punti
  if (leader && leaderName) {
    sentences.push(
      `Mondiale ${result.year}: dopo ${races} gare in testa al Campionato Piloti c'è ${leaderName} con ${leader.totalPoints} punti.`,
    );
  } else {
    sentences.push(`Mondiale ${result.year}: dopo ${races} gare nessun pilota classificato.`);
  }

  // [2] Distacco sul 2°
  if (drivers.length >= 2) {
    const delta = drivers[0].totalPoints - drivers[1].totalPoints;
    const prefix = delta > GAP_MARKED_THRESHOLD ? "marcato: " : "";
    sentences.push(`${prefix}Il distacco sul secondo è di ${delta} punti.`);
  }

  // [N1=A6] Campionato chiuso
  if (leader && leaderName && isMathematicallyClosed(drivers, races)) {
    sentences.push(
      `Mondiale Piloti già assegnato a ${leaderName}: anche con un en-plein delle gare rimanenti, il secondo non può più raggiungerlo.`,
    );
  }

  // [3] Leadership change / consolidamento
  if (races >= 3 && leader) {
    const idx3Ago = races - 3;
    let oldLeaderNumber: number | null = null;
    for (const d of drivers) {
      const p = d.points[idx3Ago - 1];
      if (p && p.positionCurrent === 1) {
        oldLeaderNumber = d.driverNumber;
        break;
      }
    }
    if (oldLeaderNumber != null && oldLeaderNumber !== leader.driverNumber) {
      const newName = driverNameMap.get(leader.driverNumber) ?? `#${leader.driverNumber}`;
      const oldName = driverNameMap.get(oldLeaderNumber) ?? `#${oldLeaderNumber}`;
      sentences.push(`${newName} ha superato ${oldName} nelle ultime gare.`);
    } else {
      const gained = gainInLastN(leader, 3);
      if (gained >= CONSOLIDATION_MIN_GAIN) {
        sentences.push(
          `Il leader ha consolidato la sua posizione con +${gained} punti negli ultimi 3 GP.`,
        );
      }
    }
  }

  // [N2=A1] Pilota del momento
  if (races >= 4 && drivers.length >= 1) {
    let best: { driver: DriverTimeline; gain: number } | null = null;
    for (const d of drivers) {
      const gain = gainInLastN(d, 3);
      if (
        !best ||
        gain > best.gain ||
        (gain === best.gain &&
          d.currentPosition > 0 &&
          (best.driver.currentPosition === 0 || d.currentPosition < best.driver.currentPosition))
      ) {
        best = { driver: d, gain };
      }
    }
    if (
      best &&
      best.gain >= HOT_DRIVER_MIN_GAIN &&
      leader &&
      best.driver.driverNumber !== leader.driverNumber
    ) {
      const name = driverNameMap.get(best.driver.driverNumber) ?? `#${best.driver.driverNumber}`;
      sentences.push(
        `In rampa di lancio: ${name} ha collezionato ${best.gain} punti nelle ultime 3 gare, più di chiunque altro.`,
      );
    }
  }

  // [N3=A2] Sorpassi in classifica (lookback 3)
  if (races >= 4) {
    let bestMover: { driver: DriverTimeline; mv: { from: number; to: number; delta: number } } | null = null;
    for (const d of drivers) {
      const mv = positionMovement(d, 3);
      if (!mv) continue;
      if (Math.abs(mv.delta) < POSITION_MOVEMENT_MIN) continue;
      if (
        !bestMover ||
        Math.abs(mv.delta) > Math.abs(bestMover.mv.delta) ||
        (Math.abs(mv.delta) === Math.abs(bestMover.mv.delta) &&
          d.currentPosition > 0 &&
          (bestMover.driver.currentPosition === 0 || d.currentPosition < bestMover.driver.currentPosition))
      ) {
        bestMover = { driver: d, mv };
      }
    }
    if (bestMover) {
      const name =
        driverNameMap.get(bestMover.driver.driverNumber) ?? `#${bestMover.driver.driverNumber}`;
      const { from, to, delta } = bestMover.mv;
      if (delta > 0) {
        sentences.push(
          `${name} è salito di ${delta} posizioni nelle ultime gare, da P${from} a P${to}.`,
        );
      } else {
        sentences.push(
          `${name} ha perso ${Math.abs(delta)} posizioni nelle ultime gare, da P${from} a P${to}.`,
        );
      }
    }
  }

  // [N4=A3] Asimmetria teammates (solo top team)
  if (driverTeamMap && races >= 3 && teams.length >= 1) {
    const topTeam = teams[0];
    const teamDrivers = drivers.filter(
      (d) => d.currentPosition > 0 && driverTeamMap.get(d.driverNumber) === topTeam.teamName,
    );
    if (teamDrivers.length >= 2) {
      teamDrivers.sort((a, b) => b.totalPoints - a.totalPoints);
      const lead = teamDrivers[0];
      const second = teamDrivers[1];
      const delta = lead.totalPoints - second.totalPoints;
      if (delta >= TEAMMATE_GAP_MIN) {
        const leadName = driverNameMap.get(lead.driverNumber) ?? `#${lead.driverNumber}`;
        const secondName = driverNameMap.get(second.driverNumber) ?? `#${second.driverNumber}`;
        sentences.push(
          `In ${topTeam.teamName}, ${leadName} (${lead.totalPoints} pt) si stacca da ${secondName} (${second.totalPoints} pt): ${delta} punti di gap nel top team.`,
        );
      }
    }
  }

  // [N5=A5] Vittorie/podi del leader
  if (leader && leaderName) {
    const { wins, podiums } = countWinsAndPodiums(leader);
    if (wins >= LEADER_MIN_WINS) {
      sentences.push(
        `${leaderName} guida con ${wins} vittorie e ${podiums} podi su ${races} gare.`,
      );
    }
  }

  // [4] Leader costruttori + delta
  if (teams.length >= 2) {
    const t = teams[0];
    const delta = t.totalPoints - teams[1].totalPoints;
    sentences.push(
      `Tra i Costruttori, ${t.teamName} è in testa con ${t.totalPoints} punti, +${delta} sul secondo.`,
    );
  }

  // [N6=A4] Trend team
  if (races >= 4 && teams.length >= 3) {
    let bestTeam: { team: TeamTimeline; gain: number } | null = null;
    for (let i = 1; i < teams.length; i++) {
      const t = teams[i];
      const gain = gainInLastN(t, 3);
      if (!bestTeam || gain > bestTeam.gain) {
        bestTeam = { team: t, gain };
      }
    }
    if (bestTeam && bestTeam.gain >= HOT_TEAM_MIN_GAIN) {
      sentences.push(
        `Il momento è di ${bestTeam.team.teamName}: ${bestTeam.gain} punti negli ultimi 3 GP, più di chiunque tra i top team.`,
      );
    }
  }

  return sentences;
}
