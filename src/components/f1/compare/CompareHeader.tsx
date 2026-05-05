import { ArrowLeftRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ComparisonResult } from "@/lib/headToHeadComparison";
import type { Driver } from "@/lib/openf1";
import { computeDuelInsight } from "@/lib/duelInsight";

interface Props {
  comparison: ComparisonResult;
  driverA: Driver;
  driverB: Driver;
  onSwap: () => void;
}

function DriverPanel({ driver, color, side, hash }: { driver: Driver; color: string; side: "A" | "B"; hash: string }) {
  return (
    <Card className="flex-1 p-4 border-l-4" style={{ borderLeftColor: `#${color}` }}>
      <div className="flex items-center gap-3">
        {driver.headshot_url ? (
          <img
            src={driver.headshot_url}
            alt={driver.full_name}
            className="w-14 h-14 rounded-full object-cover object-top ring-2"
            style={{ boxShadow: `0 0 0 2px #${color}` }}
          />
        ) : (
          <div className="w-14 h-14 rounded-full" style={{ backgroundColor: `#${color}` }} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pilota {side}</span>
            <span className="font-mono text-2xl font-bold">{driver.name_acronym}</span>
            <span className="font-mono text-xs text-muted-foreground">#{driver.driver_number}</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">{driver.team_name ?? "—"}</div>
          <div className="text-[10px] text-muted-foreground/70 truncate">{driver.full_name}</div>
        </div>
      </div>
    </Card>
  );
}

export function CompareHeader({ comparison, driverA, driverB, onSwap }: Props) {
  const { head_to_head_verdict: v } = comparison;
  const colorA = (driverA.team_colour || "888888").toLowerCase();
  const colorB = (driverB.team_colour || "888888").toLowerCase();

  let verdictText = "Pareggio sostanziale";
  let verdictTone: "default" | "destructive" | "secondary" = "secondary";
  const sourceLabel = v.delta_source === "official_gap" ? " al traguardo" : " sul passo";
  if (v.faster_driver === "A") {
    verdictText = `${driverA.name_acronym} più veloce di ${v.delta_total_seconds.toFixed(2)}s${sourceLabel}`;
    verdictTone = "default";
  } else if (v.faster_driver === "B") {
    verdictText = `${driverB.name_acronym} più veloce di ${v.delta_total_seconds.toFixed(2)}s${sourceLabel}`;
    verdictTone = "default";
  }

  return (
    <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border pb-4 -mx-6 px-6 pt-4">
      <div className="flex items-stretch gap-3">
        <DriverPanel driver={driverA} color={colorA} side="A" hash="a" />
        <div className="flex flex-col items-center justify-center px-2 gap-2">
          <div className="rounded-full bg-[hsl(var(--f1-red))] text-white text-xs font-bold px-3 py-1.5 shadow-md">VS</div>
          <Button variant="ghost" size="sm" onClick={onSwap} className="h-7 px-2 text-[10px] gap-1">
            <ArrowLeftRight className="h-3 w-3" /> Swap
          </Button>
        </div>
        <DriverPanel driver={driverB} color={colorB} side="B" hash="b" />
      </div>
      <div className="mt-3 flex justify-center">
        <Badge variant={verdictTone} className="text-sm px-4 py-1.5">
          {verdictText}
        </Badge>
      </div>
      {(() => {
        const gap = v.gap_at_finish_seconds;
        const pace = v.pace_sum_delta_seconds;
        if (gap == null || pace == null) return null;
        const divergence = Math.abs(gap - pace);
        if (divergence < 2.0) return null;
        const secondaryLabel = v.delta_source === "official_gap"
          ? `Differenza di passo sui giri confrontabili: ${pace.toFixed(2)}s`
          : `Gap al traguardo: ${gap.toFixed(2)}s`;
        return (
          <div className="mt-1.5 flex justify-center">
            <span className="text-[11px] text-muted-foreground italic">
              {secondaryLabel}
            </span>
          </div>
        );
      })()}
      {(() => {
        const insight = computeDuelInsight(comparison, driverA.name_acronym, driverB.name_acronym);
        if (!insight.variant || !insight.message) return null;
        const variantStyle = insight.variant === "offensive_chance"
          ? "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-300"
          : "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300";
        const title = insight.variant === "offensive_chance"
          ? "Possibilità offensiva non sfruttata"
          : "Esposizione difensiva";
        return (
          <div className="mt-2 flex justify-center">
            <div className={`max-w-2xl rounded-md border px-3 py-2 text-xs ${variantStyle}`}>
              <div className="font-semibold mb-0.5">{title}</div>
              <div>{insight.message}</div>
              <div className="mt-1 text-[10px] opacity-80 italic">
                {insight.rationale} Stima ex-ante: si basa sul verdict del duello come proxy della posizione relativa, non sul lap-by-lap; in caso di sorpassi multipli durante la gara il messaggio è approssimativo.
              </div>
            </div>
          </div>
        );
      })()}
      <div className="mt-2 flex justify-center">
        <span className="text-[10px] text-muted-foreground">
          Confidence comune: <span className="font-mono font-semibold">{comparison.common_confidence}</span>
          {" · "}Giri totali: {comparison.total_laps}
        </span>
      </div>
    </div>
  );
}
