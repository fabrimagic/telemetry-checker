import type { Lap } from "@/lib/openf1";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  laps: Lap[];
  selectedLap: number | null;
  onSelectLap: (lapNumber: number) => void;
  onFastest: () => void;
}

function formatTime(seconds: number | null) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3);
  return m > 0 ? `${m}:${s.padStart(6, "0")}` : `${s}s`;
}

export function LapTable({ laps, selectedLap, onSelectLap, onFastest }: Props) {
  const validLaps = laps.filter((l) => l.lap_duration != null);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Laps</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={onFastest}
          disabled={validLaps.length === 0}
          className="gap-1.5 text-xs border-[hsl(var(--f1-red))] text-[hsl(var(--f1-red))] hover:bg-[hsl(var(--f1-red))]/10"
        >
          <Zap className="h-3.5 w-3.5" />
          Fastest Lap
        </Button>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-muted-foreground uppercase tracking-wider">
              <th className="text-left p-2 font-medium">Lap</th>
              <th className="text-right p-2 font-medium">Time</th>
              <th className="text-right p-2 font-medium">S1</th>
              <th className="text-right p-2 font-medium">S2</th>
              <th className="text-right p-2 font-medium">S3</th>
              <th className="text-right p-2 font-medium">ST Speed</th>
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => (
              <tr
                key={lap.lap_number}
                onClick={() => lap.date_start && onSelectLap(lap.lap_number)}
                className={cn(
                  "cursor-pointer transition-colors hover:bg-muted/50",
                  selectedLap === lap.lap_number && "bg-[hsl(var(--f1-red))]/10 text-[hsl(var(--primary-foreground))]",
                  lap.is_pit_out_lap && "opacity-50"
                )}
              >
                <td className="p-2 font-mono font-bold">{lap.lap_number}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatTime(lap.lap_duration)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatTime(lap.duration_sector_1)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatTime(lap.duration_sector_2)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatTime(lap.duration_sector_3)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{lap.st_speed ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
