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
 */

import type { NarrativeEvent, RenderedNarrative } from "./types";
import { buildChapters } from "./chapters";

export interface RenderNarrativeOptions {
  totalLaps?: number;
  actualPitLaps?: number[];
}

export function renderNarrative(
  events: NarrativeEvent[],
  opts?: RenderNarrativeOptions,
): RenderedNarrative {
  const insights: string[] = [];
  const recommended_pros: string[] = [];
  const recommended_cons: string[] = [];
  const alternatives = new Map<number, { pros: string[]; cons: string[] }>();

  for (const ev of events) {
    const text = ev.prerendered_text;
    if (text == null) continue; // templates not implemented in this phase

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
