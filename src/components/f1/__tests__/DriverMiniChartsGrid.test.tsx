import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { DriverMiniChartsGrid, resolveAheadDriverNumber } from "../DriverMiniChartsGrid";
import type { Lap, PositionData, IntervalData, Driver } from "@/lib/openf1";

beforeAll(() => {
  // jsdom doesn't ship ResizeObserver, which recharts' ResponsiveContainer needs.
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function makeLap(lap_number: number, date: string): Lap {
  return {
    driver_number: 4,
    lap_number,
    date_start: date,
    duration_sector_1: null,
    duration_sector_2: null,
    duration_sector_3: null,
    i1_speed: null,
    i2_speed: null,
    is_pit_out_lap: false,
    lap_duration: 90,
    meeting_key: 1,
    session_key: 1,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    st_speed: null,
  } as unknown as Lap;
}

const baseLaps: Lap[] = [
  makeLap(1, "2024-01-01T12:00:00Z"),
  makeLap(2, "2024-01-01T12:01:30Z"),
  makeLap(3, "2024-01-01T12:03:00Z"),
];

const positions: PositionData[] = [
  { date: "2024-01-01T12:00:10Z", driver_number: 4, meeting_key: 1, position: 5, session_key: 1 },
  { date: "2024-01-01T12:01:40Z", driver_number: 4, meeting_key: 1, position: 4, session_key: 1 },
  { date: "2024-01-01T12:03:10Z", driver_number: 4, meeting_key: 1, position: 3, session_key: 1 },
  { date: "2024-01-01T12:01:40Z", driver_number: 99, meeting_key: 1, position: 1, session_key: 1 },
];

const intervals: IntervalData[] = [
  { date: "2024-01-01T12:00:10Z", driver_number: 4, gap_to_leader: 1.2, interval: 0.5, meeting_key: 1, session_key: 1 },
  { date: "2024-01-01T12:01:40Z", driver_number: 4, gap_to_leader: 1.5, interval: 0.6, meeting_key: 1, session_key: 1 },
  { date: "2024-01-01T12:03:10Z", driver_number: 4, gap_to_leader: 1.8, interval: 0.7, meeting_key: 1, session_key: 1 },
];

const cumDev = [
  { lap_number: 1, cumulative_delta: 0.1 },
  { lap_number: 2, cumulative_delta: 0.4 },
  { lap_number: 3, cumulative_delta: 0.9 },
];

describe("DriverMiniChartsGrid", () => {
  it("renders 4 compact panels with the standard titles", () => {
    render(
      <DriverMiniChartsGrid
        driverNumber={4}
        driverColor="ff0000"
        driverAcronym="NOR"
        laps={baseLaps}
        positions={positions}
        intervals={intervals}
        cumDev={cumDev}
        isRace={true}
      />,
    );
    expect(screen.getByText(/Deviazione cumulativa/i)).toBeTruthy();
    expect(screen.getByText(/^Posizione$/i)).toBeTruthy();
    expect(screen.getByText(/Gap al leader/i)).toBeTruthy();
    expect(screen.getByText(/Distacco da chi precede/i)).toBeTruthy();
    const grid = screen.getByTestId("driver-mini-charts-grid");
    expect(grid.className).toMatch(/grid-cols-1/);
    expect(grid.className).toMatch(/sm:grid-cols-2/);
    expect(grid.className).toMatch(/xl:grid-cols-4/);
  });

  it("shows non-race empty state for position/gap/interval when isRace=false", () => {
    render(
      <DriverMiniChartsGrid
        driverNumber={4}
        driverColor="ff0000"
        driverAcronym="NOR"
        laps={baseLaps}
        positions={positions}
        intervals={intervals}
        cumDev={cumDev}
        isRace={false}
      />,
    );
    const msgs = screen.getAllByText(/Dato disponibile solo in gara/i);
    // 3 race-only panels show the non-race message
    expect(msgs.length).toBe(3);
  });

  it("shows clean empty state when race data is missing (no crash)", () => {
    render(
      <DriverMiniChartsGrid
        driverNumber={4}
        driverColor="ff0000"
        driverAcronym="NOR"
        laps={baseLaps}
        positions={[]}
        intervals={[]}
        cumDev={null}
        isRace={true}
      />,
    );
    const msgs = screen.getAllByText(/Dato non disponibile per questa sessione/i);
    expect(msgs.length).toBe(4);
  });
});
