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

/** Threshold used purely for prose coloring. */
const HIGH_TRAIT = 0.7;

/**
 * Minimum spread max−min across the three per-type corner values (slow/medium/
 * fast) required to TREAT the per-type estimate as actually differentiating.
 * Below this threshold the three numbers are nearly identical and pretending
 * they represent a true per-type strength is misleading: the UI shows a single
 * aggregate value, the narrative avoids per-type claims.
 *
 * Calibration note: 0.05 on a 0..1 index corresponds to about 5% of the
 * normalized span — sectors that disagree by less than this are noise-level on
 * the data we have (e.g. Ferrari 0.64/0.64/0.63, spread 0.002 ≪ 0.05).
 */
export const CORNER_TYPE_SPREAD_MIN = 0.05;

export interface CornerTypeValues {
  slow: number;
  medium: number;
  fast: number;
}

export function cornerTypeSpread(v: CornerTypeValues): number {
  return (
    Math.max(v.slow, v.medium, v.fast) - Math.min(v.slow, v.medium, v.fast)
  );
}

export function cornerTypeMean(v: CornerTypeValues): number {
  return (v.slow + v.medium + v.fast) / 3;
}

export function isCornerTypeDifferentiating(
  v: CornerTypeValues | null | undefined,
): boolean {
  if (!v) return false;
  return cornerTypeSpread(v) >= CORNER_TYPE_SPREAD_MIN;
}


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
  // OPZIONE Z + sectors_only: il punteggio è la PERSISTENZA pura calcolata
  // sui SOLI tempi di settore (mean(s1,s2,s3)). La trap speed è esclusa
  // perché dipende dal carico aerodinamico più che dalla performance pura
  // e il backtest ha mostrato che includerla peggiora la previsione.
  sentences.push(
    "Il punteggio di affinità è un indice da 0 a 1 che riflette la tenuta nei tempi di settore espressa da ciascuna vettura nelle gare già disputate (media di s1, s2 e s3). È una lettura della forza recente in curva — dove si fanno la maggior parte dei decimi — non una previsione del risultato di gara. Il carattere specifico di questo circuito è descritto sopra come contesto, ma non entra nel punteggio.",
  );
  sentences.push(
    "La velocità massima rilevata a fine rettilineo (trap speed) compare nei dettagli tecnici come contesto, ma NON è usata nel punteggio: dipende anche dal livello di carico aerodinamico scelto dal team — un valore alto può riflettere un'ala più scarica, non necessariamente più cavalli — e il backtest ha confermato che includerla nel punteggio peggiora la previsione rispetto al fondarsi sui soli tempi di settore. Per leggerla onestamente va trattata come \"velocità raggiunta in quel punto\", non come misura della potenza del motore.",
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

  // ----- 3. TEAM FAVORITI E PERCHÉ (basato sulla persistenza sui settori) -----
  {
    const ranked = prediction.ranked;
    const leader = ranked[0];

    const leaderGroup = prediction.indistinguishable_groups.find((g) =>
      g.includes(leader.team_name),
    );
    const topNames = leaderGroup ?? [leader.team_name];
    const topTeams = ranked.filter((t) => topNames.includes(t.team_name));

    const because =
      "il loro punteggio riflette la tenuta media nei tempi di settore (s1, s2 e s3) delle gare recenti, non un giudizio sul match con questo circuito";

    if (topTeams.length > 1) {
      sentences.push(
        `Sui dati delle ultime gare, ${joinNames(
          topTeams.map((t) => t.team_name),
        )} risultano sostanzialmente equivalenti in cima alla classifica di forza recente: i loro punteggi cadono nella stessa banda di incertezza ed è quindi arbitrario ordinarli fra loro — ${because}.`,
      );
      sentences.push(
        "Più team finiscono nello stesso gruppo di equivalenza quando i dati disponibili non sono abbastanza precisi da separarli: presentarli appaiati è più onesto che assegnare un favorito unico.",
      );
    } else {
      sentences.push(
        `Sui dati delle ultime gare, ${leader.team_name} risulta tra i team più forti del campo: ${because}.`,
      );
    }
  }

  // ----- 4. CHI POTREBBE FATICARE (sulla persistenza sui settori) -----
  {
    const ranked = prediction.ranked;
    if (ranked.length >= 3) {
      const last = ranked[ranked.length - 1];
      const leaderGroup = prediction.indistinguishable_groups.find((g) =>
        g.includes(ranked[0].team_name),
      );
      if (!leaderGroup || !leaderGroup.includes(last.team_name)) {
        sentences.push(
          `${last.team_name} risulta invece tra i meno forti nei tempi di settore delle gare recenti.`,
        );
      }
    }
  }

  // ----- 4b. ORIGINE DELLA DIMENSIONE "TIPO DI CURVA" -----
  {
    const ranked = prediction.ranked;
    const geom = ranked.filter((t) => t.corner_source === "location_geometry");
    const history = ranked.filter((t) => t.corner_source === "sector_typed_history");
    const fallback = ranked.filter((t) => t.corner_source === "sector_fallback");
    if (geom.length > 0) {
      sentences.push(
        `Per ${geom.length === 1 ? "un team" : `${geom.length} team`} (${joinNames(geom.map((t) => t.team_name))}) la valutazione per tipo di curva — lente, medie e veloci — è ricostruita incrociando la geometria del circuito con la posizione GPS delle vetture in qualifica. È una lettura più granulare, ma sperimentale: l'allineamento spaziale può contenere imprecisioni, quindi va interpretata con prudenza.`,
      );
    }
    if (history.length > 0) {
      sentences.push(
        `Per ${history.length === 1 ? "un team" : `${history.length} team`} (${joinNames(history.map((t) => t.team_name))}) la valutazione per tipo di curva — lente, medie e veloci — è stimata dalla loro prestazione nei settori delle gare già disputate quest'anno, classificati in base al carattere di ciascun circuito. È una lettura più ricca della semplice media in curva, fondata sui dati reali delle gare precedenti.`,
      );
    }
    if (fallback.length > 0 && (geom.length > 0 || history.length > 0)) {
      sentences.push(
        `Per ${fallback.length === 1 ? "il team rimanente" : `i ${fallback.length} team rimanenti`} (${joinNames(fallback.map((t) => t.team_name))}) non è disponibile una stima per tipo: la tenuta in curva viene quindi calcolata dai tempi di settore aggregati, un metodo robusto ma meno granulare (non distingue fra curve lente, medie e veloci).`,
      );
    }
    // sector_typed branch with low map confidence: declare the approximation honestly.
    const sectorTyped = prediction.ranked.filter((t) => t.corner_source === "sector_typed");
    const lowMap = sectorTyped.filter((t) => t.sector_corner_map_confidence === "low");
    if (lowMap.length > 0) {
      sentences.push(
        `Per questo circuito la classificazione per-settore (lente/medie/veloci) è meno solida nelle fonti pubbliche: la stima per tipo di curva va quindi trattata come approssimata.`,
      );
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
      appendExclusionDetail(sentences, dataContext.diagnostics ?? []);
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
    appendExclusionDetail(sentences, dataContext.diagnostics ?? []);
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

  // Qualifying-source caveat: among the USED GPs, count those for which
  // the standard Qualifying session was not available. In those GPs the
  // top-speed signal comes from race trim only, which is depressed by
  // engine/fuel/ERS management → flag it for honesty.
  const usedDiags = diagnostics.filter((d) => d.status === "used");
  const missingQuali = usedDiags.filter((d) => d.sources && d.sources.quali === false);
  if (usedDiags.length > 0 && missingQuali.length > 0) {
    const names = missingQuali.map((d) => d.name);
    sentences.push(
      `Inoltre, per ${missingQuali.length === 1 ? "la gara" : `${missingQuali.length} gare`} (${joinNames(names)}) non era disponibile la sessione di qualifica: per ${missingQuali.length === 1 ? "quella" : "quelle"} il dato di velocità di punta arriva solo dal passo gara, che è meno indicativo del vero potenziale del motore.`,
    );
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

  // OPZIONE Z + sectors_only: il punteggio NON dipende dal carattere del
  // circuito né dalla trap speed. Si fonda sulla tenuta nei tempi di
  // settore. La frase per-team lo dichiara esplicitamente.
  return ranked.map((t, i) => {
    const where = positionPhrase(i, ranked.length);

    const strengthClause =
      `Il suo punteggio (${t.affinity_score.toFixed(2)}) misura la tenuta media nei tempi di settore (s1, s2 e s3) delle gare recenti — la velocità massima rilevata a fine rettilineo (trap) non entra nel calcolo perché dipende dalle scelte aerodinamiche e il backtest ha mostrato che includerla peggiora la previsione`;

    let equivClause = "";
    const group = groupByTeam.get(t.team_name);
    if (group && group.length > 1) {
      const others = group.filter((n) => n !== t.team_name);
      equivClause = ` Il suo punteggio è troppo vicino a quello di ${joinNames(others)} per distinguerli con certezza con i dati attuali: vanno considerati alla pari.`;
    }

    // Limit telaio/motore: i tempi di settore includono anche tratti in
    // rettilineo, quindi quanto la vettura "tiene in curva" deriva da una
    // misura mista, non isolata dalla potenza del motore.
    const chassisEngineDisclosure =
      " Va letto come stima derivata dai tempi di settore (che includono anche i tratti in rettilineo): una vettura con poca potenza può quindi risultare più debole in curva di quanto il suo telaio sia in realtà.";

    // Per-type honesty: se i tre numeri sono quasi identici, NON affermare
    // forza/debolezza per tipo specifico.
    const differentiated = isCornerTypeDifferentiating(t.corner_type_values);

    let sourceClause = "";
    if (t.corner_source === "location_geometry") {
      const covPct =
        typeof t.corner_coverage === "number"
          ? ` (copertura dei dati GPS circa ${Math.round(t.corner_coverage * 100)}%)`
          : "";
      if (differentiated) {
        sourceClause = ` Come contesto (non usato nel punteggio): la tenuta in curva per tipo (lente/medie/veloci) è ricostruita dalla geometria del tracciato e dalla posizione GPS in qualifica${covPct}.${chassisEngineDisclosure}`;
      } else {
        sourceClause = ` Come contesto (non usato nel punteggio): la prestazione nei tre tipi di curva (lente/medie/veloci) risulta sostanzialmente uniforme${covPct}: i dati non permettono di distinguere la sua forza per tipo di curva.${chassisEngineDisclosure}`;
      }
    } else if (t.corner_source === "sector_typed_history") {
      if (differentiated) {
        sourceClause = ` Come contesto (non usato nel punteggio): la tenuta in curva è stimata per tipo (lente/medie/veloci) dalla prestazione nei settori delle gare precedenti, classificati per carattere — è una lettura più granulare ma, per ora, descrittiva.${chassisEngineDisclosure}`;
      } else {
        sourceClause = ` Come contesto (non usato nel punteggio): la prestazione nei settori delle gare precedenti risulta uniforme tra i tipi di curva (lente/medie/veloci): i dati non permettono di distinguere la sua forza per tipo di curva.${chassisEngineDisclosure}`;
      }
    } else if (t.corner_source === "sector_typed") {
      if (differentiated) {
        sourceClause = ` Come contesto (non usato nel punteggio): la tenuta in curva è stimata per tipo (lente/medie/veloci) a partire dalla prestazione nei diversi settori del circuito — descrittiva, non predittiva.${chassisEngineDisclosure}`;
      } else {
        sourceClause = ` Come contesto (non usato nel punteggio): la stima per tipo (lente/medie/veloci) ricavata dai diversi settori del circuito risulta uniforme: i dati non permettono di distinguere la sua forza per tipo di curva.${chassisEngineDisclosure}`;
      }
    } else if (t.corner_source === "sector_fallback") {
      sourceClause = ` La tenuta in curva di questo team è disponibile solo dai tempi di settore aggregati (non è disponibile la ricostruzione per tipo di curva).${chassisEngineDisclosure}`;
    }

    const text = `${t.team_name} ${where}. ${strengthClause}.${equivClause}${sourceClause}`;
    return { team_name: t.team_name, text };
  });
}

