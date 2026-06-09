import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RaceEventTimeline } from "../RaceEventTimeline";
import type { DiaryEvent } from "@/lib/raceDiary";

function ev(partial: Partial<DiaryEvent>): DiaryEvent {
  return {
    type: "RACE_CONTROL",
    date: "2024-01-01T00:00:00Z",
    lapNumber: 1,
    description: "evento",
    details: {},
    ...partial,
  } as DiaryEvent;
}

describe("RaceEventTimeline", () => {
  it("rende una icona per ogni evento con lapNumber", () => {
    const events = [
      ev({ type: "OVERTAKE_DONE", lapNumber: 3, description: "sorpasso" }),
      ev({ type: "PIT_STOP", lapNumber: 10, description: "pit" }),
      ev({ type: "OVERTAKE_RECEIVED", lapNumber: 15, description: "subito" }),
    ];
    render(<RaceEventTimeline events={events} driverAcronym="VER" driverColor="0600EF" />);
    expect(screen.getByTestId("race-event-timeline")).toBeInTheDocument();
    expect(screen.getByText(/3 eventi/)).toBeInTheDocument();
  });

  it("distingue neutralizzazione dalle altre Race Control via legenda", () => {
    const events = [
      ev({ type: "RACE_CONTROL", lapNumber: 5, impact_tags: ["race_control"] }),
      ev({ type: "RACE_CONTROL", lapNumber: 8, impact_tags: ["neutralization", "safety"] }),
    ];
    render(<RaceEventTimeline events={events} driverAcronym="HAM" driverColor="00D2BE" />);
    expect(screen.getAllByText("Race Control").length).toBeGreaterThan(0);
    expect(screen.getByText("Neutralizzazione")).toBeInTheDocument();
  });

  it("mostra stato vuoto pulito senza eventi", () => {
    render(<RaceEventTimeline events={[]} driverAcronym="LEC" driverColor="DC0000" />);
    expect(screen.getByText(/Nessun evento per questa sessione/i)).toBeInTheDocument();
  });

  it("ignora eventi senza lapNumber", () => {
    const events = [
      ev({ type: "OVERTAKE_DONE", lapNumber: null, description: "no lap" }),
      ev({ type: "PIT_STOP", lapNumber: 4, description: "pit" }),
    ];
    render(<RaceEventTimeline events={events} driverAcronym="NOR" driverColor="FF8700" />);
    expect(screen.getByText(/1 eventi/)).toBeInTheDocument();
  });

  it("filtra BATTLE per default", () => {
    const events = [
      ev({ type: "BATTLE", lapNumber: 3, description: "duello" }),
      ev({ type: "PIT_STOP", lapNumber: 5, description: "pit" }),
    ];
    render(<RaceEventTimeline events={events} driverAcronym="SAI" driverColor="DC0000" />);
    expect(screen.getByText(/1 eventi/)).toBeInTheDocument();
    expect(screen.queryByText("Battaglia")).not.toBeInTheDocument();
  });

  it("impila eventi sullo stesso giro con overflow badge", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      ev({ type: "RACE_CONTROL", lapNumber: 7, description: `rc ${i}`, date: `2024-01-01T00:00:0${i}Z` }),
    );
    render(<RaceEventTimeline events={events} driverAcronym="PIA" driverColor="FF8700" />);
    expect(screen.getByText(/\+2/)).toBeInTheDocument();
  });
});
