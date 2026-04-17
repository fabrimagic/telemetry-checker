import { ArrowLeftRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ComparisonResult } from "@/lib/headToHeadComparison";
import type { Driver } from "@/lib/openf1";

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
  if (v.faster_driver === "A") {
    verdictText = `${driverA.name_acronym} più veloce di ${v.delta_total_seconds.toFixed(2)}s`;
    verdictTone = "default";
  } else if (v.faster_driver === "B") {
    verdictText = `${driverB.name_acronym} più veloce di ${v.delta_total_seconds.toFixed(2)}s`;
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
      <div className="mt-2 flex justify-center">
        <span className="text-[10px] text-muted-foreground">
          Confidence comune: <span className="font-mono font-semibold">{comparison.common_confidence}</span>
          {" · "}Giri totali: {comparison.total_laps}
        </span>
      </div>
    </div>
  );
}
