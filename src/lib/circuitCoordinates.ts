/**
 * Approximate circuit coordinates (lat/lon) for each round of the 2026 F1 calendar.
 * Used by the weekend weather card to query Open-Meteo (no API key required).
 * Keys match `gpName` in src/lib/f1Calendar2026.ts.
 */

export interface CircuitCoords {
  lat: number;
  lon: number;
  /** IANA timezone — used to align hourly forecasts to local circuit time. */
  timezone: string;
}

export const CIRCUIT_COORDINATES: Record<string, CircuitCoords> = {
  "Gran Premio d'Australia":           { lat: -37.8497, lon: 144.9680, timezone: "Australia/Melbourne" },
  "Gran Premio della Cina":            { lat:  31.3389, lon: 121.2197, timezone: "Asia/Shanghai" },
  "Gran Premio del Giappone":          { lat:  34.8431, lon: 136.5410, timezone: "Asia/Tokyo" },
  "Gran Premio di Miami":              { lat:  25.9581, lon: -80.2389, timezone: "America/New_York" },
  "Gran Premio del Canada":            { lat:  45.5000, lon: -73.5228, timezone: "America/Toronto" },
  "Gran Premio di Monaco":             { lat:  43.7347, lon:   7.4206, timezone: "Europe/Monaco" },
  "Gran Premio di Barcellona-Catalunya": { lat: 41.5700, lon:   2.2611, timezone: "Europe/Madrid" },
  "Gran Premio d'Austria":             { lat:  47.2197, lon:  14.7647, timezone: "Europe/Vienna" },
  "Gran Premio di Gran Bretagna":      { lat:  52.0786, lon:  -1.0169, timezone: "Europe/London" },
  "Gran Premio del Belgio":            { lat:  50.4372, lon:   5.9714, timezone: "Europe/Brussels" },
  "Gran Premio d'Ungheria":            { lat:  47.5789, lon:  19.2486, timezone: "Europe/Budapest" },
  "Gran Premio d'Olanda":              { lat:  52.3888, lon:   4.5409, timezone: "Europe/Amsterdam" },
  "Gran Premio d'Italia":              { lat:  45.6156, lon:   9.2811, timezone: "Europe/Rome" },
  "Gran Premio di Spagna":             { lat:  40.4637, lon:  -3.7492, timezone: "Europe/Madrid" },
  "Gran Premio dell'Azerbaijan":       { lat:  40.3725, lon:  49.8533, timezone: "Asia/Baku" },
  "Gran Premio di Singapore":          { lat:   1.2914, lon: 103.8642, timezone: "Asia/Singapore" },
  "Gran Premio degli Stati Uniti":     { lat:  30.1328, lon: -97.6411, timezone: "America/Chicago" },
  "Gran Premio del Messico":           { lat:  19.4042, lon: -99.0907, timezone: "America/Mexico_City" },
  "Gran Premio del Brasile":           { lat: -23.7036, lon: -46.6997, timezone: "America/Sao_Paulo" },
  "Gran Premio di Las Vegas":          { lat:  36.1147, lon: -115.1728, timezone: "America/Los_Angeles" },
  "Gran Premio del Qatar":             { lat:  25.4900, lon:  51.4542, timezone: "Asia/Qatar" },
  "Gran Premio di Abu Dhabi":          { lat:  24.4672, lon:  54.6031, timezone: "Asia/Dubai" },
};
