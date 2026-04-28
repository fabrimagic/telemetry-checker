/**
 * Lever 3 — Linguistic template variants
 * ──────────────────────────────────────
 * For 6 high-frequency narrative categories, replaces the fixed
 * `prerendered_text` with one of 3 semantically-equivalent variants chosen
 * deterministically from `(session_key, event_id)` and an intensity bucket
 * derived from `event.data`. Same race + same event always picks the same
 * variant; different races may pick different variants.
 *
 * Anti-hallucination contract:
 *   • Variants are SEMANTICALLY EQUIVALENT — they paraphrase the same fact
 *     and do NOT add or remove information.
 *   • Pure & deterministic. No Math.random, no Date.
 *   • Returns null whenever a placeholder cannot be filled — caller falls
 *     back to the original `prerendered_text`.
 */

import type { NarrativeCategory } from "./types";

export type IntensityBucket = "mild" | "moderate" | "strong";

export interface TemplateContext {
  data: Record<string, unknown>;
  lap?: number;
  session_key: number;
  event_id: string;
}

interface VariantSet {
  variants: string[];
}

type CategoryTemplates = Partial<Record<IntensityBucket, VariantSet>>;

/* ── Hash (djb2) — deterministic, no external deps ─────────────────── */

export function hashStringNumeric(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  // force unsigned 32-bit
  return h >>> 0;
}

/* ── Number formatting helpers ─────────────────────────────────────── */

function fmt(n: unknown, digits: number): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n.toFixed(digits);
}

/* ── Intensity bucket extraction per category ──────────────────────── */

function bucketFor(
  category: NarrativeCategory,
  data: Record<string, unknown>,
): IntensityBucket | null {
  switch (category) {
    case "traffic": {
      const lvl = data.level;
      if (lvl === "HEAVY" || lvl === "PACK") return "strong";
      if (lvl === "LIGHT") return "moderate";
      if (lvl === "CLEAN") return "mild";
      return null; // template not provided for sub-types (release/persist/stuck)
    }
    case "warmup": {
      // Skip templating for hard-compound-specific warmup events: the original
      // text carries domain-specific information (compound implications) that
      // generic warmup templates do not preserve.
      if (data.has_hard === true) return null;
      const w = data.warmup_total;
      if (typeof w !== "number") return null;
      if (w > 5) return "strong";
      if (w > 2.5) return "moderate";
      return "mild";
    }
    case "neutralization": {
      const b = data.benefit_seconds;
      if (typeof b === "number") {
        if (b > 8) return "strong";
        if (b > 4) return "moderate";
        return "mild";
      }
      return "moderate";
    }
    case "cumulative_deviation": {
      const md = data.max_deviation;
      const fd = data.driver_final_delta;
      const v = Math.max(
        typeof md === "number" ? Math.abs(md) : 0,
        typeof fd === "number" ? Math.abs(fd) : 0,
      );
      if (v > 5) return "strong";
      if (v > 2) return "moderate";
      return "mild";
    }
    case "pace_loss": {
      const s = data.status;
      if (s === "CLIFF_RISK") return "strong";
      if (s === "HIGH_LOSS") return "moderate";
      if (s === "NORMAL_LOSS") return "mild";
      return null;
    }
    case "degradation_quality": {
      const s = data.status;
      // Skip templating when the original carries domain-specific augmentations
      // (correction note, fallback description) that generic templates do not preserve.
      if (data.model_corrected === true) return null;
      if (typeof data.fallback_description === "string" && data.fallback_description.length > 0) return null;
      if (s === "INVALID") return "strong";
      if (s === "NEUTRAL") return "moderate";
      return "mild";
    }
    case "pre_race_compound_stress": {
      const variability = data.variability;
      const sampleConfidence = data.sample_confidence;
      if (variability === "VARIABILE") return "mild";
      if (variability === "COERENTE" && sampleConfidence === "HIGH") return "strong";
      if (variability === "COERENTE" && sampleConfidence === "MEDIUM") return "moderate";
      return null; // LOW sample → no narrative
    }
    case "pre_race_watch": {
      const signal = data.signal;
      if (signal === "POSITIVE") return "strong";
      if (signal === "NEGATIVE") return "moderate";
      if (signal === "NEUTRAL") return "mild";
      return null;
    }
    case "pre_race_quali_anomaly": {
      const classification = data.classification;
      if (classification === "UNDER_QUALIFIER") return "strong";
      if (classification === "OVER_QUALIFIER") return "moderate";
      return null; // ALIGNED / NO_QUALI_DATA → no narrative
    }
    default:
      return null;
  }
}

