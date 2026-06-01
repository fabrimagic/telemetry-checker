/**
 * Pure narrative generator for the "Anteprima GP" page.
 *
 * Pattern mirrors src/lib/championshipNarrative.ts: deterministic, no fetch,
 * builds a string[] via sentences.push from the already-computed
 * CircuitProfile and GpPrediction. NO probabilities, NO predictions of race
 * results — only a prose readout of what the matching engine already
 * produced.
 */

import type { CircuitProfile } from "./circuitProfiles";
import type { GpPrediction } from "./gpPrediction";

/** Thresholds used purely for prose coloring. */
const HIGH_TRAIT = 0.7;
const DOMINANT_TOP_RATIO = 0.6; // contributions.top_speed / total ≥ this ⇒ "velocità di punta"
const DOMINANT_CORNER_RATIO = 0.6;

function confidenceItalian(c: "high" | "medium" | "low"): string {
  return c === "high" ? "alta" : c === "medium" ? "media" : "bassa";
}

function joinTeamNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export function buildGpPreviewNarrative(
  circuit: CircuitProfile,
  prediction: GpPrediction,
): string[] {
  const sentences: string[] = [];

  // ----- 1. CARATTERE DEL CIRCUITO -----
  {
    const dims: Array<{ key: string; label: string; value: number }> = [
      { key: "top_speed", label: "velocità di punta", value: circuit.top_speed },
      { key: "slow", label: "curve lente", value: circuit.slow_corner_traction },
      { key: "medium", label: "curve medie", value: circuit.medium_corner },
      { key: "fast", label: "curve veloci", value: circuit.fast_corner },
    ];
    const sorted = [...dims].sort((a, b) => b.value - a.value);
    const top = sorted[0];

    const cornerMean =
      (circuit.slow_corner_traction + circuit.medium_corner + circuit.fast_corner) / 3;

    let lead: string;
    if (top.key === "top_speed" && circuit.top_speed >= cornerMean) {
      lead = `Il circuito di ${circuit.gpName} premia soprattutto la velocità di punta e l'efficienza in rettilineo`;
    } else if (top.key === "slow") {
      lead = `Il circuito di ${circuit.gpName} premia la tenuta in curva, in particolare la trazione nelle curve lente`;
    } else if (top.key === "medium") {
      lead = `Il circuito di ${circuit.gpName} premia la tenuta in curva, in particolare nelle curve di media velocità`;
    } else if (top.key === "fast") {
      lead = `Il circuito di ${circuit.gpName} premia la tenuta in curva, in particolare nelle curve veloci`;
    } else {
      lead = `Il circuito di ${circuit.gpName} ha un profilo bilanciato fra rettilinei e curve`;
    }

    const extras: string[] = [];
    if (circuit.tyre_deg >= HIGH_TRAIT) extras.push("con elevato degrado gomme");
    if (circuit.overtaking_difficulty >= HIGH_TRAIT)
      extras.push("e sorpassi difficili, dove la qualifica pesa molto");

    sentences.push(`${lead}${extras.length > 0 ? ", " + extras.join(" ") : ""}.`);
  }

  // ----- Edge: nessun team -----
  if (prediction.ranked.length === 0) {
    sentences.push("Dati insufficienti per un'analisi dei team su questo circuito.");
    return sentences;
  }

  // ----- 2. TEAM FAVORITI E PERCHÉ -----
  {
    const ranked = prediction.ranked;
    const leader = ranked[0];

    // Find the indistinguishable group that contains the leader, if any.
    const leaderGroup = prediction.indistinguishable_groups.find((g) =>
      g.includes(leader.team_name),
    );

    // The "top group" we present together: either the leader's indistinguishable
    // group (if it includes the leader), otherwise just the leader alone.
    const topNames = leaderGroup ?? [leader.team_name];
    const topTeams = ranked.filter((t) => topNames.includes(t.team_name));

    // Aggregate dominant dimension across the top teams (sum contributions).
    let sumTop = 0;
    let sumCorner = 0;
    for (const t of topTeams) {
      sumTop += t.contributions.top_speed;
      sumCorner += t.contributions.cornering;
    }
    const totalC = sumTop + sumCorner;
    const topRatio = totalC > 0 ? sumTop / totalC : 0.5;

    let because: string;
    if (topRatio >= DOMINANT_TOP_RATIO) because = "soprattutto grazie alla velocità di punta";
    else if (1 - topRatio >= DOMINANT_CORNER_RATIO)
      because = "soprattutto grazie alla tenuta in curva";
    else because = "grazie a un buon compromesso fra velocità di punta e curve";

    if (topTeams.length > 1) {
      sentences.push(
        `Sui dati delle ultime gare, ${joinTeamNames(
          topTeams.map((t) => t.team_name),
        )} sembrano sostanzialmente equivalenti in cima alla classifica di affinità, ${because}.`,
      );
    } else {
      sentences.push(
        `Sui dati delle ultime gare, ${leader.team_name} sembra il team più adatto a questo tracciato, ${because}.`,
      );
    }
  }

  // ----- 3. CHI POTREBBE FATICARE -----
  {
    const ranked = prediction.ranked;
    if (ranked.length >= 3) {
      const last = ranked[ranked.length - 1];
      const leaderGroup = prediction.indistinguishable_groups.find((g) =>
        g.includes(ranked[0].team_name),
      );
      // Only mention a back-marker if it is NOT in the leaders' equivalence group.
      if (!leaderGroup || !leaderGroup.includes(last.team_name)) {
        sentences.push(
          `${last.team_name} potrebbe invece trovarsi meno a suo agio su questo tipo di tracciato.`,
        );
      }
    }
  }

  // ----- 4. CAVEAT DI CONFIDENZA -----
  {
    const noteText = prediction.notes.find((n) => /Profili vettura basati/i.test(n));
    const confLabel = confidenceItalian(prediction.global_confidence);
    if (noteText) {
      sentences.push(`Confidenza ${confLabel}: ${noteText}`);
    } else {
      sentences.push(`Confidenza ${confLabel} sull'analisi complessiva.`);
    }

    const overtakingNote = prediction.notes.find((n) => /sorpass/i.test(n));
    if (overtakingNote) {
      sentences.push(
        "Su questo circuito le caratteristiche tecniche pesano meno: il track position e la qualifica restano decisivi.",
      );
    }
  }

  return sentences;
}
