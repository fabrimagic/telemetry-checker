/**
 * Narrative system — public types
 * ────────────────────────────────
 * Structured representation of every narrative push the VRE performs.
 * In this refactor phase, every event carries a `prerendered_text` that is
 * IDENTICAL bit-per-bit to the original literal pushed to `narrativeInsights`,
 * `recommendedStrategy.pros/cons` or `alt.pros/cons`. No template engine yet.
 *
 * Anti-hallucination: this file is types-only. No logic.
 */

export type NarrativeCategory =
  | "mode_context"
  | "degradation_quality"
  | "raw_vs_corrected"
  | "pace_loss"
  | "cumulative_deviation"
  | "battle_context"
  | "weather"
  | "neutralization"
  | "warmup"
  | "scenario"
  | "risk_scoring"
  | "soft_sensor_scoring"
  | "traffic"
  | "robustness"
  | "competitor"
  | "overtake_difficulty"
  | "cliff"
  | "pit_window"
  | "diary";

export type NarrativePriority = "critical" | "supporting" | "context";

export type NarrativeTarget = "global" | "recommended" | "alternative";

export interface NarrativeEvent {
  id: string;
  category: NarrativeCategory;
  priority: NarrativePriority;
  target: NarrativeTarget;
  /** Index in alternatives[]; required when target = "alternative". */
  target_index?: number;
  lap?: number;
  data: Record<string, unknown>;
  /**
   * Pre-rendered string. During the refactor this is the ONLY source of text
   * (templates will be introduced in a later phase). Bypasses any template logic.
   */
  prerendered_text?: string;
  /** For target = "recommended" or "alternative": classifies as pro or con. */
  side?: "pro" | "con";
  /** Lever 2: IDs of preceding events that caused this one. Renderer uses the first found in collector. */
  because_of?: string[];
  /** Lever 2: IDs of subsequent events caused by this one (informational, not used by renderer). */
  triggers?: string[];
}

export interface RenderedNarrative {
  insights: string[];
  recommended_pros: string[];
  recommended_cons: string[];
  recommended_reason_suffix: string;
  recommended_description_suffix: string;
  alternatives: Map<number, { pros: string[]; cons: string[] }>;
  chapters: NarrativeChapter[];
}

/* ── Lever 1: narrative chapters (additive) ────────────────────── */

export type NarrativePhase = "OPENING" | "DEVELOPMENT" | "CRITICAL" | "CLOSING";

export interface NarrativeChapter {
  id: string;
  phase: NarrativePhase;
  title: string;
  lap_range: [number, number] | null;
  /** Max 120 chars. */
  headline: string;
  events: NarrativeEvent[];
  outcome: string | null;
  priority_max: NarrativePriority;
}
