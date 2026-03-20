import { useMemo } from "react";
import type { LocationData } from "@/lib/openf1";

interface DriverLocation {
  driverNumber: number;
  acronym: string;
  color: string; // hex without #
  locations: LocationData[];
}

interface Props {
  drivers: DriverLocation[];
  activeDate: string | null;
}

export function TrackMap({ drivers, activeDate }: Props) {
  const { viewBox, driverPaths, scale } = useMemo(() => {
    const allLocs = drivers.flatMap((d) => d.locations);
    if (!allLocs.length) return { viewBox: "0 0 100 100", driverPaths: [], scale: 100 };

    const xs = allLocs.map((l) => l.x);
    const ys = allLocs.map((l) => l.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const range = Math.max(maxX - minX, maxY - minY);
    const pad = range * 0.08;
    const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

    const paths = drivers.map((d) => {
      const pts = d.locations.map((l) => `${l.x},${l.y}`).join(" ");

      let active: { x: number; y: number } | null = null;
      if (activeDate) {
        const target = new Date(activeDate).getTime();
        let closest = d.locations[0];
        let minDiff = Infinity;
        for (const loc of d.locations) {
          const diff = Math.abs(new Date(loc.date).getTime() - target);
          if (diff < minDiff) {
            minDiff = diff;
            closest = loc;
          }
        }
        if (closest) active = { x: closest.x, y: closest.y };
      }

      return { ...d, points: pts, activePoint: active };
    });

    return { viewBox: vb, driverPaths: paths, scale: range || 100 };
  }, [drivers, activeDate]);

  if (!drivers.some((d) => d.locations.length > 0)) return null;

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Track Position</h3>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-3">
        {drivers.map((d) => (
          <span key={d.driverNumber} className="flex items-center gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${d.color}` }} />
            <span className="font-mono font-bold">{d.acronym}</span>
          </span>
        ))}
      </div>
      <svg viewBox={viewBox} className="w-full max-h-[400px]" style={{ aspectRatio: "1", transform: "scale(-1,1)" }}>
        {/* Track outline from first driver */}
        {driverPaths[0] && (
          <polyline
            points={driverPaths[0].points}
            fill="none"
            stroke="hsl(220 14% 22%)"
            strokeWidth={Math.max(scale * 0.006, 1)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {/* Each driver's path and marker */}
        {driverPaths.map((d) => (
          <g key={d.driverNumber}>
            <polyline
              points={d.points}
              fill="none"
              stroke={`#${d.color}`}
              strokeWidth={Math.max(scale * 0.003, 0.5)}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.5}
            />
            {d.activePoint && (
              <>
                <circle
                  cx={d.activePoint.x}
                  cy={d.activePoint.y}
                  r={Math.max(scale * 0.015, 2)}
                  fill={`#${d.color}`}
                  opacity={0.3}
                />
                <circle
                  cx={d.activePoint.x}
                  cy={d.activePoint.y}
                  r={Math.max(scale * 0.008, 1)}
                  fill={`#${d.color}`}
                  stroke="white"
                  strokeWidth={Math.max(scale * 0.002, 0.3)}
                />
              </>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
