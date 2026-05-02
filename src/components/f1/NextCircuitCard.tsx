import { useEffect, useMemo, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { getNextSession } from "@/lib/f1Calendar2026";
import { fetchCircuitOutline } from "@/lib/circuitGeometry";

/**
 * Renders a stylized layout of the circuit hosting the next F1 session.
 * Pure presentation component — does not affect any calculation logic.
 */
export function NextCircuitCard() {
  const next = useMemo(() => getNextSession(new Date()), []);
  const gpName = next?.session.gpName ?? null;
  const sessionType = next?.session.sessionType ?? null;

  const [coords, setCoords] = useState<[number, number][] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCoords(null);
    if (!gpName) {
      setLoading(false);
      return;
    }
    fetchCircuitOutline(gpName)
      .then((c) => {
        if (!cancelled) setCoords(c);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gpName]);

  const { viewBox, polyPoints } = useMemo(() => {
    if (!coords || coords.length < 2) return { viewBox: "0 0 100 100", polyPoints: "" };
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const pad = Math.max(w, h) * 0.08;
    // Flip Y because SVG y grows downward while latitudes grow upward.
    const pts = coords
      .map(([x, y]) => `${(x - minX).toFixed(4)},${(maxY - y).toFixed(4)}`)
      .join(" ");
    return {
      viewBox: `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`,
      polyPoints: pts,
    };
  }, [coords]);

  return (
    <div className="card-premium rounded-xl p-5 flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-[hsl(var(--f1-red-glow))] shrink-0" />
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[hsl(var(--f1-red-glow))]">
            Prossimo circuito
          </span>
        </div>
        {sessionType && (
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {sessionType}
          </span>
        )}
      </div>

      <div className="mb-3 min-h-[2.5rem]">
        <h3 className="text-base font-bold tracking-tight text-foreground leading-tight">
          {gpName ?? "Nessuna sessione programmata"}
        </h3>
      </div>

      <div className="relative flex-1 min-h-[180px] rounded-lg bg-muted/30 border border-border/40 overflow-hidden flex items-center justify-center">
        {loading ? (
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        ) : coords && coords.length > 1 ? (
          <svg
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full p-3"
          >
            {(() => {
              const vbW = parseFloat(viewBox.split(" ")[2]) || 1;
              const glowW = Math.max(vbW * 0.008, 0.0008);
              const lineW = Math.max(vbW * 0.0035, 0.0004);
              return (
                <>
                  <polyline
                    points={polyPoints}
                    fill="none"
                    stroke="hsl(var(--f1-red))"
                    strokeOpacity={0.2}
                    strokeWidth={glowW}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points={polyPoints}
                    fill="none"
                    stroke="hsl(var(--f1-red-glow))"
                    strokeWidth={lineW}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              );
            })()}
          </svg>
        ) : (
          <span className="text-xs text-muted-foreground">Layout non disponibile</span>
        )}
      </div>
    </div>
  );
}
