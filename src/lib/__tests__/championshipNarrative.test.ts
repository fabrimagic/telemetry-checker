import { describe, it, expect } from "vitest";
import { buildChampionshipNarrative } from "../championshipNarrative";
import type {
  ChampionshipResult,
  DriverTimeline,
  TeamTimeline,
  TimelinePoint,
} from "../championship";

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

/** Build a driver timeline from per-race pointsGained + per-race position. */
function mkDriver(
  driverNumber: number,
  perRace: Array<{ gained: number; pos: number }>,
): DriverTimeline {
  let cum = 0;
  const points: TimelinePoint[] = perRace.map((r, i) => {
    cum += r.gained;
    return {
      raceIndex: i + 1,
      raceLabel: `R${i + 1}`,
      pointsCurrent: cum,
      positionCurrent: r.pos,
      pointsGained: r.gained,
    };
  });
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  return {
    driverNumber,
    totalPoints: last.pointsCurrent,
    currentPosition: last.positionCurrent,
    positionDeltaVsPrevRace:
      prev && prev.positionCurrent && last.positionCurrent
        ? last.positionCurrent - prev.positionCurrent
        : 0,
    points,
  };
}

function mkTeam(
  teamName: string,
  perRace: Array<{ gained: number; pos: number }>,
): TeamTimeline {
  let cum = 0;
  const points: TimelinePoint[] = perRace.map((r, i) => {
    cum += r.gained;
    return {
      raceIndex: i + 1,
      raceLabel: `R${i + 1}`,
      pointsCurrent: cum,
      positionCurrent: r.pos,
      pointsGained: r.gained,
    };
  });
  const last = points[points.length - 1];
  return {
    teamName,
    totalPoints: last.pointsCurrent,
    currentPosition: last.positionCurrent,
    positionDeltaVsPrevRace: 0,
    points,
  };
}

