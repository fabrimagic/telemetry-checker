/**
 * Maps each 2026 calendar GP to a circuit GeoJSON id from the
 * bacinger/f1-circuits dataset on GitHub. Used by NextCircuitCard
 * to render a layout preview of the upcoming session's track.
 */
export const GP_TO_CIRCUIT_ID: Record<string, string> = {
  "Gran Premio d'Australia": "au-1953",
  "Gran Premio della Cina": "cn-2004",
  "Gran Premio del Giappone": "jp-1962",
  "Gran Premio di Miami": "us-2022",
  "Gran Premio del Canada": "ca-1978",
  "Gran Premio di Monaco": "mc-1929",
  "Gran Premio di Barcellona-Catalunya": "es-1991",
  "Gran Premio d'Austria": "at-1969",
  "Gran Premio di Gran Bretagna": "gb-1948",
  "Gran Premio del Belgio": "be-1925",
  "Gran Premio d'Ungheria": "hu-1986",
  "Gran Premio d'Olanda": "nl-1948",
  "Gran Premio d'Italia": "it-1922",
  "Gran Premio di Spagna": "es-2026",
  "Gran Premio dell'Azerbaijan": "az-2016",
  "Gran Premio di Singapore": "sg-2008",
  "Gran Premio degli Stati Uniti": "us-2012",
  "Gran Premio del Messico": "mx-1962",
  "Gran Premio del Brasile": "br-1940",
  "Gran Premio di Las Vegas": "us-2023",
  "Gran Premio del Qatar": "qa-2004",
  "Gran Premio di Abu Dhabi": "ae-2009",
};

/**
 * Maps OpenF1 session metadata (`location`, then `country_name` as fallback)
 * to the calendar `gpName` used as the key of `GP_TO_CIRCUIT_ID`.
 *
 * RATIONALE: OpenF1 returns short circuit/city names (e.g. "Monaco",
 * "Suzuka", "Catalunya"); our calendar uses the Italian GP names
 * ("Gran Premio di Monaco", "Gran Premio del Giappone", ...). Without
 * this normalization the keys NEVER match, fetchCircuitOutline always
 * returns null, and the geometric corner analysis silently no-ops on
 * every historical race. Keep this map in sync with both
 * `GP_TO_CIRCUIT_ID` and the OpenF1 vocabulary.
 *
 * Keys are normalized to lowercase for case-insensitive lookup. Includes
 * multiple aliases per circuit (e.g. "Monaco" / "Monte Carlo") to cover
 * historical variations in the OpenF1 dataset.
 */
