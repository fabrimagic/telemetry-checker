import type { Lap, Driver } from "@/lib/openf1";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface DriverLaps {
  driver: Driver;
  laps: Lap[];
  selectedLap: number | null;
}

interface Props {
  driversLaps: DriverLaps[];
  onSelectLap: (driverNumber: number, lapNumber: number) => void;
  onFastest: (driverNumber: number) => void;
}

function formatTime(seconds: number | null) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3);
  return m > 0 ? `${m}:${s.padStart(6, "0")}` : `${s}s`;
}

export function LapTable({ driversLaps, onSelectLap, onFastest }: Props) {
  return (
    <div className="space-y-4">
      {driversLaps.map(({ driver, laps, selectedLap }) => (
        <div key={driver.driver_number}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: `#${driver.team_colour || "ffffff"}` }}
              />
              <h3 className="text-sm font-medium uppercase tracking-wider">
                <span className="font-mono font-bold">{driver.name_acronym}</span>
                <span className="text-muted-foreground ml-2 font-normal text-xs">{driver.full_name}</span>
              </h3>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onFastest(driver.driver_number)}
              disabled={!laps.some((l) => l.lap_duration != null)}
              className="gap-1.5 text-xs border-[hsl(var(--f1-red))] text-[hsl(var(--f1-red))] hover:bg-[hsl(var(--f1-red))]/10"
            >
              <Zap className="h-3.5 w-3.5" />
              Fastest
            </Button>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="text-muted-foreground uppercase tracking-wider">
                  <th className="text-left p-2 font-medium">Lap</th>
                  <th className="text-right p-2 font-medium">Time</th>
                  <th className="text-right p-2 font-medium">S1</th>
                  <th className="text-right p-2 font-medium">S2</th>
                  <th className="text-right p-2 font-medium">S3</th>
                  <th className="text-right p-2 font-medium">ST</th>
                </tr>
              </thead>
              <tbody>
                {laps.map((lap) => (
                  <tr
                    key={lap.lap_number}
                    onClick={() => lap.date_start && onSelectLap(driver.driver_number, lap.lap_number)}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/50",
                      selectedLap === lap.lap_number && "bg-[hsl(var(--f1-red))]/10",
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
      ))}
    </div>
  );
}
