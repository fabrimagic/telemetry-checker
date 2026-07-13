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
   * Which method produced the cornering signal for this team. Priorità
   * (Opzione A): location_geometry > sector_typed_history > sector_typed
   * (downstream residuale) > sector_fallback.
   *  - "location_geometry":     strength per tipo dal GPS + layout (gold standard);
   *  - "sector_typed_history":  strength per tipo STIMATA a MONTE da carProfiles
   *                             pesando i settori delle gare passate via la
   *                             sector_corner_map del circuito d'ORIGINE;
   *  - "sector_typed":          STIMA a VALLE — fallback residuale quando il
   *                             car non ha corner_type_strength ma il circuito
   *                             target ha una sector_corner_map;
   *  - "sector_fallback":       media piatta dei sector_strength (legacy).
   * Surfaced so the UI/narrative can be transparent about provenance.
   */
  corner_source?:
    | "location_geometry"
    | "sector_typed_history"
    | "sector_typed"
    | "sector_fallback";
  /**
   * Aggregated /location coverage as measured by the analyzer. ALWAYS
   * propagated when the analyzer produced a measurement, including when
   * the team fell back to sector_fallback because coverage was below the
   * gate threshold (diagnostic-only). `null` when coverage could not be
   * measured at all (no analyzer / no data / analyzer error). Does NOT
   * affect the affinity score.
   */
  corner_coverage?: number | null;
  /**
   * Diagnostic-only: aggregated coverage restricted to CORNER vertices
   * (slow/medium/fast). Compare against `corner_coverage` (global) to see
   * whether corners were covered better/worse than the full track. Does
   * NOT affect the affinity score. `null` when not measurable.
   */
  corner_coverage_curve?: number | null;
  /**
   * Diagnostic gate outcome propagated verbatim from CarProfile:
   * "ok" | "below_threshold" | "not_available". Surfaced so the UI can
   * always show the user WHY the geometric branch was (or was not) used.
   */
  corner_coverage_status?: "ok" | "below_threshold" | "not_available";
  /**
   * Diagnostic-only: aggregated Procrustes alignment residual propagated
   * verbatim from CarProfile. Lower is better; ≪1 means the GPS↔layout
   * shape alignment locked. `null` when not measurable. Does NOT affect
   * the affinity score.
   */
  corner_alignment_error?: number | null;
  /**
   * Diagnostic-only: when corner_source === "sector_typed", the three per-type
   * estimates derived by weighting the car's sector_strength via the circuit's
   * sector_corner_map. null entries when the circuit weight on that type is 0.
   * Undefined for other branches. Does NOT affect the score.
   */
  corner_type_estimate?: {
    slow: number | null;
    medium: number | null;
    fast: number | null;
  } | null;
  /**
   * Diagnostic-only: confidence of the circuit's sector_corner_map. Only set
   * when corner_source === "sector_typed". Allows the UI/narrative to surface
   * "stima approssimata" badge when low.
   */
  sector_corner_map_confidence?: "high" | "medium" | "low";
  /**
   * Unified per-type values (slow/medium/fast) for UI/narrative, regardless of
   * branch. Populated when the underlying source actually has three numbers:
   *  - location_geometry / sector_typed_history → mirrors car.corner_type_strength
   *  - sector_typed                              → mirrors corner_type_estimate
   *                                                when all three are non-null
   *  - sector_fallback                           → undefined
   * DESCRIPTIVE only — never enters the score.
   */
  corner_type_values?: { slow: number; medium: number; fast: number } | null;
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
  /**
   * OPZIONE Z — override of {@link USE_CIRCUIT_SPECIFIC_MODEL}. When omitted
   * the module-level flag is used (currently false: pure persistence). Set
   * to `true` in tests / future experiments to exercise the dormant
   * circuit-specific engine.
   */
  useCircuitSpecificModel?: boolean;
}


/**
 * Half-band width (score units, 0..1) by qualitative confidence level.
 * Used for `circuitBand` only: the circuit confidence is curated/qualitative
 * and has no "effective sample" to drive a continuous formula. The team
 * component is computed continuously via {@link teamBandFromSample}.
 */
