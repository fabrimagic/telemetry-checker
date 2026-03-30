import { useMemo } from "react";
import type { Lap, Driver } from "@/lib/openf1";

interface Props {
  drivers: {
    driver: Driver;
    lap: Lap;
    color: string;
  }[];
}

// Segment value -> color mapping from OpenF1
// 2048 = yellow (personal), 2049 = green (session best sector), 2051 = purple (overall best), 2064 = blue (pit/slow)
function segmentColor(value: number | null): string {
  switch (value) {
    case 2049: return "hsl(142 70% 45%)";   // green
    case 2051: return "hsl(270 80% 55%)";   // purple (fastest)
    case 2064: return "hsl(210 80% 55%)";   // blue (pit)
    case 2048: return "hsl(45 90% 55%)";    // yellow
    default:   return "hsl(220 10% 25%)";   // unknown/grey
  }
}

function formatSectorTime(duration: number | null): string {
  if (duration == null) return "—";
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  if (mins > 0) return `${mins}:${secs.toFixed(3).padStart(6, "0")}`;
  return secs.toFixed(3);
}

export function SectorMiniSectors({ drivers }: Props) {
  if (!drivers.length) return null;

  return (
    <div className="mt-4 space-y-3">
      {drivers.map(({ driver, lap, color }) => (
        <div key={driver.driver_number} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: `#${color}` }} />
            <span className="text-xs font-mono font-bold text-foreground">{driver.name_acronym}</span>
            <span className="text-[10px] text-muted-foreground">Lap {lap.lap_number}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {([
              { label: "S1", time: lap.duration_sector_1, segments: (lap as any).segments_sector_1 as (number | null)[] | undefined },
              { label: "S2", time: lap.duration_sector_2, segments: (lap as any).segments_sector_2 as (number | null)[] | undefined },
              { label: "S3", time: lap.duration_sector_3, segments: (lap as any).segments_sector_3 as (number | null)[] | undefined },
            ]).map((sector) => (
              <div key={sector.label} className="bg-muted/30 rounded-md p-2">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">{sector.label}</span>
                  <span className="text-xs font-mono font-semibold text-foreground">
                    {formatSectorTime(sector.time)}
                  </span>
                </div>
                {sector.segments && (
                  <div className="flex gap-[2px]">
                    {sector.segments.map((seg, i) => (
                      <div
                        key={i}
                        className="h-3 flex-1 rounded-[2px]"
                        style={{ backgroundColor: segmentColor(seg) }}
                        title={`Segment ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {/* Legend */}
      <div className="flex gap-3 pt-1">
        {[
          { color: "hsl(45 90% 55%)", label: "Personal" },
          { color: "hsl(142 70% 45%)", label: "Session Best" },
          { color: "hsl(270 80% 55%)", label: "Overall Best" },
          { color: "hsl(210 80% 55%)", label: "Pit/Slow" },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