/* ── Templates: 6 categories × up to 3 buckets × 3 variants ────────── */

const TEMPLATES: Partial<Record<NarrativeCategory, CategoryTemplates>> = {
  traffic: {
    strong: {
      variants: [
        "Traffico pesante al rientro: {traffic_loss}s persi nella coda formatasi",
        "Pit sfortunato come timing: rientro in traffico compatto, {traffic_loss}s lasciati sul tavolo",
        "Finestra pit già usata dai rivali: {traffic_loss}s persi nel pacchetto al rientro",
      ],
    },
    moderate: {
      variants: [
        "Traffico leggero al rientro: {traffic_loss}s persi",
        "Lieve perdita per traffico: {traffic_loss}s al rientro in pista",
        "Rientro un po' compresso dal traffico: {traffic_loss}s persi",
      ],
    },
    mild: {
      variants: [
        "Rientro in aria pulita dopo il pit",
        "Pit ben sincronizzato: aria libera al rientro",
        "Timing pit indovinato: nessun traffico al rientro",
      ],
    },
  },
  warmup: {
    strong: {
      variants: [
        "Warmup gomme oneroso: {warmup_total}s totali persi nel riscaldamento",
        "Costo termico elevato: {warmup_total}s spesi per portare le gomme in finestra",
        "Penalità warmup importante: {warmup_total}s lasciati sul rateo di riscaldamento",
      ],
    },
    moderate: {
      variants: [
        "Warmup gomme moderato: {warmup_total}s totali nella fase di riscaldamento",
        "Costo termico contenuto ma presente: {warmup_total}s di warmup",
        "Riscaldamento gomme nella media: {warmup_total}s totali",
      ],
    },
    mild: {
      variants: [
        "Warmup gomme contenuto: solo {warmup_total}s totali",
        "Fase termica rapida: appena {warmup_total}s di warmup",
        "Gomme in finestra in fretta: {warmup_total}s di warmup totali",
      ],
    },
  },
  neutralization: {
    strong: {
      variants: [
        "Pit sotto neutralizzazione molto vantaggioso: ~{benefit_seconds}s di pit loss risparmiati",
        "Neutralizzazione sfruttata in pieno: circa {benefit_seconds}s guadagnati sul pit loss",
        "Vantaggio neutralizzazione molto forte: ~{benefit_seconds}s sottratti al costo del pit",
      ],
    },
    moderate: {
      variants: [
        "Pit sotto neutralizzazione vantaggioso: ~{benefit_seconds}s di pit loss risparmiati",
        "Neutralizzazione sfruttata: circa {benefit_seconds}s guadagnati sul pit loss",
        "Beneficio neutralizzazione apprezzabile: ~{benefit_seconds}s sul pit loss",
      ],
    },
    mild: {
      variants: [
        "Lieve vantaggio dalla neutralizzazione: ~{benefit_seconds}s sul pit loss",
        "Neutralizzazione marginalmente sfruttata: circa {benefit_seconds}s risparmiati",
        "Piccolo beneficio dal pit sotto neutralizzazione: ~{benefit_seconds}s",
      ],
    },
  },
  cumulative_deviation: {
    strong: {
      variants: [
        "Deviazione cumulativa elevata: +{max_deviation}s al giro {max_deviation_lap}",
        "Distacco cumulato significativo: picco di +{max_deviation}s al giro {max_deviation_lap}",
        "Forte scostamento dal benchmark: +{max_deviation}s al giro {max_deviation_lap}",
      ],
    },
    moderate: {
      variants: [
        "Deviazione cumulativa moderata: +{max_deviation}s al giro {max_deviation_lap}",
        "Scostamento contenuto dal benchmark: +{max_deviation}s al giro {max_deviation_lap}",
        "Distacco cumulato apprezzabile: +{max_deviation}s al giro {max_deviation_lap}",
      ],
    },
    mild: {
      variants: [
        "Deviazione cumulativa contenuta: +{max_deviation}s al giro {max_deviation_lap}",
        "Scostamento dal benchmark limitato: +{max_deviation}s al giro {max_deviation_lap}",
        "Distacco cumulato modesto: +{max_deviation}s al giro {max_deviation_lap}",
      ],
    },
  },
  pace_loss: {
    strong: {
      variants: [
        "Perdita di passo critica nello stint {stint} ({rate} s/giro): possibile tyre cliff in atto",
        "Crollo di passo nello stint {stint}: {rate} s/giro, segnale compatibile con cliff gomme",
        "Stint {stint} in evidente sofferenza: {rate} s/giro di perdita, rischio cliff alto",
      ],
    },
    moderate: {
      variants: [
        "Perdita di passo significativa nello stint {stint}: {rate} s/giro",
        "Stint {stint} in chiaro calo: {rate} s/giro di perdita di passo",
        "Degrado pesante nello stint {stint}: {rate} s/giro lasciati per giro",
      ],
    },
    mild: {
      variants: [
        "Perdita di passo moderata nello stint {stint}: {rate} s/giro, coerente con degrado normale",
        "Stint {stint} con calo di passo nella norma: {rate} s/giro",
        "Degrado regolare nello stint {stint}: {rate} s/giro di perdita",
      ],
    },
  },
  degradation_quality: {
    strong: {
      variants: [
        "Stima di degrado dello stint {stint} ({compound}) non attendibile: esclusa dal modello strategico",
        "Stint {stint} ({compound}): degrado fuori range affidabile, non usato nel modello",
        "Degrado dello stint {stint} ({compound}) classificato come non attendibile e ignorato dal modello",
      ],
    },
    moderate: {
      variants: [
        "Stint {stint} ({compound}): degrado troppo debole per essere significativo, usato con cautela",
        "Segnale di degrado marginale sullo stint {stint} ({compound}): peso ridotto nel modello",
        "Stint {stint} ({compound}) con degrado al limite della significatività: usato in modo conservativo",
      ],
    },
    mild: {
      variants: [
        "Stima di degrado dello stint {stint} ({compound}) entro la norma",
        "Stint {stint} ({compound}): degrado coerente con il modello atteso",
        "Degrado dello stint {stint} ({compound}) regolare, usato pienamente nel modello",
      ],
    },
  },
  pre_race_compound_stress: {
    strong: {
      variants: [
        "{compound}: i {drivers_count} piloti analizzati mostrano un comportamento omogeneo, con una perdita media di {slope_median} s/giro. È un dato solido per ipotizzare il passo gara su questa mescola.",
        "Pattern chiaro su {compound}: tutti i {drivers_count} piloti convergono su un degrado di circa {slope_median} s/giro. Ci si aspetta un comportamento prevedibile in gara.",
        "{compound} con risposta uniforme tra i {drivers_count} piloti, slope mediana {slope_median} s/giro. Buona base per pianificare le strategie.",
      ],
    },
    moderate: {
      variants: [
        "{compound}: i {drivers_count} piloti che hanno fatto long run mostrano una tendenza coerente (slope mediana {slope_median} s/giro), ma il campione è limitato — la conferma arriverà in gara.",
        "Indicazione su {compound}: con {drivers_count} piloti e slope mediana {slope_median} s/giro, si vede un pattern, ma servirebbero più dati per essere certi.",
        "{compound} sembra avere un comportamento regolare ({slope_median} s/giro su {drivers_count} piloti), ma il campione ridotto invita a cautela.",
      ],
    },
    mild: {
      variants: [
        "{compound}: i {drivers_count} piloti reagiscono in modo molto diverso (IQR {slope_iqr} s/giro). Difficile fare previsioni univoche — molto dipenderà dallo stile di guida e dal setup.",
        "Risposta non uniforme su {compound}: spread ampio tra i piloti (IQR {slope_iqr} s/giro). Alcuni team hanno trovato la quadra, altri stanno ancora cercando.",
        "{compound} si comporta diversamente da pilota a pilota (IQR {slope_iqr} s/giro). Aspettarsi gestione gomma differenziata in gara.",
      ],
    },
  },
  pre_race_watch: {
    strong: {
      variants: [
        "{acronym} è da tenere d'occhio: {reason}. Potrebbe sorprendere in positivo durante la gara.",
        "Segnale positivo da {acronym}: {reason}. Se questo passo si conferma, può essere protagonista.",
        "Possibile outsider {acronym}: {reason}. La pratica suggerisce un potenziale superiore alla griglia di partenza.",
      ],
    },
    moderate: {
      variants: [
        "Attenzione su {acronym}: {reason}. C'è il rischio di scivolare durante la gara.",
        "{acronym} mostra un segnale di vulnerabilità: {reason}. Il passo gara potrebbe non reggere fino alla fine.",
        "Punto debole per {acronym}: {reason}. La gestione gomma in gara sarà critica.",
      ],
    },
    mild: {
      variants: [
        "Da segnalare su {acronym}: {reason}. Un dato che può essere utile interpretare nel contesto della gara.",
        "Osservazione su {acronym}: {reason}. Non per forza positiva o negativa, ma significativa.",
        "Spunto da {acronym}: {reason}. Vale la pena osservarlo per capire il quadro completo.",
      ],
    },
  },
  pre_race_quali_anomaly: {
    strong: {
      variants: [
        "{acronym} parte {qualifying_position}° ma ha il {pace_rank}° miglior passo gara. Può recuperare fino a {position_delta_abs} posizioni se la gara fila liscia, senza neutralizzazioni che congelino i distacchi.",
        "Sottoperformance in qualifica per {acronym}: {pace_rank}° nei long run, ma {qualifying_position}° in griglia. Da seguire come potenziale rimontatore.",
        "{acronym} ha un passo gara da {pace_rank}° posizione, ma partirà {qualifying_position}°. La differenza di {position_delta_abs} posizioni è il margine di rimonta che la pratica suggerisce.",
      ],
    },
    moderate: {
      variants: [
        "{acronym} parte {qualifying_position}° ma in pace gara è solo {pace_rank}°. Setup probabilmente ottimizzato per il giro singolo: in gara potrebbe scivolare di {position_delta_abs} posizioni.",
        "Vulnerabilità per {acronym}: la posizione in griglia ({qualifying_position}°) non riflette il passo nei long run ({pace_rank}°). Difficile difenderla per tutta la gara.",
        "{acronym} ha brillato in qualifica ({qualifying_position}°) ma il passo nei long run è da {pace_rank}° posizione. Aspettarsi pressione sui rivali nelle fasi centrali.",
      ],
    },
    mild: {
      variants: [
        "Allineamento per {acronym} ({qualifying_position}° vs {pace_rank}°)",
        "{acronym} in linea ({qualifying_position}° / {pace_rank}°)",
        "Coerenza qualifica-passo per {acronym}",
      ],
    },
  },
};