const CONFIDENCE_BAND: Record<ConfidenceLevel, number> = {
  high: 0.05,
  medium: 0.12,
  low: 0.22,
};

/**
 * OPZIONE Z — Production currently uses PURE PERSISTENCE for the score.
 *
 * The backtest with circuit_key resolution (4 validated races) showed
 * Δ = rho_model − rho_baseline = −0.166: the circuit-specific model
 * predicts SYSTEMATICALLY WORSE than the persistence baseline. Until a
 * future backtest demonstrates Δ ≥ 0, the production "Anteprima GP" ranks
 * teams by their overall recent strength and treats circuit character as
 * DESCRIPTIVE context only.
 *
 * The circuit-specific model is NOT deleted — it is kept as dormant
 * infrastructure behind this flag and can be reactivated (or mixed) when
 * the data justifies it. Tests covering the dormant behaviour pass
 * `{ useCircuitSpecificModel: true }` explicitly.
 */
export const USE_CIRCUIT_SPECIFIC_MODEL = false;

/**
 * Persistence score modes.
 *
 *  - "top_and_sectors" — historical formula, mean of top_speed_index and the
 *    average sector strength. Kept as a HELPER variant for monitoring /
 *    A-B comparison (the backtest still reports its rho beside the
 *    production one).
 *  - "sectors_only"    — mean(s1,s2,s3). DROPS the trap speed entirely.
 *    Motivation: top_speed_index is a normalized TRAP speed which depends
 *    on the aero setup chosen by the team, not on raw performance. A
 *    high-downforce favorite (e.g. McLaren) is penalized because its trap
 *    speed is naturally low; a low-downforce car with a weak engine
 *    (e.g. Audi) is rewarded. The 3-way backtest showed this variant
 *    predicts much better (Δ ≈ +0.209; ρ 0.841 vs 0.632; top-3 100% vs 25%).
 *
 * The helper's DEFAULT stays "top_and_sectors" for back-compat with any
 * external consumer. PRODUCTION picks the active mode explicitly via
 * {@link PRODUCTION_PERSISTENCE_MODE}.
 */
export type PersistenceMode = "top_and_sectors" | "sectors_only";

/**
 * Mode used by the production engine in {@link predictGpAffinity} and by
 * the backtest baseline that REPRESENTS production. Single source of
 * truth — change here to swap formulas.
 *
 * Currently "sectors_only": validated by the 3-way backtest as a strict
 * improvement over "top_and_sectors". The trap speed is excluded from the
 * SCORE because it is misleading (depends on aero load, not pure
 * performance) and removing it improves predictive accuracy. The trap
 * value remains available in CarProfile as descriptive context (shown in
 * "Dettagli tecnici"), it just doesn't drive the ranking.
 */
export const PRODUCTION_PERSISTENCE_MODE: PersistenceMode = "sectors_only";

/**
 * Persistence score — the SAME formula used as the baseline in gpBacktest
 * (see `computeBaselineOrder`). MUST stay in lock-step with the baseline so
 * that what the user sees in production coincides with what the backtest
 * validated as the winning policy. Higher = stronger overall.
 *
 * The optional `mode` argument is for the validation infrastructure
 * (gpBacktest 3-way comparison). The default is INVARIANT vs the previous
 * single-argument signature — no production behavior changes here.
 */
export function computePersistenceScore(
  car: {
    top_speed_index: number;
    sector_strength: { s1: number; s2: number; s3: number };
  },
  mode: PersistenceMode = "top_and_sectors",
): number {
  const sectorMean =
    (car.sector_strength.s1 + car.sector_strength.s2 + car.sector_strength.s3) / 3;
  if (mode === "sectors_only") return sectorMean;
  return (car.top_speed_index + sectorMean) / 2;
}

