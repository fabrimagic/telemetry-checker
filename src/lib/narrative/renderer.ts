/**
 * Narrative renderer
 * ──────────────────
 * Turns a flat list of NarrativeEvent into the final string buckets consumed
 * by the VRE result.
 *
 * Refactor phase contract:
 *   • `prerendered_text` is the ONLY source of truth for text.
 *   • Insertion order is preserved within each bucket.
 *   • Events without `prerendered_text` are silently skipped (template engine
 *     will be introduced in a later phase). This is safe because the migration
 *     always populates `prerendered_text` with the original literal.
 *   • Lever 1: when `opts` provides race shape (totalLaps, actualPitLaps) the
 *     renderer also produces `chapters`. Otherwise `chapters` is [].
 *   • Lever 2: events with `because_of` get an inline annotation
 *     " (conseguenza di [descrizione])" appended to their text, when the source
 *     event is present in the same batch. Broken chains are silent.
 */

import type { NarrativeEvent, RenderedNarrative } from "./types";
import { buildChapters } from "./chapters";

export interface RenderNarrativeOptions {
  totalLaps?: number;
  actualPitLaps?: number[];
}

const CATEGORY_LABEL: Record<string, string> = {
  pace_loss: "calo di passo",
  cumulative_deviation: "deviazione cumulativa",
  weather: "cambio meteo",
  neutralization: "neutralizzazione",
  degradation_quality: "degrado anomalo",
};

/**
 * Pure, deterministic. Builds a short Italian phrase describing the cause
 * event. Never throws. Used for Lever 2 inline causal annotations.
 */
export function describeCause(sourceEvent: NarrativeEvent): string {
  const label = CATEGORY_LABEL[sourceEvent.category] ?? sourceEvent.category;
  if (typeof sourceEvent.lap === "number" && Number.isFinite(sourceEvent.lap)) {
    return `${label} dal giro ${sourceEvent.lap}`;
  }
  return label;
}

/** Builds the inline annotation text or returns null if chain is broken. */
function buildCausalAnnotation(
  ev: NarrativeEvent,
  byId: Map<string, NarrativeEvent>,
): string | null {
  if (!ev.because_of || ev.because_of.length === 0) return null;
  for (const causeId of ev.because_of) {
    const cause = byId.get(causeId);
    if (cause) {
      return ` (conseguenza di ${describeCause(cause)})`;
    }
  }
  return null;
}

export function renderNarrative(
  events: NarrativeEvent[],
  opts?: RenderNarrativeOptions,
): RenderedNarrative {
  const insights: string[] = [];
  const recommended_pros: string[] = [];
  const recommended_cons: string[] = [];
  const alternatives = new Map<number, { pros: string[]; cons: string[] }>();

  // Lever 2: build id → event lookup once.
  const byId = new Map<string, NarrativeEvent>();
  for (const ev of events) {
    if (ev.id) byId.set(ev.id, ev);
  }

  for (const ev of events) {
    const base = ev.prerendered_text;
    if (base == null) continue; // templates not implemented in this phase

    const annotation = buildCausalAnnotation(ev, byId);
    const text = annotation ? base + annotation : base;

    if (ev.target === "global") {
      insights.push(text);
    } else if (ev.target === "recommended") {
      if (ev.side === "con") recommended_cons.push(text);
      else recommended_pros.push(text);
    } else if (ev.target === "alternative" && ev.target_index != null) {
      let bucket = alternatives.get(ev.target_index);
      if (!bucket) {
        bucket = { pros: [], cons: [] };
        alternatives.set(ev.target_index, bucket);
      }
      if (ev.side === "con") bucket.cons.push(text);
      else bucket.pros.push(text);
    }
  }

  const chapters =
    opts && typeof opts.totalLaps === "number" && Array.isArray(opts.actualPitLaps)
      ? buildChapters(events, opts.totalLaps, opts.actualPitLaps)
      : [];

  return {
    insights,
    recommended_pros,
    recommended_cons,
    recommended_reason_suffix: "",
    recommended_description_suffix: "",
    alternatives,
    chapters,
  };
}
