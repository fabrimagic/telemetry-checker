/**
 * VRE Presentation Modes: ANALYST and BROADCAST views.
 * ENGINEER mode uses the existing full detail view in VirtualRaceEngineerCard.
 * 
 * Anti-hallucination: every rendered field comes directly from VirtualRaceEngineerResult.
 * No data is invented, inferred or embellished beyond what the engine provides.
 */

import type { VirtualRaceEngineerResult, AlternativeStrategy, Confidence } from "@/lib/virtualRaceEngineer";
import type { RobustnessLabel } from "@/lib/strategyAnalysis";
import { RISK_MODES, type RiskMode } from "@/lib/riskAppetite";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, Gauge, Shield, Target, Info, TrendingUp, TrendingDown, Minus } from "lucide-react";
import React from "react";

export type ViewMode = "ENGINEER" | "ANALYST" | "BROADCAST";

/* ── Shared helpers ── */

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: "hsl(0 80% 50%)", MEDIUM: "hsl(45 100% 50%)", HARD: "hsl(0 0% 85%)",
  INTERMEDIATE: "hsl(120 60% 45%)", WET: "hsl(210 80% 50%)",
};

function CompoundBadge({ compound }: { compound: string }) {
  const bg = COMPOUND_COLORS[compound] || "hsl(var(--muted))";
  const isDark = compound === "HARD" || compound === "MEDIUM";
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase"
      style={{ backgroundColor: bg, color: isDark ? "#1a1a1a" : "#fff" }}>
      {compound}
    </span>
  );
}

function confidenceLabel(c: Confidence): string {
  return c === "HIGH" ? "Alta affidabilità" : c === "MEDIUM" ? "Affidabilità media" : "Lettura prudente";
}

function confidenceStyle(c: Confidence): string {
  return c === "HIGH" ? "text-emerald-400" : c === "MEDIUM" ? "text-amber-400" : "text-red-400";
}

function robustnessLabel(r: RobustnessLabel): string {
  return r === "ROBUST" ? "poco sensibile alle variabili" : r === "MEDIUM" ? "moderatamente sensibile" : "sensibile a traffico, degrado o variazioni di esecuzione";
}

function deltaDescription(delta: number | null | undefined): string {
  if (delta == null || Math.abs(delta) < 0.1) return "";
  return delta > 0 ? `+${delta.toFixed(1)}s di vantaggio stimato` : `${delta.toFixed(1)}s di svantaggio stimato`;
}

/* ── Key drivers extraction (shared by ANALYST and BROADCAST) ── */

interface KeyInsight {
  icon: React.ReactNode;
  label: string;
  detail: string;
}

function extractKeyInsights(result: VirtualRaceEngineerResult, maxCount: number): KeyInsight[] {
  const insights: KeyInsight[] = [];
  const { integrated_context, recommended_strategy, weather_impact, neutralisation_impact, pace_loss_results, degradation_validations } = result;

  // Degradation
  if (degradation_validations && degradation_validations.length > 0) {
    const invalidCount = degradation_validations.filter(d => d.status === "INVALID").length;
    const validCount = degradation_validations.filter(d => d.status === "VALID").length;
    if (invalidCount > 0) {
      insights.push({ icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />, label: "Degrado", detail: `${invalidCount} stint con degrado non affidabile su ${degradation_validations.length} totali` });
    } else if (validCount === degradation_validations.length) {
      insights.push({ icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />, label: "Degrado", detail: `Tutti i ${validCount} stint con degrado valido` });
    }
  }

  // Traffic
  if (result.traffic_analysis.length > 0) {
    const heavyCount = result.traffic_analysis.filter(t => t.traffic_level === "HEAVY").length;
    const totalLoss = result.traffic_analysis.reduce((s, t) => s + t.estimated_traffic_time_loss, 0);
    if (heavyCount > 0) {
      insights.push({ icon: <AlertTriangle className="h-3.5 w-3.5 text-red-400" />, label: "Traffico", detail: `${heavyCount} finestre con traffico pesante, perdita stimata ${totalLoss.toFixed(1)}s` });
    } else if (totalLoss < 0.5) {
      insights.push({ icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />, label: "Traffico", detail: "Aria pulita nelle finestre analizzate" });
    }
  }

  // Neutralizations
  if (integrated_context?.track_status_context && integrated_context.track_status_context.total_neutralized_laps > 0) {
    const tsc = integrated_context.track_status_context;
    const types = [tsc.had_safety_car && "SC", tsc.had_vsc && "VSC", tsc.had_red_flag && "Red Flag"].filter(Boolean).join(", ");
    insights.push({ icon: <Shield className="h-3.5 w-3.5 text-amber-400" />, label: "Neutralizzazioni", detail: `${tsc.total_neutralized_laps} giri neutralizzati (${types})` });
  }

  // Weather
  if (weather_impact) {
    insights.push({ icon: <Info className="h-3.5 w-3.5 text-blue-400" />, label: "Meteo", detail: weather_impact });
  }

  // Robustness of recommended
  if (recommended_strategy.analysis?.robustness) {
    const rob = recommended_strategy.analysis.robustness;
    insights.push({ icon: <Shield className="h-3.5 w-3.5" />, label: "Robustezza", detail: `Strategia raccomandata: ${rob.robustness_label} — ${robustnessLabel(rob.robustness_label)}` });
  }

  return insights.slice(0, maxCount);
}

