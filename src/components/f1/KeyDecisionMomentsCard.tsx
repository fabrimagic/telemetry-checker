import React, { useState } from "react";
import type {
  DecisionPoint,
  KeyDecisionMomentsResult,
  DecisionDriver,
  ContextSnapshot,
  DecisionOutcome,
  DecisionType,
  ConfidenceLevel,
} from "@/lib/keyDecisionMoments";
import type { DecisionSoftSensorContext, SoftSensorConfidence } from "@/lib/softSensors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronDown, Target, ArrowRight,
  AlertTriangle, Info, TrendingUp, TrendingDown,
  Minus, Gauge, Shield,
} from "lucide-react";

/* ══════ Design tokens ══════ */

const DECISION_STYLES: Record<DecisionType, { bg: string; text: string; label: string }> = {
  PIT_NOW: { bg: "bg-red-500/15", text: "text-red-400", label: "PIT NOW" },
  STAY_OUT: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "STAY OUT" },
  MARGINAL: { bg: "bg-amber-500/15", text: "text-amber-400", label: "MARGINALE" },
};

const CONFIDENCE_STYLES: Record<ConfidenceLevel, string> = {
  HIGH: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  MEDIUM: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  LOW: "bg-red-500/20 text-red-400 border-red-500/30",
};

const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = { HIGH: "Alta", MEDIUM: "Media", LOW: "Bassa" };

const DIRECTION_ICON: Record<string, React.ReactNode> = {
  PIT: <TrendingDown className="h-3 w-3 text-red-400 shrink-0" />,
  STAY_OUT: <TrendingUp className="h-3 w-3 text-emerald-400 shrink-0" />,
  NEUTRAL: <Minus className="h-3 w-3 text-muted-foreground shrink-0" />,
};

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: "hsl(0 80% 50%)",
  MEDIUM: "hsl(45 100% 50%)",
  HARD: "hsl(0 0% 85%)",
  INTERMEDIATE: "hsl(120 60% 45%)",
  WET: "hsl(210 80% 50%)",
};

function CompoundDot({ compound }: { compound: string }) {
  const bg = COMPOUND_COLORS[compound] || "hsl(var(--muted))";
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border border-border/50"
      style={{ backgroundColor: bg }}
      title={compound}
    />
  );
}

/* ══════ Sub-components ══════ */

