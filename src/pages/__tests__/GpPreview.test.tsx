import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GpPredictionResultView } from "../GpPreview";
import type { CircuitProfile } from "@/lib/circuitProfiles";
import type { GpPrediction } from "@/lib/gpPrediction";

// Mocks to prevent computeCarProfiles from doing anything at module load.
vi.mock("@/lib/carProfiles", () => ({
  computeCarProfiles: vi.fn(async () => ({
    profiles: [],
    races_used: [],
    aborted: false,
  })),
}));

const circuit: CircuitProfile = {
  gpName: "Test GP",
  top_speed: 0.8,
  slow_corner_traction: 0.5,
  medium_corner: 0.6,
  fast_corner: 0.7,
  tyre_deg: 0.4,
  overtaking_difficulty: 0.3,
  confidence: "high",
  source: "historical",
};

const prediction: GpPrediction = {
  ranked: [
    {
      team_name: "Alpha",
      affinity_score: 0.82,
      uncertainty: 0.05,
      confidence: "high",
      contributions: { top_speed: 0.5, cornering: 0.32 },
    },
    {
      team_name: "Beta",
      affinity_score: 0.80,
      uncertainty: 0.06,
      confidence: "high",
      contributions: { top_speed: 0.45, cornering: 0.35 },
    },
    {
      team_name: "Gamma",
      affinity_score: 0.40,
      uncertainty: 0.08,
      confidence: "medium",
      contributions: { top_speed: 0.2, cornering: 0.2 },
    },
  ],
  global_confidence: "medium",
  indistinguishable_groups: [["Alpha", "Beta"]],
  notes: ["Circuito stimato dal solo layout (confidenza ridotta)"],
};

describe("GpPredictionResultView", () => {
  it("renders ranking, bands, equivalent group badge and caveats", () => {
    render(<GpPredictionResultView circuit={circuit} prediction={prediction} />);
    // Ranking present
    expect(screen.getByTestId("team-row-Alpha")).toBeTruthy();
    expect(screen.getByTestId("team-row-Beta")).toBeTruthy();
    expect(screen.getByTestId("team-row-Gamma")).toBeTruthy();
    // Equivalent badge for Alpha+Beta
    const badges = screen.getAllByTestId("equivalent-badge");
    expect(badges.length).toBe(2);
    // Bands visible (textual range)
    expect(screen.getByText(/0\.77.{1}0\.87/)).toBeTruthy();
    // Caveats section + note
    expect(screen.getByTestId("caveats-card")).toBeTruthy();
    expect(screen.getByText(/Circuito stimato dal solo layout/)).toBeTruthy();
    expect(screen.getByText(/Confidenza complessiva: Media/)).toBeTruthy();
    expect(screen.getByText(/non una previsione del risultato/i)).toBeTruthy();
  });

  it("renders the sector_typed badge and hides GPS diagnostic badges", () => {
    const pred: GpPrediction = {
      ranked: [
        {
          team_name: "Sec",
          affinity_score: 0.7,
          uncertainty: 0.05,
          confidence: "high",
          contributions: { top_speed: 0.4, cornering: 0.3 },
          corner_source: "sector_typed",
          corner_coverage: 0.11,
          corner_coverage_curve: 0.08,
          corner_alignment_error: 0.42,
        },
      ],
      global_confidence: "medium",
      indistinguishable_groups: [],
      notes: [],
    };
    render(<GpPredictionResultView circuit={circuit} prediction={pred} />);
    const badge = screen.getByTestId("corner-source-Sec");
    expect(badge.textContent).toMatch(/stima per tipo/i);
    expect(screen.queryByTestId("corner-coverage-Sec")).toBeNull();
    expect(screen.queryByTestId("alignment-error-Sec")).toBeNull();
  });

  it("hides GPS diagnostic badges also in location_geometry and sector_fallback branches", () => {
    const pred: GpPrediction = {
      ranked: [
        {
          team_name: "Geo",
          affinity_score: 0.7, uncertainty: 0.05, confidence: "high",
          contributions: { top_speed: 0.4, cornering: 0.3 },
          corner_source: "location_geometry",
          corner_coverage: 0.8, corner_coverage_curve: 0.7, corner_alignment_error: 0.15,
        },
        {
          team_name: "Fb",
          affinity_score: 0.6, uncertainty: 0.05, confidence: "high",
          contributions: { top_speed: 0.4, cornering: 0.2 },
          corner_source: "sector_fallback",
        },
      ],
      global_confidence: "medium",
      indistinguishable_groups: [],
      notes: [],
    };
    render(<GpPredictionResultView circuit={circuit} prediction={pred} />);
    expect(screen.getByTestId("corner-source-Geo").textContent).toMatch(/geometria GPS/i);
    expect(screen.getByTestId("corner-source-Fb").textContent).toMatch(/Curve da settori/i);
    expect(screen.queryByTestId("corner-coverage-Geo")).toBeNull();
    expect(screen.queryByTestId("corner-coverage-Fb")).toBeNull();
    expect(screen.queryByTestId("alignment-error-Geo")).toBeNull();
  });
});
    // Bands visible (textual range)
    expect(screen.getByText(/0\.77.{1}0\.87/)).toBeTruthy();
    // Caveats section + note
    expect(screen.getByTestId("caveats-card")).toBeTruthy();
    expect(screen.getByText(/Circuito stimato dal solo layout/)).toBeTruthy();
    expect(screen.getByText(/Confidenza complessiva: Media/)).toBeTruthy();
    expect(screen.getByText(/non una previsione del risultato/i)).toBeTruthy();
  });
});

describe("GpPreview page", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders empty state when no next GP is mapped", async () => {
    vi.doMock("@/lib/circuitProfiles", async () => {
      const actual = await vi.importActual<typeof import("@/lib/circuitProfiles")>(
        "@/lib/circuitProfiles",
      );
      return { ...actual, getCircuitProfileForNextGP: () => null };
    });
    vi.doMock("@/lib/f1Calendar2026", async () => {
      const actual = await vi.importActual<typeof import("@/lib/f1Calendar2026")>(
        "@/lib/f1Calendar2026",
      );
      return { ...actual, getNextSession: () => null };
    });
    const { default: GpPreview } = await import("../GpPreview");
    render(
      <MemoryRouter>
        <GpPreview />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Nessun Gran Premio mappato in arrivo/i)).toBeTruthy();
  });

  it("does not start computation on mount (on-demand)", async () => {
    const carProfiles = await import("@/lib/carProfiles");
    const spy = vi.mocked(carProfiles.computeCarProfiles);
    spy.mockClear();
    vi.doMock("@/lib/circuitProfiles", async () => {
      const actual = await vi.importActual<typeof import("@/lib/circuitProfiles")>(
        "@/lib/circuitProfiles",
      );
      return {
        ...actual,
        getCircuitProfileForNextGP: () => circuit,
      };
    });
    const { default: GpPreview } = await import("../GpPreview");
    render(
      <MemoryRouter>
        <GpPreview />
      </MemoryRouter>,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Analizza i team/i })).toBeTruthy();
  });
});
