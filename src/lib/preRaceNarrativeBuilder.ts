import type { PreRaceAnalysisResult } from "./practiceLongRunAggregator";
import type { QualifyingFingerprintResult } from "./qualifyingFingerprint";
import { NarrativeCollector } from "./narrative/collector";
import { renderNarrative } from "./narrative/renderer";
import type { NarrativeEvent } from "./narrative/types";

export interface PreRaceNarrativeResult {
  /** Narrative insights per section. UI decides how to render them. */
  compoundStressInsights: string[];
  watchListInsights: string[];
  qualiAnomalyInsights: string[];
  /** Total insights produced (sum of the three sections). */
  totalInsights: number;
}

/**
 * Pure narrative builder. Given the structured outputs of Fase 1+2, produces
 * narrative strings via the existing template/renderer pipeline.
 *
 * - ranking → NO narrative (handled by UI as plain table)
 * - compoundStress → 1 insight per compound (LOW sample → bucketFor returns
 *   null → renderer falls back to prerendered_text)
 * - watchList → 1 insight per entry
 * - fingerprint → 1 insight per OVER_QUALIFIER or UNDER_QUALIFIER entry only
 *
 * sessionKey drives deterministic Lever 3 template variant selection.
 */
export function buildPreRaceNarrative(
  preRaceResult: PreRaceAnalysisResult,
  fingerprint: QualifyingFingerprintResult,
  sessionKey: number,
): PreRaceNarrativeResult {
  const compoundCollector = new NarrativeCollector();
  const watchCollector = new NarrativeCollector();
  const fingerprintCollector = new NarrativeCollector();

  // ── compoundStress events ──
  for (const cs of preRaceResult.compoundStress) {
    const ev: NarrativeEvent = {
      id: `compound_stress_${cs.compound}`,
      category: "pre_race_compound_stress",
      priority: "supporting",
      target: "global",
      data: {
        compound: cs.compound,
        // Pre-formatted strings so that fillPlaceholders' generic string branch
        // emits 3-decimal values consistently (avoids JS toString quirks like
        // 0.05 → "0.05" vs "0.050").
        drivers_count: String(cs.driversCount),
        slope_median: cs.slopeMedian.toFixed(3),
        slope_iqr: cs.slopeIQR.toFixed(3),
        variability: cs.variability,
        sample_confidence: cs.sampleConfidence,
      },
      prerendered_text: `${cs.compound}: ${cs.driversCount} piloti, slope mediana ${cs.slopeMedian.toFixed(3)} s/giro`,
    };
    compoundCollector.add(ev);
  }

  // ── watchList events ──
  for (const w of preRaceResult.watchList) {
    const ev: NarrativeEvent = {
      id: `watch_${w.driverNumber}`,
      category: "pre_race_watch",
      priority: w.signal === "NEGATIVE" ? "critical" : "supporting",
      target: "global",
      data: {
        acronym: w.acronym,
        reason: w.reason,
        signal: w.signal,
      },
      prerendered_text: `${w.acronym}: ${w.reason}`,
    };
    watchCollector.add(ev);
  }

  // ── fingerprint events: only OVER and UNDER ──
  for (const fp of fingerprint.entries) {
    if (fp.classification !== "OVER_QUALIFIER" && fp.classification !== "UNDER_QUALIFIER") {
      continue;
    }
    const ev: NarrativeEvent = {
      id: `quali_anomaly_${fp.driverNumber}`,
      category: "pre_race_quali_anomaly",
      priority: "supporting",
      target: "global",
      data: {
        acronym: fp.acronym,
        // Strings → fillPlaceholders' string branch handles them as-is, no
        // toFixed surprises. Integer-only by construction.
        pace_rank: String(fp.paceRank),
        qualifying_position: String(fp.qualifyingPosition),
        position_delta_abs: String(Math.abs(fp.positionDelta!)),
        classification: fp.classification,
      },
      prerendered_text:
        fp.classification === "UNDER_QUALIFIER"
          ? `${fp.acronym} parte ${fp.qualifyingPosition}° ma è ${fp.paceRank}° in pace`
          : `${fp.acronym} parte ${fp.qualifyingPosition}° ma in pace è ${fp.paceRank}°`,
    };
    fingerprintCollector.add(ev);
  }

  const compoundRendered = renderNarrative(compoundCollector.getAll(), { session_key: sessionKey });
  const watchRendered = renderNarrative(watchCollector.getAll(), { session_key: sessionKey });
  const fingerprintRendered = renderNarrative(fingerprintCollector.getAll(), { session_key: sessionKey });

  return {
    compoundStressInsights: compoundRendered.insights,
    watchListInsights: watchRendered.insights,
    qualiAnomalyInsights: fingerprintRendered.insights,
    totalInsights:
      compoundRendered.insights.length +
      watchRendered.insights.length +
      fingerprintRendered.insights.length,
  };
}
