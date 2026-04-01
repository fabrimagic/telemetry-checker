import type { VirtualRaceEngineerResult, ActualStrategy, RecommendedStrategy } from "@/lib/virtualRaceEngineer";
import type { TrafficPrediction, TrafficLevel } from "@/lib/trafficPredictor";
import type { StrategyBreakdown } from "@/lib/strategyBreakdown";
import { breakdownToRows } from "@/lib/strategyBreakdown";
import { getPhaseLabel } from "@/lib/racePhase";
import { RISK_MODES, scoreStrategies, type RiskMode } from "@/lib/riskAppetite";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, ChevronDown, ArrowRight, Clock, AlertTriangle, CheckCircle, Gauge, Navigation, BarChart3, Shield, Zap, Scale, Activity } from "lucide-react";
import React, { useState, useMemo } from "react";

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: "hsl(0 80% 50%)",
  MEDIUM: "hsl(45 100% 50%)",
  HARD: "hsl(0 0% 85%)",
  INTERMEDIATE: "hsl(120 60% 45%)",
  WET: "hsl(210 80% 50%)",
};

function CompoundBadge({ compound }: { compound: string }) {
  const bg = COMPOUND_COLORS[compound] || "hsl(var(--muted))";
  const isDark = compound === "HARD" || compound === "MEDIUM";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase"
      style={{ backgroundColor: bg, color: isDark ? "#1a1a1a" : "#fff" }}
    >
      {compound}
    </span>
  );
}

function ConfidenceBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    HIGH: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    MEDIUM: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    LOW: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const labels: Record<string, string> = { HIGH: "Alta", MEDIUM: "Media", LOW: "Bassa" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold ${styles[level] || styles.LOW}`}>
      <Gauge className="h-3 w-3" />
      Confidenza: {labels[level] || level}
    </span>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.1) return null;
  const positive = delta > 0;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${positive ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
      {positive ? "+" : ""}{delta.toFixed(1)}s
    </span>
  );
}

/* ── Strategy Timeline Chart ── */
function StrategyTimeline({ actual, recommended }: { actual: ActualStrategy; recommended: RecommendedStrategy }) {
  const totalLaps = actual.stints.length > 0
    ? Math.max(...actual.stints.map((s) => s.lap_end))
    : 0;
  if (totalLaps === 0) return null;

  // Build recommended stints from pit windows + compounds array
  const recStints: { compound: string; lap_start: number; lap_end: number }[] = [];
  if (recommended.pit_windows.length > 0 && recommended.compounds?.length > 0) {
    const sortedWindows = [...recommended.pit_windows].sort((a, b) => a.ideal_lap - b.ideal_lap);
    let cursor = actual.stints[0]?.lap_start ?? 1;

    for (let i = 0; i < sortedWindows.length; i++) {
      const w = sortedWindows[i];
      recStints.push({ compound: recommended.compounds[i] ?? actual.stints[i]?.compound ?? "MEDIUM", lap_start: cursor, lap_end: w.ideal_lap });
      cursor = w.ideal_lap + 1;
    }
    recStints.push({ compound: recommended.compounds[sortedWindows.length] ?? sortedWindows[sortedWindows.length - 1].compound_after, lap_start: cursor, lap_end: totalLaps });
  }

  const renderRow = (label: string, stints: { compound: string; lap_start: number; lap_end: number }[]) => (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-24 shrink-0 text-right">{label}</span>
      <div className="flex-1 flex h-7 rounded overflow-hidden border border-border/50">
        {stints.map((s, i) => {
          const width = ((s.lap_end - s.lap_start + 1) / totalLaps) * 100;
          const bg = COMPOUND_COLORS[s.compound] || "hsl(var(--muted))";
          const isDark = s.compound === "HARD" || s.compound === "MEDIUM";
          return (
            <div
              key={i}
              className="flex items-center justify-center text-[9px] font-bold relative"
              style={{ width: `${width}%`, backgroundColor: bg, color: isDark ? "#1a1a1a" : "#fff" }}
              title={`${s.compound} L${s.lap_start}–${s.lap_end}`}
            >
              {width > 8 && <span>{s.compound.substring(0, 3)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        📊 Confronto visivo strategia
      </h4>
      {renderRow("Reale", actual.stints.map((s) => ({ compound: s.compound, lap_start: s.lap_start, lap_end: s.lap_end })))}
      {recStints.length > 0 && renderRow("Consigliata", recStints)}
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0" />
        <div className="flex-1 flex justify-between text-[9px] text-muted-foreground px-0.5">
          <span>L1</span>
          <span>L{totalLaps}</span>
        </div>
      </div>
    </div>
  );
}

interface Props {
  result: VirtualRaceEngineerResult;
  onRiskModeChange?: (mode: RiskMode) => void;
}

export function VirtualRaceEngineerCard({ result, onRiskModeChange }: Props) {
  const { actual_strategy, recommended_strategy, alternative_strategies, verdict, confidence, confidence_factors, weather_impact, neutralisation_impact, practice_compounds_used, traffic_analysis, actual_breakdown, race_phase, risk_mode } = result;

  // Use risk_mode from result (backend-computed) as source of truth

  // Determine which breakdown to show (recommended if available, otherwise actual)
  const primaryBreakdown = recommended_strategy.breakdown ?? actual_breakdown ?? null;
  const breakdownRows = primaryBreakdown ? breakdownToRows(primaryBreakdown) : [];

  // Score strategies with phase + risk
  const scoredStrategies = useMemo(() => {
    if (!race_phase) return null;
    const allStrats = [
      ...alternative_strategies.map(alt => ({
        name: alt.name,
        delta: alt.estimated_delta_vs_actual,
        breakdown: alt.breakdown,
      })),
    ];
    if (recommended_strategy.estimated_gain_seconds > 0.1) {
      allStrats.push({
        name: "Strategia ottimale",
        delta: recommended_strategy.estimated_gain_seconds,
        breakdown: recommended_strategy.breakdown,
        isRecommended: true,
      } as any);
    }
    if (allStrats.length === 0) return null;
    return scoreStrategies(allStrats, race_phase.phase_adjustments, riskMode);
  }, [race_phase, alternative_strategies, recommended_strategy, riskMode]);

  const topScoredName = scoredStrategies?.[0]?.name ?? null;
  const topScoredReason = scoredStrategies?.[0]?.adjustment_reason ?? null;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
            <span className="text-base">🏎️</span> Virtual Race Engineer
          </CardTitle>
          <ConfidenceBadge level={confidence} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Analisi strategica basata su degrado gomme, pit stop, meteo e neutralizzazioni. I risultati sono stime del modello.
        </p>
        {practice_compounds_used && practice_compounds_used.length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
            <Info className="h-3 w-3 shrink-0" />
            Degrado da Practice incluso per: {practice_compounds_used.map((c) => (
              <CompoundBadge key={c} compound={c} />
            ))}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-5 pt-0">

        {/* ── Verdict ── */}
        <div className="rounded-lg bg-muted/50 border border-border p-4">
          <div className="flex items-start gap-3">
            {verdict.delta_seconds != null && verdict.delta_seconds > 2
              ? <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
              : <CheckCircle className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />}
            <div>
              <p className="text-sm font-semibold text-foreground">{verdict.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{verdict.summary}</p>
              {verdict.delta_seconds != null && verdict.delta_seconds > 0.1 && (
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-mono font-bold text-foreground">Δ {verdict.delta_seconds.toFixed(1)}s</span> — tempo potenzialmente recuperabile stimato
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Race Context: Phase + Risk Appetite ── */}
        {race_phase && (
          <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Race Context
            </h4>

            {/* Phase indicator */}
            <div className="flex items-start gap-2">
              <span className="text-[11px] text-muted-foreground shrink-0 w-20">Race phase:</span>
              <div>
                <span className="text-[11px] font-semibold text-foreground">{getPhaseLabel(race_phase.current_phase)}</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">{race_phase.phase_reason}</p>
              </div>
            </div>

            {/* Risk appetite selector */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground shrink-0 w-20">Risk mode:</span>
              <div className="flex rounded-md border border-border overflow-hidden">
                {(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"] as RiskMode[]).map((mode) => {
                  const info = RISK_MODES[mode];
                  const isActive = riskMode === mode;
                  const icons: Record<RiskMode, React.ReactNode> = {
                    CONSERVATIVE: <Shield className="h-3 w-3" />,
                    BALANCED: <Scale className="h-3 w-3" />,
                    AGGRESSIVE: <Zap className="h-3 w-3" />,
                  };
                  return (
                    <button
                      key={mode}
                      onClick={() => setRiskMode(mode)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                      title={info.description}
                    >
                      {icons[mode]}
                      {info.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Impact note */}
            {topScoredName && riskMode !== "BALANCED" && (
              <p className="text-[10px] text-muted-foreground italic">
                💡 Con profilo <strong className="text-foreground">{RISK_MODES[riskMode].label}</strong> in fase <strong className="text-foreground">{getPhaseLabel(race_phase.current_phase)}</strong>:
                strategia favorita → <strong className="text-foreground">{topScoredName}</strong>
                {topScoredReason && topScoredReason !== "Nessun aggiustamento" && (
                  <span> ({topScoredReason})</span>
                )}
              </p>
            )}
          </div>
        )}

        {/* ── Visual Timeline ── */}
        <StrategyTimeline actual={actual_strategy} recommended={recommended_strategy} />

        {/* ── Actual Strategy ── */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Strategia reale
          </h4>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {actual_strategy.stints.map((s, i) => (
              <div key={s.stint_number} className="flex items-center gap-1">
                <CompoundBadge compound={s.compound} />
                <span className="text-[10px] text-muted-foreground">
                  L{s.lap_start}–{s.lap_end} ({s.laps_count}g)
                </span>
                {i < actual_strategy.stints.length - 1 && (
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>

          {/* Stint table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1.5 pr-2">Stint</th>
                  <th className="text-left py-1.5 pr-2">Compound</th>
                  <th className="text-right py-1.5 pr-2">Giri</th>
                  <th className="text-right py-1.5 pr-2">Media</th>
                  <th className="text-right py-1.5 pr-2">Degrado</th>
                  <th className="text-right py-1.5">R²</th>
                </tr>
              </thead>
              <tbody>
                {actual_strategy.stints.map((s) => (
                  <tr key={s.stint_number} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-mono">{s.stint_number}</td>
                    <td className="py-1.5 pr-2"><CompoundBadge compound={s.compound} /></td>
                    <td className="py-1.5 pr-2 text-right font-mono">{s.laps_count}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{s.avg_lap_time ? s.avg_lap_time.toFixed(3) + "s" : "—"}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">
                      {s.degradation_slope != null ? (
                        <span className={s.degradation_slope > 0.08 ? "text-red-400" : s.degradation_slope > 0.04 ? "text-amber-400" : "text-emerald-400"}>
                          +{s.degradation_slope.toFixed(3)}s/giro
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-1.5 text-right font-mono">{s.r_squared != null ? s.r_squared.toFixed(3) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pit stops */}
          {actual_strategy.pit_stops.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-muted-foreground mb-1">Pit Stop</p>
              <div className="space-y-1">
                {actual_strategy.pit_stops.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="font-mono font-bold">L{p.lap_number}</span>
                    {p.compound_before && p.compound_after && (
                      <span className="flex items-center gap-1">
                        <CompoundBadge compound={p.compound_before} />
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <CompoundBadge compound={p.compound_after} />
                      </span>
                    )}
                    <span className="text-muted-foreground">{p.lane_duration.toFixed(1)}s</span>
                    {p.under_neutralisation && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-amber-500/10 text-amber-400 border-amber-500/30">
                        {p.neutralisation_type}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Recommended Strategy ── */}
        {recommended_strategy.pit_windows.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              ✨ Strategia stimata ottimale
            </h4>
            <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
              {/* Full compound sequence */}
              {recommended_strategy.compounds?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {recommended_strategy.compounds.map((c, i) => (
                    <React.Fragment key={i}>
                      <CompoundBadge compound={c} />
                      {i < recommended_strategy.compounds.length - 1 && (
                        <ArrowRight className="h-3 w-3 text-muted-foreground self-center" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}
              {recommended_strategy.pit_windows.map((pw, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground">Pit {i + 1}:</span>
                  <span className="font-mono font-bold">Giro {pw.ideal_lap}</span>
                  <span className="text-muted-foreground">(finestra {pw.range[0]}–{pw.range[1]})</span>
                </div>
              ))}
              {recommended_strategy.estimated_gain_seconds > 0.1 && (
                <p className="text-[11px] mt-1">
                  <span className="font-semibold text-emerald-400">Guadagno stimato: {recommended_strategy.estimated_gain_seconds.toFixed(1)}s</span>
                </p>
              )}
              <p className="text-[11px] text-muted-foreground italic">{recommended_strategy.reason}</p>
            </div>
          </div>
        )}

        {/* ── Alternative Strategies ── */}
        {alternative_strategies.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              🔄 Strategie alternative
            </h4>
            <div className="space-y-2">
              {alternative_strategies.map((alt, i) => (
                <div key={i} className="rounded-lg bg-muted/30 border border-border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-foreground">{alt.name}</span>
                    <DeltaBadge delta={alt.estimated_delta_vs_actual} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-1.5">{alt.description}</p>
                  <div className="flex gap-4 text-[10px]">
                    <div>
                      <span className="text-emerald-400 font-semibold">Pro: </span>
                      <span className="text-muted-foreground">{alt.pros.join("; ")}</span>
                    </div>
                    <div>
                      <span className="text-red-400 font-semibold">Contro: </span>
                      <span className="text-muted-foreground">{alt.cons.join("; ")}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Traffic Release Analysis ── */}
        {traffic_analysis.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Navigation className="h-3.5 w-3.5" /> Traffic Release Analysis
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1.5 pr-2">Pit Lap</th>
                    <th className="text-right py-1.5 pr-2">Pos. rientro</th>
                    <th className="text-left py-1.5 pr-2">Tra</th>
                    <th className="text-center py-1.5 pr-2">Traffico</th>
                    <th className="text-right py-1.5">Tempo perso</th>
                  </tr>
                </thead>
                <tbody>
                  {traffic_analysis.filter(t => t.traffic_level !== "UNKNOWN").map((t) => {
                    const trafficColors: Record<string, string> = {
                      CLEAN: "bg-emerald-500/20 text-emerald-400",
                      LIGHT: "bg-amber-500/20 text-amber-400",
                      HEAVY: "bg-red-500/20 text-red-400",
                    };
                    const trafficLabels: Record<string, string> = {
                      CLEAN: "Clean air",
                      LIGHT: "Leggero",
                      HEAVY: "Pesante",
                    };
                    return (
                      <tr key={t.pit_lap} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 font-mono font-bold">L{t.pit_lap}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">P{t.rejoin_position_estimated}</td>
                        <td className="py-1.5 pr-2 text-muted-foreground">
                          {t.rejoin_between[0] && t.rejoin_between[1]
                            ? `${t.rejoin_between[0]} – ${t.rejoin_between[1]}`
                            : t.rejoin_between[0] ? `dietro ${t.rejoin_between[0]}` : t.rejoin_between[1] ? `davanti ${t.rejoin_between[1]}` : "—"}
                        </td>
                        <td className="py-1.5 pr-2 text-center">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${trafficColors[t.traffic_level] || ""}`}>
                            {trafficLabels[t.traffic_level] || t.traffic_level}
                          </span>
                        </td>
                        <td className="py-1.5 text-right font-mono">
                          {t.estimated_traffic_time_loss > 0
                            ? <span className="text-red-400">+{t.estimated_traffic_time_loss.toFixed(1)}s</span>
                            : <span className="text-emerald-400">+0.0s</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(weather_impact || neutralisation_impact) && (
          <div className="space-y-1.5">
            {weather_impact && (
              <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <span>🌧️</span> {weather_impact}
              </p>
            )}
            {neutralisation_impact && (
              <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <span>🏴</span> {neutralisation_impact}
              </p>
            )}
          </div>
        )}

        {/* ── Scomposizione del giudizio ── */}
        {breakdownRows.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" /> Scomposizione del giudizio
            </h4>
            <p className="text-[10px] text-muted-foreground mb-2">
              Questa scomposizione mostra come il modello ha costruito il giudizio strategico. Valori positivi = costi stimati, valori negativi = vantaggi stimati.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1.5 pr-2">Componente</th>
                    <th className="text-right py-1.5 pr-2">Valore stimato</th>
                    <th className="text-center py-1.5 pr-2">Impatto</th>
                    <th className="text-left py-1.5">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownRows.map((row, i) => {
                    const impactStyles: Record<string, { badge: string; label: string }> = {
                      favorable: { badge: "bg-emerald-500/20 text-emerald-400", label: "Favorevole" },
                      neutral: { badge: "bg-muted text-muted-foreground", label: "Neutro" },
                      penalizing: { badge: "bg-red-500/20 text-red-400", label: "Penalizzante" },
                    };
                    const style = impactStyles[row.impact] || impactStyles.neutral;
                    return (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 font-medium text-foreground">{row.label}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">
                          {row.value != null ? (
                            <span className={row.value < 0 ? "text-emerald-400" : row.value > 0 ? "text-foreground" : "text-muted-foreground"}>
                              {row.value > 0 ? "+" : ""}{row.value.toFixed(1)}s
                            </span>
                          ) : "N/A"}
                        </td>
                        <td className="py-1.5 pr-2 text-center">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.badge}`}>
                            {style.label}
                          </span>
                        </td>
                        <td className="py-1.5 text-muted-foreground text-[10px]">{row.note}</td>
                      </tr>
                    );
                  })}
                  {primaryBreakdown?.total_estimated != null && (
                    <tr className="border-t border-border font-semibold">
                      <td className="py-1.5 pr-2 text-foreground">Totale stimato</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-foreground">
                        {primaryBreakdown.total_estimated.toFixed(1)}s
                      </td>
                      <td colSpan={2} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Confidence factors ── */}
        <details className="group">
          <summary className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/40 rounded-md px-3 py-2 w-full hover:bg-muted/60 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium text-foreground/80">Fattori di confidenza del modello</span>
            <ChevronDown className="h-3 w-3 ml-auto transition-transform group-open:rotate-180" />
          </summary>
          <div className="bg-muted/40 rounded-b-md px-3 py-2.5 space-y-1 text-[11px] text-muted-foreground -mt-1">
            <ul className="space-y-1 pl-5 list-disc">
              {confidence_factors.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
            <p className="pt-1.5 italic text-[10px]">
              ⚠️ Questa analisi è una stima basata sui dati OpenF1 disponibili e non sostituisce l'analisi di un team di F1.
            </p>
          </div>
        </details>

      </CardContent>
    </Card>
  );
}
