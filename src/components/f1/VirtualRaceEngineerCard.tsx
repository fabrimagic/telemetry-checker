import type { VirtualRaceEngineerResult, ActualStrategy, RecommendedStrategy } from "@/lib/virtualRaceEngineer";
import type { TrafficPrediction, TrafficLevel } from "@/lib/trafficPredictor";
import type { StrategyBreakdown } from "@/lib/strategyBreakdown";
import { breakdownToRows } from "@/lib/strategyBreakdown";
import { RISK_MODES, NEUTRAL_PHASE_ADJUSTMENTS, scoreStrategies, type RiskMode } from "@/lib/riskAppetite";
import { ALL_SCENARIO_IDS, SCENARIO_DEFINITIONS, isSimulatedScenario, type ScenarioId } from "@/lib/scenarioContext";
import type { EnrichedStrategyAnalysis, RobustnessLabel } from "@/lib/strategyAnalysis";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Info, ChevronDown, ArrowRight, Clock, AlertTriangle, CheckCircle, Gauge, Navigation, BarChart3, Shield, Zap, Scale, Activity, FlaskConical, Target, Layers, Globe, Flag, Repeat } from "lucide-react";
import React, { useMemo, useState } from "react";

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
      {labels[level] || level}
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

function RobustnessBadge({ label }: { label: RobustnessLabel }) {
  const styles: Record<RobustnessLabel, string> = {
    ROBUST: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    MEDIUM: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    FRAGILE: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded border text-[9px] font-semibold ${styles[label]}`}>
      {label}
    </span>
  );
}

function StrategyAdvancedDetails({ analysis }: { analysis: EnrichedStrategyAnalysis }) {
  const [open, setOpen] = useState(false);
  const hasContent = analysis.competitor_context || analysis.overtake_difficulty || analysis.stint_extension || analysis.sensitivity;
  if (!hasContent) return null;

  return (
    <details className="mt-1.5 group" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <Layers className="h-3 w-3 shrink-0" />
        <span>Dettagli avanzati</span>
        <ChevronDown className={`h-3 w-3 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </summary>
      <div className="mt-1.5 space-y-1.5 pl-4 text-[10px] text-muted-foreground border-l border-border/50">
        {analysis.sensitivity && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>Sens. degrado: <strong className="font-mono text-foreground">{analysis.sensitivity.sensitivity_to_degradation > 0 ? "+" : ""}{analysis.sensitivity.sensitivity_to_degradation}s</strong></span>
            <span>Sens. traffico: <strong className="font-mono text-foreground">{analysis.sensitivity.sensitivity_to_traffic > 0 ? "+" : ""}{analysis.sensitivity.sensitivity_to_traffic}s</strong></span>
            <span>Sens. pit loss: <strong className="font-mono text-foreground">+{analysis.sensitivity.sensitivity_to_pit_loss}s</strong></span>
          </div>
        )}
        {analysis.competitor_context && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>Rientro: <strong className="font-mono text-foreground">P{analysis.competitor_context.expected_rejoin_position}</strong></span>
            <span>Undercut risk: <strong className="font-mono text-foreground">{Math.round(analysis.competitor_context.undercut_risk * 100)}%</strong></span>
            <span>Undercut opp.: <strong className="font-mono text-foreground">{Math.round(analysis.competitor_context.undercut_opportunity * 100)}%</strong></span>
            <span>Traffic risk: <strong className="font-mono text-foreground">{Math.round(analysis.competitor_context.traffic_risk_after_pit * 100)}%</strong></span>
          </div>
        )}
        {analysis.overtake_difficulty && analysis.overtake_difficulty.expected_laps_stuck > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>Difficoltà sorpasso: <strong className="font-mono text-foreground">{Math.round(analysis.overtake_difficulty.overtake_difficulty_score * 100)}%</strong></span>
            <span>Giri bloccato: <strong className="font-mono text-foreground">~{analysis.overtake_difficulty.expected_laps_stuck}</strong></span>
            <span>Dirty air: <strong className="font-mono text-foreground">+{analysis.overtake_difficulty.dirty_air_penalty}s</strong></span>
          </div>
        )}
        {analysis.stint_extension && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>Costo estensione: <strong className="font-mono text-foreground">{analysis.stint_extension.extension_cost_per_lap}s/g</strong></span>
            <span>Penalità totale: <strong className="font-mono text-foreground">+{analysis.stint_extension.total_extension_penalty}s</strong></span>
            <span>Cliff risk: <strong className="font-mono text-foreground">{Math.round(analysis.stint_extension.cliff_risk_if_extend * 100)}%</strong></span>
          </div>
        )}
      </div>
    </details>
  );
}

