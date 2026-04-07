import React, { useState, useCallback } from "react";
import type {
  DecisionPoint,
  KeyDecisionMomentsResult,
  DecisionDriver,
  ContextSnapshot,
  DecisionOutcome,
  HistoricalAnalog,
  DecisionType,
  ConfidenceLevel,
  AnalogStrength,
} from "@/lib/keyDecisionMoments";
import { searchHistoricalAnalogs } from "@/lib/keyDecisionMoments";
import type { SessionInfo, Lap, StintData, PitData, PositionData, IntervalData, Driver } from "@/lib/openf1";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronDown, Target, ArrowRight, Clock, AlertTriangle,
  CheckCircle, Search, Loader2, Info, TrendingUp, TrendingDown,
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

const ANALOG_STRENGTH_STYLES: Record<AnalogStrength, { bg: string; label: string }> = {
  STRONG: { bg: "bg-emerald-500/20 text-emerald-400", label: "Forte" },
  WEAK: { bg: "bg-amber-500/20 text-amber-400", label: "Debole" },
  NONE: { bg: "bg-muted text-muted-foreground", label: "—" },
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

function AnalogCard({ analog }: { analog: HistoricalAnalog }) {
  const [expanded, setExpanded] = useState(false);
  const strengthStyle = ANALOG_STRENGTH_STYLES[analog.analog_strength];

  return (
    <div className="rounded-md bg-muted/20 border border-border/50 p-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-foreground">{analog.gp_name} {analog.year}</span>
          <span className="text-[9px] text-muted-foreground">{analog.driver_acronym}</span>
          <DecisionBadge type={analog.decision_taken} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono font-semibold text-foreground">{Math.round(analog.similarity_score * 100)}%</span>
          <span className={`inline-flex items-center px-1.5 py-0 rounded text-[9px] font-semibold ${strengthStyle.bg}`}>
            {strengthStyle.label}
          </span>
          <ConfBadge level={analog.reliability} />
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-1 flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        Dettagli
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-1.5 text-[10px]">
          <p className="text-muted-foreground">{analog.outcome_summary}</p>
          <div>
            <span className="text-emerald-400 font-semibold text-[9px]">In comune: </span>
            <span className="text-muted-foreground text-[9px]">{analog.matching_factors.join(", ")}</span>
          </div>
          <div>
            <span className="text-amber-400 font-semibold text-[9px]">Differenze: </span>
            <span className="text-muted-foreground text-[9px]">{analog.differences.join(", ")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════ Main Component ══════ */

interface Props {
  result: KeyDecisionMomentsResult;
  sessionKey: number;
  currentYear: number;
  onAnalogsLoaded?: (pointId: string, analogs: HistoricalAnalog[], warnings: string[]) => void;
}

export function KeyDecisionMomentsCard({ result, sessionKey, currentYear, onAnalogsLoaded }: Props) {
  const { decision_points, warnings } = result;
  const [loadingAnalogs, setLoadingAnalogs] = useState<Set<string>>(new Set());
  const [analogErrors, setAnalogErrors] = useState<Map<string, string>>(new Map());

  const handleLoadAnalogs = useCallback(async (point: DecisionPoint) => {
    if (point.analogs_status === "LOADED" || loadingAnalogs.has(point.id)) return;

    setLoadingAnalogs(prev => new Set(prev).add(point.id));

    try {
      const fetchSessions = async (yearStart: number, yearEnd: number): Promise<SessionInfo[]> => {
        const res = await fetch(`https://api.openf1.org/v1/sessions?session_type=Race&date_start>=${yearStart}-01-01&date_start<=${yearEnd}-12-31`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
      };

      const fetchSessionData = async (sk: number) => {
        const [lapsRes, stintsRes, pitsRes, posRes, ivsRes, driversRes] = await Promise.all([
          fetch(`https://api.openf1.org/v1/laps?session_key=${sk}`),
          fetch(`https://api.openf1.org/v1/stints?session_key=${sk}`),
          fetch(`https://api.openf1.org/v1/pit?session_key=${sk}`),
          fetch(`https://api.openf1.org/v1/position?session_key=${sk}`),
          fetch(`https://api.openf1.org/v1/intervals?session_key=${sk}`),
          fetch(`https://api.openf1.org/v1/drivers?session_key=${sk}`),
        ]);

        if (!lapsRes.ok || !stintsRes.ok) return null;

        return {
          laps: await lapsRes.json() as Lap[],
          stints: await stintsRes.json() as StintData[],
          pitStops: await pitsRes.json() as PitData[],
          positions: await posRes.json() as PositionData[],
          intervals: await ivsRes.json() as IntervalData[],
          drivers: await driversRes.json() as Driver[],
        };
      };

      const { analogs, warnings: analogWarnings } = await searchHistoricalAnalogs(
        point,
        currentYear,
        fetchSessions,
        fetchSessionData,
      );

      onAnalogsLoaded?.(point.id, analogs, analogWarnings);
    } catch (err) {
      setAnalogErrors(prev => new Map(prev).set(point.id, "Errore nel recupero degli analoghi storici"));
    } finally {
      setLoadingAnalogs(prev => {
        const next = new Set(prev);
        next.delete(point.id);
        return next;
      });
    }
  }, [currentYear, loadingAnalogs, onAnalogsLoaded]);

  if (decision_points.length === 0 && warnings.length === 0) return null;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
          <Target className="h-4 w-4" />
          Key Decision Moments
        </CardTitle>
        <p className="text-[11px] text-muted-foreground mt-1">
          Momenti della gara in cui una scelta strategica "pit vs stay out" era plausibile.
        </p>
        {warnings.length > 0 && (
          <div className="mt-1.5">
            {warnings.map((w, i) => (
              <p key={i} className="text-[10px] text-muted-foreground italic flex items-center gap-1">
                <Info className="h-3 w-3 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {decision_points.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center py-4">
            Nessun momento decisionale plausibile identificato.
          </p>
        ) : (
          decision_points.map((point) => (
            <DecisionPointCard
              key={point.id}
              point={point}
              isLoadingAnalogs={loadingAnalogs.has(point.id)}
              analogError={analogErrors.get(point.id)}
              onLoadAnalogs={() => handleLoadAnalogs(point)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

/* ══════ Decision Point Card ══════ */

function DecisionPointCard({ point, isLoadingAnalogs, analogError, onLoadAnalogs }: {
  point: DecisionPoint;
  isLoadingAnalogs: boolean;
  analogError?: string;
  onLoadAnalogs: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Top 2-3 drivers for compact view
  const topDrivers = point.drivers
    .filter(d => d.weight === "HIGH" || d.weight === "MEDIUM")
    .slice(0, 3);

  const hasAnalogs = point.analogs.length > 0;
  const analogsAvailable = point.analogs_status === "LOADED";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* ── Compact Card ── */}
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
              {analogsAvailable && (
                <Badge variant="outline" className={`text-[8px] px-1.5 py-0 ${hasAnalogs ? "border-emerald-500/30 text-emerald-400" : "border-border text-muted-foreground"}`}>
                  {hasAnalogs ? `${point.analogs.length} analoghi` : "0 analoghi"}
                </Badge>
              )}
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
            </div>
          </div>

          {/* Top drivers preview */}
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

      {/* ── Expanded Detail ── */}
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

          {/* 4. Historical Analogs */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
              <Search className="h-3 w-3" /> Casi recenti simili (ultimi 5 anni)
            </h4>

            {point.analogs_status === "NOT_LOADED" && (
              <button
                onClick={(e) => { e.stopPropagation(); onLoadAnalogs(); }}
                disabled={isLoadingAnalogs}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {isLoadingAnalogs ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Ricerca in corso...</>
                ) : (
                  <><Search className="h-3 w-3" /> Cerca analoghi storici</>
                )}
              </button>
            )}

            {analogError && (
              <p className="text-[10px] text-red-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {analogError}
              </p>
            )}

            {point.analogs_status === "LOADED" && point.analogs.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic">
                Nessun caso comparabile trovato nella finestra storica.
              </p>
            )}

            {point.analogs.length > 0 && (
              <div className="space-y-1.5">
                {point.analogs.map((analog, i) => (
                  <AnalogCard key={i} analog={analog} />
                ))}
              </div>
            )}
          </div>

          {/* 5. Reliability Notes */}
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