const OPENF1_LOCATION_TO_GP_NAME: Record<string, string> = {
  // location field
  melbourne: "Gran Premio d'Australia",
  shanghai: "Gran Premio della Cina",
  suzuka: "Gran Premio del Giappone",
  miami: "Gran Premio di Miami",
  montreal: "Gran Premio del Canada",
  monaco: "Gran Premio di Monaco",
  "monte carlo": "Gran Premio di Monaco",
  "monte-carlo": "Gran Premio di Monaco",
  catalunya: "Gran Premio di Barcellona-Catalunya",
  "barcelona-catalunya": "Gran Premio di Barcellona-Catalunya",
  barcelona: "Gran Premio di Barcellona-Catalunya",
  spielberg: "Gran Premio d'Austria",
  "red bull ring": "Gran Premio d'Austria",
  silverstone: "Gran Premio di Gran Bretagna",
  "spa-francorchamps": "Gran Premio del Belgio",
  spa: "Gran Premio del Belgio",
  budapest: "Gran Premio d'Ungheria",
  hungaroring: "Gran Premio d'Ungheria",
  zandvoort: "Gran Premio d'Olanda",
  monza: "Gran Premio d'Italia",
  madrid: "Gran Premio di Spagna",
  baku: "Gran Premio dell'Azerbaijan",
  singapore: "Gran Premio di Singapore",
  "marina bay": "Gran Premio di Singapore",
  austin: "Gran Premio degli Stati Uniti",
  cota: "Gran Premio degli Stati Uniti",
  "mexico city": "Gran Premio del Messico",
  "ciudad de méxico": "Gran Premio del Messico",
  "sao paulo": "Gran Premio del Brasile",
  "são paulo": "Gran Premio del Brasile",
  interlagos: "Gran Premio del Brasile",
  "las vegas": "Gran Premio di Las Vegas",
  lusail: "Gran Premio del Qatar",
  doha: "Gran Premio del Qatar",
  "yas marina": "Gran Premio di Abu Dhabi",
  "abu dhabi": "Gran Premio di Abu Dhabi",
  // country_name field (fallback when location is missing / ambiguous)
  australia: "Gran Premio d'Australia",
  china: "Gran Premio della Cina",
  japan: "Gran Premio del Giappone",
  "united states": "Gran Premio degli Stati Uniti",
  usa: "Gran Premio degli Stati Uniti",
  canada: "Gran Premio del Canada",
  spain: "Gran Premio di Spagna",
  austria: "Gran Premio d'Austria",
  "united kingdom": "Gran Premio di Gran Bretagna",
  "great britain": "Gran Premio di Gran Bretagna",
  uk: "Gran Premio di Gran Bretagna",
  belgium: "Gran Premio del Belgio",
  hungary: "Gran Premio d'Ungheria",
  netherlands: "Gran Premio d'Olanda",
  italy: "Gran Premio d'Italia",
  azerbaijan: "Gran Premio dell'Azerbaijan",
  mexico: "Gran Premio del Messico",
  brazil: "Gran Premio del Brasile",
  qatar: "Gran Premio del Qatar",
  "united arab emirates": "Gran Premio di Abu Dhabi",
  uae: "Gran Premio di Abu Dhabi",
};

/**
 * Resolves the calendar `gpName` (the key expected by `GP_TO_CIRCUIT_ID`)
 * from OpenF1 session metadata. Prefers `location` over `country_name`
 * because country is ambiguous on circuits that share a host country
 * (e.g. Imola vs Monza in Italy, Miami vs COTA vs Vegas in the US).
 *
 * Returns `null` when neither field resolves — caller MUST treat null as a
 * real degradation (no layout available → sector fallback), not as an
 * "unknown circuit" that should fall back to the upcoming GP layout
 * (which would mismatch the historical session's actual track).
 */
export function resolveCalendarGpName(
  location?: string | null,
  countryName?: string | null,
): string | null {
  const tryKey = (s?: string | null): string | null => {
    if (!s) return null;
    const k = s.trim().toLowerCase();
    if (!k) return null;
    return OPENF1_LOCATION_TO_GP_NAME[k] ?? null;
  };
  return tryKey(location) ?? tryKey(countryName);
}

const BASE_URL =
  "https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits";

const cache = new Map<string, Promise<[number, number][] | null>>();

/**
 * Fetches a circuit's outline as an array of [lon, lat] coordinates.
 * Returns null if no mapping is available or the fetch fails.
 */
export function fetchCircuitOutline(gpName: string): Promise<[number, number][] | null> {
  const id = GP_TO_CIRCUIT_ID[gpName];
  if (!id) return Promise.resolve(null);
  const existing = cache.get(id);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/${id}.geojson`);
      if (!res.ok) return null;
      const json = await res.json();
      const features = json?.features ?? [];
      // Pick the longest LineString — that's the racing line.
      let best: [number, number][] | null = null;
      for (const f of features) {
        const g = f?.geometry;
        if (!g) continue;
        if (g.type === "LineString" && Array.isArray(g.coordinates)) {
          if (!best || g.coordinates.length > best.length) {
            best = g.coordinates as [number, number][];
          }
        } else if (g.type === "MultiLineString" && Array.isArray(g.coordinates)) {
          for (const line of g.coordinates) {
            if (!best || line.length > best.length) {
              best = line as [number, number][];
            }
          }
        }
      }
      return best;
    } catch {
      return null;
    }
  })();

  cache.set(id, p);
  return p;
}
