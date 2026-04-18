import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NarrativeChapters } from "../NarrativeChapters";
import type { NarrativeChapter, NarrativeEvent } from "@/lib/narrative/types";

function ev(id: string, text: string, priority: NarrativeEvent["priority"] = "supporting"): NarrativeEvent {
  return {
    id,
    category: "scenario",
    priority,
    target: "global",
    data: {},
    prerendered_text: text,
  };
}

describe("NarrativeChapters", () => {
  it("falls back to flat list when chapters is empty", () => {
    render(
      <NarrativeChapters
        chapters={[]}
        insightsFallback={["Primo insight legacy", "Secondo insight legacy"]}
      />,
    );
    expect(screen.getByTestId("narrative-chapters-fallback")).toBeTruthy();
    expect(screen.getByText("Primo insight legacy")).toBeTruthy();
    expect(screen.getByText("Secondo insight legacy")).toBeTruthy();
  });

  it("renders title, headline, and events for a chapter", () => {
    const chapter: NarrativeChapter = {
      id: "chapter_0_opening",
      phase: "OPENING",
      title: "Primo stint (giri 1-20)",
      lap_range: [1, 20],
      headline: "Apertura solida con gomme medie",
      events: [ev("e1", "Pace stabile a 1:23.4"), ev("e2", "Gap dal leader 2.1s")],
      outcome: null,
      priority_max: "supporting",
    };
    render(<NarrativeChapters chapters={[chapter]} insightsFallback={[]} />);
    expect(screen.getByText("Primo stint (giri 1-20)")).toBeTruthy();
    expect(screen.getByText("Apertura solida con gomme medie")).toBeTruthy();
    expect(screen.getByText("Pace stabile a 1:23.4")).toBeTruthy();
    expect(screen.getByText("Gap dal leader 2.1s")).toBeTruthy();
  });

  it("applies critical accent border when priority_max is critical", () => {
    const chapter: NarrativeChapter = {
      id: "chapter_1_critical",
      phase: "CRITICAL",
      title: "Il degrado morde",
      lap_range: [21, 35],
      headline: "Cliff sulle medie",
      events: [ev("c1", "Cliff detected al giro 28", "critical")],
      outcome: null,
      priority_max: "critical",
    };
    const { container } = render(
      <NarrativeChapters chapters={[chapter]} insightsFallback={[]} />,
    );
    const trigger = container.querySelector('[data-priority-max="critical"]');
    expect(trigger).toBeTruthy();
    expect(trigger?.className).toContain("border-l-red-500");
  });

  it("opens OPENING/CRITICAL by default and keeps DEVELOPMENT/CLOSING + setup_analysis closed", () => {
    const chapters: NarrativeChapter[] = [
      {
        id: "setup_analysis",
        phase: "OPENING",
        title: "Setup dell'analisi",
        lap_range: null,
        headline: "Contesto",
        events: [ev("s1", "Mode ex-post")],
        outcome: null,
        priority_max: "context",
      },
      {
        id: "chapter_0_opening",
        phase: "OPENING",
        title: "Apertura",
        lap_range: [1, 10],
        headline: "Apertura headline",
        events: [ev("o1", "Open evt")],
        outcome: null,
        priority_max: "supporting",
      },
      {
        id: "chapter_1_development",
        phase: "DEVELOPMENT",
        title: "Sviluppo",
        lap_range: [11, 30],
        headline: "Dev headline",
        events: [ev("d1", "Dev evt")],
        outcome: null,
        priority_max: "supporting",
      },
      {
        id: "chapter_2_critical",
        phase: "CRITICAL",
        title: "Critico",
        lap_range: [31, 40],
        headline: "Crit headline",
        events: [ev("cr1", "Crit evt", "critical")],
        outcome: null,
        priority_max: "critical",
      },
      {
        id: "chapter_3_closing",
        phase: "CLOSING",
        title: "Finale",
        lap_range: [41, 50],
        headline: "Close headline",
        events: [ev("cl1", "Close evt")],
        outcome: null,
        priority_max: "supporting",
      },
    ];
    const { container } = render(
      <NarrativeChapters chapters={chapters} insightsFallback={[]} />,
    );
    const stateOf = (id: string) =>
      container
        .querySelector(`[data-testid="chapter-trigger-${id}"]`)
        ?.getAttribute("data-state");
    expect(stateOf("setup_analysis")).toBe("closed");
    expect(stateOf("chapter_0_opening")).toBe("open");
    expect(stateOf("chapter_1_development")).toBe("closed");
    expect(stateOf("chapter_2_critical")).toBe("open");
    expect(stateOf("chapter_3_closing")).toBe("closed");
  });

  it("renders outcome when present", () => {
    const chapter: NarrativeChapter = {
      id: "chapter_critical_to_closing",
      phase: "CRITICAL",
      title: "Critico",
      lap_range: [20, 30],
      headline: "Headline",
      events: [ev("e1", "Evt", "critical")],
      outcome: "La situazione si stabilizza dopo il pit al giro 30",
      priority_max: "critical",
    };
    render(<NarrativeChapters chapters={[chapter]} insightsFallback={[]} />);
    expect(
      screen.getByText("La situazione si stabilizza dopo il pit al giro 30"),
    ).toBeTruthy();
  });
});
