import type { RankingEntry } from "./practiceLongRunAggregator";

const ANOMALY_THRESHOLD = 3;

/**
 * Per-driver qualifying input. Provided by the caller (no fetch here).
 * The caller is responsible for selecting the right Qualifying session
 * (Quali ufficiale, NOT Sprint Qualifying).
 *
 * driverNumber matches RankingEntry.driverNumber.
 * qualifyingPosition: 1-indexed position. null if driver did not participate
 *   in qualifying (DNF, DNS, etc.) or if data is missing for that driver.
 * qualifyingTime: best lap time (Q3 if reached, else Q2, else Q1). Optional;
 *   the fingerprint logic does not require it but the UI may display it.
 */
export interface QualifyingInput {
  driverNumber: number;
  qualifyingPosition: number | null;
  qualifyingTime: number | null;
}

/**
 * Classification of the qualifying-vs-pace fingerprint for one driver.
 *
 * - OVER_QUALIFIER: qualified ≥3 positions BETTER than pace rank
 *                   (e.g. P3 quali, P9 pace → likely vulnerable in race)
 * - UNDER_QUALIFIER: qualified ≥3 positions WORSE than pace rank
 *                    (e.g. P9 quali, P3 pace → candidate to recover)
 * - ALIGNED: |delta| < 3
 * - NO_QUALI_DATA: qualifyingPosition is null
 */
export type FingerprintClassification =
  | "OVER_QUALIFIER"
  | "UNDER_QUALIFIER"
  | "ALIGNED"
  | "NO_QUALI_DATA";

export interface FingerprintEntry {
  driverNumber: number;
  acronym: string;
  paceRank: number;
  qualifyingPosition: number | null;
  positionDelta: number | null;
  classification: FingerprintClassification;
}

export interface QualifyingFingerprintResult {
  entries: FingerprintEntry[];
  qualifyingDataAvailable: boolean;
  anomaliesCount: number;
}

/**
 * Pure builder. Merges a pace ranking (from Fase 1) with qualifying input.
 * Returns one entry per RankingEntry, in the SAME ORDER (by paceRank ASC).
 */
export function buildQualifyingFingerprint(
  ranking: RankingEntry[],
  qualifyingInput: QualifyingInput[],
): QualifyingFingerprintResult {
  const qualiByDriver = new Map<number, QualifyingInput>();
  for (const q of qualifyingInput) {
    qualiByDriver.set(q.driverNumber, q);
  }

  const anyQualiAvailable = qualifyingInput.some(
    (q) => q.qualifyingPosition != null,
  );

  const entries: FingerprintEntry[] = [];
  let anomaliesCount = 0;

  for (const r of ranking) {
    const q = qualiByDriver.get(r.driverNumber);
    const qPos = q?.qualifyingPosition ?? null;

    let classification: FingerprintClassification;
    let positionDelta: number | null = null;

    if (qPos == null) {
      classification = "NO_QUALI_DATA";
    } else {
      positionDelta = qPos - r.paceRank;
      if (positionDelta <= -ANOMALY_THRESHOLD) {
        classification = "OVER_QUALIFIER";
        anomaliesCount++;
      } else if (positionDelta >= ANOMALY_THRESHOLD) {
        classification = "UNDER_QUALIFIER";
        anomaliesCount++;
      } else {
        classification = "ALIGNED";
      }
    }

    entries.push({
      driverNumber: r.driverNumber,
      acronym: r.acronym,
      paceRank: r.paceRank,
      qualifyingPosition: qPos,
      positionDelta,
      classification,
    });
  }

  return {
    entries,
    qualifyingDataAvailable: anyQualiAvailable,
    anomaliesCount,
  };
}
