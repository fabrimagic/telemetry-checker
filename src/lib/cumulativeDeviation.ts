import type { Lap, SessionResult, Driver } from "./openf1";

export interface LapDeviation {
  lap_number: number;
  lap_time: number;
  delta_lap: number;
  cumulative_delta: number;
}

export interface DriverCumulativeDeviation {
  driver_number: number;
  driver_code: string;
  team_colour: string;
  laps: LapDeviation[];
  final_cumulative_delta: number | null;
  valid_laps_count: number;
}

export interface CumulativeDeviationResult {
  session_key: number;
  winner_driver_number: number | null;
  winner_driver_code: string | null;
  winner_reference_avg_lap: number | null;
  drivers: DriverCumulativeDeviation[];
  error: string | null;
}

/**
 * Identify the session winner from results (P1, not DNF/DNS/DSQ).
 */
function getSessionWinner(results: SessionResult[]): number | null {
  if (!results.length) return null;
  const p1 = results.find((r) => r.position === 1 && !r.dnf && !r.dns && !r.dsq);
  return p1 ? p1.driver_number : null;
}

/**
 * Filter valid laps for benchmark: exclude pit out laps, null durations, outliers.
 */
function getValidLaps(laps: Lap[]): Lap[] {
  const valid = laps.filter(
    (l) =>
      l.lap_duration != null &&
      l.lap_duration > 0 &&
      !l.is_pit_out_lap &&
      l.lap_number > 1 // exclude formation/first lap
  );

  if (valid.length < 3) return valid;

  // Remove statistical outliers (> 1.5x median)
  const times = valid.map((l) => l.lap_duration!).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const threshold = median * 1.5;

  return valid.filter((l) => l.lap_duration! <= threshold);
}

/**
 * Calculate winner's reference average lap time using only valid laps.
 */
function getWinnerReferenceAvg(allLaps: Lap[], winnerNumber: number): number | null {
  const winnerLaps = allLaps.filter((l) => l.driver_number === winnerNumber);
  const valid = getValidLaps(winnerLaps);
  if (valid.length === 0) return null;

  const sum = valid.reduce((acc, l) => acc + l.lap_duration!, 0);
  return sum / valid.length;
}

/**
 * Build cumulative deviation data for a single driver.
 */
function buildDriverDeviation(
  allLaps: Lap[],
  driverNumber: number,
  driverCode: string,
  teamColour: string,
  referenceAvg: number
): DriverCumulativeDeviation {
  const driverLaps = allLaps.filter((l) => l.driver_number === driverNumber);
  // Use the SAME filtering as the benchmark to ensure the winner ends at ~0
  const validLaps = getValidLaps(driverLaps).sort((a, b) => a.lap_number - b.lap_number);

  let cumulative = 0;
  const laps: LapDeviation[] = [];

  for (const lap of validLaps) {
    const lt = lap.lap_duration!;

    const delta = lt - referenceAvg;
    cumulative += delta;
    laps.push({
      lap_number: lap.lap_number,
      lap_time: Math.round(lt * 1000) / 1000,
      delta_lap: Math.round(delta * 1000) / 1000,
      cumulative_delta: Math.round(cumulative * 1000) / 1000,
    });
  }

  return {
    driver_number: driverNumber,
    driver_code: driverCode,
    team_colour: teamColour,
    laps,
    final_cumulative_delta: laps.length > 0 ? laps[laps.length - 1].cumulative_delta : null,
    valid_laps_count: laps.length,
  };
}

/**
 * Main entry: compute cumulative deviation for all drivers in a session.
 */
export function computeCumulativeDeviation(
  sessionKey: number,
  allLaps: Lap[],
  results: SessionResult[],
  drivers: Driver[]
): CumulativeDeviationResult {
  const winnerNumber = getSessionWinner(results);
  if (winnerNumber == null) {
    return {
      session_key: sessionKey,
      winner_driver_number: null,
      winner_driver_code: null,
      winner_reference_avg_lap: null,
      drivers: [],
      error: "Impossibile determinare il vincitore della sessione",
    };
  }

  const winnerDriver = drivers.find((d) => d.driver_number === winnerNumber);
  const winnerCode = winnerDriver?.name_acronym ?? `#${winnerNumber}`;

  const referenceAvg = getWinnerReferenceAvg(allLaps, winnerNumber);
  if (referenceAvg == null) {
    return {
      session_key: sessionKey,
      winner_driver_number: winnerNumber,
      winner_driver_code: winnerCode,
      winner_reference_avg_lap: null,
      drivers: [],
      error: "Dati insufficienti per calcolare il benchmark del vincitore",
    };
  }

  // Build deviation for all drivers that appear in results
  const driverDeviations: DriverCumulativeDeviation[] = [];
  const resultDrivers = results
    .sort((a, b) => a.position - b.position)
    .map((r) => r.driver_number);

  for (const num of resultDrivers) {
    const drv = drivers.find((d) => d.driver_number === num);
    const code = drv?.name_acronym ?? `#${num}`;
    const colour = drv?.team_colour ?? "ffffff";
    const dev = buildDriverDeviation(allLaps, num, code, colour, referenceAvg);
    if (dev.laps.length > 0) {
      driverDeviations.push(dev);
    }
  }

  return {
    session_key: sessionKey,
    winner_driver_number: winnerNumber,
    winner_driver_code: winnerCode,
    winner_reference_avg_lap: Math.round(referenceAvg * 1000) / 1000,
    drivers: driverDeviations,
    error: null,
  };
}