/* ══════════════════════════════════════════════════════
   ANALYST VIEW
   ══════════════════════════════════════════════════════ */

export function AnalystView({ result }: { result: VirtualRaceEngineerResult }) {
  const { verdict, confidence, recommended_strategy, alternative_strategies, confidence_factors, risk_mode, integrated_context } = result;
  const insights = extractKeyInsights(result, 5);

  // Build "what drove the result" from narrative_insights + verdict
  const drivers: string[] = [];
  if (recommended_strategy.estimated_gain_seconds > 0.1) {
    drivers.push(`Il sistema stima un vantaggio di ${recommended_strategy.estimated_gain_seconds.toFixed(1)}s con la strategia raccomandata rispetto a quella reale.`);
  }
  if (recommended_strategy.analysis?.robustness) {
    drivers.push(`La raccomandazione è classificata come ${recommended_strategy.analysis.robustness.robustness_label} (${robustnessLabel(recommended_strategy.analysis.robustness.robustness_label)}).`);
  }
  if (result.narrative_insights.length > 0) {
    drivers.push(...result.narrative_insights.slice(0, 2));
  }

  // Top 2 alternatives
  const topAlts = alternative_strategies.slice(0, 2);

  return (
    <div className="space-y-4">
      {/* 1. Executive Summary */}
      <div className="rounded-lg bg-muted/50 border border-border p-4 space-y-2">
        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
          <Target className="h-3.5 w-3.5" /> Sintesi
        </h4>
        <p className="text-sm text-foreground font-medium">{verdict.label}</p>
        <p className="text-xs text-muted-foreground">{verdict.summary}</p>
        {verdict.delta_seconds != null && verdict.delta_seconds > 0.1 && (
          <p className="text-xs text-muted-foreground">
            Delta stimato: <span className="font-mono font-bold text-foreground">{verdict.delta_seconds.toFixed(1)}s</span>
          </p>
        )}
        <p className={`text-[11px] font-semibold ${confidenceStyle(confidence)}`}>
          {confidenceLabel(confidence)}
        </p>
      </div>

      {/* 2. Key Insights */}
      {insights.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Punti chiave</h4>
          <div className="space-y-1.5">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span className="mt-0.5 shrink-0">{ins.icon}</span>
                <div>
                  <span className="font-semibold text-foreground">{ins.label}: </span>
                  <span className="text-muted-foreground">{ins.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. What Drove the Result */}
      {drivers.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Perché questo risultato</h4>
          <ul className="space-y-1">
            {drivers.map((d, i) => (
              <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <span className="text-foreground/60 mt-0.5 shrink-0">•</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 4. Strategy Compare */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Confronto strategico</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Actual */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Reale</p>
            <div className="flex flex-wrap gap-1">
              {result.actual_strategy.stints.map((s, i) => (
                <CompoundBadge key={i} compound={s.compound} />
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {result.actual_strategy.pit_stops.length} pit stop — Giri: {result.actual_strategy.stints.map(s => `${s.laps_count}`).join("+")}
            </p>
          </div>
          {/* Recommended */}
          {recommended_strategy.compounds?.length > 0 && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider">Raccomandata</p>
              <div className="flex flex-wrap gap-1">
                {recommended_strategy.compounds.map((c, i) => (
                  <CompoundBadge key={i} compound={c} />
                ))}
              </div>
              {recommended_strategy.pit_windows.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Pit: {recommended_strategy.pit_windows.map(pw => `L${pw.ideal_lap}`).join(", ")}
                  {recommended_strategy.estimated_gain_seconds > 0.1 && (
                    <span className="ml-1.5 font-semibold text-emerald-400">+{recommended_strategy.estimated_gain_seconds.toFixed(1)}s</span>
                  )}
                </p>
              )}
              {recommended_strategy.pros && recommended_strategy.pros.length > 0 && (
                <p className="text-[10px] text-emerald-400">Pro: {recommended_strategy.pros.join("; ")}</p>
              )}
              {recommended_strategy.cons && recommended_strategy.cons.length > 0 && (
                <p className="text-[10px] text-red-400">Contro: {recommended_strategy.cons.join("; ")}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 5. Top Alternatives */}
      {topAlts.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Alternative</h4>
          {topAlts.map((alt, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground">{alt.name}</span>
                {alt.estimated_delta_vs_actual !== 0 && (
                  <span className={`text-[10px] font-mono font-bold ${alt.estimated_delta_vs_actual > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {alt.estimated_delta_vs_actual > 0 ? "+" : ""}{alt.estimated_delta_vs_actual.toFixed(1)}s
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">{alt.description}</p>
              <div className="flex gap-4 text-[10px]">
                <span><span className="text-emerald-400 font-semibold">Pro:</span> <span className="text-muted-foreground">{alt.pros.join("; ")}</span></span>
                <span><span className="text-red-400 font-semibold">Contro:</span> <span className="text-muted-foreground">{alt.cons.join("; ")}</span></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 6. Reliability */}
      <div className="rounded-md bg-muted/40 border border-border px-3 py-2.5 space-y-1 text-[11px] text-muted-foreground">
        <p className="font-medium text-foreground/80 flex items-center gap-1">
          <Gauge className="h-3.5 w-3.5 shrink-0" /> Affidabilità dell'analisi
        </p>
        <ul className="space-y-0.5 pl-5 list-disc">
          {confidence_factors.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
        {integrated_context?.data_gaps && integrated_context.data_gaps.length > 0 && (
          <p className="text-[10px] italic mt-1">
            ⚠️ Dati parziali: {integrated_context.data_gaps.join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   BROADCAST VIEW
   ══════════════════════════════════════════════════════ */

export function BroadcastView({ result }: { result: VirtualRaceEngineerResult }) {
  const { verdict, confidence, recommended_strategy, actual_strategy, integrated_context, weather_impact, neutralisation_impact, narrative_insights, degradation_validations } = result;

  // Build race story from available data
  const storyParts: string[] = [];

  // Strategy executed
  const compoundSeq = actual_strategy.stints.map(s => s.compound).join(" → ");
  storyParts.push(`${result.driver_acronym} ha eseguito una strategia a ${actual_strategy.pit_stops.length} soste (${compoundSeq}).`);

  // Verdict direction
  if (verdict.delta_seconds != null && verdict.delta_seconds > 1) {
    storyParts.push(`Il modello stima che una strategia alternativa avrebbe potuto far guadagnare circa ${verdict.delta_seconds.toFixed(1)} secondi.`);
  } else if (verdict.delta_seconds != null && verdict.delta_seconds < 0.5) {
    storyParts.push("La strategia scelta risulta in linea con l'ottimale stimato.");
  }

  // Key contextual factor
  if (neutralisation_impact) {
    storyParts.push(neutralisation_impact);
  } else if (weather_impact) {
    storyParts.push(weather_impact);
  }

  // Battles
  if (integrated_context?.battle_context && integrated_context.battle_context.total_episodes > 0) {
    storyParts.push(`${integrated_context.battle_context.total_episodes} episodi di battaglia durante la gara, per un totale di ${integrated_context.battle_context.total_battle_laps} giri.`);
  }

  // Narrative insights (pick top 1)
  if (narrative_insights.length > 0) {
    storyParts.push(narrative_insights[0]);
  }

  // Key takeaways
  const takeaways: { icon: React.ReactNode; text: string }[] = [];

  // What helped
  if (recommended_strategy.pros && recommended_strategy.pros.length > 0) {
    takeaways.push({ icon: <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />, text: recommended_strategy.pros[0] });
  }

  // What penalized
  if (recommended_strategy.cons && recommended_strategy.cons.length > 0) {
    takeaways.push({ icon: <TrendingDown className="h-3.5 w-3.5 text-red-400" />, text: recommended_strategy.cons[0] });
  }

  // What could have changed
  if (result.alternative_strategies.length > 0) {
    const bestAlt = result.alternative_strategies[0];
    if (bestAlt.estimated_delta_vs_actual > 0.5) {
      takeaways.push({ icon: <Minus className="h-3.5 w-3.5 text-amber-400" />, text: `${bestAlt.name}: avrebbe potuto cambiare il risultato di ${bestAlt.estimated_delta_vs_actual.toFixed(1)}s` });
    }
  }

  return (
    <div className="space-y-4">
      {/* 1. Headline */}
      <div className="rounded-lg bg-muted/50 border border-border p-4">
        <p className="text-base font-bold text-foreground leading-snug">{verdict.label}</p>
      </div>

      {/* 2. Race Story */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">La gara</h4>
        <div className="text-[12px] text-muted-foreground leading-relaxed space-y-1">
          {storyParts.slice(0, 6).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>

      {/* 3. Key Takeaways */}
      {takeaways.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">In sintesi</h4>
          <div className="space-y-1.5">
            {takeaways.slice(0, 3).map((t, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span className="mt-0.5 shrink-0">{t.icon}</span>
                <span className="text-muted-foreground">{t.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Trust Marker */}
      <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-[11px]">
        <p className={`font-semibold ${confidenceStyle(confidence)}`}>
          {confidence === "HIGH"
            ? "📊 Analisi ad alta affidabilità — dati completi e coerenti."
            : confidence === "MEDIUM"
            ? "📊 Affidabilità media — alcuni dati limitati o parziali."
            : "📊 Lettura prudente — dati incompleti o contaminati, conclusioni da verificare."}
        </p>
        {integrated_context?.data_gaps && integrated_context.data_gaps.length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1 italic">
            Dati non disponibili: {integrated_context.data_gaps.join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}
