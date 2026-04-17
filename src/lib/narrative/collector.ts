/**
 * NarrativeCollector
 * ──────────────────
 * Pure in-memory collector. Preserves insertion order — critical because the
 * UI presentation order mirrors insertion order in the original VRE.
 */

import type { NarrativeCategory, NarrativeEvent } from "./types";

export class NarrativeCollector {
  private events: NarrativeEvent[] = [];

  add(event: NarrativeEvent): void {
    this.events.push(event);
  }

  addMany(events: NarrativeEvent[]): void {
    for (const e of events) this.events.push(e);
  }

  getAll(): NarrativeEvent[] {
    return this.events.slice();
  }

  getByCategory(cat: NarrativeCategory): NarrativeEvent[] {
    return this.events.filter((e) => e.category === cat);
  }
}
