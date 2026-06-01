/**
 * Lap precipitation outlook — purely informative/UI feature.
 *
 * IMPORTANT: this module is presentational only. Its output MUST NEVER be fed
 * into any strategic computation (computeVirtualRaceEngineer, simulateStrategyCost,
 * soft sensors, degradation models, alternative strategies, scoring, …).
 * It is rendered next to the per-lap WeatherCard and that is its only purpose.
 *
 * Data source: Open-Meteo Historical Forecast API (https://open-meteo.com/).
 * - Free for non-commercial use, no API key required.
 * - Licensed CC BY 4.0 — attribution required in the UI.
 * - If Pitwall ever becomes a commercial product, the licensing terms and
 *   plan tier of Open-Meteo must be re-verified.
 *
 * Network: client-side fetch to historical-forecast-api.open-meteo.com.
 */

export type PrecipDataResolution = "15min_native" | "interpolated";

export interface LapPrecipOutlook {
  probability_pct: number | null;
  precip_mm: number | null;
  window_start_iso: string;
  window_end_iso: string;
  data_resolution: PrecipDataResolution;
  source: "historical_forecast";
}

interface CircuitCoord {
  lat: number;
  lon: number;
  /**
   * Open-Meteo provides true 15-minute native resolution on parts of North
   * America and Central Europe; elsewhere the 15-min series is interpolated
   * from the hourly series. We expose this honestly as a confidence label.
   */
  resolution: PrecipDataResolution;
}

/**
 * Static mapping from OpenF1 `location` (or `country_name` fallback) to
 * approximate lat/lon of the circuit. Keys are lowercased on lookup.
 *
 * If a circuit is not in this map the feature simply stays hidden.
 */
export const CIRCUIT_COORDINATES: Record<string, CircuitCoord> = {
  // OpenF1 `location` keys
  "sakhir":              { lat: 26.0325, lon: 50.5106, resolution: "interpolated" },
  "jeddah":              { lat: 21.6319, lon: 39.1044, resolution: "interpolated" },
  "melbourne":           { lat: -37.8497, lon: 144.9680, resolution: "interpolated" },
  "suzuka":              { lat: 34.8431, lon: 136.5410, resolution: "interpolated" },
  "shanghai":            { lat: 31.3389, lon: 121.2197, resolution: "interpolated" },
  "miami":               { lat: 25.9581, lon: -80.2389, resolution: "15min_native" },
  "imola":               { lat: 44.3439, lon: 11.7167, resolution: "15min_native" },
  "monte carlo":         { lat: 43.7347, lon: 7.4206, resolution: "15min_native" },
  "montréal":            { lat: 45.5000, lon: -73.5228, resolution: "15min_native" },
  "montreal":            { lat: 45.5000, lon: -73.5228, resolution: "15min_native" },
  "catalunya":           { lat: 41.5700, lon: 2.2611, resolution: "15min_native" },
  "barcelona":           { lat: 41.5700, lon: 2.2611, resolution: "15min_native" },
  "spielberg":           { lat: 47.2197, lon: 14.7647, resolution: "15min_native" },
  "silverstone":         { lat: 52.0786, lon: -1.0169, resolution: "15min_native" },
  "spa-francorchamps":   { lat: 50.4372, lon: 5.9714, resolution: "15min_native" },
  "budapest":            { lat: 47.5789, lon: 19.2486, resolution: "15min_native" },
  "zandvoort":           { lat: 52.3888, lon: 4.5409, resolution: "15min_native" },
  "monza":               { lat: 45.6156, lon: 9.2811, resolution: "15min_native" },
  "madrid":              { lat: 40.4637, lon: -3.7492, resolution: "15min_native" },
  "baku":                { lat: 40.3725, lon: 49.8533, resolution: "interpolated" },
  "marina bay":          { lat: 1.2914, lon: 103.8642, resolution: "interpolated" },
  "singapore":           { lat: 1.2914, lon: 103.8642, resolution: "interpolated" },
  "austin":              { lat: 30.1328, lon: -97.6411, resolution: "15min_native" },
  "mexico city":         { lat: 19.4042, lon: -99.0907, resolution: "interpolated" },
  "são paulo":           { lat: -23.7036, lon: -46.6997, resolution: "interpolated" },
  "sao paulo":           { lat: -23.7036, lon: -46.6997, resolution: "interpolated" },
  "interlagos":          { lat: -23.7036, lon: -46.6997, resolution: "interpolated" },
  "las vegas":           { lat: 36.1147, lon: -115.1728, resolution: "15min_native" },
  "lusail":              { lat: 25.4900, lon: 51.4542, resolution: "interpolated" },
  "yas marina":          { lat: 24.4672, lon: 54.6031, resolution: "interpolated" },
  // country_name fallbacks (lowercase) for circuits with single venue per country
  "bahrain":             { lat: 26.0325, lon: 50.5106, resolution: "interpolated" },
  "saudi arabia":        { lat: 21.6319, lon: 39.1044, resolution: "interpolated" },
  "australia":           { lat: -37.8497, lon: 144.9680, resolution: "interpolated" },
  "japan":               { lat: 34.8431, lon: 136.5410, resolution: "interpolated" },
  "china":               { lat: 31.3389, lon: 121.2197, resolution: "interpolated" },
  "monaco":              { lat: 43.7347, lon: 7.4206, resolution: "15min_native" },
  "canada":              { lat: 45.5000, lon: -73.5228, resolution: "15min_native" },
  "spain":               { lat: 41.5700, lon: 2.2611, resolution: "15min_native" },
  "austria":             { lat: 47.2197, lon: 14.7647, resolution: "15min_native" },
  "united kingdom":      { lat: 52.0786, lon: -1.0169, resolution: "15min_native" },
  "belgium":             { lat: 50.4372, lon: 5.9714, resolution: "15min_native" },
  "hungary":             { lat: 47.5789, lon: 19.2486, resolution: "15min_native" },
  "netherlands":         { lat: 52.3888, lon: 4.5409, resolution: "15min_native" },
  "azerbaijan":          { lat: 40.3725, lon: 49.8533, resolution: "interpolated" },
  "mexico":              { lat: 19.4042, lon: -99.0907, resolution: "interpolated" },
  "brazil":              { lat: -23.7036, lon: -46.6997, resolution: "interpolated" },
  "qatar":               { lat: 25.4900, lon: 51.4542, resolution: "interpolated" },
  "united arab emirates":{ lat: 24.4672, lon: 54.6031, resolution: "interpolated" },
};

