import type { ChampionshipResult } from "./championship";

/**
 * Pure narrative generator for the Championship page.
 * NO LLM, NO randomness, NO Date access — fully deterministic.
 */
export function buildChampionshipNarrative(
  result: ChampionshipResult,
  driverNameMap: Map<number, string>,
): string[] {
  if (!result || result.racesCompleted === 0) {
    return [`Mondiale ${result?.year ?? ""} non ancora iniziato.`.replace(/\s+/g, " ").trim()];
  }

  const sentences: string[] = [];
  const drivers = result.driverTimelines;
  const teams = result.teamTimelines;

  // Sentence 1 — always
  if (drivers.length >= 1) {
    const leader = drivers[0];
    const leaderName =
      driverNameMap.get(leader.driverNumber) ?? `#${leader.driverNumber}`;
    sentences.push(
      `Mondiale ${result.year}: dopo ${result.racesCompleted} gare in testa al Campionato Piloti c'è ${leaderName} con ${leader.totalPoints} punti.`,
    );
  } else {
    sentences.push(`Mondiale ${result.year}: dopo ${result.racesCompleted} gare nessun pilota classificato.`);
  }

  // Sentence 2 — gap leader vs second
  if (drivers.length >= 2) {
    const delta = drivers[0].totalPoints - drivers[1].totalPoints;
    const prefix = delta > 50 ? "marcato: " : "";
    sentences.push(`${prefix}Il distacco sul secondo è di ${delta} punti.`);
  }

  // Sentence 3 — leadership change or consolidation in last 3 races
  if (result.racesCompleted >= 3 && drivers.length >= 1) {
    const currentLeader = drivers[0];
    const idx3Ago = result.racesCompleted - 3; // index in points[] BEFORE last 3 races
    // Find who was leader 3 races ago (position 1 in any timeline at that race index)
    let oldLeaderNumber: number | null = null;
    for (const d of drivers) {
      const p = d.points[idx3Ago - 1]; // points[idx-1] = state after race (racesCompleted-3)
      if (p && p.positionCurrent === 1) {
        oldLeaderNumber = d.driverNumber;
        break;
      }
    }
    if (oldLeaderNumber != null && oldLeaderNumber !== currentLeader.driverNumber) {
      const newName =
        driverNameMap.get(currentLeader.driverNumber) ?? `#${currentLeader.driverNumber}`;
      const oldName = driverNameMap.get(oldLeaderNumber) ?? `#${oldLeaderNumber}`;
      sentences.push(`${newName} ha superato ${oldName} nelle ultime gare.`);
    } else {
      const last3 = currentLeader.points.slice(-3);
      const gained = last3.reduce((s, p) => s + (p.pointsGained || 0), 0);
      if (gained >= 30) {
        sentences.push(
          `Il leader ha consolidato la sua posizione con +${gained} punti negli ultimi 3 GP.`,
        );
      }
    }
  }

  // Sentence 4 — constructors
  if (teams.length >= 2) {
    const t = teams[0];
    const delta = t.totalPoints - teams[1].totalPoints;
    sentences.push(
      `Tra i Costruttori, ${t.teamName} è in testa con ${t.totalPoints} punti, +${delta} sul secondo.`,
    );
  }

  return sentences;
}
