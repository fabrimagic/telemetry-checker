/**
 * Identifies wet-weather tyre compounds (INTERMEDIATE, WET).
 * Pitwall does NOT model degradation for these compounds — dedicated
 * profiles do not exist. Use this helper to gate display of degradation
 * metrics in the UI.
 */
const WET_COMPOUNDS = new Set(["INTERMEDIATE", "INTER", "WET"]);

export function isWetCompound(compound: string | null | undefined): boolean {
  if (!compound) return false;
  return WET_COMPOUNDS.has(compound.toUpperCase().trim());
}

/** Italian caveat shown to the user when a stint uses a wet compound. */
export const WET_COMPOUND_CAVEAT_IT =
  "Degrado non modellato per pneumatici da bagnato. " +
  "Profili dedicati a INTERMEDIATE/WET non disponibili: i parametri di " +
  "filtering e cliff sono pensati per gomme da asciutto.";