function resolveCoord(circuitKey: string | null | undefined): CircuitCoord | null {
  if (!circuitKey) return null;
  const k = circuitKey.trim().toLowerCase();
  return CIRCUIT_COORDINATES[k] ?? null;
}

function toIsoDate(iso: string): string {
  // YYYY-MM-DD in UTC
  return iso.slice(0, 10);
}

/**
 * Fetch precipitation outlook for the ~15 minutes following the lap start.
 *
 * @param circuitKey OpenF1 `location` (preferred) or `country_name`.
 * @param lapDateStartISO ISO timestamp of the lap (`lap.date_start`).
 * @returns null on any failure or when the circuit is not in the static map.
 */
export async function fetchLapPrecipOutlook(
  circuitKey: string | null | undefined,
  lapDateStartISO: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<LapPrecipOutlook | null> {
  try {
    if (!lapDateStartISO) return null;
    const coord = resolveCoord(circuitKey);
    if (!coord) return null;

    const startMs = Date.parse(lapDateStartISO);
    if (!Number.isFinite(startMs)) return null;
    const endMs = startMs + 15 * 60 * 1000;
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();

    const dateStr = toIsoDate(startIso);
    // Open-Meteo allows querying a window across midnight by widening end_date.
    const endDateStr = toIsoDate(endIso);

    const url =
      `https://historical-forecast-api.open-meteo.com/v1/forecast` +
      `?latitude=${coord.lat}&longitude=${coord.lon}` +
      `&start_date=${dateStr}&end_date=${endDateStr}` +
      `&minutely_15=precipitation_probability,precipitation` +
      `&timezone=UTC`;

    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const json: any = await res.json();

    const times: string[] | undefined = json?.minutely_15?.time;
    const probs: Array<number | null> | undefined = json?.minutely_15?.precipitation_probability;
    const mms: Array<number | null> | undefined = json?.minutely_15?.precipitation;
    if (!Array.isArray(times) || times.length === 0) return null;

    // Open-Meteo returns local-naive timestamps when timezone is set; we asked
    // for UTC so they are UTC instants without trailing Z. Parse defensively.
    const binMs = times.map((t) => Date.parse(t.endsWith("Z") ? t : t + "Z"));

    // Window: [startMs, endMs). Include any 15-min bin whose start falls in it,
    // plus the bin immediately preceding startMs if startMs is mid-bin.
    const indices: number[] = [];
    for (let i = 0; i < binMs.length; i++) {
      const b = binMs[i];
      if (!Number.isFinite(b)) continue;
      const binEnd = b + 15 * 60 * 1000;
      if (binEnd > startMs && b < endMs) indices.push(i);
    }
    if (indices.length === 0) return null;

    // Aggregate: take MAX probability (most pessimistic in the window) and
    // SUM precipitation (since each bin reports its own 15-min accumulation).
    let maxProb: number | null = null;
    let sumMm: number | null = null;
    for (const i of indices) {
      const p = probs?.[i];
      const m = mms?.[i];
      if (typeof p === "number" && Number.isFinite(p)) {
        maxProb = maxProb == null ? p : Math.max(maxProb, p);
      }
      if (typeof m === "number" && Number.isFinite(m)) {
        sumMm = (sumMm ?? 0) + m;
      }
    }

    if (maxProb == null && sumMm == null) return null;

    return {
      probability_pct: maxProb,
      precip_mm: sumMm,
      window_start_iso: startIso,
      window_end_iso: endIso,
      data_resolution: coord.resolution,
      source: "historical_forecast",
    };
  } catch {
    return null;
  }
}
