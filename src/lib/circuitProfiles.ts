/**
 * Circuit characteristic profiles — Phase 1 of "Anteprima GP" prediction.
 *
 * (header docs unchanged — see git history)
 */

import { getNextSession } from "./f1Calendar2026";

export interface CornerTypeWeights {
  slow: number;
  medium: number;
  fast: number;
}

/**
 * STIMA del carattere di ciascun settore in termini di tipi di curva.
 * Additiva/opzionale: se assente, il modello usa il comportamento attuale
 * (media piatta dei sector_strength). I valori 0..1 indicano quanto il
 * settore è rappresentativo di un tipo di curva (idealmente Σ≈1 per
 * settore, non vincolante).
 */
export interface SectorCornerMap {
  s1: CornerTypeWeights;
  s2: CornerTypeWeights;
  s3: CornerTypeWeights;
}

export interface CircuitProfile {
  gpName: string;
  top_speed: number;
  slow_corner_traction: number;
  medium_corner: number;
  fast_corner: number;
  tyre_deg: number;
  overtaking_difficulty: number;
  confidence: "high" | "medium" | "low";
  source: "historical" | "layout_estimate";
  dormant?: boolean;
  /**
   * STIMA opzionale del carattere dei settori (matrice settore→tipo di
   * curva). Quando presente abilita il ramo "sector_typed" in gpPrediction.
   */
  sector_corner_map?: SectorCornerMap;
  /**
   * Confidenza della matrice sector_corner_map. Riflette la solidità delle
   * fonti pubbliche per la suddivisione per-settore di quel circuito:
   *  - "high":   classificazione ben documentata (es. Monaco, Monza);
   *  - "medium": carattere noto ma suddivisione per-settore meno netta;
   *  - "low":    stima approssimata, da dichiarare in UI.
   * Solo significativa quando sector_corner_map è presente.
   */
  sector_corner_map_confidence?: "high" | "medium" | "low";
}

