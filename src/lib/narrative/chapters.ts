/**
 * Narrative chapters (Lever 1)
 * ────────────────────────────
 * Pure, deterministic transformation of a flat list of NarrativeEvent into a
 * sequence of NarrativeChapter grouped by race phase.
 *
 * Rules:
 *  - Only events with target === "global" are considered.
 *  - Segmentation is driven by the actual pit laps (windows between pits).
 *  - No randomness, no Date-based variation.
 *  - No invented outcome text: only factual transitions populate `outcome`.
 *  - Empty windows produce no chapter (no placeholder strings).
 *  - Malformed inputs (totalLaps <= 0, etc.) → returns [].
 */

import type {
  NarrativeChapter,
  NarrativeEvent,
  NarrativePhase,
  NarrativePriority,
} from "./types";

const PRIORITY_RANK: Record<NarrativePriority, number> = {
  context: 0,
  supporting: 1,
  critical: 2,
};

/** Categories whose events are treated as "context" when missing a lap. */
const CAP_CONTEXT_CATEGORIES = new Set([
  "mode_context",
  "raw_vs_corrected",
  "degradation_quality",
  "scenario",
  "risk_scoring",
  "soft_sensor_scoring",
]);

interface Window {
  start: number;
  end: number;
  /** index in the pits array that closes this window (null = last/open window) */
  closingPitIdx: number | null;
}

function maxPriority(events: NarrativeEvent[]): NarrativePriority {
  let best: NarrativePriority = "context";
  for (const e of events) {
    if (PRIORITY_RANK[e.priority] > PRIORITY_RANK[best]) best = e.priority;
  }
  return best;
}

function truncate120(s: string): string {
  if (s.length <= 120) return s;
  return s.slice(0, 117) + "...";
}

function phaseLabelIt(phase: NarrativePhase): string {
  switch (phase) {
    case "OPENING": return "apertura";
    case "DEVELOPMENT": return "sviluppo";
    case "CRITICAL": return "fase critica";
    case "CLOSING": return "chiusura";
  }
}

function isCriticalEvent(e: NarrativeEvent): boolean {
  if (e.priority !== "critical") return false;
  // Strict trigger set per spec: pace_loss CRITICAL / cliff / cliff_risk
  if (e.category === "cliff") return true;
  if (e.category === "pace_loss") return true;
  return false;
}

function pickHeadline(events: NarrativeEvent[], phase: NarrativePhase): string {
  if (events.length === 0) {
    return `Contesto di ${phaseLabelIt(phase)}`;
  }
  // Highest priority, first inserted at parity (events keep insertion order).
  let best = events[0];
  for (let i = 1; i < events.length; i++) {
    if (PRIORITY_RANK[events[i].priority] > PRIORITY_RANK[best.priority]) {
      best = events[i];
    }
  }
  if (best.prerendered_text && best.prerendered_text.length > 0) {
    return truncate120(best.prerendered_text);
  }
  // No textual content available → fallback context line
  return `Contesto di ${phaseLabelIt(phase)}`;
}

function chapterTitle(
  phase: NarrativePhase,
  lapRange: [number, number] | null,
  events: NarrativeEvent[],
  windowIdx: number,
  isFirstStint: boolean,
  pitLapBefore: number | null,
): string {
  if (phase === "OPENING") {
    if (lapRange == null) return "Setup dell'analisi";
    return `Primo stint (giri ${lapRange[0]}-${lapRange[1]})`;
  }
  if (phase === "CLOSING") {
    if (lapRange == null) return "Il finale";
    return `Il finale (giri ${lapRange[0]}-${lapRange[1]})`;
  }
  if (phase === "CRITICAL") {
    // Deterministic on dominant critical-event category
    let dominant: string | null = null;
    let dominantRank = -1;
    for (const e of events) {
      const r = PRIORITY_RANK[e.priority];
      if (r > dominantRank) { dominantRank = r; dominant = e.category; }
    }
    if (dominant === "cliff") return "Il degrado morde";
    if (dominant === "pace_loss") return "Il passo cede";
    if (dominant === "battle_context") return "La pressione aumenta";
    return "Il momento critico";
  }
  // DEVELOPMENT
  if (isFirstStint) {
    return lapRange ? `Primo stint (giri ${lapRange[0]}-${lapRange[1]})` : "Sviluppo gara";
  }
  if (pitLapBefore != null) {
    return `Dopo il pit al giro ${pitLapBefore}`;
  }
  // Fallback by ordinal
  if (windowIdx === 1) return "Secondo stint";
  if (windowIdx === 2) return "Terzo stint";
  return `Stint ${windowIdx + 1}`;
}

