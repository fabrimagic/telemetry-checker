import { useMemo } from "react";
import type { LocationData } from "@/lib/openf1";
import type { DriverZones } from "./DrivingAnalysis";

interface DriverLocation {
  driverNumber: number;
  acronym: string;
  color: string;
  locations: LocationData[];
}

interface Props {
  drivers: DriverLocation[];
  activeDate: string | null;
  driverZones?: DriverZones[];
  activeInfo?: { timestamp: string; lapNumber: number | null; acronym: string; pinned: boolean } | null;
  onClearPin?: () => void;
}

export function TrackMap({ drivers, activeDate, driverZones, activeInfo, onClearPin }: Props) {
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

  // Compute zone highlight points
  const zonePoints = useMemo(() => {
    if (!driverZones?.length) return [];
    return driverZones.flatMap((dz) => {
      const driverLoc = drivers.find((d) => d.driverNumber === dz.driverNumber);
      if (!driverLoc || !driverLoc.locations.length) return [];

      const dateTimes = driverLoc.locations.map((l) => new Date(l.date).getTime());

      return dz.zones.map((z) => {
        const target = new Date(z.date).getTime();
        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < dateTimes.length; i++) {
          const diff = Math.abs(dateTimes[i] - target);
          if (diff < minDiff) { minDiff = diff; closestIdx = i; }
        }
        const loc = driverLoc.locations[closestIdx];
        return { x: loc.x, y: loc.y, type: z.type, color: dz.color };
      });
    });
  }, [driverZones, drivers]);

  if (!drivers.some((d) => d.locations.length > 0)) return null;

  const dotR = Math.max(scale * 0.004, 0.5);

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Track Position</h3>
        {activeInfo && (
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className={`px-1.5 py-0.5 rounded border ${activeInfo.pinned ? "bg-primary/15 border-primary/40 text-primary" : "bg-muted/40 border-border text-muted-foreground"}`}>
              {activeInfo.pinned ? "PIN" : "HOVER"} · {activeInfo.acronym}
              {activeInfo.lapNumber != null && <> · L{activeInfo.lapNumber}</>}
              <> · {activeInfo.timestamp}</>
            </span>
            {activeInfo.pinned && onClearPin && (
              <button onClick={onClearPin} className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2">clear</button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3 mb-3">
        {drivers.map((d) => (
          <span key={d.driverNumber} className="flex items-center gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${d.color}` }} />
            <span className="font-mono font-bold">{d.acronym}</span>
          </span>
        ))}
        {driverZones && driverZones.some((dz) => dz.zones.length > 0) && (
          <>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "hsl(0 85% 55%)" }} />
              Superclipping
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "hsl(200 85% 55%)" }} />
              Lift & Coast
            </span>
          </>
        )}
      </div>
      <svg viewBox={viewBox} className="w-full max-h-[400px]" style={{ aspectRatio: "1", transform: "scale(-1,1)" }}>
        {/* Track outline */}
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
        {/* Zone highlights */}
        {zonePoints.map((zp, i) => (
          <circle
            key={i}
            cx={zp.x}
            cy={zp.y}
            r={dotR}
            fill={zp.type === "superclipping" ? "hsl(0 85% 55%)" : "hsl(200 85% 55%)"}
            opacity={0.7}
          />
        ))}
        {/* Driver paths and markers */}
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
                <circle cx={d.activePoint.x} cy={d.activePoint.y} r={Math.max(scale * 0.015, 2)} fill={`#${d.color}`} opacity={0.3} />
                <circle cx={d.activePoint.x} cy={d.activePoint.y} r={Math.max(scale * 0.008, 1)} fill={`#${d.color}`} stroke="white" strokeWidth={Math.max(scale * 0.002, 0.3)} />
              </>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
