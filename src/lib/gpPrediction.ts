/**
 * GP affinity prediction — Phase 3 of "Anteprima GP".
 *
 * Pure, deterministic matching engine that crosses a CircuitProfile (static)
 * with the CarProfile[] aggregated from OpenF1, producing an affinity score
 * per team plus uncertainty bands and group-level confidence.
 *
 * DESIGN — STRADA B (two dimensions):
 *  We deliberately DO NOT map sectors (s1/s2/s3) to corner types
 *  (slow/medium/fast). Public data does not justify that mapping; any
 *  hand-picked correspondence would inject noise. Instead the affinity
 *  uses two clean dimensions:
 *    - top_speed       (circuit.top_speed × car.top_speed_index)
 *    - cornering       (aggregated corner weight × aggregated sector index)
 *
 *  tyre_deg is NOT scored (descriptive only — we cannot match car↔circuit
 *  on degradation with current data). overtaking_difficulty does NOT enter
 *  the score either: it MODULATES the global_confidence (high overtaking
 *  difficulty ⇒ technical traits matter less than track position, so we
 *  downgrade confidence by one level).
 *
 *  Uncertainty per team is propagated from BOTH car.confidence and
 *  circuit.confidence by mapping each qualitative level to a band width and
 *  combining in quadrature. Teams whose [score ± uncertainty] bands overlap
 *  are reported as "indistinguishable groups" — they cannot be ranked in a
 *  meaningful way given the data.
 */

import type { CarProfile } from "./carProfiles";
import type { CircuitProfile } from "./circuitProfiles";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface TeamGpAffinity {
  team_name: string;
  /** 0..1, 1 = maximal technical affinity with the circuit. */
  affinity_score: number;
  /** Symmetric band half-width around affinity_score. */
  uncertainty: number;
  confidence: ConfidenceLevel;
  /** How much each dimension contributed to the final score. */
  contributions: { top_speed: number; cornering: number };
  /**
   * Which method produced the cornering signal for this team:
   *  - "location_geometry": granular slow/medium/fast strength matched
   *                         against the circuit's per-corner-type weights;
   *  - "sector_fallback":   aggregated sector_strength (the legacy path).
   * Surfaced so the UI/narrative can be transparent about provenance.
   */
  corner_source?: "location_geometry" | "sector_fallback";
  /** Aggregated /location coverage when corner_source = "location_geometry". */
  corner_coverage?: number;
}

export interface GpPrediction {
  ranked: TeamGpAffinity[];
  global_confidence: ConfidenceLevel;
  /** Groups of team names whose bands overlap — not meaningfully orderable. */
  indistinguishable_groups: string[][];
  /** Declared factors NOT captured + downgrades applied. */
  notes: string[];
}

export interface GpPredictionMeta {
  /** Number of races the system actually considered (e.g. last 4). */
  racesConsidered?: number;
}


/** Map a qualitative confidence to a half-band width in score units (0..1). */
const CONFIDENCE_BAND: Record<ConfidenceLevel, number> = {
  high: 0.05,
  medium: 0.12,
  low: 0.22,
};

/**
 * Threshold above which overtaking_difficulty downgrades the global
 * confidence by one level. 0.8 matches Monaco-style street circuits where
 * qualifying largely decides the race.
 */
export const OVERTAKING_DIFFICULTY_DOWNGRADE_THRESHOLD = 0.8;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Weighted quadratic mean: Σ(wᵢ²) / Σ(wᵢ). Emphasizes the largest weights
 * (dominant corner-type character) without collapsing to max(). Returns 0
 * if the sum of weights is 0 (avoids NaN; downstream handles the fallback).
 */
function weightedQuadratic(weights: number[]): number {
  let sum = 0;
  let sumSq = 0;
  for (const w of weights) {
    sum += w;
    sumSq += w * w;
  }
  if (sum <= 0) return 0;
  return sumSq / sum;
}
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function downgrade(level: ConfidenceLevel): ConfidenceLevel {
  if (level === "high") return "medium";
  if (level === "medium") return "low";
  return "low";
}

function minConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  const order: ConfidenceLevel[] = ["low", "medium", "high"];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

function medianConfidence(cars: CarProfile[]): ConfidenceLevel {
  if (cars.length === 0) return "low";
  const rank: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };
  const vals = cars.map((c) => rank[c.confidence]).sort((a, b) => a - b);
  const mid = vals[Math.floor((vals.length - 1) / 2)];
  const inverse: ConfidenceLevel[] = ["low", "medium", "high"];
  return inverse[mid];
}

/**
 * Pure matching: crosses a CircuitProfile with an array of CarProfile and
 * returns ranked affinities, global confidence and indistinguishable groups.
 */
export function predictGpAffinity(
  circuit: CircuitProfile,
  cars: CarProfile[],
  meta?: GpPredictionMeta,
): GpPrediction {

  const notes: string[] = [];

  // Aggregated corner weight balancing the cornering dimension against
  // top_speed (wTop/wCorner). We use a WEIGHTED QUADRATIC mean
  //   Σ(wᵢ²) / Σ(wᵢ)
  // instead of a simple mean: it accentuates the dominant corner-type
  // character of the circuit (e.g. Monaco slow=1.00, medium=0.60, fast=0.15
  // → 0.79 vs simple-mean 0.58) without the extremism of a max(), and
  // collapses to the simple mean when all three weights are equal.
  // Handles Σ=0 by returning 0 (the downstream 50/50 fallback applies).
  const cornerWeight = weightedQuadratic([
    circuit.slow_corner_traction,
    circuit.medium_corner,
    circuit.fast_corner,
  ]);
  const topWeight = circuit.top_speed;

  const totalW = topWeight + cornerWeight;
  // Edge: if the circuit profile has zero weight on both dimensions, fall
  // back to a neutral 50/50 split so the score stays defined.
  const wTop = totalW > 0 ? topWeight / totalW : 0.5;
  const wCorner = totalW > 0 ? cornerWeight / totalW : 0.5;

  if (circuit.source === "layout_estimate") {
    notes.push("Circuito stimato dal solo layout (confidenza ridotta)");
  }

  if (cars.length === 0) {
    return {
      ranked: [],
      global_confidence: "low",
      indistinguishable_groups: [],
      notes: [
        ...notes,
        "Nessun profilo-vettura disponibile: previsione non calcolabile",
      ],
    };
  }

  const ranked: TeamGpAffinity[] = cars.map((car) => {
    const topIdx = clamp01(car.top_speed_index);

    // HYBRID cornering signal:
    //  - If the car has a per-corner-type strength (location_geometry path),
    //    weight slow/medium/fast by the circuit's slow/medium/fast weights.
    //    This is the FIRST place where slow_corner_traction/medium_corner/
    //    fast_corner enter the score (previously descriptive only).
    //  - Otherwise fall back to the legacy sector-mean estimate, which does
    //    NOT depend on spatial alignment.
    let cornerIdx: number;
    let cornerSource: "location_geometry" | "sector_fallback";
    if (car.corner_type_strength) {
      const wS = circuit.slow_corner_traction;
      const wM = circuit.medium_corner;
      const wF = circuit.fast_corner;
      const sumW = wS + wM + wF;
      if (sumW > 0) {
        cornerIdx = clamp01(
          (wS * car.corner_type_strength.slow +
            wM * car.corner_type_strength.medium +
            wF * car.corner_type_strength.fast) /
            sumW,
        );
      } else {
        cornerIdx = clamp01(
          mean([
            car.corner_type_strength.slow,
            car.corner_type_strength.medium,
            car.corner_type_strength.fast,
          ]),
        );
      }
      cornerSource = "location_geometry";
    } else {
      cornerIdx = clamp01(
        mean([car.sector_strength.s1, car.sector_strength.s2, car.sector_strength.s3]),
      );
      cornerSource = "sector_fallback";
    }

    const cTop = wTop * topIdx;
    const cCorner = wCorner * cornerIdx;
    const score = clamp01(cTop + cCorner);

    const carBand = CONFIDENCE_BAND[car.confidence];
    const circuitBand = CONFIDENCE_BAND[circuit.confidence];
    // Combine the two independent uncertainty sources in quadrature.
    const uncertainty = Math.sqrt(carBand * carBand + circuitBand * circuitBand);

    return {
      team_name: car.team_name,
      affinity_score: score,
      uncertainty,
      confidence: minConfidence(car.confidence, circuit.confidence),
      contributions: { top_speed: cTop, cornering: cCorner },
      corner_source: cornerSource,
      corner_coverage:
        cornerSource === "location_geometry" ? car.corner_data_coverage : undefined,
    };
  });

  ranked.sort((a, b) => b.affinity_score - a.affinity_score);

  // Global confidence: min between circuit and median car confidence, then
  // downgraded if overtaking_difficulty exceeds the documented threshold.
  let globalConfidence = minConfidence(circuit.confidence, medianConfidence(cars));
  if (circuit.overtaking_difficulty >= OVERTAKING_DIFFICULTY_DOWNGRADE_THRESHOLD) {
    globalConfidence = downgrade(globalConfidence);
    notes.push(
      "Sorpasso molto difficile: le caratteristiche tecniche pesano meno del track position",
    );
  }

  // Indistinguishable groups: walk sorted list; merge into the current group
  // while the next team's band overlaps with ANY band already in the group.
  const groups: string[][] = [];
  let current: TeamGpAffinity[] = [];
  for (const t of ranked) {
    if (current.length === 0) {
      current.push(t);
      continue;
    }
    const overlapsGroup = current.some(
      (g) => Math.abs(g.affinity_score - t.affinity_score) <= g.uncertainty + t.uncertainty,
    );
    if (overlapsGroup) {
      current.push(t);
    } else {
      if (current.length > 1) groups.push(current.map((x) => x.team_name));
      current = [t];
    }
  }
  if (current.length > 1) groups.push(current.map((x) => x.team_name));

  // Generic caveat for the regulation context — always declared.
  const withData = cars.reduce((m, c) => Math.max(m, c.sample_races), 0);
  const considered = meta?.racesConsidered;
  if (typeof considered === "number" && considered > 0 && withData < considered) {
    notes.push(
      `Profili vettura basati sui dati disponibili di ${withData} delle ultime ${considered} gare (regolamento 2026 ancora recente).`,
    );
    notes.push(
      "Per alcune delle gare considerate i dati di telemetria/settore non erano ancora disponibili.",
    );
  } else {
    const n = typeof considered === "number" && considered > 0 ? considered : withData;
    notes.push(
      `Profili vettura basati sui dati disponibili di ${n} gare (regolamento 2026 ancora recente).`,
    );
  }

  // Geometry-source transparency: when at least one team's cornering signal
  // comes from /location + circuit GeoJSON (location_geometry), declare it
  // honestly so the UI/narrative can surface the caveat about possible
  // spatial-alignment imperfections.
  const geomTeams = ranked.filter((t) => t.corner_source === "location_geometry");
  if (geomTeams.length > 0) {
    notes.push(
      `Per ${geomTeams.length === 1 ? "un team" : `${geomTeams.length} team`} la tenuta in curva è ricostruita dalla geometria del tracciato e dalla posizione GPS delle vetture in qualifica (dimensione sperimentale): può contenere imprecisioni di allineamento.`,
    );
  }
  const fallbackTeams = ranked.filter((t) => t.corner_source === "sector_fallback");
  if (fallbackTeams.length > 0 && geomTeams.length > 0) {
    notes.push(
      `Per gli altri team la tenuta in curva è stimata dai tempi di settore (metodo aggregato, non per tipo di curva).`,
    );
  }




  return {
    ranked,
    global_confidence: globalConfidence,
    indistinguishable_groups: groups,
    notes,
  };
}