export function buildChapters(
  events: NarrativeEvent[],
  totalLaps: number,
  actualPitLaps: number[],
): NarrativeChapter[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  if (typeof totalLaps !== "number" || !Number.isFinite(totalLaps) || totalLaps <= 0) return [];
  if (!Array.isArray(actualPitLaps)) return [];

  // Sanitize pit laps: in-range, sorted ascending, deduped.
  const cleanPits = Array.from(new Set(
    actualPitLaps
      .filter(p => typeof p === "number" && Number.isFinite(p) && p >= 1 && p <= totalLaps)
      .map(p => Math.floor(p))
  )).sort((a, b) => a - b);

  // Only globals participate.
  const globals = events.filter(e => e.target === "global");
  if (globals.length === 0) return [];

  // 2. Build windows
  const windows: Window[] = [];
  if (cleanPits.length === 0) {
    windows.push({ start: 1, end: totalLaps, closingPitIdx: null });
  } else {
    // W0
    windows.push({ start: 1, end: cleanPits[0], closingPitIdx: 0 });
    // intermediate
    for (let i = 1; i < cleanPits.length; i++) {
      const start = cleanPits[i - 1] + 1;
      const end = cleanPits[i];
      if (start <= end) windows.push({ start, end, closingPitIdx: i });
    }
    // last
    const lastPit = cleanPits[cleanPits.length - 1];
    if (lastPit < totalLaps) {
      windows.push({ start: lastPit + 1, end: totalLaps, closingPitIdx: null });
    }
  }

  // 3. Assign events to windows / cap-context bucket
  const windowEvents: NarrativeEvent[][] = windows.map(() => []);
  const capContext: NarrativeEvent[] = [];

  for (const ev of globals) {
    if (ev.lap != null && Number.isFinite(ev.lap) && ev.lap >= 1 && ev.lap <= totalLaps) {
      // Find window containing this lap
      let placed = false;
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        if (ev.lap >= w.start && ev.lap <= w.end) {
          windowEvents[i].push(ev);
          placed = true;
          break;
        }
      }
      if (!placed) {
        // Out of any window (e.g. lap > totalLaps post-sanitize) — drop into cap context
        capContext.push(ev);
      }
    } else {
      // No lap → cap context if category matches, else first window
      if (CAP_CONTEXT_CATEGORIES.has(ev.category)) {
        capContext.push(ev);
      } else if (windowEvents.length > 0) {
        windowEvents[0].push(ev);
      } else {
        capContext.push(ev);
      }
    }
  }

  // 4. Phase mapping
  const phases: NarrativePhase[] = windows.map((_, i) => {
    if (windows.length === 1) return "DEVELOPMENT";
    if (i === 0) return "OPENING";
    if (i === windows.length - 1) return "CLOSING";
    return "DEVELOPMENT";
  });
  // Promote to CRITICAL where critical events live (overrides DEVELOPMENT/OPENING/CLOSING)
  for (let i = 0; i < windows.length; i++) {
    if (windowEvents[i].some(isCriticalEvent)) {
      phases[i] = "CRITICAL";
    }
  }

  // 5. Cap context handling
  // If <= 2: merge into first OPENING window if any; else keep as dedicated chapter
  let setupChapter: NarrativeChapter | null = null;
  if (capContext.length > 0) {
    const openingIdx = phases.indexOf("OPENING");
    if (capContext.length <= 2 && openingIdx >= 0) {
      // Prepend so the setup context appears before per-lap events
      windowEvents[openingIdx] = [...capContext, ...windowEvents[openingIdx]];
    } else {
      const setupEvents = capContext;
      setupChapter = {
        id: "setup_analysis",
        phase: "OPENING",
        title: "Setup dell'analisi",
        lap_range: null,
        headline: pickHeadline(setupEvents, "OPENING"),
        events: setupEvents,
        outcome: null,
        priority_max: maxPriority(setupEvents),
      };
    }
  }

  // 6+7. Build per-window chapters
  const chapters: NarrativeChapter[] = [];
  if (setupChapter) chapters.push(setupChapter);

  for (let i = 0; i < windows.length; i++) {
    const evs = windowEvents[i];
    if (evs.length === 0) continue; // do not create empty chapters
    const w = windows[i];
    const phase = phases[i];
    const lapRange: [number, number] = [w.start, w.end];
    const isFirstStint = i === 0;
    const pitLapBefore = !isFirstStint ? cleanPits[i - 1] ?? null : null;
    const title = chapterTitle(phase, lapRange, evs, i, isFirstStint, pitLapBefore);
    const headline = pickHeadline(evs, phase);
    chapters.push({
      id: `chapter_${i}_${phase.toLowerCase()}`,
      phase,
      title,
      lap_range: lapRange,
      headline,
      events: evs,
      outcome: null,
      priority_max: maxPriority(evs),
    });
  }

  // 8. Outcome (factual only): CRITICAL → non-CRITICAL OR DEVELOPMENT → CLOSING
  // with a pit transition between them.
  for (let i = 0; i < chapters.length - 1; i++) {
    const cur = chapters[i];
    const next = chapters[i + 1];
    if (cur.id === "setup_analysis") continue;
    const transitionCriticalToNon = cur.phase === "CRITICAL" && next.phase !== "CRITICAL";
    const transitionDevToClosing = cur.phase === "DEVELOPMENT" && next.phase === "CLOSING";
    if (!transitionCriticalToNon && !transitionDevToClosing) continue;
    // Find the pit lap that separates the two windows: the lap at cur.lap_range[1]
    // matches a pit if cleanPits includes it.
    const sepLap = cur.lap_range ? cur.lap_range[1] : null;
    if (sepLap != null && cleanPits.includes(sepLap)) {
      cur.outcome = `La situazione si stabilizza dopo il pit al giro ${sepLap}`;
    }
  }

  return chapters;
}
