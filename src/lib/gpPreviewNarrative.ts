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

export interface RaceDiagnosticLite {
  name: string;
  date_end: string;
  status: "used" | "no_data" | "fetch_failed";
  /** Which sessions contributed to this GP. Optional for back-compat. */
  sources?: { quali: boolean; race: boolean };
}

export interface NarrativeDataContext {
  totalPastRaces?: number;
  racesConsidered?: number;
  racesWithData?: number;
  diagnostics?: RaceDiagnosticLite[];
}

function confidenceItalian(c: "high" | "medium" | "low"): string {
  return c === "high" ? "alta" : c === "medium" ? "media" : "bassa";
}

function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** Format a ratio in [0,1] as a readable Italian fraction phrase. */
function ratioPhrase(r: number): string {
  if (!Number.isFinite(r)) return "in parte";
  if (r >= 0.78) return "in larghissima parte";
  if (r >= 0.68) return "per circa tre quarti";
  if (r >= 0.6) return "per circa due terzi";
  if (r >= 0.52) return "per poco più della metà";
  if (r >= 0.48) return "per circa metà";
  if (r >= 0.4) return "per poco meno della metà";
  if (r >= 0.32) return "per circa un terzo";
  if (r >= 0.22) return "per circa un quarto";
  return "in piccola parte";
}

