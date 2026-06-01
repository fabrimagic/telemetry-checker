import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SoftSensorsLapCard } from "../SoftSensorsLapCard";
import type { SoftSensorsLapState } from "@/lib/softSensors";

function makeState(overrides: Partial<SoftSensorsLapState> = {}): SoftSensorsLapState {
  return {
    lap_number: 12,
    stint_number: 2,
    tyre_thermal: { label: "IN_WINDOW", score: 0.5, confidence: "HIGH", reasons: [] },
    tyre_stress: { label: "MODERATE", score: 0.4, confidence: "MEDIUM", reasons: [] },
    track_grip: { label: "STABLE", score: 0.5, confidence: "HIGH", reasons: [] },
    overall_confidence: "MEDIUM",
    reliability_notes: ["nota di test"],
    ...overrides,
  };
}

describe("SoftSensorsLapCard", () => {
  it("returns null when state is null", () => {
    const { container } = render(<SoftSensorsLapCard state={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders all three sensors with Italian labels", () => {
    render(<SoftSensorsLapCard state={makeState()} />);
    expect(screen.getByText(/giro 12/i)).toBeTruthy();
    expect(screen.getByText("In finestra")).toBeTruthy();
    expect(screen.getByText("Moderato")).toBeTruthy();
    expect(screen.getByText("Stabile")).toBeTruthy();
    expect(screen.getByText(/nota di test/)).toBeTruthy();
  });

  it("renders em-dash for UNKNOWN sensors without inventing values", () => {
    render(
      <SoftSensorsLapCard
        state={makeState({
          tyre_thermal: { label: "UNKNOWN", score: null, confidence: "LOW", reasons: [] },
          tyre_stress: { label: "UNKNOWN", score: null, confidence: "LOW", reasons: [] },
          track_grip: { label: "UNKNOWN", score: null, confidence: "LOW", reasons: [] },
        })}
      />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(3);
  });
});
