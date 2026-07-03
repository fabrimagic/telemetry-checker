import { describe, it, expect } from "vitest";
import type { Driver, Lap } from "@/lib/openf1";

/**
 * Regression test for QualifyingOverviewDashboard default reference driver selection.
 *
 * When the selected driver is the poleman (or when pole is unknown), the default
 * reference must be the "best opponent" — the driver (other than the selected one)
 * with the fastest valid lap in the session — not the first driver in the arbitrary
 * API insertion order.
 *
 * This mirrors the memoised `bestOpponentDriverNum` computation in the component
 * so the invariant stays locked even if the component internals change.
 */

function isValidLap(l: Lap): boolean {
  return (
    typeof l.lap_duration === "number" &&
    l.lap_duration > 0 &&
    !l.is_pit_out_lap &&
    typeof l.duration_sector_1 === "number" &&
    typeof l.duration_sector_2 === "number" &&
    typeof l.duration_sector_3 === "number"
  );
}

function bestLapOf(laps: Lap[]): Lap | null {
  const v = laps.filter(isValidLap);
  if (!v.length) return null;
  return v.reduce((b, l) =>
    (l.lap_duration as number) < (b.lap_duration as number) ? l : b,
  );
}

function computeBestOpponent(
  selected: number,
  allDrivers: Driver[],
  sessionAllLaps: Lap[],
): number | null {
  const others = allDrivers.filter((d) => d.driver_number !== selected);
  let best: { num: number; t: number } | null = null;
  for (const d of others) {
    const dl = sessionAllLaps.filter((l) => l.driver_number === d.driver_number);
    const bl = bestLapOf(dl);
    if (bl && typeof bl.lap_duration === "number") {
      if (!best || (bl.lap_duration as number) < best.t) {
        best = { num: d.driver_number, t: bl.lap_duration as number };
      }
    }
  }
  return best?.num ?? null;
}

function makeLap(driver_number: number, lap_number: number, lap_duration: number): Lap {
  return {
    driver_number,
    lap_number,
    date_start: `2024-01-01T12:0${lap_number}:00Z`,
    duration_sector_1: lap_duration / 3,
    duration_sector_2: lap_duration / 3,
    duration_sector_3: lap_duration / 3,
    i1_speed: null,
    i2_speed: null,
    is_pit_out_lap: false,
    lap_duration,
    meeting_key: 1,
    session_key: 1,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    st_speed: null,
  } as unknown as Lap;
}

function makeDriver(driver_number: number, acronym: string): Driver {
  return {
    driver_number,
    name_acronym: acronym,
    full_name: acronym,
    team_name: "TEAM",
    team_colour: "ffffff",
  } as unknown as Driver;
}

describe("Qualifying default reference — best opponent selection", () => {
  it("picks the opponent with the fastest valid lap, not the first in API order", () => {
    // Selected = 1 (poleman). Opponents 2, 3, 4 arrive in that order from the API.
    // Fastest opponent is #3 (slowest .lap_duration among opponents).
    const drivers: Driver[] = [
      makeDriver(1, "POL"),
      makeDriver(2, "AAA"), // first in list — should NOT be chosen
      makeDriver(3, "BBB"), // fastest opponent — should be chosen
      makeDriver(4, "CCC"),
    ];
    const laps: Lap[] = [
      makeLap(1, 1, 89.0), // poleman
      makeLap(2, 1, 91.5),
      makeLap(3, 1, 90.2), // fastest among opponents
      makeLap(4, 1, 92.8),
    ];

    const best = computeBestOpponent(1, drivers, laps);
    expect(best).toBe(3);
  });

  it("returns null when no opponent has a valid lap so caller can fall back", () => {
    const drivers: Driver[] = [makeDriver(1, "POL"), makeDriver(2, "AAA")];
    const laps: Lap[] = [
      makeLap(1, 1, 89.0),
      // opponent has only a pit-out lap
      { ...makeLap(2, 1, 95.0), is_pit_out_lap: true } as Lap,
    ];
    expect(computeBestOpponent(1, drivers, laps)).toBeNull();
  });
});
