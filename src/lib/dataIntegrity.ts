import type { Lap, StintData, PitData } from "./openf1";

export type IntegrityIssue = {
  code: "MISSING_STINT" | "MISSING_PIT" | "LAP_NO_TIME" | "NO_STINTS";
  title: string;
  detail: string;
  impact: string;
};

/**
 * Detect partial-data conditions in OpenF1 responses for a single driver.
 * Pure detection: NO calculation logic is altered, NO data is invented.
 * All findings are derived deterministically from what OpenF1 returned.
 */
export function detectDataIntegrityIssues(args: {
  laps: Lap[];
  stints: StintData[];
  pits: PitData[];
  isRaceOrSprint: boolean;
}): IntegrityIssue[] {
  const { laps, stints, pits, isRaceOrSprint } = args;
  const issues: IntegrityIssue[] = [];

  // 1. No stints at all (only meaningful for race/sprint)
  if (isRaceOrSprint && stints.length === 0 && laps.length > 0) {
    issues.push({
      code: "NO_STINTS",
      title: "Stint non disponibili",
      detail: "OpenF1 non ha restituito alcuno stint per questo pilota in questa sessione.",
      impact:
        "Senza stint non è possibile attribuire un compound ai giri: degrado gomma, pace loss per stint, raccomandazione strategica del Virtual Race Engineer e cumulative deviation per stint non sono calcolabili.",
    });
  }

  // 2. Stint mancanti — gap nei stint_number o lap_start del primo stint > 1
  if (stints.length > 0) {
    const sorted = [...stints].sort((a, b) => a.stint_number - b.stint_number);
    const minStintNum = sorted[0].stint_number;
    const minLapStart = Math.min(...sorted.map((s) => s.lap_start));

    // Primo stint mancante: o stint_number non parte da 1, o lap_start del primo > 1
    if (minStintNum > 1 || minLapStart > 1) {
      const missingUntil = minLapStart - 1;
      issues.push({
        code: "MISSING_STINT",
        title: `Stint iniziale mancante (giri 1–${missingUntil})`,
        detail: `OpenF1 non ha restituito lo stint #1: i primi ${missingUntil} giri non hanno un compound associato.`,
        impact:
          "Il compound usato in partenza non è noto. Calcoli che dipendono dal compound nei primi giri (degrado, warmup gomma, classificazione long-run, raccomandazione strategica iniziale del VRE) escludono questi giri o operano con informazione incompleta.",
      });
    }

    // Gap tra stint consecutivi
    for (let i = 1; i < sorted.length; i++) {
      const expected = sorted[i - 1].stint_number + 1;
      if (sorted[i].stint_number !== expected) {
        issues.push({
          code: "MISSING_STINT",
          title: `Stint #${expected} mancante`,
          detail: `Salto tra stint #${sorted[i - 1].stint_number} e #${sorted[i].stint_number} nella risposta OpenF1.`,
          impact:
            "Il compound dello stint intermedio non è noto: degrado, pace loss e cumulative deviation per quel segmento di gara non sono calcolabili.",
        });
      }
    }
  }

  // 3. Pit stops mancanti rispetto al numero di stint
  if (isRaceOrSprint && stints.length >= 2) {
    const expectedPits = stints.length - 1;
    if (pits.length < expectedPits) {
      const missing = expectedPits - pits.length;
      issues.push({
        code: "MISSING_PIT",
        title: `${missing} pit stop non registrato/i`,
        detail: `OpenF1 ha restituito ${pits.length} pit stop ma gli stint registrati ne implicano ${expectedPits}.`,
        impact:
          "Pit loss reale, finestra di pit window e analisi di traffico in uscita box non includono lo stop mancante.",
      });
    }
  }

  // 4. Giri senza tempo registrato
  const lapsNoTime = laps.filter((l) => l.lap_duration == null).length;
  if (lapsNoTime > 0) {
    issues.push({
      code: "LAP_NO_TIME",
      title: `${lapsNoTime} giro/i senza tempo registrato`,
      detail: `OpenF1 non ha restituito lap_duration per ${lapsNoTime} giro/i di questo pilota.`,
      impact:
        "Questi giri sono esclusi dal calcolo della media stint, dal modello di degrado gomma, dal long-run detector e dal grafico tempi sul giro.",
    });
  }

  return issues;
}
