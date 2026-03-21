import type { PitData, Driver } from "@/lib/openf1";
import { Square } from "lucide-react";

interface Props {
  pitStops: PitData[];
  allDrivers: Driver[];
  multiDriver?: boolean;
}

export function PitStopsCard({ pitStops, allDrivers, multiDriver }: Props) {
  if (!pitStops.length) return null;

  const driverName = (num: number) => {
    const d = allDrivers.find((dr) => dr.driver_number === num);
    return d ? d.name_acronym : `#${num}`;
  };

  const driverColor = (num: number) => {
    const d = allDrivers.find((dr) => dr.driver_number === num);
    return d?.team_colour || "ffffff";
  };

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Square className="h-3.5 w-3.5" />
        Pit Stops ({pitStops.length})
      </h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {pitStops.map((p, i) => (
          <div
            key={i}
            className="flex items-center gap-3 text-xs py-1.5 px-2 rounded bg-muted/50"
          >
            {multiDriver && (
              <span className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: `#${driverColor(p.driver_number)}` }}
                />
                <span className="font-mono font-bold">{driverName(p.driver_number)}</span>
              </span>
            )}
            <span className="text-muted-foreground">Lap {p.lap_number}</span>
            <span className="font-mono tabular-nums ml-auto">
              {p.lane_duration.toFixed(1)}s
              <span className="text-muted-foreground ml-1">lane</span>
            </span>
            {p.stop_duration != null && (
              <span className="font-mono tabular-nums">
                {p.stop_duration.toFixed(1)}s
                <span className="text-muted-foreground ml-1">stop</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
