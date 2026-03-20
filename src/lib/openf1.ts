const BASE = "https://api.openf1.org/v1";

export interface Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  session_key: number;
}

export interface Lap {
  lap_number: number;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  st_speed: number | null;
  date_start: string | null;
  is_pit_out_lap: boolean;
  driver_number: number;
  session_key: number;
}

export interface CarData {
  date: string;
  speed: number;
  throttle: number;
  brake: number;
  n_gear: number;
  rpm: number;
  drs: number;
  driver_number: number;
  session_key: number;
}

export interface LocationData {
  date: string;
  x: number;
  y: number;
  z: number;
  driver_number: number;
  session_key: number;
}

export interface WeatherData {
  air_temperature: number;
  date: string;
  humidity: number;
  meeting_key: number;
  pressure: number;
  rainfall: number;
  session_key: number;
  track_temperature: number;
  wind_direction: number;
  wind_speed: number;
}

export interface OvertakeData {
  date: string;
  meeting_key: number;
  overtaken_driver_number: number;
  overtaking_driver_number: number;
  position: number;
  session_key: number;
}

// Simple queue to enforce max 2 requests/second
let lastRequestTime = 0;
const MIN_INTERVAL = 500; // ms between requests

async function fetchApi<T>(path: string, retries = 2): Promise<T> {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL - (now - lastRequestTime));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();

  const res = await fetch(`${BASE}${path}`);
  if (res.status === 429 && retries > 0) {
    await new Promise((r) => setTimeout(r, 1500));
    return fetchApi<T>(path, retries - 1);
  }
  if (!res.ok) throw new Error(`OpenF1 API error: ${res.status}`);
  return res.json();
}

export function getDrivers(sessionKey: number) {
  return fetchApi<Driver[]>(`/drivers?session_key=${sessionKey}`);
}

export function getLaps(sessionKey: number, driverNumber: number) {
  return fetchApi<Lap[]>(`/laps?session_key=${sessionKey}&driver_number=${driverNumber}`);
}

export function getCarData(sessionKey: number, driverNumber: number, dateStart: string, dateEnd: string) {
  return fetchApi<CarData[]>(
    `/car_data?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${dateStart}&date<=${dateEnd}`
  );
}

export function getLocation(sessionKey: number, driverNumber: number, dateStart: string, dateEnd: string) {
  return fetchApi<LocationData[]>(
    `/location?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${dateStart}&date<=${dateEnd}`
  );
}

export function getWeather(sessionKey: number, dateStart: string, dateEnd: string) {
  return fetchApi<WeatherData[]>(
    `/weather?session_key=${sessionKey}&date>=${dateStart}&date<=${dateEnd}`
  );
}

export function getOvertakes(sessionKey: number, driverNumber: number) {
  return fetchApi<OvertakeData[]>(
    `/overtakes?session_key=${sessionKey}&overtaking_driver_number=${driverNumber}`
  );
}
