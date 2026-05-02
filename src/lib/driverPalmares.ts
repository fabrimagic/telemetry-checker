/**
 * Palmares dei piloti (carriera completa).
 * Fonte: Wikipedia IT — schede infobox aggiornate al GP del Giappone 2026.
 * Indicizzato per numero di gara F1.
 */

export interface DriverPalmares {
  debutDate: string;        // Data di esordio in F1
  wins: number;             // GP vinti
  podiums: number;          // Podi
  careerPoints: number;     // Punti ottenuti in carriera
  polePositions: number;    // Pole position
  fastestLaps: number;      // Giri veloci
  worldTitles?: number;     // Titoli mondiali (opzionale)
}

export const DRIVER_PALMARES: Record<number, DriverPalmares> = {
  // Lando Norris (#4) — McLaren
  4: {
    debutDate: "17 marzo 2019",
    wins: 11,
    podiums: 44,
    careerPoints: 1455,
    polePositions: 16,
    fastestLaps: 18,
    worldTitles: 1,
  },
  // Max Verstappen (#1) — Red Bull
  1: {
    debutDate: "15 marzo 2015",
    wins: 71,
    podiums: 127,
    careerPoints: 3456.5,
    polePositions: 48,
    fastestLaps: 37,
    worldTitles: 4,
  },
  // Oscar Piastri (#81) — McLaren
  81: {
    debutDate: "5 marzo 2023",
    wins: 9,
    podiums: 27,
    careerPoints: 820,
    polePositions: 6,
    fastestLaps: 9,
  },
  // Charles Leclerc (#16) — Ferrari
  16: {
    debutDate: "25 marzo 2018",
    wins: 8,
    podiums: 52,
    careerPoints: 1721,
    polePositions: 27,
    fastestLaps: 11,
  },
  // George Russell (#63) — Mercedes
  63: {
    debutDate: "17 marzo 2019",
    wins: 6,
    podiums: 26,
    careerPoints: 1096,
    polePositions: 8,
    fastestLaps: 11,
  },
  // Lewis Hamilton (#44) — Ferrari
  44: {
    debutDate: "18 marzo 2007",
    wins: 105,
    podiums: 203,
    careerPoints: 5059.5,
    polePositions: 104,
    fastestLaps: 68,
    worldTitles: 7,
  },
  // Andrea Kimi Antonelli (#12) — Mercedes
  12: {
    debutDate: "16 marzo 2025",
    wins: 2,
    podiums: 6,
    careerPoints: 222,
    polePositions: 2,
    fastestLaps: 5,
  },
};

export function getDriverPalmares(driverNumber: number): DriverPalmares | null {
  return DRIVER_PALMARES[driverNumber] ?? null;
}
