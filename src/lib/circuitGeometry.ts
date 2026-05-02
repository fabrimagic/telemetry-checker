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