function DecisionBadge({ type }: { type: DecisionType }) {
  const s = DECISION_STYLES[type];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function ConfBadge({ level }: { level: ConfidenceLevel }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-semibold ${CONFIDENCE_STYLES[level]}`}>
      <Gauge className="h-2.5 w-2.5" />
      {CONFIDENCE_LABELS[level]}
    </span>
  );
}

function DriversList({ drivers }: { drivers: DecisionDriver[] }) {
  return (
    <div className="space-y-1">
      {drivers.map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-[10px]">
          {DIRECTION_ICON[d.direction]}
          <span className="font-medium text-foreground">{d.factor}</span>
          <Badge variant="outline" className={`text-[8px] px-1 py-0 ${
            d.weight === "HIGH" ? "border-foreground/40" : "border-border"
          }`}>
            {d.weight}
          </Badge>
          {d.detail && <span className="text-muted-foreground truncate max-w-[200px]" title={d.detail}>{d.detail}</span>}
        </div>
      ))}
    </div>
  );
}

function ContextSummary({ ctx }: { ctx: ContextSnapshot }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[10px]">
      <div className="flex items-center gap-1.5">
        <CompoundDot compound={ctx.compound} />
        <span className="text-muted-foreground">Mescola:</span>
        <span className="font-semibold text-foreground">{ctx.compound}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Età gomme: </span>
        <span className="font-mono font-semibold text-foreground">{ctx.tyre_age}g</span>
      </div>
      <div>
        <span className="text-muted-foreground">Posizione: </span>
        <span className="font-mono font-semibold text-foreground">{ctx.track_position != null ? `P${ctx.track_position}` : "—"}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Degrado: </span>
        <span className={`font-mono font-semibold ${ctx.degradation_slope != null && ctx.degradation_slope > 0.06 ? "text-red-400" : ctx.degradation_slope != null ? "text-foreground" : "text-muted-foreground"}`}>
          {ctx.degradation_slope != null ? `${ctx.degradation_slope.toFixed(3)} s/g` : "N/D"}
        </span>
      </div>
      <div>
        <span className="text-muted-foreground">Gap davanti: </span>
        <span className="font-mono font-semibold text-foreground">{ctx.gap_ahead != null ? `${ctx.gap_ahead.toFixed(1)}s` : "—"}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Meteo: </span>
        <span className="font-semibold text-foreground">{ctx.weather_state}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Status: </span>
        <span className={`font-semibold ${ctx.neutralization_state !== "GREEN" ? "text-amber-400" : "text-foreground"}`}>
          {ctx.neutralization_state}
        </span>
      </div>
      <div>
        <span className="text-muted-foreground">Giri rimanenti: </span>
        <span className="font-mono font-semibold text-foreground">{ctx.laps_remaining}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Trend perdita: </span>
        <span className={`font-semibold ${ctx.cumulative_loss_trend === "WORSENING" ? "text-red-400" : ctx.cumulative_loss_trend === "IMPROVING" ? "text-emerald-400" : "text-muted-foreground"}`}>
          {ctx.cumulative_loss_trend ?? "N/D"}
        </span>
      </div>
    </div>
  );
}

function OutcomeBlock({ outcome, realAction }: { outcome: DecisionOutcome; realAction: "PIT" | "STAY_OUT" }) {
  return (
    <div className="rounded-md bg-muted/30 border border-border p-2.5 space-y-1">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
          realAction === "PIT" ? "bg-blue-500/15 text-blue-400" : "bg-slate-500/15 text-slate-400"
        }`}>
          {realAction === "PIT" ? "🔧 PIT" : "▶ STAY OUT"}
        </span>
        {outcome.position_change != null && (
          <span className={`text-[10px] font-mono font-bold ${outcome.position_change > 0 ? "text-red-400" : outcome.position_change < 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
            {outcome.position_change > 0 ? "+" : ""}{outcome.position_change} pos
          </span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">{outcome.outcome_summary}</p>
      {outcome.next_event && (
        <p className="text-[10px] text-foreground/70 italic">{outcome.next_event}</p>
      )}
      <p className="text-[9px] text-muted-foreground">Osservato per {outcome.laps_observed} giri dopo la decisione</p>
    </div>
  );
}

/* ══════ Main Component ══════ */

interface Props {
  result: KeyDecisionMomentsResult;
}

export function KeyDecisionMomentsCard({ result }: Props) {
  const { decision_points, warnings } = result;
  const [cardOpen, setCardOpen] = useState(false);

  if (decision_points.length === 0 && warnings.length === 0) return null;

  return (
    <Collapsible open={cardOpen} onOpenChange={setCardOpen}>
      <Card className="border-border">
        <CollapsibleTrigger className="w-full text-left">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
              <Target className="h-4 w-4" />
              Key Decision Moments
              <span className="text-[10px] font-normal text-muted-foreground ml-1">
                ({decision_points.length} {decision_points.length === 1 ? "momento" : "momenti"})
              </span>
              <ChevronDown className={`h-4 w-4 ml-auto text-muted-foreground transition-transform ${cardOpen ? "rotate-180" : ""}`} />
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Momenti della gara in cui una scelta strategica "pit vs stay out" era plausibile.
            </p>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-2 pt-0">
            {warnings.length > 0 && (
              <div className="mb-2">
                {warnings.map((w, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground italic flex items-center gap-1">
                    <Info className="h-3 w-3 shrink-0" /> {w}
                  </p>
                ))}
              </div>
            )}

            {decision_points.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-4">
                Nessun momento decisionale plausibile identificato.
              </p>
            ) : (
              decision_points.map((point) => (
                <DecisionPointCard key={point.id} point={point} />
              ))
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/* ══════ Decision Point Card ══════ */

function DecisionPointCard({ point }: { point: DecisionPoint }) {
  const [open, setOpen] = useState(false);

  const topDrivers = point.drivers
    .filter(d => d.weight === "HIGH" || d.weight === "MEDIUM")
    .slice(0, 3);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full text-left">
        <div className="rounded-lg bg-muted/30 border border-border p-3 hover:bg-muted/40 transition-colors">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold text-foreground">
                {point.lap_window[0] === point.lap_window[1]
                  ? `G${point.lap_window[0]}`
                  : `G${point.lap_window[0]}–${point.lap_window[1]}`}
              </span>
              <DecisionBadge type={point.decision_type} />
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                point.real_action === "PIT" ? "bg-blue-500/15 text-blue-400" : "bg-slate-500/15 text-slate-400"
              }`}>
                {point.real_action === "PIT" ? "🔧 PIT" : "▶ OUT"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <ConfBadge level={point.confidence} />
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
            </div>
          </div>

          {topDrivers.length > 0 && (
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {topDrivers.map((d, i) => (
                <span key={i} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                  {DIRECTION_ICON[d.direction]}
                  {d.factor}
                </span>
              ))}
            </div>
          )}
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-2 mr-2 mt-1 space-y-3 border-l-2 border-border/50 pl-3 pb-2">

          {/* 1. Decision Snapshot */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
              <Shield className="h-3 w-3" /> Contesto decisionale
            </h4>
            <ContextSummary ctx={point.context} />
          </div>

          {/* Decision drivers */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Fattori
            </h4>
            <DriversList drivers={point.drivers} />
          </div>

          {/* 2. Real Action + 3. Short-Term Outcome */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
              <ArrowRight className="h-3 w-3" /> Azione reale ed esito
            </h4>
            <OutcomeBlock outcome={point.outcome} realAction={point.real_action} />
          </div>

          {/* Reliability Notes */}
          {point.reliability_notes.length > 0 && (
            <div className="rounded-md bg-muted/20 border border-border/30 px-2.5 py-2">
              <h4 className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                <Info className="h-3 w-3" /> Note di affidabilità
              </h4>
              <ul className="space-y-0.5">
                {point.reliability_notes.map((note, i) => (
                  <li key={i} className="text-[9px] text-muted-foreground flex items-start gap-1">
                    <span className="mt-0.5 shrink-0">•</span>
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
