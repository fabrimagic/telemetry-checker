/**
 * Side-by-side card that contrasts each driver's REAL race strategy with the
 * "ex-ante balanced" ALTERNATIVE strategy computed by a second VRE pass
 * (analysisMode = POST_RACE, riskMode = BALANCED).
 *
 * Anti-hallucination: every number rendered comes directly from
 * `VirtualRaceEngineerResult.recommended_strategy` / `actual_strategy`. When a
 * field is missing or NaN we render a neutral placeholder ("—") instead of
 * inventing a value.
 *
 * The counterfactual section renders only when `comparison.counterfactual_analysis`
 * is non-null, and ALWAYS surfaces the disclaimer string from the analysis.
 */

import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRight, AlertTriangle, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { ComparisonResult, CounterfactualScenarioId } from "@/lib/headToHeadComparison";
import type { Driver } from "@/lib/openf1";
import type { VirtualRaceEngineerResult } from "@/lib/virtualRaceEngineer";
import { cn } from "@/lib/utils";

interface Props {
  comparison: ComparisonResult;
  driverA: Driver;
  driverB: Driver;
}

/** Render a signed seconds value with motorsport convention coloring. */
function GainBadge({ seconds }: { seconds: number | null }) {
  if (seconds == null || !Number.isFinite(seconds)) {
    return <span className="text-muted-foreground font-mono text-xs">—</span>;
  }
  const isFaster = seconds < -0.05;
  const isSlower = seconds > 0.05;
  const Icon = isFaster ? TrendingDown : isSlower ? TrendingUp : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs font-bold tabular-nums",
        isFaster && "text-emerald-400",
        isSlower && "text-destructive",
        !isFaster && !isSlower && "text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {seconds > 0 ? "+" : ""}{seconds.toFixed(2)}s
    </span>
  );
}