function mkResult(
  year: number,
  drivers: DriverTimeline[],
  teams: TeamTimeline[] = [],
): ChampionshipResult {
  const races = drivers[0]?.points.length ?? 0;
  return {
    year,
    racesCompleted: races,
    races: [],
    driverTimelines: drivers,
    teamTimelines: teams,
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

  it("4. A6: campionato chiuso, 20 gare, leader +200 sul secondo → 'già assegnato'", () => {
    // 20 races, leader scores 25 each = 500. Second scores 15 each = 300. Gap = 200.
    // Races left = 24-20=4, max remaining = 100. 200 > 100 → closed.
    const leader = mkDriver(1, Array.from({ length: 20 }, () => ({ gained: 25, pos: 1 })));
    const second = mkDriver(44, Array.from({ length: 20 }, () => ({ gained: 15, pos: 2 })));
    const result = mkResult(2026, [leader, second]);
    const map = new Map([[1, "BIG. CHAMP"], [44, "RUNNER. UP"]]);
    const out = buildChampionshipNarrative(result, map);
    expect(out.some((s) => s.includes("già assegnato"))).toBe(true);
    expect(out.some((s) => s.includes("BIG. CHAMP"))).toBe(true);
  });

  it("5. A1: pilota del momento (non leader) ha +50 negli ultimi 3 → 'rampa di lancio'; skip se è il leader", () => {
    // Leader has 200 total, modest recent gains.
    const leader = mkDriver(1, [
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 50, pos: 1 }, // +50 from sprints → wait keep <= 25
    ].map((r) => ({ gained: Math.min(r.gained, 25), pos: r.pos })).concat([
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
    ]));
    // Hot driver: 0,0,18,18,18 → last3=54
    const hot = mkDriver(99, [
      { gained: 0, pos: 8 },
      { gained: 0, pos: 8 },
      { gained: 18, pos: 5 },
      { gained: 18, pos: 4 },
      { gained: 18, pos: 3 },
    ]);
    const filler = mkDriver(44, [
      { gained: 10, pos: 2 },
      { gained: 10, pos: 2 },
      { gained: 5, pos: 2 },
      { gained: 5, pos: 2 },
      { gained: 5, pos: 2 },
    ]);
    const result = mkResult(2026, [leader, filler, hot]);
    const map = new Map([[1, "LEADER"], [44, "MID"], [99, "HOT. PILOT"]]);
    const out = buildChampionshipNarrative(result, map);
    expect(out.some((s) => s.includes("rampa di lancio") && s.includes("HOT. PILOT"))).toBe(true);

    // Now make leader the hottest: should NOT emit "rampa di lancio"
    const leader2 = mkDriver(1, [
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
    ]);
    const cold = mkDriver(44, [
      { gained: 5, pos: 2 },
      { gained: 5, pos: 2 },
      { gained: 5, pos: 2 },
      { gained: 5, pos: 2 },
      { gained: 5, pos: 2 },
    ]);
    const out2 = buildChampionshipNarrative(mkResult(2026, [leader2, cold]), map);
    expect(out2.some((s) => s.includes("rampa di lancio"))).toBe(false);
  });

  it("6. A2: pilota sale da P15 a P11 in 3 gare → 'salito di 4 posizioni'", () => {
    const leader = mkDriver(1, [
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
    ]);
    const climber = mkDriver(77, [
      { gained: 0, pos: 15 },
      { gained: 0, pos: 15 },
      { gained: 2, pos: 14 },
      { gained: 4, pos: 13 },
      { gained: 6, pos: 11 },
    ]);
    const result = mkResult(2026, [leader, climber]);
    const map = new Map([[1, "LEADER"], [77, "V. BOTTAS"]]);
    const out = buildChampionshipNarrative(result, map);
    expect(
      out.some(
        (s) => s.includes("V. BOTTAS") && s.includes("salito di 4") && s.includes("P15") && s.includes("P11"),
      ),
    ).toBe(true);
  });

  it("7. A3: top team con 2 piloti separati di 25 pt → 'si stacca'; non appare senza driverTeamMap", () => {
    const a = mkDriver(1, [
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
    ]);
    // teammate: 100 pt total → 25 gap
    const b = mkDriver(2, [
      { gained: 20, pos: 2 },
      { gained: 20, pos: 2 },
      { gained: 20, pos: 2 },
      { gained: 20, pos: 2 },
      { gained: 20, pos: 2 },
    ]);
    const teams = [
      mkTeam("Red Bull", [
        { gained: 45, pos: 1 },
        { gained: 45, pos: 1 },
        { gained: 45, pos: 1 },
        { gained: 45, pos: 1 },
        { gained: 45, pos: 1 },
      ]),
      mkTeam("Ferrari", [
        { gained: 20, pos: 2 },
        { gained: 20, pos: 2 },
        { gained: 20, pos: 2 },
        { gained: 20, pos: 2 },
        { gained: 20, pos: 2 },
      ]),
    ];
    const result = mkResult(2026, [a, b], teams);
    const nameMap = new Map([[1, "M. VERSTAPPEN"], [2, "S. PEREZ"]]);
    const teamMap = new Map([[1, "Red Bull"], [2, "Red Bull"]]);
    const out = buildChampionshipNarrative(result, nameMap, teamMap);
    expect(
      out.some(
        (s) =>
          s.includes("Red Bull") &&
          s.includes("si stacca") &&
          s.includes("M. VERSTAPPEN") &&
          s.includes("S. PEREZ"),
      ),
    ).toBe(true);

    // Without driverTeamMap: skip silently
    const out2 = buildChampionshipNarrative(result, nameMap);
    expect(out2.some((s) => s.includes("si stacca"))).toBe(false);
  });

  it("8. A5: leader con 4 vittorie e 5 podi → 'guida con 4 vittorie e 5 podi'", () => {
    const leader = mkDriver(1, [
      { gained: 25, pos: 1 }, // win + podium
      { gained: 25, pos: 1 }, // win + podium
      { gained: 25, pos: 1 }, // win + podium
      { gained: 25, pos: 1 }, // win + podium
      { gained: 18, pos: 1 }, // podium only
    ]);
    const result = mkResult(2026, [leader]);
    const map = new Map([[1, "L. HAMILTON"]]);
    const out = buildChampionshipNarrative(result, map);
    expect(out.some((s) => s.includes("L. HAMILTON") && s.includes("4 vittorie") && s.includes("5 podi"))).toBe(true);
  });

  it("9. A4: team minore (non leader costruttori) con 80 pt ultimi 3 GP → 'momento è di'", () => {
    const drv = mkDriver(1, [
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
      { gained: 25, pos: 1 },
    ]);
    const teams = [
      // Leader team: dominant total but weak in last 3 (20 in last 3)
      mkTeam("McLaren", [
        { gained: 80, pos: 1 },
        { gained: 80, pos: 1 },
        { gained: 5, pos: 1 },
        { gained: 5, pos: 1 },
        { gained: 10, pos: 1 },
      ]),
      // Hot team: 80 pts in last 3
      mkTeam("Mercedes", [
        { gained: 5, pos: 3 },
        { gained: 5, pos: 3 },
        { gained: 30, pos: 2 },
        { gained: 25, pos: 2 },
        { gained: 25, pos: 2 },
      ]),
      mkTeam("Ferrari", [
        { gained: 10, pos: 2 },
        { gained: 10, pos: 2 },
        { gained: 10, pos: 2 },
        { gained: 10, pos: 2 },
        { gained: 10, pos: 2 },
      ]),
    ];
    const result = mkResult(2026, [drv], teams);
    const map = new Map([[1, "LEADER"]]);
    const out = buildChampionshipNarrative(result, map);
    expect(out.some((s) => s.includes("momento è di") && s.includes("Mercedes") && s.includes("80"))).toBe(true);
  });
});
