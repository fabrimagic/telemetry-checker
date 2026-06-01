/**
 * Circuit characteristic profiles — Phase 1 of "Anteprima GP" prediction.
 *
 * Purely static, curated dataset. Each profile assigns 0..1 importance
 * weights to six circuit dimensions that are objectively measurable
 * (no aerodynamic-efficiency / mechanical-grip dimensions — those would
 * be circular if derived only from public data).
 *
 * Weights are INDEPENDENT (they do NOT sum to 1): each one is the
 * absolute importance of that characteristic on this specific circuit.
 *
 * NOTE on `overtaking_difficulty`: conceptually special. A high value
 * means qualifying largely decides the race, so technical car
 * characteristics matter LESS for the outcome. Phase 2+ will use this
 * to dampen the overall prediction confidence. In Phase 1 it is just
 * another weight.
 *
 * NOTE on `confidence`:
 *  - "high":   long historical sample in current layout (Monza, Spa, Silverstone, Monaco, Suzuka, Interlagos, Hungaroring, Zandvoort, Spielberg, Barcellona, Montreal, Bahrain-style staples...).
 *  - "medium": meaningful but shorter modern history (Miami, Las Vegas, COTA, Baku, Singapore, Yas Marina, Qatar/Lusail, Shanghai).
 *  - "low":    no representative history in current configuration — pure layout estimate (Madrid 2026).
 *
 * gpName keys MUST match exactly those used in src/lib/f1Calendar2026.ts.
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
 * settore, non vincolante). NON è una misura pura: un settore è una
 * miscela (es. S2 Monaco contiene tornante lento + tunnel veloce).
 */
export interface SectorCornerMap {
  s1: CornerTypeWeights;
  s2: CornerTypeWeights;
  s3: CornerTypeWeights;
}

export interface CircuitProfile {
  /** Must match exactly an F1_CALENDAR_2026 gpName. */
  gpName: string;
  /** Importance of straight-line speed / power-unit efficiency. */
  top_speed: number;
  /** Importance of traction out of slow corners. */
  slow_corner_traction: number;
  /** Importance of medium-speed corner performance. */
  medium_corner: number;
  /** Importance of high-speed corner performance. */
  fast_corner: number;
  /** Severity of tyre degradation typical of this circuit. */
  tyre_deg: number;
  /**
   * How hard it is to overtake (1 = qualifying basically decides the race).
   * Special role: in later phases a high value REDUCES the confidence of
   * the technical-match prediction, since car traits matter less when
   * track position is locked.
   */
  overtaking_difficulty: number;
  confidence: "high" | "medium" | "low";
  source: "historical" | "layout_estimate";
  /**
   * true se il circuito non è nel calendario attivo 2026 ma il profilo è pronto
   * per un eventuale recupero/stagione futura. I profili dormienti NON devono
   * comparire nel calendario e NON vengono usati da getCircuitProfileForNextGP
   * finché il GP non entra nel calendario. Assenza = false (retrocompatibile).
   */
  dormant?: boolean;
  /**
   * STIMA opzionale del carattere dei settori (matrice settore→tipo di
   * curva). Quando presente abilita il ramo "sector_typed" in
   * gpPrediction. Assente → ramo legacy sector_fallback (media piatta).
   */
  sector_corner_map?: SectorCornerMap;
}

