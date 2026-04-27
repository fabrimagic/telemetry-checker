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
import { selectTemplate } from "./templates";

export interface RenderNarrativeOptions {
  totalLaps?: number;
  actualPitLaps?: number[];
  /** Lever 3: enables template-based variant selection. When omitted, all
   *  events keep their original prerendered_text (backward-compatible). */
  session_key?: number;
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

  // Build annotated event list (preserves order); chapters reuse it so the
  // causal annotation appears inside chapter rendering as well.
  // Lever 3 + Lever 2 pipeline:
  //   1. Pick a templated variant if session_key is provided and the category
  //      is supported. Fallback to prerendered_text on any mismatch.
  //   2. Append the causal annotation (Lever 2) to the resulting text.
  const annotatedEvents: NarrativeEvent[] = events.map((ev) => {
    if (ev.prerendered_text == null) return ev;
    let baseText = ev.prerendered_text;
    if (opts?.session_key != null && ev.id) {
      const templated = selectTemplate(ev.category, {
        data: ev.data,
        lap: ev.lap,
        session_key: opts.session_key,
        event_id: ev.id,
      });
      if (templated != null) baseText = templated;
    }
    const annotation = buildCausalAnnotation(ev, byId);
    const finalText = annotation ? baseText + annotation : baseText;
    if (finalText === ev.prerendered_text) return ev;
    return { ...ev, prerendered_text: finalText };
  });

  for (const ev of annotatedEvents) {
    const text = ev.prerendered_text;
    if (text == null) continue;

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
      ? buildChapters(annotatedEvents, opts.totalLaps, opts.actualPitLaps)
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