function VRESection({ title, icon, defaultOpen = false, badge, children }: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1">{title}</span>
        {badge}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 pb-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function StrategyTimeline({ actual, recommended, riskMode }: { actual: ActualStrategy; recommended: RecommendedStrategy; riskMode?: RiskMode }) {
  const totalLaps = actual.stints.length > 0
    ? Math.max(...actual.stints.map((s) => s.lap_end))
    : 0;
  if (totalLaps === 0) return null;

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
      <span className="text-[10px] text-muted-foreground w-20 shrink-0 text-right">{label}</span>
      <div className="flex-1 flex h-6 rounded overflow-hidden border border-border/50">
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
      {renderRow("Reale", actual.stints.map((s) => ({ compound: s.compound, lap_start: s.lap_start, lap_end: s.lap_end })))}
      {recStints.length > 0 && renderRow("Ottimale", recStints)}
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0" />
        <div className="flex-1 flex justify-between text-[9px] text-muted-foreground px-0.5">
          <span>L1</span>
          <span>L{totalLaps}</span>
        </div>
      </div>
      {recommended.estimated_gain_seconds > 0.1 && (
        <div className="flex items-center gap-2 mt-1">
          <span className="w-20 shrink-0" />
          <p className="text-[10px] text-muted-foreground">
            Guadagno stimato: <span className="font-mono font-bold text-emerald-400">{recommended.estimated_gain_seconds.toFixed(1)}s</span>
            {riskMode && riskMode !== "BALANCED" && (
              <span className="ml-1.5">
                (profilo <strong className="text-foreground">{RISK_MODES[riskMode].label}</strong>)
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Breakdown Table (reusable for recommended + alternatives) ── */
function BreakdownTable({ breakdown, riskMode, scenarioLabel, scenarioIsSimulated, scenarioModifiers }: {
  breakdown: StrategyBreakdown;
  riskMode: RiskMode;
  scenarioLabel?: string;
  scenarioIsSimulated?: boolean;
  scenarioModifiers?: Record<string, any>;
}) {
  const adjustedBreakdown = useMemo(() => {
    if (riskMode === "BALANCED") return breakdown;
    const riskWeights: Record<RiskMode, { degradation: number; traffic: number }> = {
      CONSERVATIVE: { degradation: 1.15, traffic: 1.3 },
      BALANCED: { degradation: 1.0, traffic: 1.0 },
      AGGRESSIVE: { degradation: 0.85, traffic: 0.7 },
    };
    const rw = riskWeights[riskMode];
    const degMult = rw.degradation;
    const trafficMult = rw.traffic;
    return {
      ...breakdown,
      tyre_degradation_cost: breakdown.tyre_degradation_cost != null
        ? Math.round(breakdown.tyre_degradation_cost * degMult * 10) / 10
        : null,
      traffic_loss: breakdown.traffic_loss != null
        ? Math.round(breakdown.traffic_loss * trafficMult * 10) / 10
        : null,
      total_estimated: breakdown.total_estimated != null
        ? Math.round((
            (breakdown.base_stint_time ?? 0) +
            (breakdown.tyre_degradation_cost ?? 0) * degMult +
            (breakdown.pit_loss ?? 0) +
            (breakdown.traffic_loss ?? 0) * trafficMult +
            (breakdown.weather_adjustment ?? 0) +
            (breakdown.neutralization_adjustment ?? 0)
          ) * 10) / 10
        : null,
    };
  }, [breakdown, riskMode]);

  const rows = breakdownToRows(adjustedBreakdown);
  if (rows.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] text-muted-foreground mb-2">
        Valori positivi = costi stimati, negativi = vantaggi.
        {riskMode !== "BALANCED" && (
          <span className="font-semibold"> Pesi aggiustati per profilo {RISK_MODES[riskMode].label}.</span>
        )}
        {scenarioIsSimulated && scenarioLabel && (
          <span className="font-semibold text-amber-400"> Scenario: {scenarioLabel}.</span>
        )}
      </p>
      {scenarioIsSimulated && scenarioModifiers && Object.keys(scenarioModifiers).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {Object.entries(scenarioModifiers).map(([key, val]) => (
            <span key={key} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {key.replace(/_/g, " ")}: {typeof val === "number" ? val.toFixed(2) : val}
            </span>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-2">Componente</th>
              <th className="text-right py-1.5 pr-2">Valore</th>
              <th className="text-center py-1.5 pr-2">Impatto</th>
              <th className="text-left py-1.5">Nota</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
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
            {adjustedBreakdown?.total_estimated != null && (
              <tr className="border-t border-border font-semibold">
                <td className="py-1.5 pr-2 text-foreground">Totale stimato</td>
                <td className="py-1.5 pr-2 text-right font-mono text-foreground">
                  {adjustedBreakdown.total_estimated.toFixed(1)}s
                </td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Traffic Predictions Table (per-strategy) ── */
function TrafficPredictionsTable({ predictions }: { predictions: TrafficPrediction[] }) {
  const filtered = predictions.filter(t => t.traffic_level !== "UNKNOWN");
  if (filtered.length === 0) return null;

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
    <div className="overflow-x-auto">
      <p className="text-[10px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
        <Navigation className="h-3 w-3" /> Traffic prediction
      </p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1 pr-2">Pit Lap</th>
            <th className="text-right py-1 pr-2">Pos. rientro</th>
            <th className="text-left py-1 pr-2">Tra</th>
            <th className="text-center py-1 pr-2">Traffico</th>
            <th className="text-right py-1">Tempo perso</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((t) => (
            <tr key={t.pit_lap} className="border-b border-border/50">
              <td className="py-1 pr-2 font-mono font-bold">L{t.pit_lap}</td>
              <td className="py-1 pr-2 text-right font-mono">P{t.rejoin_position_estimated}</td>
              <td className="py-1 pr-2 text-muted-foreground">
                {t.rejoin_between[0] && t.rejoin_between[1]
                  ? `${t.rejoin_between[0]} – ${t.rejoin_between[1]}`
                  : t.rejoin_between[0] ? `dietro ${t.rejoin_between[0]}` : t.rejoin_between[1] ? `davanti ${t.rejoin_between[1]}` : "—"}
              </td>
              <td className="py-1 pr-2 text-center">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${trafficColors[t.traffic_level] || ""}`}>
                  {trafficLabels[t.traffic_level] || t.traffic_level}
                </span>
              </td>
              <td className="py-1 text-right font-mono">
                {t.estimated_traffic_time_loss > 0
                  ? <span className="text-red-400">+{t.estimated_traffic_time_loss.toFixed(1)}s</span>
                  : <span className="text-emerald-400">+0.0s</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Props {
  result: VirtualRaceEngineerResult;
  onRiskModeChange?: (mode: RiskMode) => void;
  onScenarioChange?: (scenario: ScenarioId) => void;
  onScenarioActivationLapChange?: (lap: number | null) => void;
  onScenarioDurationChange?: (duration: number | null) => void;
  onCustomDegradationChange?: (deg: Record<string, number> | null) => void;
  scenarioActivationLap?: number | null;
  scenarioDurationLaps?: number | null;
}

export function VirtualRaceEngineerCard({ result, onRiskModeChange, onScenarioChange, onScenarioActivationLapChange, onScenarioDurationChange, onCustomDegradationChange, scenarioActivationLap, scenarioDurationLaps }: Props) {
  const { actual_strategy, recommended_strategy, alternative_strategies, verdict, confidence, confidence_factors, weather_impact, neutralisation_impact, practice_compounds_used, traffic_analysis, actual_breakdown, risk_mode, integrated_context, narrative_insights, scenario_id, scenario_is_simulated, scenario_label, scenario_description, scenario_activation_lap, scenario_duration_laps, scenario_window, scenario_activation_warning, degradation_validations, pace_loss_results, custom_degradation_override } = result;

  const scoredStrategies = useMemo(() => {
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
    return scoreStrategies(allStrats, NEUTRAL_PHASE_ADJUSTMENTS, risk_mode);
  }, [alternative_strategies, recommended_strategy, risk_mode]);

  const topScoredName = scoredStrategies?.[0]?.name ?? null;
  const topScoredReason = scoredStrategies?.[0]?.adjustment_reason ?? null;

  return (
    <Card className="border-border">
      {/* ══════ HEADER ══════ */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
            <span className="text-base">🏎️</span> Virtual Race Engineer
          </CardTitle>
          <ConfidenceBadge level={confidence} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Analisi strategica basata su degrado gomme, pit stop, meteo e neutralizzazioni.
        </p>
        {scenario_is_simulated && (
         <div className="mt-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-amber-400 shrink-0" />
             <p className="text-[11px] text-amber-400 font-semibold">
               What-if: {scenario_label}
               {scenario_window ? ` (giri ${scenario_window.start}–${scenario_window.end})` : scenario_activation_lap != null ? ` dal giro ${scenario_activation_lap}` : ""}
             </p>
         </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3 pt-0">

        {/* ══════ VERDICT (always visible) ══════ */}
        <div className="rounded-lg bg-muted/50 border border-border p-4">
          <div className="flex items-start gap-3">
            {verdict.delta_seconds != null && verdict.delta_seconds > 2
              ? <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
              : <CheckCircle className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />}
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">{verdict.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{verdict.summary}</p>
              {verdict.delta_seconds != null && verdict.delta_seconds > 0.1 && (
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-mono font-bold text-foreground">Δ {verdict.delta_seconds.toFixed(1)}s</span> — tempo potenzialmente recuperabile
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ══════ STRATEGY TIMELINE (always visible) ══════ */}
        <StrategyTimeline actual={actual_strategy} recommended={recommended_strategy} riskMode={risk_mode} />


        {/* ═══════════════════════════════════════════════════════════════
            SECTION A: ANALISI GLOBALE GARA
            Contesto condiviso, comune a tutte le strategie
        ═══════════════════════════════════════════════════════════════ */}
        <VRESection
          title="Analisi globale gara"
          icon={<Globe className="h-3.5 w-3.5 text-muted-foreground" />}
          defaultOpen={false}
          badge={<Badge variant="outline" className="text-[8px] px-1.5 py-0 border-border text-muted-foreground">CONTESTO</Badge>}
        >
          <div className="space-y-4 pl-1">

            {/* Context summary badges */}
            {integrated_context && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {integrated_context.battle_context && (
                  <div className="rounded-lg bg-muted/30 border border-border p-2 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Battaglie</p>
                    <p className="text-sm font-bold text-foreground">{integrated_context.battle_context.total_episodes}</p>
                    <p className="text-[9px] text-muted-foreground">{integrated_context.battle_context.total_battle_laps} giri</p>
                  </div>
                )}
                {integrated_context.weather_context?.had_weather_change && (
                  <div className="rounded-lg bg-muted/30 border border-border p-2 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Meteo</p>
                    <p className="text-sm font-bold text-foreground">🌧️ Variabile</p>
                    <p className="text-[9px] text-muted-foreground">{integrated_context.weather_context.wet_laps + integrated_context.weather_context.mixed_laps} giri non-dry</p>
                  </div>
                )}
                {integrated_context.track_status_context && integrated_context.track_status_context.total_neutralized_laps > 0 && (
                  <div className="rounded-lg bg-muted/30 border border-border p-2 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Neutralizzazioni</p>
                    <p className="text-sm font-bold text-foreground">{integrated_context.track_status_context.total_neutralized_laps}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {[
                        integrated_context.track_status_context.had_safety_car && "SC",
                        integrated_context.track_status_context.had_vsc && "VSC",
                        integrated_context.track_status_context.had_red_flag && "Red",
                      ].filter(Boolean).join(", ") || "giri"}
                    </p>
                  </div>
                )}
                {integrated_context.cumulative_deviation_context?.available && integrated_context.cumulative_deviation_context.driver_final_delta != null && (
                  <div className="rounded-lg bg-muted/30 border border-border p-2 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Dev. Cumulativa</p>
                    <p className={`text-sm font-bold font-mono ${integrated_context.cumulative_deviation_context.driver_final_delta > 5 ? "text-red-400" : integrated_context.cumulative_deviation_context.driver_final_delta > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                      {integrated_context.cumulative_deviation_context.driver_final_delta > 0 ? "+" : ""}{integrated_context.cumulative_deviation_context.driver_final_delta.toFixed(1)}s
                    </p>
                    <p className="text-[9px] text-muted-foreground">vs {integrated_context.cumulative_deviation_context.winner_code ?? "P1"}</p>
                  </div>
                )}
              </div>
            )}

            {/* Narrative insights (global context) */}
            {narrative_insights && narrative_insights.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  💡 Insight contestuali
                </h4>
                <ul className="space-y-1.5">
                  {narrative_insights.map((insight, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                      <span className="text-foreground/60 mt-0.5 shrink-0">•</span>
                      <span>{insight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Weather & neutralisation impact */}
            {(weather_impact || neutralisation_impact) && (
              <div className="space-y-1">
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

            {/* Data gaps */}
            {integrated_context?.data_gaps && integrated_context.data_gaps.length > 0 && (
              <p className="text-[10px] text-muted-foreground italic">
                ⚠️ Dati parziali: {integrated_context.data_gaps.join("; ")}
              </p>
            )}

            {/* Traffic Release Analysis (global — shared context) */}
            {traffic_analysis.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <Navigation className="h-3.5 w-3.5" /> Traffic Release Analysis
                  <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-border text-muted-foreground">GLOBALE</Badge>
                </h4>
                <TrafficPredictionsTable predictions={traffic_analysis} />
              </div>
            )}

            {/* Pace Loss per Stint (global — shared context) */}
            {pace_loss_results && pace_loss_results.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" /> Pace Loss per Stint
                  <span className="text-[9px] font-normal text-muted-foreground ml-1">(da deviazione cumulativa)</span>
                </h4>
                <p className="text-[10px] text-muted-foreground mb-2">
                  Indicatore ausiliario di perdita di passo nello stint. Non è una misura diretta del degrado gomme.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-1.5 pr-2">Stint</th>
                        <th className="text-right py-1.5 pr-2">Rate</th>
                        <th className="text-center py-1.5 pr-2">Status</th>
                        <th className="text-center py-1.5 pr-2">Conf.</th>
                        <th className="text-center py-1.5 pr-2">Usato</th>
                        <th className="text-left py-1.5">Nota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pace_loss_results.map((pl) => {
                        const statusStyles: Record<string, string> = {
                          STABLE: "bg-emerald-500/20 text-emerald-400",
                          NORMAL_LOSS: "bg-muted text-muted-foreground",
                          HIGH_LOSS: "bg-amber-500/20 text-amber-400",
                          CLIFF_RISK: "bg-red-500/20 text-red-400",
                          UNRELIABLE: "bg-muted text-muted-foreground/50",
                        };
                        const confStyles: Record<string, string> = {
                          HIGH: "text-emerald-400",
                          MEDIUM: "text-amber-400",
                          LOW: "text-red-400",
                        };
                        return (
                          <tr key={pl.stint_number} className="border-b border-border/50">
                            <td className="py-1.5 pr-2 font-mono">{pl.stint_number}</td>
                            <td className="py-1.5 pr-2 text-right font-mono">
                              {pl.stint_pace_loss_rate != null
                                ? <span className={pl.stint_pace_loss_rate > 0.1 ? "text-amber-400" : pl.stint_pace_loss_rate > 0.2 ? "text-red-400" : ""}>{pl.stint_pace_loss_rate > 0 ? "+" : ""}{pl.stint_pace_loss_rate.toFixed(3)}</span>
                                : "—"}
                            </td>
                            <td className="py-1.5 pr-2 text-center">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${statusStyles[pl.pace_loss_status]}`}>
                                {pl.pace_loss_status}
                              </span>
                            </td>
                            <td className={`py-1.5 pr-2 text-center text-[10px] font-semibold ${confStyles[pl.pace_loss_confidence] || ""}`}>
                              {pl.pace_loss_confidence}
                            </td>
                            <td className="py-1.5 pr-2 text-center">
                              {pl.pace_loss_used_for_strategy ? "✓" : "—"}
                            </td>
                            <td className="py-1.5 text-[10px] text-muted-foreground max-w-[200px] truncate" title={pl.pace_loss_reason}>
                              {pl.pace_loss_reason}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {pace_loss_results.some(r => r.pace_loss_contamination_flags.battle || r.pace_loss_contamination_flags.weather || r.pace_loss_contamination_flags.neutralization) && (
                  <p className="text-[9px] text-muted-foreground italic mt-1.5">
                    ⚠️ Giri contaminati da {[
                      pace_loss_results.some(r => r.pace_loss_contamination_flags.battle) && "battaglie",
                      pace_loss_results.some(r => r.pace_loss_contamination_flags.weather) && "meteo",
                      pace_loss_results.some(r => r.pace_loss_contamination_flags.neutralization) && "neutralizzazioni",
                    ].filter(Boolean).join(", ")} esclusi o ridimensionati nell'analisi.
                  </p>
                )}
              </div>
            )}

            {/* Confidence factors */}
            <div className="rounded-md bg-muted/40 border border-border px-3 py-2.5 space-y-1 text-[11px] text-muted-foreground">
              <p className="font-medium text-foreground/80 flex items-center gap-1">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Fattori di confidenza
              </p>
              <ul className="space-y-1 pl-5 list-disc">
                {confidence_factors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
              <p className="pt-1.5 italic text-[10px]">
                ⚠️ Stima basata sui dati OpenF1 disponibili, non sostituisce l'analisi di un team di F1.
              </p>
            </div>

            {practice_compounds_used && practice_compounds_used.length > 0 && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3 shrink-0" />
                Degrado da Practice: {practice_compounds_used.map((c) => (
                  <CompoundBadge key={c} compound={c} />
                ))}
              </p>
            )}
          </div>
        </VRESection>


        {/* ═══════════════════════════════════════════════════════════════
            RACE CONTEXT & SIMULATORE (controls)
        ═══════════════════════════════════════════════════════════════ */}
        {(
          <VRESection
            title="Race Context & Simulatore"
            icon={<Activity className="h-3.5 w-3.5 text-muted-foreground" />}
            defaultOpen={false}
          >
            <div className="space-y-3 pl-1">
              {/* Scenario selector */}
              <div className="flex items-start gap-2">
                <span className="text-[11px] text-muted-foreground shrink-0 w-20 pt-2">Scenario:</span>
                <div className="flex-1 space-y-1">
                  <Select
                    value={scenario_id}
                    onValueChange={(val) => onScenarioChange?.(val as ScenarioId)}
                  >
                    <SelectTrigger className="h-8 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_SCENARIO_IDS.map((sid) => {
                        const def = SCENARIO_DEFINITIONS[sid];
                        return (
                          <SelectItem key={sid} value={sid} className="text-[11px]">
                            <span className="flex items-center gap-1.5">
                              {isSimulatedScenario(sid) && <FlaskConical className="h-3 w-3 text-amber-400" />}
                              {def.label}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">{scenario_description}</p>
                  {scenario_is_simulated && (
                    <>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground shrink-0">Giro:</span>
                        <Input
                          type="number"
                          min={1}
                          max={actual_strategy.stints.length > 0 ? Math.max(...actual_strategy.stints.map(s => s.lap_end)) : 99}
                          value={scenarioActivationLap ?? ""}
                          placeholder="Tutti"
                          onChange={(e) => {
                            const val = e.target.value;
                            onScenarioActivationLapChange?.(val === "" ? null : parseInt(val, 10));
                          }}
                          className="h-7 w-16 text-[11px] font-mono"
                        />
                        <span className="text-[10px] text-muted-foreground shrink-0">Durata:</span>
                        <Input
                          type="number"
                          min={1}
                          max={actual_strategy.stints.length > 0 ? Math.max(...actual_strategy.stints.map(s => s.lap_end)) : 99}
                          value={scenarioDurationLaps ?? ""}
                          placeholder="∞"
                          onChange={(e) => {
                            const val = e.target.value;
                            onScenarioDurationChange?.(val === "" ? null : parseInt(val, 10));
                          }}
                          className="h-7 w-16 text-[11px] font-mono"
                        />
                      </div>
                      {scenario_window && (
                        <p className="text-[10px] text-foreground/70 font-mono mt-0.5">
                          📌 Finestra: giro {scenario_window.start} → {scenario_window.end}
                        </p>
                      )}
                      {scenario_activation_warning && (
                        <p className="text-[10px] text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> {scenario_activation_warning}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Phase indicator */}
              <div className="flex items-start gap-2">
                <span className="text-[11px] text-muted-foreground shrink-0 w-20">Fase gara:</span>
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
                    const isActive = risk_mode === mode;
                    const icons: Record<RiskMode, React.ReactNode> = {
                      CONSERVATIVE: <Shield className="h-3 w-3" />,
                      BALANCED: <Scale className="h-3 w-3" />,
                      AGGRESSIVE: <Zap className="h-3 w-3" />,
                    };
                    return (
                      <button
                        key={mode}
                        onClick={() => onRiskModeChange?.(mode)}
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

              {/* Risk mode note */}
              <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-[10px] text-muted-foreground">
                <p className="font-semibold text-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  {risk_mode === "CONSERVATIVE" && "Conservative: priorità a robustezza e track position"}
                  {risk_mode === "BALANCED" && "Balanced: compromesso equilibrato"}
                  {risk_mode === "AGGRESSIVE" && "Aggressive: massimizza guadagno, accetta più rischio"}
                </p>
                {risk_mode === "CONSERVATIVE" && (
                  <p className="mt-0.5">Degrado +15%, traffico +30%, guadagno −20%. Favorisce scelte difensive.</p>
                )}
                {risk_mode === "BALANCED" && (
                  <p className="mt-0.5">Tutti i pesi applicati senza modifiche. Profilo di riferimento standard.</p>
                )}
                {risk_mode === "AGGRESSIVE" && (
                  <p className="mt-0.5">Degrado −10%, traffico −30%, guadagno +30%. Favorisce alto upside.</p>
                )}
              </div>

              {topScoredName && risk_mode !== "BALANCED" && (
                <p className="text-[10px] text-muted-foreground italic">
                  💡 Top strategia con profilo <strong className="text-foreground">{RISK_MODES[risk_mode].label}</strong>: <strong className="text-foreground">{topScoredName}</strong>
                  {topScoredReason && topScoredReason !== "Nessun aggiustamento" && (
                    <span> ({topScoredReason})</span>
                  )}
                </p>
              )}

              {/* Race phase explanation */}
              <details className="group">
                <summary className="flex items-center gap-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <Info className="h-3 w-3 shrink-0" />
                  <span>Come funziona la Race Phase</span>
                  <ChevronDown className="h-3 w-3 ml-auto transition-transform group-open:rotate-180" />
                </summary>
                <p className="text-[10px] text-muted-foreground/70 mt-1 leading-relaxed pl-5">
                  La Race Phase è il primo input del modello. Rileva automaticamente la fase corrente (partenza, stint iniziale, finestra pit, gestione centrale, attacco finale, ultimi giri, neutralizzazione, transizione meteo) e assegna pesi che modificano l'importanza relativa di degrado, traffico, posizione, rischio e opportunità da neutralizzazione.
                </p>
              </details>

              {/* Custom degradation override — per compound */}
              {degradation_validations?.some(dv => dv.status === "INVALID") && (() => {
                const invalidCompounds = Array.from(new Set(
                  degradation_validations.filter(dv => dv.status === "INVALID").map(dv => dv.original.compound)
                ));
                const overrideMap: Record<string, number> = custom_degradation_override != null && typeof custom_degradation_override === "object" ? custom_degradation_override : {};
                const hasAnyOverride = Object.keys(overrideMap).length > 0;

                return (
                  <div className="bg-muted/30 border border-border rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <p className="text-[11px] font-semibold text-foreground">Degrado personalizzato (opzionale)</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Uno o più stint hanno degrado classificato come <strong className="text-red-400">INVALID</strong>. 
                      Puoi inserire un valore di degrado personalizzato per ciascuna mescola (in secondi al giro). 
                      I campi lasciati vuoti useranno il fallback automatico.
                    </p>
                    <div className="space-y-1.5">
                      {invalidCompounds.map(compound => (
                        <div key={compound} className="flex items-center gap-2">
                          <CompoundBadge compound={compound} />
                          <Input
                            type="number"
                            step="0.001"
                            min="0.001"
                            max="0.300"
                            placeholder="es. 0.045"
                            className="w-28 h-7 text-xs font-mono bg-background"
                            value={overrideMap[compound] != null ? overrideMap[compound] : ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              const newMap = { ...overrideMap };
                              if (val === "" || val === null) {
                                delete newMap[compound];
                              } else {
                                const num = parseFloat(val);
                                if (!isNaN(num) && num >= 0.001 && num <= 0.300) {
                                  newMap[compound] = num;
                                } else if (!isNaN(num) && num === 0) {
                                  return;
                                } else {
                                  return;
                                }
                              }
                              onCustomDegradationChange?.(Object.keys(newMap).length > 0 ? newMap : null);
                            }}
                          />
                          <span className="text-[10px] text-muted-foreground">s/giro</span>
                          {overrideMap[compound] != null && (
                            <button
                              onClick={() => {
                                const newMap = { ...overrideMap };
                                delete newMap[compound];
                                onCustomDegradationChange?.(Object.keys(newMap).length > 0 ? newMap : null);
                              }}
                              className="text-[10px] text-red-400 hover:text-red-300 underline"
                            >
                              Rimuovi
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {hasAnyOverride && (
                      <div className="space-y-0.5">
                        {Object.entries(overrideMap).map(([comp, val]) => (
                          <p key={comp} className="text-[9px] text-amber-400/80 flex items-center gap-1">
                            <Gauge className="h-3 w-3" />
                            Override attivo per {comp}: {val.toFixed(3)} s/giro
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </VRESection>
        )}


        {/* ═══════════════════════════════════════════════════════════════
            SECTION B: STRATEGIA REALE
            Solo dati della strategia effettivamente eseguita
        ═══════════════════════════════════════════════════════════════ */}
        <VRESection
          title="Strategia reale"
          icon={<Flag className="h-3.5 w-3.5 text-muted-foreground" />}
          defaultOpen={false}
          badge={<Badge variant="outline" className="text-[8px] px-1.5 py-0 border-border text-muted-foreground">REALE</Badge>}
        >
          <div className="space-y-4 pl-1">
            {/* Stint visualization */}
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

            {/* Stint table with degradation */}
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1.5 pr-2">Stint</th>
                    <th className="text-left py-1.5 pr-2">Compound</th>
                    <th className="text-right py-1.5 pr-2">Giri</th>
                    <th className="text-right py-1.5 pr-2">Media</th>
                    <th className="text-right py-1.5 pr-2">Grezzo</th>
                    <th className="text-right py-1.5 pr-2">Corretto</th>
                    <th className="text-right py-1.5 pr-2">R²</th>
                    <th className="text-center py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {actual_strategy.stints.map((s) => {
                    const dv = degradation_validations?.find(d => d.original.stint === s.stint_number);
                    const statusStyles: Record<string, string> = {
                      VALID: "bg-emerald-500/20 text-emerald-400",
                      NEUTRAL: "bg-amber-500/20 text-amber-400",
                      INVALID: "bg-red-500/20 text-red-400",
                    };
                    return (
                      <tr key={s.stint_number} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 font-mono">{s.stint_number}</td>
                        <td className="py-1.5 pr-2"><CompoundBadge compound={s.compound} /></td>
                        <td className="py-1.5 pr-2 text-right font-mono">{s.laps_count}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{s.avg_lap_time?.toFixed(3) ?? "—"}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">
                          {dv ? (
                            <>
                              {dv.original.slopeSecPerLap.toFixed(4)}
                              {dv.model_corrected && (
                                <span className="block text-[8px] text-amber-400/70">raw</span>
                              )}
                            </>
                          ) : "—"}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono">
                          {dv ? (
                            <>
                              {dv.effective_slope.toFixed(4)}
                              {dv.fallback_applied && (
                                <span className="block text-[8px] text-amber-400/70">fallback</span>
                              )}
                            </>
                          ) : "—"}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono">{s.r_squared != null ? s.r_squared.toFixed(3) : "—"}</td>
                        <td className="py-1.5 text-center">
                          {dv ? (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${statusStyles[dv.status]}`} title={dv.reason}>
                              {dv.status}
                              {dv.model_corrected && <span className="ml-0.5 text-[7px]">MV</span>}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pit stops */}
            {actual_strategy.pit_stops.length > 0 && (
              <div>
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
                      <span className="text-muted-foreground">{typeof p.lane_duration === "number" ? p.lane_duration.toFixed(1) : p.lane_duration ?? "—"}s</span>
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

            {/* Actual breakdown if available */}
            {actual_breakdown && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" /> Scomposizione costi reali
                </h4>
                <BreakdownTable
                  breakdown={actual_breakdown}
                  riskMode="BALANCED"
                  racePhaseDef={undefined}
                />
              </div>
            )}
          </div>
        </VRESection>


        {/* ═══════════════════════════════════════════════════════════════
            SECTION C: STRATEGIA RACCOMANDATA
            Solo dati della recommended strategy
        ═══════════════════════════════════════════════════════════════ */}
        {recommended_strategy.pit_windows.length > 0 && (
          <VRESection
            title="Strategia raccomandata"
            icon={<Target className="h-3.5 w-3.5 text-muted-foreground" />}
            defaultOpen={false}
            badge={
              <div className="flex items-center gap-1.5">
                {recommended_strategy.analysis?.robustness && (
                  <RobustnessBadge label={recommended_strategy.analysis.robustness.robustness_label} />
                )}
                {recommended_strategy.estimated_gain_seconds > 0.1 && (
                  <DeltaBadge delta={recommended_strategy.estimated_gain_seconds} />
                )}
                <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-primary/30 text-primary">OTTIMALE</Badge>
              </div>
            }
          >
            <div className="space-y-3 pl-1">
              <div className="rounded-lg bg-muted/30 border border-primary/20 p-3 space-y-2">
                {/* Compounds */}
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

                {/* Pit windows */}
                {recommended_strategy.pit_windows.map((pw, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground">Pit {i + 1}:</span>
                    <span className="font-mono font-bold">Giro {pw.ideal_lap}</span>
                    <span className="text-muted-foreground">(finestra {pw.range[0]}–{pw.range[1]})</span>
                  </div>
                ))}

                {/* Gain */}
                {recommended_strategy.estimated_gain_seconds > 0.1 && (
                  <p className="text-[11px] mt-1">
                    <span className="font-semibold text-emerald-400">Guadagno stimato: {recommended_strategy.estimated_gain_seconds.toFixed(1)}s</span>
                    {recommended_strategy.time_delta_vs_actual != null && (
                      <span className="text-muted-foreground ml-2 font-mono text-[10px]">
                        (Δt: {recommended_strategy.time_delta_vs_actual > 0 ? "+" : ""}{recommended_strategy.time_delta_vs_actual.toFixed(1)}s)
                      </span>
                    )}
                  </p>
                )}

                {/* Description & Reason */}
                {recommended_strategy.description && (
                  <p className="text-[10px] text-muted-foreground">{recommended_strategy.description}</p>
                )}
                <p className="text-[11px] text-muted-foreground italic">{recommended_strategy.reason}</p>

                {/* Multi-objective mini-bar */}
                {recommended_strategy.analysis?.multi_objective && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-muted-foreground mt-1.5">
                    <span>⏱ Tempo: <strong className="text-foreground">{recommended_strategy.analysis.multi_objective.race_time_objective > 0 ? "+" : ""}{recommended_strategy.analysis.multi_objective.race_time_objective}s</strong></span>
                    <span>📍 Posiz.: <strong className="text-foreground">{recommended_strategy.analysis.multi_objective.track_position_objective > 0 ? "-" : ""}{recommended_strategy.analysis.multi_objective.track_position_objective}</strong></span>
                    <span>⚠️ Rischio: <strong className="text-foreground">{Math.round(recommended_strategy.analysis.multi_objective.risk_objective * 100)}%</strong></span>
                    <span>🛡️ Robustezza: <strong className="text-foreground">{Math.round(recommended_strategy.analysis.multi_objective.robustness_objective * 100)}%</strong></span>
                  </div>
                )}

                {/* Pros / Cons */}
                {((recommended_strategy.pros && recommended_strategy.pros.length > 0) || (recommended_strategy.cons && recommended_strategy.cons.length > 0)) && (
                  <div className="flex gap-4 text-[10px] mt-1.5">
                    {recommended_strategy.pros && recommended_strategy.pros.length > 0 && (
                      <div>
                        <span className="text-emerald-400 font-semibold">Pro: </span>
                        <span className="text-muted-foreground">{recommended_strategy.pros.join("; ")}</span>
                      </div>
                    )}
                    {recommended_strategy.cons && recommended_strategy.cons.length > 0 && (
                      <div>
                        <span className="text-red-400 font-semibold">Contro: </span>
                        <span className="text-muted-foreground">{recommended_strategy.cons.join("; ")}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Traffic predictions for recommended */}
                {recommended_strategy.traffic_predictions && recommended_strategy.traffic_predictions.length > 0 && (
                  <div className="mt-2">
                    <TrafficPredictionsTable predictions={recommended_strategy.traffic_predictions} />
                  </div>
                )}

                {/* Advanced details */}
                {recommended_strategy.analysis && (
                  <StrategyAdvancedDetails analysis={recommended_strategy.analysis} />
                )}
              </div>

              {/* Breakdown for recommended */}
              {recommended_strategy.breakdown && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5" /> Scomposizione del giudizio
                  </h4>
                  <BreakdownTable
                    breakdown={recommended_strategy.breakdown}
                    riskMode={risk_mode}
                    racePhaseDef={race_phase}
                    scenarioLabel={scenario_label}
                    scenarioIsSimulated={scenario_is_simulated}
                    scenarioModifiers={result.scenario_modifiers_applied}
                  />
                </div>
              )}
            </div>
          </VRESection>
        )}


        {/* ═══════════════════════════════════════════════════════════════
            SECTION D: STRATEGIE ALTERNATIVE
            Una card per ogni alternativa con i propri dati specifici
        ═══════════════════════════════════════════════════════════════ */}
        {alternative_strategies.length > 0 && (
          <VRESection
            title="Strategie alternative"
            icon={<Repeat className="h-3.5 w-3.5 text-muted-foreground" />}
            defaultOpen={false}
            badge={
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-border text-muted-foreground">
                  {alternative_strategies.length} {alternative_strategies.length === 1 ? "alternativa" : "alternative"}
                </Badge>
                {risk_mode !== "BALANCED" && (
                  <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-border text-muted-foreground">
                    {RISK_MODES[risk_mode].label}
                  </Badge>
                )}
              </div>
            }
          >
            <div className="space-y-3 pl-1">
              {(() => {
                const displayAlts = scoredStrategies
                  ? scoredStrategies
                      .filter(s => s.index >= 0)
                      .map(s => {
                        const alt = alternative_strategies[s.index];
                        if (!alt) return null;
                        return { ...alt, adjusted_score: s.adjusted_score, adjustment_reason: s.adjustment_reason };
                      })
                      .filter(Boolean) as (typeof alternative_strategies[number] & { adjusted_score: number; adjustment_reason: string })[]
                  : alternative_strategies.map(alt => ({ ...alt, adjusted_score: alt.estimated_delta_vs_actual, adjustment_reason: "" }));

                return displayAlts.map((alt, i) => (
                  <div key={i} className={`rounded-lg border p-3 space-y-2 ${scoredStrategies && i === 0 && risk_mode !== "BALANCED" ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30"}`}>
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-foreground">{alt.name}</span>
                        {scoredStrategies && i === 0 && risk_mode !== "BALANCED" && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/30 text-primary">
                            Top {RISK_MODES[risk_mode].label}
                          </Badge>
                        )}
                        {alt.analysis?.robustness && (
                          <RobustnessBadge label={alt.analysis.robustness.robustness_label} />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {risk_mode !== "BALANCED" && Math.abs(alt.adjusted_score - alt.estimated_delta_vs_actual) > 0.05 && (
                          <span className="text-[9px] text-muted-foreground font-mono">
                            adj: {alt.adjusted_score > 0 ? "+" : ""}{alt.adjusted_score.toFixed(1)}s
                          </span>
                        )}
                        <DeltaBadge delta={alt.estimated_delta_vs_actual} />
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-[10px] text-muted-foreground">{alt.description}</p>

                    {/* Risk adjustment reason */}
                    {risk_mode !== "BALANCED" && alt.adjustment_reason && alt.adjustment_reason !== "Nessun aggiustamento" && (
                      <p className="text-[9px] text-muted-foreground italic">
                        ⚖️ {alt.adjustment_reason}
                      </p>
                    )}

                    {/* Pit Window */}
                    {alt.analysis?.pit_window && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-semibold">Pit window:</span>
                        <span className="font-mono">L{alt.analysis.pit_window.pit_window_start}–L{alt.analysis.pit_window.pit_window_end}</span>
                        <span className="text-[9px]">(best: L{alt.analysis.pit_window.best_lap_in_window}, spread: {alt.analysis.pit_window.window_time_spread}s)</span>
                      </div>
                    )}

                    {/* Multi-objective mini-bar */}
                    {alt.analysis?.multi_objective && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-muted-foreground">
                        <span>⏱ Tempo: <strong className="text-foreground">{alt.analysis.multi_objective.race_time_objective > 0 ? "+" : ""}{alt.analysis.multi_objective.race_time_objective}s</strong></span>
                        <span>📍 Posiz.: <strong className="text-foreground">{alt.analysis.multi_objective.track_position_objective > 0 ? "-" : ""}{alt.analysis.multi_objective.track_position_objective}</strong></span>
                        <span>⚠️ Rischio: <strong className="text-foreground">{Math.round(alt.analysis.multi_objective.risk_objective * 100)}%</strong></span>
                        <span>🛡️ Robustezza: <strong className="text-foreground">{Math.round(alt.analysis.multi_objective.robustness_objective * 100)}%</strong></span>
                      </div>
                    )}

                    {/* Pros / Cons */}
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

                    {/* Traffic predictions per-strategy */}
                    {alt.traffic_predictions && alt.traffic_predictions.length > 0 && (
                      <TrafficPredictionsTable predictions={alt.traffic_predictions} />
                    )}

                    {/* Advanced details */}
                    {alt.analysis && (
                      <StrategyAdvancedDetails analysis={alt.analysis} />
                    )}

                    {/* Breakdown per-strategy */}
                    {alt.breakdown && (
                      <details className="group mt-1">
                        <summary className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                          <BarChart3 className="h-3 w-3 shrink-0" />
                          <span>Scomposizione del giudizio</span>
                          <ChevronDown className="h-3 w-3 ml-auto transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="mt-1.5">
                          <BreakdownTable
                            breakdown={alt.breakdown}
                            riskMode={risk_mode}
                            racePhaseDef={race_phase}
                            scenarioLabel={scenario_label}
                            scenarioIsSimulated={scenario_is_simulated}
                            scenarioModifiers={result.scenario_modifiers_applied}
                          />
                        </div>
                      </details>
                    )}
                  </div>
                ));
              })()}
            </div>
          </VRESection>
        )}

      </CardContent>
    </Card>
  );
}