export const CIRCUIT_PROFILES: Record<string, CircuitProfile> = {
  "Gran Premio d'Australia": {
    gpName: "Gran Premio d'Australia",
    top_speed: 0.70, slow_corner_traction: 0.45, medium_corner: 0.70, fast_corner: 0.80,
    tyre_deg: 0.45, overtaking_difficulty: 0.55,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.2, medium: 0.4, fast: 0.4 },
      s2: { slow: 0.2, medium: 0.3, fast: 0.5 },
      s3: { slow: 0.1, medium: 0.3, fast: 0.6 },
    },
    sector_corner_map_confidence: "medium",
  },
  "Gran Premio della Cina": {
    gpName: "Gran Premio della Cina",
    top_speed: 0.70, slow_corner_traction: 0.65, medium_corner: 0.70, fast_corner: 0.55,
    tyre_deg: 0.70, overtaking_difficulty: 0.35,
    confidence: "medium", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.5, medium: 0.3, fast: 0.2 },
      s2: { slow: 0.1, medium: 0.3, fast: 0.6 },
      s3: { slow: 0.2, medium: 0.3, fast: 0.5 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio del Giappone": {
    gpName: "Gran Premio del Giappone",
    top_speed: 0.55, slow_corner_traction: 0.40, medium_corner: 0.85, fast_corner: 1.00,
    tyre_deg: 0.75, overtaking_difficulty: 0.65,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.1, medium: 0.3, fast: 0.6 },
      s2: { slow: 0.5, medium: 0.3, fast: 0.2 },
      s3: { slow: 0.2, medium: 0.3, fast: 0.5 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio di Miami": {
    gpName: "Gran Premio di Miami",
    top_speed: 0.70, slow_corner_traction: 0.65, medium_corner: 0.60, fast_corner: 0.40,
    tyre_deg: 0.55, overtaking_difficulty: 0.45,
    confidence: "medium", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.3, medium: 0.4, fast: 0.3 },
      s2: { slow: 0.4, medium: 0.3, fast: 0.3 },
      s3: { slow: 0.5, medium: 0.3, fast: 0.2 },
    },
    sector_corner_map_confidence: "low",
  },
  "Gran Premio del Canada": {
    gpName: "Gran Premio del Canada",
    top_speed: 0.80, slow_corner_traction: 0.85, medium_corner: 0.35, fast_corner: 0.25,
    tyre_deg: 0.40, overtaking_difficulty: 0.30,
    confidence: "high", source: "historical",
    // Circuit Gilles Villeneuve — stop-and-go: hairpin Senna e L'Épingle lentissimi,
    // chicane in 2ª marcia, Wall of Champions; carattere curvo prevalentemente lento,
    // intervallato da lunghi rettilinei (top speed alto). Fonti settore-per-settore solide.
    sector_corner_map: {
      s1: { slow: 0.6, medium: 0.3, fast: 0.1 },
      s2: { slow: 0.6, medium: 0.3, fast: 0.1 },
      s3: { slow: 0.7, medium: 0.2, fast: 0.1 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio di Monaco": {
    gpName: "Gran Premio di Monaco",
    top_speed: 0.20, slow_corner_traction: 1.00, medium_corner: 0.60, fast_corner: 0.15,
    tyre_deg: 0.20, overtaking_difficulty: 1.00,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.7, medium: 0.3, fast: 0.0 },
      s2: { slow: 0.6, medium: 0.2, fast: 0.2 },
      s3: { slow: 0.8, medium: 0.2, fast: 0.0 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio di Barcellona-Catalunya": {
    gpName: "Gran Premio di Barcellona-Catalunya",
    top_speed: 0.45, slow_corner_traction: 0.50, medium_corner: 0.80, fast_corner: 0.90,
    tyre_deg: 0.80, overtaking_difficulty: 0.65,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.1, medium: 0.4, fast: 0.5 },
      s2: { slow: 0.2, medium: 0.4, fast: 0.4 },
      s3: { slow: 0.7, medium: 0.3, fast: 0.0 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio d'Austria": {
    gpName: "Gran Premio d'Austria",
    top_speed: 0.80, slow_corner_traction: 0.75, medium_corner: 0.45, fast_corner: 0.50,
    tyre_deg: 0.55, overtaking_difficulty: 0.30,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.2, medium: 0.3, fast: 0.5 },
      s2: { slow: 0.1, medium: 0.3, fast: 0.6 },
      s3: { slow: 0.1, medium: 0.4, fast: 0.5 },
    },
    sector_corner_map_confidence: "medium",
  },
  "Gran Premio di Gran Bretagna": {
    gpName: "Gran Premio di Gran Bretagna",
    top_speed: 0.55, slow_corner_traction: 0.40, medium_corner: 0.75, fast_corner: 1.00,
    tyre_deg: 0.80, overtaking_difficulty: 0.40,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.3, medium: 0.2, fast: 0.5 },
      s2: { slow: 0.0, medium: 0.2, fast: 0.8 },
      s3: { slow: 0.3, medium: 0.4, fast: 0.3 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio del Belgio": {
    gpName: "Gran Premio del Belgio",
    top_speed: 0.90, slow_corner_traction: 0.40, medium_corner: 0.55, fast_corner: 0.90,
    tyre_deg: 0.55, overtaking_difficulty: 0.30,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.1, medium: 0.3, fast: 0.6 },
      s2: { slow: 0.1, medium: 0.3, fast: 0.6 },
      s3: { slow: 0.4, medium: 0.4, fast: 0.2 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio d'Ungheria": {
    gpName: "Gran Premio d'Ungheria",
    top_speed: 0.25, slow_corner_traction: 0.80, medium_corner: 0.85, fast_corner: 0.35,
    tyre_deg: 0.55, overtaking_difficulty: 0.85,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.5, medium: 0.4, fast: 0.1 },
      s2: { slow: 0.5, medium: 0.4, fast: 0.1 },
      s3: { slow: 0.6, medium: 0.3, fast: 0.1 },
    },
    sector_corner_map_confidence: "medium",
  },
  "Gran Premio d'Olanda": {
    gpName: "Gran Premio d'Olanda",
    top_speed: 0.35, slow_corner_traction: 0.55, medium_corner: 0.75, fast_corner: 0.85,
    tyre_deg: 0.60, overtaking_difficulty: 0.85,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.2, medium: 0.4, fast: 0.4 },
      s2: { slow: 0.2, medium: 0.4, fast: 0.4 },
      s3: { slow: 0.3, medium: 0.4, fast: 0.3 },
    },
    sector_corner_map_confidence: "medium",
  },
  "Gran Premio d'Italia": {
    gpName: "Gran Premio d'Italia",
    top_speed: 1.00, slow_corner_traction: 0.45, medium_corner: 0.25, fast_corner: 0.30,
    tyre_deg: 0.40, overtaking_difficulty: 0.20,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.2, medium: 0.3, fast: 0.5 },
      s2: { slow: 0.1, medium: 0.3, fast: 0.6 },
      s3: { slow: 0.2, medium: 0.3, fast: 0.5 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio di Spagna": {
    gpName: "Gran Premio di Spagna",
    top_speed: 0.60, slow_corner_traction: 0.55, medium_corner: 0.65, fast_corner: 0.60,
    tyre_deg: 0.50, overtaking_difficulty: 0.55,
    confidence: "low", source: "layout_estimate",
  },
  "Gran Premio dell'Azerbaijan": {
    gpName: "Gran Premio dell'Azerbaijan",
    top_speed: 0.95, slow_corner_traction: 0.80, medium_corner: 0.35, fast_corner: 0.30,
    tyre_deg: 0.35, overtaking_difficulty: 0.30,
    confidence: "medium", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.5, medium: 0.2, fast: 0.3 },
      s2: { slow: 0.7, medium: 0.3, fast: 0.0 },
      s3: { slow: 0.1, medium: 0.2, fast: 0.7 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio di Singapore": {
    gpName: "Gran Premio di Singapore",
    top_speed: 0.30, slow_corner_traction: 0.90, medium_corner: 0.75, fast_corner: 0.20,
    tyre_deg: 0.55, overtaking_difficulty: 0.85,
    confidence: "medium", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.4, medium: 0.4, fast: 0.2 },
      s2: { slow: 0.6, medium: 0.3, fast: 0.1 },
      s3: { slow: 0.5, medium: 0.3, fast: 0.2 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio degli Stati Uniti": {
    gpName: "Gran Premio degli Stati Uniti",
    top_speed: 0.60, slow_corner_traction: 0.55, medium_corner: 0.75, fast_corner: 0.85,
    tyre_deg: 0.75, overtaking_difficulty: 0.40,
    confidence: "medium", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.1, medium: 0.3, fast: 0.6 },
      s2: { slow: 0.5, medium: 0.2, fast: 0.3 },
      s3: { slow: 0.7, medium: 0.3, fast: 0.0 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio del Messico": {
    gpName: "Gran Premio del Messico",
    top_speed: 0.85, slow_corner_traction: 0.65, medium_corner: 0.50, fast_corner: 0.45,
    tyre_deg: 0.35, overtaking_difficulty: 0.45,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.4, medium: 0.3, fast: 0.3 },
      s2: { slow: 0.1, medium: 0.4, fast: 0.5 },
      s3: { slow: 0.7, medium: 0.3, fast: 0.0 },
    },
    sector_corner_map_confidence: "high",
  },
  "Gran Premio del Brasile": {
    gpName: "Gran Premio del Brasile",
    top_speed: 0.70, slow_corner_traction: 0.55, medium_corner: 0.75, fast_corner: 0.70,
    tyre_deg: 0.65, overtaking_difficulty: 0.35,
    confidence: "high", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.2, medium: 0.4, fast: 0.4 },
      s2: { slow: 0.3, medium: 0.4, fast: 0.3 },
      s3: { slow: 0.3, medium: 0.4, fast: 0.3 },
    },
    sector_corner_map_confidence: "low",
  },
  "Gran Premio di Las Vegas": {
    gpName: "Gran Premio di Las Vegas",
    top_speed: 0.95, slow_corner_traction: 0.60, medium_corner: 0.40, fast_corner: 0.25,
    tyre_deg: 0.35, overtaking_difficulty: 0.35,
    confidence: "medium", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.5, medium: 0.2, fast: 0.3 },
      s2: { slow: 0.6, medium: 0.2, fast: 0.2 },
      s3: { slow: 0.4, medium: 0.2, fast: 0.4 },
    },
    sector_corner_map_confidence: "medium",
  },
  "Gran Premio del Qatar": {
    gpName: "Gran Premio del Qatar",
    top_speed: 0.50, slow_corner_traction: 0.35, medium_corner: 0.80, fast_corner: 0.95,
    tyre_deg: 0.90, overtaking_difficulty: 0.55,
    confidence: "medium", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.1, medium: 0.3, fast: 0.6 },
      s2: { slow: 0.1, medium: 0.3, fast: 0.6 },
      s3: { slow: 0.2, medium: 0.4, fast: 0.4 },
    },
    sector_corner_map_confidence: "medium",
  },
  "Gran Premio di Abu Dhabi": {
    gpName: "Gran Premio di Abu Dhabi",
    top_speed: 0.65, slow_corner_traction: 0.50, medium_corner: 0.65, fast_corner: 0.60,
    tyre_deg: 0.50, overtaking_difficulty: 0.55,
    confidence: "medium", source: "historical",
    sector_corner_map: {
      s1: { slow: 0.2, medium: 0.4, fast: 0.4 },
      s2: { slow: 0.3, medium: 0.4, fast: 0.3 },
      s3: { slow: 0.4, medium: 0.4, fast: 0.2 },
    },
    sector_corner_map_confidence: "medium",
  },
  // ============================================================
  // PROFILI DORMIENTI — non nel calendario 2026.
  // ============================================================
  "Gran Premio del Bahrain": {
    gpName: "Gran Premio del Bahrain",
    top_speed: 0.80, slow_corner_traction: 0.80, medium_corner: 0.55, fast_corner: 0.35,
    tyre_deg: 0.90, overtaking_difficulty: 0.35,
    confidence: "medium", source: "historical", dormant: true,
    sector_corner_map: {
      s1: { slow: 0.4, medium: 0.3, fast: 0.3 },
      s2: { slow: 0.5, medium: 0.3, fast: 0.2 },
      s3: { slow: 0.6, medium: 0.3, fast: 0.1 },
    },
    sector_corner_map_confidence: "low",
  },
  "Gran Premio dell'Arabia Saudita": {
    gpName: "Gran Premio dell'Arabia Saudita",
    top_speed: 0.90, slow_corner_traction: 0.30, medium_corner: 0.55, fast_corner: 0.95,
    tyre_deg: 0.45, overtaking_difficulty: 0.35,
    confidence: "medium", source: "historical", dormant: true,
    sector_corner_map: {
      s1: { slow: 0.1, medium: 0.3, fast: 0.6 },
      s2: { slow: 0.1, medium: 0.2, fast: 0.7 },
      s3: { slow: 0.2, medium: 0.3, fast: 0.5 },
    },
    sector_corner_map_confidence: "low",
  },
};