/**
 * Calibration constants for the team half-band as a CONTINUOUS function of
 * the effective sample size: `band = K / sqrt(max(effective, EFF_MIN))`.
 *
 * Derivation: standard error scales as 1/√n. We anchor to the legacy
 * step mapping in the typical-sample zone: at effective ≈ 4 we want
 * band ≈ 0.12 (the previous "medium" step), giving k = 0.12 × √4 = 0.24.
 * The result is clamped to [MIN, MAX] so we never promise absolute
 * certainty and never blow up with minimal samples. `sample_laps` is
 * intentionally NOT factored in: `effective_sample_races` is the principal
 * driver and already absorbs recency weighting from carProfiles.
 */
export const TEAM_BAND_K = 0.24;
export const TEAM_BAND_EFF_MIN = 1;
export const TEAM_BAND_MIN = 0.04;
export const TEAM_BAND_MAX = 0.25;

export function teamBandFromSample(effectiveSampleRaces: number): number {
  const eff = Number.isFinite(effectiveSampleRaces) && effectiveSampleRaces > 0
    ? effectiveSampleRaces
    : 0;
  const denom = Math.sqrt(Math.max(eff, TEAM_BAND_EFF_MIN));
  const raw = TEAM_BAND_K / denom;
  if (raw < TEAM_BAND_MIN) return TEAM_BAND_MIN;
  if (raw > TEAM_BAND_MAX) return TEAM_BAND_MAX;
  return raw;
}

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

    let cornerIdx: number;
    let cornerSource:
      | "location_geometry"
      | "sector_typed_history"
      | "sector_typed"
      | "sector_fallback";
    let typeEstimate: TeamGpAffinity["corner_type_estimate"] = undefined;
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
      // La corner_type_strength può arrivare dal GPS (location_geometry) o
      // dalla stima sui settori storici (sector_typed_history, Opzione A);
      // propaghiamo verbatim la sorgente dichiarata dal CarProfile.
      cornerSource =
        car.corner_source === "sector_typed_history"
          ? "sector_typed_history"
          : "location_geometry";
    } else if (circuit.sector_corner_map) {
      const map = circuit.sector_corner_map;
      const s = car.sector_strength;
      const estimate = (
        key: "slow" | "medium" | "fast",
      ): number | null => {
        const wSum = map.s1[key] + map.s2[key] + map.s3[key];
        if (wSum <= 0) return null;
        const num =
          map.s1[key] * s.s1 + map.s2[key] * s.s2 + map.s3[key] * s.s3;
        return num / wSum;
      };
      const estSlow = estimate("slow");
      const estMed = estimate("medium");
      const estFast = estimate("fast");
      typeEstimate = { slow: estSlow, medium: estMed, fast: estFast };
      const wS = circuit.slow_corner_traction;
      const wM = circuit.medium_corner;
      const wF = circuit.fast_corner;
      let num = 0;
      let den = 0;
      if (estSlow !== null) { num += wS * estSlow; den += wS; }
      if (estMed !== null)  { num += wM * estMed;  den += wM; }
      if (estFast !== null) { num += wF * estFast; den += wF; }
      if (den > 0) {
        cornerIdx = clamp01(num / den);
      } else {
        const ests = [estSlow, estMed, estFast].filter(
          (x): x is number => x !== null,
        );
        cornerIdx = clamp01(
          ests.length > 0 ? mean(ests) : mean([s.s1, s.s2, s.s3]),
        );
      }
      cornerSource = "sector_typed";
    } else {
      cornerIdx = clamp01(
        mean([car.sector_strength.s1, car.sector_strength.s2, car.sector_strength.s3]),
      );
      cornerSource = "sector_fallback";
    }

    // ----- SCORE -----
    // Default (OPZIONE Z + PRODUCTION_PERSISTENCE_MODE="sectors_only"):
    // pure persistence on sector pace only — same formula used as the
    // production baseline in gpBacktest (see computeBaselineOrder). The
    // trap-speed component (top_speed_index) is INTENTIONALLY EXCLUDED
    // from the score because the 3-way backtest showed it hurts prediction
    // (Δ ≈ +0.209 for sectors_only over top_and_sectors; ρ 0.841 vs 0.632;
    // top-3 100% vs 25%). The circuit-specific weighted sum is computed
    // but kept dormant; the corner_source data above remains populated
    // for the UI's DESCRIPTIVE context (badges, tech details, narrative)
    // but does NOT drive the ranking unless the flag is on.
    const useCircuitSpecific =
      meta?.useCircuitSpecificModel ?? USE_CIRCUIT_SPECIFIC_MODEL;
    const cTopCircuit = wTop * topIdx;
    const cCornerCircuit = wCorner * cornerIdx;
    const persistence = clamp01(
      computePersistenceScore(car, PRODUCTION_PERSISTENCE_MODE),
    );
    const score = useCircuitSpecific
      ? clamp01(cTopCircuit + cCornerCircuit)
      : persistence;
    // Contributions:
    //  - circuit-specific (dormant) mode: legacy weighted contributions
    //    that sum to the score.
    //  - persistence/sectors_only (production): trap speed is NOT part of
    //    the score → top_speed contribution is 0; the entire score comes
    //    from sector pace (mean(s1,s2,s3)). The cornering field equals
    //    the score itself, so any UI/narrative summing top+corner gets the
    //    correct total without falsely attributing weight to the trap.
    const sectorMean =
      (car.sector_strength.s1 + car.sector_strength.s2 + car.sector_strength.s3) / 3;
    const cTop = useCircuitSpecific ? cTopCircuit : 0;
    const cCorner = useCircuitSpecific ? cCornerCircuit : sectorMean;

    const carBand = teamBandFromSample(car.effective_sample_races);
    const circuitBand = CONFIDENCE_BAND[circuit.confidence];
    // Uncertainty:
    //  - useCircuitSpecific = true (dormant): the score depends on the
    //    circuit profile, so its confidence contributes to the band; we
    //    combine carBand and circuitBand in quadrature (independent errors).
    //  - useCircuitSpecific = false (PRODUCTION, pure persistence): the
    //    score does NOT use the circuit profile at all, therefore the
    //    circuit-profile confidence must NOT inflate the band. Uncertainty
    //    is the team half-band alone. This intentionally tightens bands
    //    and can shrink equivalence groups.
    const uncertainty = useCircuitSpecific
      ? Math.sqrt(carBand * carBand + circuitBand * circuitBand)
      : carBand;

    return {
      team_name: car.team_name,
      affinity_score: score,
      uncertainty,
      confidence: minConfidence(car.confidence, circuit.confidence),
      contributions: { top_speed: cTop, cornering: cCorner },
      corner_source: cornerSource,
      corner_coverage:
        car.corner_data_coverage === undefined ? null : car.corner_data_coverage,
      corner_coverage_curve:
        car.corner_coverage_curve === undefined ? null : car.corner_coverage_curve,
      corner_coverage_status: car.corner_coverage_status ?? "not_available",
      corner_alignment_error:
        car.corner_alignment_error === undefined ? null : car.corner_alignment_error,
      corner_type_estimate: typeEstimate,
      sector_corner_map_confidence:
        cornerSource === "sector_typed"
          ? circuit.sector_corner_map_confidence
          : undefined,
      corner_type_values:
        (cornerSource === "location_geometry" || cornerSource === "sector_typed_history") &&
        car.corner_type_strength
          ? {
              slow: car.corner_type_strength.slow,
              medium: car.corner_type_strength.medium,
              fast: car.corner_type_strength.fast,
            }
          : cornerSource === "sector_typed" &&
            typeEstimate &&
            typeEstimate.slow !== null &&
            typeEstimate.medium !== null &&
            typeEstimate.fast !== null
          ? {
              slow: typeEstimate.slow,
              medium: typeEstimate.medium,
              fast: typeEstimate.fast,
            }
          : undefined,
    };
  });

  // Deterministic tie-break on team name so this production ranking stays
  // bit-for-bit identical to computeBaselineOrder in gpBacktest.ts.
  ranked.sort(
    (a, b) => b.affinity_score - a.affinity_score || a.team_name.localeCompare(b.team_name),
  );

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
