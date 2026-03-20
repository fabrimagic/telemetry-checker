import type { StintData } from "@/lib/openf1";
import { Circle } from "lucide-react";

interface Props {
  stints: StintData[];
}

const compoundColors: Record<string, string> = {
  SOFT: "hsl(0, 85%, 55%)",
  MEDIUM: "hsl(45, 95%, 55%)",
  HARD: "hsl(0, 0%, 75%)",
  INTERMEDIATE: "hsl(140, 70%, 45%)",
  WET: "hsl(210, 80%, 50%)",
};

export function StintsCard({ stints }: Props) {
  if (!stints.length) return null;

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Circle className="h-3.5 w-3.5" />
        Tyre Stints ({stints.length})
      </h3>
      <div className="space-y-2">
        {stints.map((s) => (
          <div
            key={s.stint_number}
            className="flex items-center gap-3 text-xs py-1.5 px-2 rounded bg-muted/50"
          >
            <span
              className="w-3 h-3 rounded-full shrink-0 border border-border"
              style={{ backgroundColor: compoundColors[s.compound] ?? "hsl(0,0%,50%)" }}
            />
            <span className="font-mono font-bold w-16">{s.compound}</span>
            <span className="text-muted-foreground">
              Lap {s.lap_start}–{s.lap_end}
            </span>
            <span className="text-muted-foreground ml-auto tabular-nums font-mono">
              {s.lap_end - s.lap_start + 1} laps
            </span>
            {s.tyre_age_at_start > 0 && (
              <span className="text-muted-foreground text-[10px]">
                (used +{s.tyre_age_at_start})
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
