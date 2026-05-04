import { describe, it, expect } from "vitest";
import { buildChampionshipNarrative } from "../championshipNarrative";
import type { ChampionshipResult } from "../championship";

function emptyResult(year: number): ChampionshipResult {
  return {
    year,
    racesCompleted: 0,
    races: [],
    driverTimelines: [],
    teamTimelines: [],
    warnings: [],
  };
}

describe("buildChampionshipNarrative", () => {
  it("1. racesCompleted=0 → frase 'non ancora iniziato'", () => {
    const out = buildChampionshipNarrative(emptyResult(2026), new Map());
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("non ancora iniziato");
    expect(out[0]).toContain("2026");
  });

  it("2. 1 gara, 1 pilota, 0 team → solo frase base", () => {
    const result: ChampionshipResult = {
      year: 2026,
      racesCompleted: 1,
      races: [],
      driverTimelines: [
        {
          driverNumber: 1,
          totalPoints: 25,
          currentPosition: 1,
          positionDeltaVsPrevRace: 0,
          points: [{ raceIndex: 1, raceLabel: "AUS", pointsCurrent: 25, positionCurrent: 1, pointsGained: 25 }],
        },
      ],
      teamTimelines: [],
      warnings: [],
    };
    const map = new Map([[1, "M. VERSTAPPEN"]]);
    const out = buildChampionshipNarrative(result, map);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("M. VERSTAPPEN");
    expect(out[0]).toContain("25 punti");
  });

  it("3. 5 gare, leader stabile +35 negli ultimi 3 → contiene 'consolidato'", () => {
    const points = [
      { raceIndex: 1, raceLabel: "R1", pointsCurrent: 25, positionCurrent: 1, pointsGained: 25 },
      { raceIndex: 2, raceLabel: "R2", pointsCurrent: 50, positionCurrent: 1, pointsGained: 25 },
      { raceIndex: 3, raceLabel: "R3", pointsCurrent: 60, positionCurrent: 1, pointsGained: 10 },
      { raceIndex: 4, raceLabel: "R4", pointsCurrent: 75, positionCurrent: 1, pointsGained: 15 },
      { raceIndex: 5, raceLabel: "R5", pointsCurrent: 85, positionCurrent: 1, pointsGained: 10 },
    ];
    // last 3 gained = 10 + 15 + 10 = 35
    const result: ChampionshipResult = {
      year: 2026,
      racesCompleted: 5,
      races: [],
      driverTimelines: [
        {
          driverNumber: 1,
          totalPoints: 85,
          currentPosition: 1,
          positionDeltaVsPrevRace: 0,
          points,
        },
        {
          driverNumber: 44,
          totalPoints: 40,
          currentPosition: 2,
          positionDeltaVsPrevRace: 0,
          points: points.map((p) => ({ ...p, pointsCurrent: Math.floor(p.pointsCurrent / 2), positionCurrent: 2 })),
        },
      ],
      teamTimelines: [],
      warnings: [],
    };
    const map = new Map([[1, "LEADER"], [44, "SECOND"]]);
    const out = buildChampionshipNarrative(result, map);
    const joined = out.join(" | ");
    expect(joined).toContain("consolidato");
    expect(joined).toContain("+35");
  });
});