export function buildGpPreviewNarrative(
  circuit: CircuitProfile,
  prediction: GpPrediction,
  dataContext?: NarrativeDataContext,
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
    // Even with no teams, surface the data-context paragraph if available so the
    // user understands why.
    appendDataContextParagraph(sentences, dataContext);
    return sentences;
  }

  // ----- 2. COSA RAPPRESENTA IL PUNTEGGIO (didattica) -----
  sentences.push(
    "Il punteggio di affinità è un indice da 0 a 1 che stima quanto le caratteristiche misurate di ogni vettura — velocità di punta e tenuta in curva aggregata sui tre settori — si sposano con ciò che questo circuito richiede. Non è una previsione del risultato della gara, ma una lettura tecnica del match circuito-vettura sui dati raccolti finora.",
  );
  sentences.push(
    "La velocità di punta riflette soprattutto il potenziale espresso in qualifica, quando le vetture spingono al massimo con motore party-mode, ERS scarico, carburante minimo e gomma nuova; in gara la velocità di punta è invece compressa dalla gestione di gomme, motore ed energia e racconta meno del vero potenziale.",
  );

  // ----- 2b. COME LEGGERE LE BANDE DI INCERTEZZA -----
  {
    const ranked = prediction.ranked;
    const avgBand =
      ranked.reduce((s, t) => s + t.uncertainty, 0) / Math.max(1, ranked.length);
    const bandText = Number.isFinite(avgBand) ? `±${avgBand.toFixed(2)}` : "";
    sentences.push(
      `Ogni punteggio è accompagnato da una banda di incertezza${bandText ? ` (tipicamente ${bandText})` : ""} che riflette quanto i dati disponibili sono sufficienti a stimarlo: due team le cui bande si sovrappongono vanno considerati sostanzialmente equivalenti, perché la loro differenza rientra nell'errore di stima.`,
    );
  }

  // ----- 3. TEAM FAVORITI E PERCHÉ (esteso) -----
  {
    const ranked = prediction.ranked;
    const leader = ranked[0];

    const leaderGroup = prediction.indistinguishable_groups.find((g) =>
      g.includes(leader.team_name),
    );
    const topNames = leaderGroup ?? [leader.team_name];
    const topTeams = ranked.filter((t) => topNames.includes(t.team_name));

    // Aggregate dominant dimension across top teams.
    let sumTop = 0;
    let sumCorner = 0;
    for (const t of topTeams) {
      sumTop += t.contributions.top_speed;
      sumCorner += t.contributions.cornering;
    }
    const totalC = sumTop + sumCorner;
    const topRatio = totalC > 0 ? sumTop / totalC : 0.5;
    const cornerRatio = 1 - topRatio;

    let because: string;
    if (topRatio >= DOMINANT_TOP_RATIO) {
      because = `${ratioPhrase(topRatio)} grazie alla velocità di punta e ${ratioPhrase(cornerRatio)} grazie alla tenuta in curva`;
    } else if (cornerRatio >= DOMINANT_CORNER_RATIO) {
      because = `${ratioPhrase(cornerRatio)} grazie alla tenuta in curva e ${ratioPhrase(topRatio)} grazie alla velocità di punta`;
    } else {
      because = "grazie a un buon compromesso fra velocità di punta e tenuta in curva, senza una vera dimensione dominante";
    }

    if (topTeams.length > 1) {
      sentences.push(
        `Sui dati delle ultime gare, ${joinNames(
          topTeams.map((t) => t.team_name),
        )} risultano sostanzialmente equivalenti in cima alla classifica di affinità: i loro punteggi cadono nella stessa banda di incertezza ed è quindi arbitrario ordinarli fra loro. Il loro punteggio combinato deriva ${because}.`,
      );
      sentences.push(
        "Più team finiscono nello stesso gruppo di equivalenza quando i dati disponibili non sono abbastanza precisi da separarli: presentarli appaiati è più onesto che assegnare un favorito unico.",
      );
    } else {
      sentences.push(
        `Sui dati delle ultime gare, ${leader.team_name} sembra il team più in linea con questo tracciato: il suo punteggio deriva ${because}.`,
      );
    }
  }

  // ----- 4. CHI POTREBBE FATICARE (collegato al perché) -----
  {
    const ranked = prediction.ranked;
    if (ranked.length >= 3) {
      const last = ranked[ranked.length - 1];
      const leaderGroup = prediction.indistinguishable_groups.find((g) =>
        g.includes(ranked[0].team_name),
      );
      if (!leaderGroup || !leaderGroup.includes(last.team_name)) {
        const total =
          last.contributions.top_speed + last.contributions.cornering;
        const lastTopRatio = total > 0 ? last.contributions.top_speed / total : 0.5;
        // Identify which trait the circuit rewards most to explain the mismatch.
        const cornerMean =
          (circuit.slow_corner_traction + circuit.medium_corner + circuit.fast_corner) / 3;
        const circuitFavoursTop = circuit.top_speed >= cornerMean;
        let why: string;
        if (circuitFavoursTop && lastTopRatio < 0.5) {
          why = "perché il suo punto di forza è più nella tenuta in curva che nella velocità di punta, ed è questa seconda dimensione che il circuito premia di più";
        } else if (!circuitFavoursTop && lastTopRatio > 0.5) {
          why = "perché il suo punto di forza è più nella velocità di punta che nella tenuta in curva, ed è quest'ultima che il circuito premia di più";
        } else {
          why = "perché su entrambe le dimensioni misurate appare più indietro rispetto agli altri team";
        }
        sentences.push(
          `${last.team_name} potrebbe invece trovarsi meno a suo agio su questo tipo di tracciato, ${why}.`,
        );
      }
    }
  }

  // ----- 5. PARAGRAFO ESTESO SULLE GARE ESCLUSE -----
  appendDataContextParagraph(sentences, dataContext);

  // ----- 6. CAVEAT DI CONFIDENZA (richiamo breve, evita ripetizioni) -----
  {
    const confLabel = confidenceItalian(prediction.global_confidence);
    const hasExtendedDataParagraph =
      !!dataContext &&
      typeof dataContext.racesConsidered === "number" &&
      typeof dataContext.racesWithData === "number" &&
      dataContext.racesWithData < dataContext.racesConsidered;

    if (hasExtendedDataParagraph) {
      sentences.push(`Confidenza complessiva ${confLabel}, per i motivi appena esposti.`);
    } else {
      const noteText = prediction.notes.find((n) => /Profili vettura basati/i.test(n));
      if (noteText) {
        sentences.push(`Confidenza ${confLabel}: ${noteText}`);
      } else {
        sentences.push(`Confidenza ${confLabel} sull'analisi complessiva.`);
      }
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

/**
 * Builds the extended "what races were excluded and why" paragraph and
 * appends it to the sentences array. No-op when dataContext is missing or
 * when racesWithData === racesConsidered (only a short reassurance sentence
 * is added in that case).
 */
function appendDataContextParagraph(
  sentences: string[],
  dataContext?: NarrativeDataContext,
): void {
  if (!dataContext) return;
  const considered = dataContext.racesConsidered;
  const withData = dataContext.racesWithData;
  const total = dataContext.totalPastRaces;
  if (typeof considered !== "number" || typeof withData !== "number") return;

  // Detect the new "include all races, decay weights" mode: when considered
  // equals the total number of past races, no hard cutoff was applied.
  const consideringAll =
    typeof total === "number" && total > 0 && considered >= total;

  if (consideringAll) {
    if (withData >= considered) {
      sentences.push(
        `Nel 2026 si sono finora disputate ${total} gare; l'analisi le considera tutte, dando un peso maggiore alle più recenti per riflettere gli aggiornamenti tecnici delle vetture. Tutte le gare hanno fornito dati utilizzabili.`,
      );
      return;
    }
    sentences.push(
      `Nel 2026 si sono finora disputate ${total} gare; l'analisi le considera tutte, con peso maggiore alle più recenti per riflettere gli aggiornamenti tecnici delle vetture.`,
    );
    sentences.push(
      `Di queste ${considered}, solo ${withData} hanno fornito dati telemetrici completi (velocità ai rilevamenti e tempi di settore validi).`,
    );
    appendExclusionDetail(sentences, dataContext.diagnostics ?? []);
    sentences.push(
      "Meno gare con dati utilizzabili — soprattutto se mancano fra le più recenti, che pesano di più — significa che il campione effettivo (a peso pieno) resta limitato: è questo il motivo della confidenza più cauta. Quando i dati delle gare mancanti saranno disponibili, vale la pena rileggere l'analisi.",
    );
    return;
  }

  // Backward-compat branch: explicit lastNRaces cap was used.
  if (withData >= considered) {
    if (typeof total === "number" && total > 0) {
      sentences.push(
        `L'analisi si basa sui dati telemetrici delle ultime ${considered} gare disputate finora nel 2026 (su ${total} totali), tutte con dati utilizzabili.`,
      );
    } else {
      sentences.push(
        `L'analisi si basa sui dati telemetrici delle ultime ${considered} gare, tutte con dati utilizzabili.`,
      );
    }
    return;
  }

  if (typeof total === "number" && total > 0) {
    sentences.push(
      `Nel 2026 si sono finora disputate ${total} gare; per restare aderente all'evoluzione recente delle vetture, l'analisi considera solo le ultime ${considered}.`,
    );
  } else {
    sentences.push(
      `Per restare aderente all'evoluzione recente delle vetture, l'analisi considera solo le ultime ${considered} gare.`,
    );
  }
  sentences.push(
    `Di queste ${considered}, solo ${withData} hanno fornito dati telemetrici completi (velocità ai rilevamenti e tempi di settore validi).`,
  );
  appendExclusionDetail(sentences, dataContext.diagnostics ?? []);
  sentences.push(
    "Meno gare con dati utilizzabili significa stime più incerte: è questo il motivo della confidenza ridotta. Quando i dati delle gare mancanti saranno disponibili, vale la pena rileggere l'analisi.",
  );
}

function appendExclusionDetail(
  sentences: string[],
  diagnostics: RaceDiagnosticLite[],
): void {
  const excluded = diagnostics.filter((d) => d.status !== "used");
  const noData = excluded.filter((d) => d.status === "no_data").map((d) => d.name);
  const fetchFailed = excluded
    .filter((d) => d.status === "fetch_failed")
    .map((d) => d.name);

  const reasonParts: string[] = [];
  if (noData.length > 0) {
    const list = joinNames(noData);
    reasonParts.push(
      `${list} ${noData.length === 1 ? "è stata esclusa" : "sono state escluse"} perché i dati dettagliati di telemetria e settore di OpenF1 per le gare più recenti possono arrivare con ritardo o risultare incompleti al momento dell'analisi`,
    );
  }
  if (fetchFailed.length > 0) {
    const list = joinNames(fetchFailed);
    reasonParts.push(
      `${list} ${fetchFailed.length === 1 ? "è stata esclusa" : "sono state escluse"} perché il recupero dei dati da OpenF1 non è andato a buon fine al momento dell'analisi`,
    );
  }
  if (reasonParts.length > 0) {
    sentences.push(reasonParts.join("; ") + ".");
  }
}

// =====================================================================
// PER-TEAM explanations (Part 2) — accessible prose, one item per team.
// =====================================================================

export interface PerTeamExplanation {
  team_name: string;
  text: string;
}

/** Verbal label describing where the team's strength lies (for the UI mini-tag). */
export function strengthLabel(topPct: number): "rettilineo" | "curve" | "equilibrato" {
  if (topPct >= 60) return "rettilineo";
  if (topPct <= 40) return "curve";
  return "equilibrato";
}

function positionPhrase(index: number, total: number): string {
  if (total <= 1) return "è l'unico team analizzato in questa anteprima";
  const ratio = index / (total - 1);
  if (index === 0) return "risulta tra i team più in linea con questo circuito";
  if (ratio <= 0.34) return "si colloca tra i team più in linea con questo circuito";
  if (ratio >= 0.67) return "si colloca tra i meno favoriti su questo tracciato";
  return "si trova in una posizione intermedia della classifica di affinità";
}

function circuitFavoursTopSpeed(circuit: CircuitProfile): boolean {
  const cornerMean =
    (circuit.slow_corner_traction + circuit.medium_corner + circuit.fast_corner) / 3;
  return circuit.top_speed > cornerMean;
}

function circuitDimensionGap(circuit: CircuitProfile): number {
  const cornerMean =
    (circuit.slow_corner_traction + circuit.medium_corner + circuit.fast_corner) / 3;
  return Math.abs(circuit.top_speed - cornerMean);
}

export function buildPerTeamExplanations(
  circuit: CircuitProfile,
  prediction: GpPrediction,
): PerTeamExplanation[] {
  const ranked = prediction.ranked;
  if (ranked.length === 0) return [];

  const groupByTeam = new Map<string, string[]>();
  for (const g of prediction.indistinguishable_groups) {
    for (const name of g) groupByTeam.set(name, g);
  }

  const favoursTop = circuitFavoursTopSpeed(circuit);
  const circuitHasClearChar = circuitDimensionGap(circuit) >= 0.15;

  return ranked.map((t, i) => {
    const total = t.contributions.top_speed + t.contributions.cornering;
    const topPct = total > 0 ? Math.round((t.contributions.top_speed / total) * 100) : 50;
    const cornerPct = 100 - topPct;
    const where = positionPhrase(i, ranked.length);

    let strengthClause: string;
    if (topPct >= 60) {
      strengthClause = `Il suo punto di forza qui è soprattutto la velocità in rettilineo (circa il ${topPct}% del punteggio), mentre la tenuta in curva incide meno (circa il ${cornerPct}%)`;
    } else if (cornerPct >= 60) {
      strengthClause = `Il suo punto di forza qui è soprattutto la tenuta in curva (circa il ${cornerPct}% del punteggio), mentre la velocità in rettilineo conta meno (circa il ${topPct}%)`;
    } else {
      strengthClause = `Velocità in rettilineo e tenuta in curva contribuiscono in egual misura al punteggio (circa ${topPct}% e ${cornerPct}%)`;
    }

    let circuitLink = "";
    if (circuitHasClearChar) {
      if (favoursTop) {
        if (topPct >= 60) circuitLink = ", e questo circuito premia proprio i rettilinei: una combinazione favorevole";
        else if (cornerPct >= 60) circuitLink = ", ma questo circuito premia di più i rettilinei: una combinazione meno favorevole";
      } else {
        if (cornerPct >= 60) circuitLink = ", e questo circuito premia proprio la guida in curva: una combinazione favorevole";
        else if (topPct >= 60) circuitLink = ", ma questo circuito premia di più la guida in curva: una combinazione meno favorevole";
      }
    }

    let equivClause = "";
    const group = groupByTeam.get(t.team_name);
    if (group && group.length > 1) {
      const others = group.filter((n) => n !== t.team_name);
      equivClause = ` Il suo punteggio è troppo vicino a quello di ${joinNames(others)} per distinguerli con certezza con i dati attuali: vanno considerati alla pari.`;
    }

    const text = `${t.team_name} ${where}. ${strengthClause}${circuitLink}.${equivClause}`;
    return { team_name: t.team_name, text };
  });
}

