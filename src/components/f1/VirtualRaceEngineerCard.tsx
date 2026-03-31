import type { VirtualRaceEngineerResult } from "@/lib/virtualRaceEngineer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, ChevronDown, ArrowRight, Clock, AlertTriangle, CheckCircle, Gauge } from "lucide-react";

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

interface Props {
  result: VirtualRaceEngineerResult;
}

export function VirtualRaceEngineerCard({ result }: Props) {
  const { actual_strategy, recommended_strategy, alternative_strategies, verdict, confidence, confidence_factors, weather_impact, neutralisation_impact } = result;

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
              {recommended_strategy.pit_windows.map((pw, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground">Pit {i + 1}:</span>
                  <span className="font-mono font-bold">Giro {pw.ideal_lap}</span>
                  <span className="text-muted-foreground">(finestra {pw.range[0]}–{pw.range[1]})</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <CompoundBadge compound={pw.compound_after} />
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

        {/* ── Context: Weather & Neutralisations ── */}
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