/* ── Placeholder substitution ──────────────────────────────────────── */

const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

function fillPlaceholders(
  template: string,
  ctx: TemplateContext,
): string | null {
  let failed = false;
  const result = template.replace(PLACEHOLDER_RE, (_, key: string) => {
    let value: string | null = null;
    if (key === "lap" && typeof ctx.lap === "number") {
      value = String(ctx.lap);
    } else {
      const raw = ctx.data[key];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        // Pick precision per known field
        if (key === "rate" || key === "traffic_loss") value = fmt(raw, 3);
        else if (key === "warmup_total" || key === "benefit_seconds" || key === "max_deviation" || key === "driver_final_delta") value = fmt(raw, 1);
        else value = String(raw);
      } else if (typeof raw === "string" && raw.length > 0) {
        value = raw;
      }
    }
    if (value == null) {
      failed = true;
      return "";
    }
    return value;
  });
  return failed ? null : result;
}

/* ── Public API ─────────────────────────────────────────────────────── */

export function selectTemplate(
  category: NarrativeCategory,
  ctx: TemplateContext,
): string | null {
  const cat = TEMPLATES[category];
  if (!cat) return null;

  const bucket = bucketFor(category, ctx.data);
  if (!bucket) return null;

  const set = cat[bucket] ?? cat.moderate;
  if (!set || set.variants.length === 0) return null;

  const idx = hashStringNumeric(`${ctx.session_key}:${ctx.event_id}`) % set.variants.length;
  const template = set.variants[idx];

  const filled = fillPlaceholders(template, ctx);
  return filled; // null if any placeholder unresolved → caller falls back
}
