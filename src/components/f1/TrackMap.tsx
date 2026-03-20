import { useMemo } from "react";
import type { LocationData } from "@/lib/openf1";

interface Props {
  locations: LocationData[];
  activeDate: string | null;
  teamColor: string;
}

export function TrackMap({ locations, activeDate, teamColor }: Props) {
  const { points, viewBox, activePoint } = useMemo(() => {
    if (!locations.length) return { points: "", viewBox: "0 0 100 100", activePoint: null };

    const xs = locations.map((l) => l.x);
    const ys = locations.map((l) => l.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = Math.max((maxX - minX), (maxY - minY)) * 0.08;
    const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

    const pts = locations.map((l) => `${l.x},${l.y}`).join(" ");

    let active: { x: number; y: number } | null = null;
    if (activeDate) {
      const target = new Date(activeDate).getTime();
      let closest = locations[0];
      let minDiff = Infinity;
      for (const loc of locations) {
        const diff = Math.abs(new Date(loc.date).getTime() - target);
        if (diff < minDiff) {
          minDiff = diff;
          closest = loc;
        }
      }
      active = { x: closest.x, y: closest.y };
    }

    return { points: pts, viewBox: vb, activePoint: active };
  }, [locations, activeDate]);

  if (!locations.length) return null;

  const color = `#${teamColor}`;

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Track Position</h3>
      <svg viewBox={viewBox} className="w-full max-h-[400px]" style={{ aspectRatio: "1", transform: "scale(-1,1)" }}>
        {/* Track outline */}
        <polyline
          points={points}
          fill="none"
          stroke="hsl(220 14% 22%)"
          strokeWidth={Math.max((parseFloat(viewBox.split(" ")[2]) || 100) * 0.006, 1)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Colored path */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={Math.max((parseFloat(viewBox.split(" ")[2]) || 100) * 0.004, 0.5)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.6}
        />
        {/* Active marker */}
        {activePoint && (
          <>
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r={Math.max((parseFloat(viewBox.split(" ")[2]) || 100) * 0.015, 2)}
              fill={color}
              opacity={0.3}
            />
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r={Math.max((parseFloat(viewBox.split(" ")[2]) || 100) * 0.008, 1)}
              fill={color}
              stroke="white"
              strokeWidth={Math.max((parseFloat(viewBox.split(" ")[2]) || 100) * 0.002, 0.3)}
            />
          </>
        )}
      </svg>
    </div>
  );
}