export const CIRCUIT_PROFILES: Record<string, CircuitProfile> = {
  "Gran Premio d'Australia": {
    // Albert Park: reprofiling 2022 (chicane T9-T10 rimossa), layout più fluente/veloce.
    gpName: "Gran Premio d'Australia",
    top_speed: 0.70, slow_corner_traction: 0.45, medium_corner: 0.70, fast_corner: 0.80,
    tyre_deg: 0.45, overtaking_difficulty: 0.55,
    confidence: "high", source: "historical",
  },
  "Gran Premio della Cina": {
    gpName: "Gran Premio della Cina",
    top_speed: 0.70, slow_corner_traction: 0.65, medium_corner: 0.70, fast_corner: 0.55,
    tyre_deg: 0.70, overtaking_difficulty: 0.35,
    confidence: "medium", source: "historical",
  },
  "Gran Premio del Giappone": {
    // Suzuka: iconic high/medium-speed flowing layout, tyre stress high.
    gpName: "Gran Premio del Giappone",
    top_speed: 0.55, slow_corner_traction: 0.40, medium_corner: 0.85, fast_corner: 1.00,
    tyre_deg: 0.75, overtaking_difficulty: 0.65,
    confidence: "high", source: "historical",
  },
  "Gran Premio di Miami": {
    gpName: "Gran Premio di Miami",
    top_speed: 0.70, slow_corner_traction: 0.65, medium_corner: 0.60, fast_corner: 0.40,
    tyre_deg: 0.55, overtaking_difficulty: 0.45,
    confidence: "medium", source: "historical",
  },
  "Gran Premio del Canada": {
    // Montreal: stop-and-go, traction and braking decisive, low aero.
    gpName: "Gran Premio del Canada",
    top_speed: 0.80, slow_corner_traction: 0.85, medium_corner: 0.35, fast_corner: 0.25,
    tyre_deg: 0.40, overtaking_difficulty: 0.30,
    confidence: "high", source: "historical",
  },
  "Gran Premio di Monaco": {
    // Monaco: extreme slow-corner traction, no overtaking, very low deg.
    gpName: "Gran Premio di Monaco",
    top_speed: 0.20, slow_corner_traction: 1.00, medium_corner: 0.60, fast_corner: 0.15,
    tyre_deg: 0.20, overtaking_difficulty: 1.00,
    confidence: "high", source: "historical",
  },
  "Gran Premio di Barcellona-Catalunya": {
    // Barcelona: layout 2023 (chicane finale rimossa, T13-14 più veloci e fluenti);
    // curve veloci dominanti, classic tyre test.
    gpName: "Gran Premio di Barcellona-Catalunya",
    top_speed: 0.45, slow_corner_traction: 0.50, medium_corner: 0.80, fast_corner: 0.90,
    tyre_deg: 0.80, overtaking_difficulty: 0.65,
    confidence: "high", source: "historical",
  },
  "Gran Premio d'Austria": {
    // Spielberg: short, mostly slow corners + straights.
    gpName: "Gran Premio d'Austria",
    top_speed: 0.80, slow_corner_traction: 0.75, medium_corner: 0.45, fast_corner: 0.50,
    tyre_deg: 0.55, overtaking_difficulty: 0.30,
    confidence: "high", source: "historical",
  },
  "Gran Premio di Gran Bretagna": {
    // Silverstone: fast corners (Maggotts/Becketts/Copse), high tyre energy.
    gpName: "Gran Premio di Gran Bretagna",
    top_speed: 0.55, slow_corner_traction: 0.40, medium_corner: 0.75, fast_corner: 1.00,
    tyre_deg: 0.80, overtaking_difficulty: 0.40,
    confidence: "high", source: "historical",
  },
  "Gran Premio del Belgio": {
    // Spa: power + Eau Rouge/Pouhon high-speed sections.
    gpName: "Gran Premio del Belgio",
    top_speed: 0.90, slow_corner_traction: 0.40, medium_corner: 0.55, fast_corner: 0.90,
    tyre_deg: 0.55, overtaking_difficulty: 0.30,
    confidence: "high", source: "historical",
  },
  "Gran Premio d'Ungheria": {
    // Hungaroring: twisty, medium/slow, hard to overtake.
    gpName: "Gran Premio d'Ungheria",
    top_speed: 0.25, slow_corner_traction: 0.80, medium_corner: 0.85, fast_corner: 0.35,
    tyre_deg: 0.55, overtaking_difficulty: 0.85,
    confidence: "high", source: "historical",
  },
  "Gran Premio d'Olanda": {
    // Zandvoort: banked fast corners, narrow, low overtaking.
    gpName: "Gran Premio d'Olanda",
    top_speed: 0.35, slow_corner_traction: 0.55, medium_corner: 0.75, fast_corner: 0.85,
    tyre_deg: 0.60, overtaking_difficulty: 0.85,
    confidence: "high", source: "historical",
  },
  "Gran Premio d'Italia": {
    // Monza: top-speed temple, minimal corner weights.
    gpName: "Gran Premio d'Italia",
    top_speed: 1.00, slow_corner_traction: 0.45, medium_corner: 0.25, fast_corner: 0.30,
    tyre_deg: 0.40, overtaking_difficulty: 0.20,
    confidence: "high", source: "historical",
  },
  "Gran Premio di Spagna": {
    // Madrid (Madring) — new circuit 2026, no representative history.
    gpName: "Gran Premio di Spagna",
    top_speed: 0.60, slow_corner_traction: 0.55, medium_corner: 0.65, fast_corner: 0.60,
    tyre_deg: 0.50, overtaking_difficulty: 0.55,
    confidence: "low", source: "layout_estimate",
  },
  "Gran Premio dell'Azerbaijan": {
    // Baku: longest straight + tight street corners.
    gpName: "Gran Premio dell'Azerbaijan",
    top_speed: 0.95, slow_corner_traction: 0.80, medium_corner: 0.35, fast_corner: 0.30,
    tyre_deg: 0.35, overtaking_difficulty: 0.30,
    confidence: "medium", source: "historical",
  },
  "Gran Premio di Singapore": {
    // Marina Bay: street, slow/medium corners, brutal physically.
    gpName: "Gran Premio di Singapore",
    top_speed: 0.30, slow_corner_traction: 0.90, medium_corner: 0.75, fast_corner: 0.20,
    tyre_deg: 0.55, overtaking_difficulty: 0.85,
    confidence: "medium", source: "historical",
  },
  "Gran Premio degli Stati Uniti": {
    // COTA: mix, esses (sector 1) emphasise fast corners; bumpy → deg.
    gpName: "Gran Premio degli Stati Uniti",
    top_speed: 0.60, slow_corner_traction: 0.55, medium_corner: 0.75, fast_corner: 0.85,
    tyre_deg: 0.75, overtaking_difficulty: 0.40,
    confidence: "medium", source: "historical",
  },
  "Gran Premio del Messico": {
    // Mexico City: altitude reduces aero+PU, long straight, stadium slow section.
    gpName: "Gran Premio del Messico",
    top_speed: 0.85, slow_corner_traction: 0.65, medium_corner: 0.50, fast_corner: 0.45,
    tyre_deg: 0.35, overtaking_difficulty: 0.45,
    confidence: "high", source: "historical",
  },
  "Gran Premio del Brasile": {
    // Interlagos: short, undulating, medium/fast, decent overtaking.
    gpName: "Gran Premio del Brasile",
    top_speed: 0.70, slow_corner_traction: 0.55, medium_corner: 0.75, fast_corner: 0.70,
    tyre_deg: 0.65, overtaking_difficulty: 0.35,
    confidence: "high", source: "historical",
  },
  "Gran Premio di Las Vegas": {
    // Vegas: very long straights, cold-night low grip, tyre warmup issue.
    gpName: "Gran Premio di Las Vegas",
    top_speed: 0.95, slow_corner_traction: 0.60, medium_corner: 0.40, fast_corner: 0.25,
    tyre_deg: 0.35, overtaking_difficulty: 0.35,
    confidence: "medium", source: "historical",
  },
  "Gran Premio del Qatar": {
    // Lusail: flowing high-speed corners, very high tyre load.
    gpName: "Gran Premio del Qatar",
    top_speed: 0.50, slow_corner_traction: 0.35, medium_corner: 0.80, fast_corner: 0.95,
    tyre_deg: 0.90, overtaking_difficulty: 0.55,
    confidence: "medium", source: "historical",
  },
  "Gran Premio di Abu Dhabi": {
    // Yas Marina: post-reprofiling 2021 (chicane lente rimosse, banking aggiunto)
    // più fluente; mix di medie con qualche veloce.
    gpName: "Gran Premio di Abu Dhabi",
    top_speed: 0.65, slow_corner_traction: 0.50, medium_corner: 0.65, fast_corner: 0.60,
    tyre_deg: 0.50, overtaking_difficulty: 0.55,
    confidence: "medium", source: "historical",
  },
  // ============================================================
  // PROFILI DORMIENTI — non nel calendario 2026, pronti per recupero/2027.
  // ============================================================
  "Gran Premio del Bahrain": {
    // Bahrain International Circuit (layout standard GP, non Outer):
    // stop-and-go, trazione decisiva in uscita dalle lente, degrado termico
    // gomme tra i più alti del calendario (asfalto abrasivo), sorpassi
    // relativamente facili. DORMIENTE.
    gpName: "Gran Premio del Bahrain",
    top_speed: 0.80, slow_corner_traction: 0.80, medium_corner: 0.55, fast_corner: 0.35,
    tyre_deg: 0.90, overtaking_difficulty: 0.35,
    confidence: "medium", source: "historical", dormant: true,
  },
  "Gran Premio dell'Arabia Saudita": {
    // Jeddah Corniche: circuito cittadino più veloce della storia F1,
    // curvoni in pieno (la maggior parte delle 27 curve non richiede frenata),
    // poche curve lente, asfalto liscio low-grip, molte zone di sorpasso. DORMIENTE.
    gpName: "Gran Premio dell'Arabia Saudita",
    top_speed: 0.90, slow_corner_traction: 0.30, medium_corner: 0.55, fast_corner: 0.95,
    tyre_deg: 0.45, overtaking_difficulty: 0.35,
    confidence: "medium", source: "historical", dormant: true,
  },
};

/** Direct lookup by gpName. Returns null when unmapped. */
export function getCircuitProfile(gpName: string): CircuitProfile | null {
  return CIRCUIT_PROFILES[gpName] ?? null;
}

/**
 * Returns the profile of the circuit hosting the next session,
 * reusing getNextSession as the single source of truth for "next GP".
 */
export function getCircuitProfileForNextGP(now: Date = new Date()): CircuitProfile | null {
  const next = getNextSession(now);
  if (!next) return null;
  return getCircuitProfile(next.session.gpName);
}
