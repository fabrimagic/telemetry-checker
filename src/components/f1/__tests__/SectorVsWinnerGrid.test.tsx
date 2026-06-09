import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectorVsWinnerGrid } from "../SectorVsWinnerGrid";
import { aggregateSector } from "@/lib/performanceRadar";
import { getSessionWinner } from "@/lib/cumulativeDeviation";
import type { Lap, SessionResult } from "@/lib/openf1";

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function makeLap(driver: number, n: number, s1: number, s2: number, s3: number, isPitOut = false): Lap {
  return {
    driver_number: driver,
    lap_number: n,
    lap_duration: s1 + s2 + s3,
    duration_sector_1: s1,
    duration_sector_2: s2,
    duration_sector_3: s3,
    st_speed: 300,
    date_start: `2024-01-01T12:${String(n).padStart(2, "0")}:00Z`,
    is_pit_out_lap: isPitOut,
    session_key: 1,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
  };
}

describe("getSessionWinner (exported)", () => {
  it("returns the P1 driver excluding DNF/DNS/DSQ", () => {
    const results: SessionResult[] = [
      { driver_number: 1, position: 1, dnf: true, dns: false, dsq: false } as any,
      { driver_number: 4, position: 2, dnf: false, dns: false, dsq: false } as any,
    ];
    // P1 was DNF → no winner (function asks for position === 1 AND not flagged).
    expect(getSessionWinner(results)).toBe(null);
    const ok: SessionResult[] = [
      { driver_number: 4, position: 1, dnf: false, dns: false, dsq: false } as any,
    ];
    expect(getSessionWinner(ok)).toBe(4);
  });
});

describe("aggregateSector — std on filtered series", () => {
  it("returns std on the same filtered sample as the median", () => {
    const laps = [
      makeLap(4, 2, 25.0, 30.0, 28.0),
      makeLap(4, 3, 25.1, 30.0, 28.0),
      makeLap(4, 4, 25.2, 30.0, 28.0),
      makeLap(4, 5, 25.3, 30.0, 28.0),
      // Big outlier — filtered out by MAD.
      makeLap(4, 6, 60.0, 30.0, 28.0),
    ];
    const r = aggregateSector(laps, new Set(), undefined, (l) => l.duration_sector_1);
    expect(r.raw).not.toBeNull();
    expect(r.std).not.toBeNull();
    // Std on [25, 25.1, 25.2, 25.3] ≈ 0.129, NOT inflated by 60.
    expect(r.std as number).toBeLessThan(0.2);
    expect(r.sampleSize).toBe(4);
  });

  it("excludes pit-out laps and pit-in laps from the aggregate", () => {
    const laps = [
      makeLap(4, 1, 25.0, 30.0, 28.0, true), // pit-out → excluded
      makeLap(4, 2, 25.0, 30.0, 28.0),
      makeLap(4, 3, 25.1, 30.0, 28.0),
      makeLap(4, 4, 25.2, 30.0, 28.0),
    ];
    const pitIn = new Set([4]); // exclude lap 4 as pit-in
    const r = aggregateSector(laps, pitIn, undefined, (l) => l.duration_sector_1);
    expect(r.sampleSize).toBe(2); // not enough → returns null median below the threshold
    expect(r.raw).toBeNull();
  });
});

describe("SectorVsWinnerGrid — honest states", () => {
  const driverLaps = [
    makeLap(4, 2, 25.0, 30.0, 28.0),
    makeLap(4, 3, 25.1, 30.0, 28.0),
    makeLap(4, 4, 25.2, 30.0, 28.0),
    makeLap(4, 5, 25.3, 30.0, 28.0),
  ];

  it("renders the non-race fallback in all three panels for non-race sessions", () => {
    render(
      <SectorVsWinnerGrid
        selectedDriverNumber={4}
        selectedAcronym="NOR"
        selectedLaps={driverLaps}
        sessionAllLaps={driverLaps}
        winnerDriverNumber={1}
        winnerAcronym="VER"
        pitStops={[]}
        raceControlMessages={[]}
        isRace={false}
      />,
    );
    expect(screen.getAllByText(/non è una gara/i)).toHaveLength(3);
  });

  it("renders the winner-missing fallback when no winner is available", () => {
    render(
      <SectorVsWinnerGrid
        selectedDriverNumber={4}
        selectedAcronym="NOR"
        selectedLaps={driverLaps}
        sessionAllLaps={driverLaps}
        winnerDriverNumber={null}
        winnerAcronym={null}
        pitStops={[]}
        raceControlMessages={[]}
        isRace={true}
      />,
    );
    expect(screen.getAllByText(/non disponibile per questa sessione/i)).toHaveLength(3);
  });

  it("renders insufficient-data fallback for the driver when clean laps are too few", () => {
    const fewLaps = [
      makeLap(4, 2, 25.0, 30.0, 28.0),
      makeLap(4, 3, 25.1, 30.0, 28.0),
    ];
    const winnerLaps = [
      makeLap(1, 2, 24.0, 29.0, 27.0),
      makeLap(1, 3, 24.1, 29.0, 27.0),
      makeLap(1, 4, 24.0, 29.0, 27.0),
      makeLap(1, 5, 24.1, 29.0, 27.0),
    ];
    render(
      <SectorVsWinnerGrid
        selectedDriverNumber={4}
        selectedAcronym="NOR"
        selectedLaps={fewLaps}
        sessionAllLaps={[...fewLaps, ...winnerLaps]}
        winnerDriverNumber={1}
        winnerAcronym="VER"
        pitStops={[]}
        raceControlMessages={[]}
        isRace={true}
      />,
    );
    expect(screen.getAllByText(/Dati insufficienti per il settore/i).length).toBe(3);
  });

  it("renders deltas with NOR slower than VER (positive delta)", () => {
    const winnerLaps = [
      makeLap(1, 2, 24.0, 29.0, 27.0),
      makeLap(1, 3, 24.1, 29.0, 27.0),
      makeLap(1, 4, 24.0, 29.0, 27.0),
      makeLap(1, 5, 24.1, 29.0, 27.0),
    ];
    render(
      <SectorVsWinnerGrid
        selectedDriverNumber={4}
        selectedAcronym="NOR"
        selectedLaps={driverLaps}
        sessionAllLaps={[...driverLaps, ...winnerLaps]}
        winnerDriverNumber={1}
        winnerAcronym="VER"
        pitStops={[]}
        raceControlMessages={[]}
        isRace={true}
      />,
    );
    // Three "vs vincitore" titles, one per sector.
    expect(screen.getAllByText(/vs vincitore/i)).toHaveLength(3);
    // Delta for S1 should be positive (~+1.1s). At least one '+' delta is rendered.
    const plusDeltas = screen.getAllByText(/^\+\d+\.\d{3}s$/);
    expect(plusDeltas.length).toBeGreaterThan(0);
  });
});
