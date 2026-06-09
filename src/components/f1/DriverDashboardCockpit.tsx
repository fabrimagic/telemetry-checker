import { Gauge, Flag, Wrench, Hash } from "lucide-react";
import type { Lap, PitData } from "@/lib/openf1";

interface Props {
  laps: Lap[];
  pitStops: PitData[];
  driverNumber: number;
  finalPosition?: number | null;
  driverColor: string;
}

function formatLapTime(seconds: number | null): string {
  if (seconds == null || !isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/**
 * KPI strip — purely presentational summary of values already in state.
 * No computation beyond min/count over already-loaded arrays.
 */
export function DriverDashboardCockpit({
  laps,
  pitStops,
  driverNumber,
  vreResult,
  driverColor,
}: Props) {
  const driverPits = pitStops.filter((p) => p.driver_number === driverNumber);
  const validLaps = laps.filter((l) => l.lap_duration != null);
  const bestLap = validLaps.length
    ? validLaps.reduce((a, b) => (a.lap_duration! < b.lap_duration! ? a : b))
    : null;
  const totalLaps = laps.length;
  const nPits = driverPits.length;

  // Position from VRE final result if available; otherwise from last lap's position field if present.
  const finalPos =
    vreResult?.actual_strategy?.final_position ??
    (laps[laps.length - 1] as any)?.position ??
    null;

  const kpis: { label: string; value: string; sub?: string; icon: any }[] = [
    {
      icon: Gauge,
      label: "Miglior Giro",
      value: formatLapTime(bestLap?.lap_duration ?? null),
      sub: bestLap ? `Giro ${bestLap.lap_number}` : undefined,
    },
    {
      icon: Flag,
      label: "Posizione",
      value: finalPos != null ? `P${finalPos}` : "—",
    },
    {
      icon: Wrench,
      label: "Pit Stop",
      value: String(nPits),
    },
    {
      icon: Hash,
      label: "Giri Totali",
      value: String(totalLaps),
    },
  ];

  return (
    <section
      className="card-premium rounded-xl border border-border/60 p-4 sm:p-5 relative overflow-hidden"
      style={{ boxShadow: `inset 0 1px 0 #${driverColor}22` }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--f1-red))]/40 to-transparent" />
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[hsl(var(--f1-red-glow))]">
          ▸ Cockpit
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-[hsl(var(--f1-red))]/30 to-transparent" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div
              key={k.label}
              className="relative rounded-lg border border-border/50 bg-gradient-to-br from-card to-card/40 px-3 py-3 sm:px-4 sm:py-3.5"
            >
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground mb-1.5">
                <Icon className="w-3 h-3 text-[hsl(var(--f1-red-glow))]" />
                {k.label}
              </div>
              <div className="text-xl sm:text-2xl font-black tabular-nums tracking-tight text-foreground leading-none">
                {k.value}
              </div>
              {k.sub && (
                <div className="text-[10px] text-muted-foreground tabular-nums mt-1">{k.sub}</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
