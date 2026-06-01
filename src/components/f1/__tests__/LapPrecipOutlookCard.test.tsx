import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LapPrecipOutlookCard } from "../LapPrecipOutlookCard";
import type { LapPrecipOutlook } from "@/lib/precipForecast";

function makeOutlook(overrides: Partial<LapPrecipOutlook> = {}): LapPrecipOutlook {
  return {
    probability_pct: 60,
    precip_mm: 0.3,
    window_start_iso: "2024-09-01T13:05:00.000Z",
    window_end_iso: "2024-09-01T13:20:00.000Z",
    data_resolution: "15min_native",
    source: "historical_forecast",
    ...overrides,
  };
}

describe("LapPrecipOutlookCard", () => {
  it("returns null when outlook is null", () => {
    const { container } = render(<LapPrecipOutlookCard outlook={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders probability and mm for native data with confidence badge", () => {
    render(<LapPrecipOutlookCard outlook={makeOutlook()} />);
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("0.30 mm")).toBeTruthy();
    expect(screen.getByText(/15min nativa/i)).toBeTruthy();
    expect(screen.getByText(/ricostruito/i)).toBeTruthy();
    expect(screen.getByText(/Open-Meteo/)).toBeTruthy();
  });

  it("marks interpolated resolution with an indicative badge", () => {
    render(
      <LapPrecipOutlookCard outlook={makeOutlook({ data_resolution: "interpolated" })} />,
    );
    expect(screen.getByText(/oraria interpolata/i)).toBeTruthy();
  });

  it("shows a 'non disponibili' message when both values are null", () => {
    render(
      <LapPrecipOutlookCard
        outlook={makeOutlook({ probability_pct: null, precip_mm: null })}
      />,
    );
    expect(screen.getByText(/non disponibili/i)).toBeTruthy();
  });
});
