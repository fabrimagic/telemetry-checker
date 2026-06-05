import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TyreDegradationCard, type ManualSelectionDriver } from "../TyreDegradationCard";
import type { LongRunResult } from "@/lib/longRunDetector";
import type { Lap, StintData } from "@/lib/openf1";

function lap(n: number, dur: number, opts: Partial<Lap> = {}): Lap {
  return {
    lap_number: n,
    lap_duration: dur,
    duration_sector_1: dur / 3,
    duration_sector_2: dur / 3,
    duration_sector_3: dur / 3,
    st_speed: 300,
    date_start: `2024-01-01T13:${String(n).padStart(2, "0")}:00.000Z`,
    is_pit_out_lap: false,
    driver_number: 16,
    session_key: 9999,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    ...opts,
  } as Lap;
}

function makeDriver(): ManualSelectionDriver {
  const laps: Lap[] = [];
  for (let i = 1; i <= 8; i++) laps.push(lap(i, 90.0 + 0.05 * (i - 1)));
  const stints: StintData[] = [
    {
      compound: "MEDIUM",
      driver_number: 16,
      lap_end: 8,
      lap_start: 1,
      meeting_key: 1,
      session_key: 9999,
      stint_number: 1,
      tyre_age_at_start: 0,
    },
  ];
  return { driverNumber: 16, acronym: "LEC", color: "E80020", laps, stints };
}

const invalidLongRun: LongRunResult = {
  driverNumber: 16,
  acronym: "LEC",
  color: "E80020",
  stintNumber: 1,
  compound: "MEDIUM",
  lapStartLongRun: 1,
  lapEndLongRun: 3,
  lapsCount: 3,
  avgLapTime: 90.1,
  degradationSlope: 0.05,
  rSquared: 0.1,
  fitRobustness: "LOW",
  isValidLongRun: false,
};

const validLongRun: LongRunResult = { ...invalidLongRun, rSquared: 0.9, lapsCount: 8, isValidLongRun: true };

describe("TyreDegradationCard manual selection fallback", () => {
  it("shows manual selection when no valid long run exists", () => {
    render(
      <TyreDegradationCard
        results={[]}
        longRuns={[invalidLongRun]}
        manualSelectionDrivers={[makeDriver()]}
      />,
    );
    expect(screen.getByTestId("manual-selection-16")).toBeTruthy();
    expect(screen.getByText(/Nessuna simulazione passo gara rilevata/i)).toBeTruthy();
  });

  it("does NOT show manual selection when a valid long run exists", () => {
    render(
      <TyreDegradationCard
        results={[]}
        longRuns={[validLongRun]}
        manualSelectionDrivers={[makeDriver()]}
      />,
    );
    expect(screen.queryByTestId("manual-selection-16")).toBeNull();
  });

  it("blocks compute below minimum laps and enables above", () => {
    render(
      <TyreDegradationCard
        results={[]}
        longRuns={[]}
        manualSelectionDrivers={[makeDriver()]}
      />,
    );
    const calcBtn = screen.getByRole("button", { name: /Calcola sulla selezione/i }) as HTMLButtonElement;
    expect(calcBtn.disabled).toBe(true);
    // Pick 4 laps → still disabled
    for (const n of [1, 2, 3, 4]) {
      fireEvent.click(screen.getByRole("button", { name: `Giro ${n}` }));
    }
    expect((screen.getByRole("button", { name: /Calcola sulla selezione/i }) as HTMLButtonElement).disabled).toBe(true);
    // 5th lap → enabled
    fireEvent.click(screen.getByRole("button", { name: "Giro 5" }));
    expect((screen.getByRole("button", { name: /Calcola sulla selezione/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("computes a labeled manual result on click", () => {
    render(
      <TyreDegradationCard
        results={[]}
        longRuns={[]}
        manualSelectionDrivers={[makeDriver()]}
      />,
    );
    for (const n of [1, 2, 3, 4, 5, 6]) {
      fireEvent.click(screen.getByRole("button", { name: `Giro ${n}` }));
    }
    fireEvent.click(screen.getByRole("button", { name: /Calcola sulla selezione/i }));
    expect(screen.getByTestId("manual-result-16")).toBeTruthy();
    expect(screen.getByText(/Selezione manuale — non validata statisticamente/i)).toBeTruthy();
  });
});