function fmtSec(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}s`;
}

function compoundChip(c: string | null | undefined): JSX.Element {
  const map: Record<string, string> = {
    SOFT: "bg-red-500/20 text-red-300 border-red-500/40",
    MEDIUM: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    HARD: "bg-zinc-200/20 text-zinc-100 border-zinc-300/40",
    INTERMEDIATE: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    WET: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  };
  const safe = c ?? "";
  const cls = map[safe.toUpperCase()] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider", cls)}>
      {safe.charAt(0) || "?"}
    </span>
  );
}

function PitLapsList({ laps }: { laps: number[] }) {
  if (!laps.length) return <span className="font-mono text-xs text-muted-foreground">No-stop</span>;
  return (
    <span className="font-mono text-xs text-foreground">
      {laps.map((l, i) => (
        <span key={i}>
          L{l}
          {i < laps.length - 1 ? " · " : ""}
        </span>
      ))}
    </span>
  );
}

interface DriverPanelProps {
  driver: Driver;
  real: VirtualRaceEngineerResult;
  alt: VirtualRaceEngineerResult | null;
}

function DriverPanel({ driver, real, alt }: DriverPanelProps) {
  const teamColor = `#${driver.team_colour || "888888"}`;
  const realStrat = real.actual_strategy;
  const realCompounds = realStrat.stints.map((s) => s.compound);
  const realPits = realStrat.pit_laps;

  const altRec = alt?.recommended_strategy ?? null;
  const altCompounds = altRec?.compounds ?? [];
  const altPits = altRec?.pit_windows.map((w) => w.ideal_lap) ?? [];
  const altGain = altRec?.time_delta_vs_actual ?? null;
  const altDescription = altRec?.description ?? altRec?.reason ?? null;
  const altPros = altRec?.pros ?? [];
  const altCons = altRec?.cons ?? [];
  const altBreakdown = altRec?.breakdown ?? null;

  // Breakdown rows: only render fields with finite values
  const breakdownRows: { label: string; value: number | null }[] = altBreakdown
    ? [
        { label: "Tempo base stint", value: altBreakdown.base_stint_time },
        { label: "Costo degrado gomma", value: altBreakdown.tyre_degradation_cost },
        { label: "Costo warmup", value: altBreakdown.warmup_cost },
        { label: "Pit loss", value: altBreakdown.pit_loss },
        { label: "Traffico al rientro", value: altBreakdown.traffic_loss },
        { label: "Aggiustamento meteo", value: altBreakdown.weather_adjustment },
        { label: "Beneficio neutralizzazione", value: altBreakdown.neutralization_adjustment },
      ].filter((r) => r.value != null && Number.isFinite(r.value))
    : [];

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3" style={{ borderLeftWidth: 4, borderLeftColor: teamColor }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: teamColor, color: "#000" }}>
          {driver.name_acronym}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{driver.full_name}</div>
          <div className="text-[10px] text-muted-foreground font-mono uppercase">#{driver.driver_number}</div>
        </div>
      </div>

      {/* REAL strategy block */}
      <div className="px-4 py-3 bg-muted/20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Strategia reale</span>
          <Badge variant="outline" className="text-[9px] font-mono uppercase">Eseguita in pista</Badge>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            {realCompounds.length
              ? realCompounds.map((c, i) => (
                  <div key={i} className="flex items-center gap-1">
                    {compoundChip(c)}
                    {i < realCompounds.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                  </div>
                ))
              : <span className="text-xs text-muted-foreground">—</span>}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Pit:</span>
            <PitLapsList laps={realPits} />
          </div>
        </div>
      </div>

      {/* ALTERNATIVE strategy block */}
      <div className="px-4 py-3 border-t-2 border-dashed border-[hsl(var(--f1-red))]/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[hsl(var(--f1-red))]">
            Strategia alternativa · ex-ante balanced
          </span>
          {altGain != null && Number.isFinite(altGain) && (
            <GainBadge seconds={altGain} />
          )}
        </div>

        {!altRec ? (
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Dati insufficienti per calcolare un'alternativa attendibile.</span>
          </div>
        ) : (
          <>
            <div className="space-y-1.5 mb-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {altCompounds.length
                  ? altCompounds.map((c, i) => (
                      <div key={i} className="flex items-center gap-1">
                        {compoundChip(c)}
                        {i < altCompounds.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                      </div>
                    ))
                  : <span className="text-xs text-muted-foreground">—</span>}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Pit:</span>
                <PitLapsList laps={altPits} />
              </div>
            </div>

            {altDescription && (
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">{altDescription}</p>
            )}

            {(altPros.length > 0 || altCons.length > 0) && (
              <div className="grid grid-cols-2 gap-2 mb-2">
                {altPros.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-emerald-400/80">Vantaggi</div>
                    <ul className="text-[11px] text-foreground/90 space-y-0.5">
                      {altPros.slice(0, 2).map((p, i) => (
                        <li key={i} className="flex gap-1"><span className="text-emerald-400">+</span><span>{p}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {altCons.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-destructive/80">Rischi</div>
                    <ul className="text-[11px] text-foreground/90 space-y-0.5">
                      {altCons.slice(0, 2).map((c, i) => (
                        <li key={i} className="flex gap-1"><span className="text-destructive">−</span><span>{c}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {breakdownRows.length > 0 && (
              <>
                <Separator className="my-2" />
                <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Breakdown costi (s)
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                  {breakdownRows.map((r) => (
                    <div key={r.label} className="flex justify-between gap-2">
                      <span className="text-muted-foreground truncate">{r.label}</span>
                      <span className="font-mono tabular-nums">{fmtSec(r.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function scenarioLabel(id: CounterfactualScenarioId, aAcr: string, bAcr: string): string {
  if (id === "only_a") return `Solo ${aAcr}`;
  if (id === "only_b") return `Solo ${bAcr}`;
  return "Entrambi";
}

function scenarioIntro(id: CounterfactualScenarioId, aAcr: string, bAcr: string): string {
  if (id === "only_a") return `Se ${aAcr} avesse adottato la strategia alternativa (${bAcr} invariato)`;
  if (id === "only_b") return `Se ${bAcr} avesse adottato la strategia alternativa (${aAcr} invariato)`;
  return `Se entrambi avessero adottato la strategia alternativa`;
}

export function CompareAlternativeStrategies({ comparison, driverA, driverB }: Props) {
  const cf = comparison.counterfactual_analysis;
  const verdict = comparison.head_to_head_verdict;
  const aAcr = driverA.name_acronym;
  const bAcr = driverB.name_acronym;

  // Default to "both" if applicable, else first applicable scenario.
  const defaultScenario: CounterfactualScenarioId | null = useMemo(() => {
    if (!cf) return null;
    if (cf.scenarios.both.applicable) return "both";
    if (cf.scenarios.only_a.applicable) return "only_a";
    if (cf.scenarios.only_b.applicable) return "only_b";
    return null;
  }, [cf]);

  const [scenarioId, setScenarioId] = useState<CounterfactualScenarioId>(defaultScenario ?? "both");

  // Sync if comparison changes and current selection becomes inapplicable.
  useEffect(() => {
    if (defaultScenario && cf && !cf.scenarios[scenarioId].applicable) {
      setScenarioId(defaultScenario);
    }
  }, [defaultScenario, cf, scenarioId]);

  const activeScenario = cf?.scenarios[scenarioId] ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Strategia reale vs alternativa</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              L'alternativa è ricalcolata in modalità <span className="font-mono text-foreground">EX_ANTE · BALANCED</span> usando gli stessi dati di gara.
            </p>
          </div>
          <Badge variant="outline" className="text-[9px] font-mono uppercase shrink-0">
            confidenza: {cf?.confidence ?? comparison.common_confidence}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DriverPanel driver={driverA} real={comparison.driver_a} alt={comparison.alternative_a} />
          <DriverPanel driver={driverB} real={comparison.driver_b} alt={comparison.alternative_b} />
        </div>

        {cf && activeScenario && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs font-mono uppercase tracking-wider text-foreground">Verdetto controfattuale</span>
              <Badge variant="secondary" className="text-[9px] font-mono uppercase">stima teorica</Badge>
            </div>

            {/* Scenario switch (3-state) */}
            <Tabs
              value={scenarioId}
              onValueChange={(v) => {
                const next = v as CounterfactualScenarioId;
                if (cf.scenarios[next]?.applicable) setScenarioId(next);
              }}
              className="mb-3"
            >
              <TabsList className="grid w-full grid-cols-3 h-auto">
                {(["only_a", "only_b", "both"] as CounterfactualScenarioId[]).map((id) => {
                  const sc = cf.scenarios[id];
                  return (
                    <TabsTrigger
                      key={id}
                      value={id}
                      disabled={!sc.applicable}
                      className="text-[10px] font-mono uppercase tracking-wider py-1.5 data-[state=active]:bg-[hsl(var(--f1-red))]/20 data-[state=active]:text-foreground"
                      title={!sc.applicable ? "Scenario non disponibile: alternativa mancante" : undefined}
                    >
                      {scenarioLabel(id, aAcr, bAcr)}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div className="space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Guadagno {aAcr} {scenarioId === "only_b" && <span className="opacity-60">(non applicato)</span>}
                </div>
                <GainBadge seconds={activeScenario.gain_a_seconds} />
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Guadagno {bAcr} {scenarioId === "only_a" && <span className="opacity-60">(non applicato)</span>}
                </div>
                <GainBadge seconds={activeScenario.gain_b_seconds} />
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Δ controfattuale (A−B)
                </div>
                <span className="font-mono text-xs font-bold tabular-nums">
                  {activeScenario.counterfactual_h2h_delta_seconds == null
                    ? "—"
                    : `${activeScenario.counterfactual_h2h_delta_seconds >= 0 ? "+" : ""}${activeScenario.counterfactual_h2h_delta_seconds.toFixed(2)}s`}
                </span>
              </div>
            </div>

            {activeScenario.counterfactual_faster && (
              <div className={cn(
                "text-xs rounded px-3 py-2 mb-2 border",
                activeScenario.outcome_changed
                  ? "bg-[hsl(var(--f1-red))]/10 border-[hsl(var(--f1-red))]/40 text-foreground"
                  : "bg-muted/40 border-border text-muted-foreground",
              )}>
                {activeScenario.outcome_changed ? (
                  <>
                    <strong className="text-[hsl(var(--f1-red))]">Esito ribaltato:</strong>{" "}
                    nella realtà ha prevalso{" "}
                    <strong>{verdict.faster_driver === "A" ? aAcr : verdict.faster_driver === "B" ? bAcr : "parità"}</strong>,
                    ma {scenarioIntro(scenarioId, aAcr, bAcr).toLowerCase().replace(/^se /, "se ")} avrebbe prevalso{" "}
                    <strong>{activeScenario.counterfactual_faster === "A" ? aAcr : activeScenario.counterfactual_faster === "B" ? bAcr : "parità"}</strong>
                    {activeScenario.counterfactual_h2h_delta_seconds != null && (
                      <> di {Math.abs(activeScenario.counterfactual_h2h_delta_seconds).toFixed(2)}s</>
                    )}.
                  </>
                ) : (
                  <>
                    <strong>Esito invariato:</strong> {scenarioIntro(scenarioId, aAcr, bAcr).toLowerCase()},{" "}
                    {activeScenario.counterfactual_faster === "TIE"
                      ? "i due piloti sarebbero finiti in parità."
                      : <>avrebbe comunque prevalso <strong>{activeScenario.counterfactual_faster === "A" ? aAcr : bAcr}</strong>.</>}
                  </>
                )}
              </div>
            )}

            <div className="flex items-start gap-2 text-[10px] text-muted-foreground italic leading-relaxed">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{cf.disclaimer}</span>
            </div>
          </div>
        )}

        {!cf && (
          <div className="text-xs text-muted-foreground italic">
            Verdetto controfattuale non disponibile: alternativa mancante per entrambi i piloti.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