/**
 * Stable circuit identifiers from OpenF1 (verified via /meetings?year=2026 and
 * historical /meetings for dormant tracks). Maps `circuit_key` → the exact
 * `gpName` key used in CIRCUIT_PROFILES. This is the PRIMARY resolution path
 * for OpenF1 sessions; legacy location/country fallback is only used when
 * `circuit_key` is missing.
 *
 * Why circuit_key: location strings are inconsistent across the dataset
 * (e.g. "Miami Gardens" vs "Miami") and country_name is ambiguous for
 * multi-GP countries (USA: Miami/COTA/Las Vegas; Italy: Monza/Imola).
 * `circuit_key` is a stable integer per circuit — no ambiguity.
 *
 * Includes dormant circuits (Bahrain=63, Jeddah=149) so they auto-resolve
 * if they re-enter the calendar.
 */
export const CIRCUIT_KEY_TO_GP_NAME: Record<number, string> = {
  10: "Gran Premio d'Australia",
  49: "Gran Premio della Cina",
  46: "Gran Premio del Giappone",
  151: "Gran Premio di Miami",
  23: "Gran Premio del Canada",
  22: "Gran Premio di Monaco",
  15: "Gran Premio di Barcellona-Catalunya",
  19: "Gran Premio d'Austria",
  2: "Gran Premio di Gran Bretagna",
  7: "Gran Premio del Belgio",
  4: "Gran Premio d'Ungheria",
  55: "Gran Premio d'Olanda",
  39: "Gran Premio d'Italia",
  153: "Gran Premio di Spagna",
  144: "Gran Premio dell'Azerbaijan",
  61: "Gran Premio di Singapore",
  9: "Gran Premio degli Stati Uniti",
  65: "Gran Premio del Messico",
  14: "Gran Premio del Brasile",
  152: "Gran Premio di Las Vegas",
  150: "Gran Premio del Qatar",
  70: "Gran Premio di Abu Dhabi",
  // Dormant (not in 2026 calendar) — included for forward-compat.
  63: "Gran Premio del Bahrain",
  149: "Gran Premio dell'Arabia Saudita",
};

/** Resolve a calendar gpName directly from OpenF1's `circuit_key`. */
export function resolveGpNameByCircuitKey(circuitKey?: number | null): string | null {
  if (circuitKey == null || !Number.isFinite(circuitKey)) return null;
  return CIRCUIT_KEY_TO_GP_NAME[circuitKey] ?? null;
}


/** Direct lookup by gpName. Returns null when unmapped. */
export function getCircuitProfile(gpName: string): CircuitProfile | null {
  return CIRCUIT_PROFILES[gpName] ?? null;
}

/**
 * Returns the profile of the circuit hosting the next session.
 */
export function getCircuitProfileForNextGP(now: Date = new Date()): CircuitProfile | null {
  const next = getNextSession(now);
  if (!next) return null;
  return getCircuitProfile(next.session.gpName);
}
