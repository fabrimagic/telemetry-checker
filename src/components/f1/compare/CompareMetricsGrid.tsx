import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ComparisonResult } from "@/lib/headToHeadComparison";
import type { Driver } from "@/lib/openf1";

interface Props {
  comparison: ComparisonResult;
  driverA: Driver;
  driverB: Driver;
}

interface MetricRow {
  label: string;
  valueA: string;
  valueB: string;
  /** "A" if A is better, "B" if B is better, null if neutral or tie */
  winner: "A" | "B" | null;
}

function fmtTime(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  if (m > 0) return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  return `${s.toFixed(3)}s`;
}

function buildMetrics(c: ComparisonResult): MetricRow[] {
  const a = c.driver_a;
  const b = c.driver_b;

  const totalA = a.actual_strategy.total_race_time;
  const totalB = b.actual_strategy.total_race_time;

  const pitA = a.actual_strategy.pit_stops.length;
  const pitB = b.actual_strategy.pit_stops.length;

  const compA = a.actual_strategy.stints.map((s) => s.compound).join(" → ") || "—";
  const compB = b.actual_strategy.stints.map((s) => s.compound).join(" → ") || "—";

  const cumDevA = a.integrated_context?.cumulative_deviation_context?.driver_final_delta ?? null;
  const cumDevB = b.integrated_context?.cumulative_deviation_context?.driver_final_delta ?? null;

  const battlesA = a.integrated_context?.battle_context?.total_episodes ?? 0;
  const battlesB = b.integrated_context?.battle_context?.total_episodes ?? 0;

  const neutLapsA = a.integrated_context?.track_status_context?.total_neutralized_laps ?? 0;
  const neutLapsB = b.integrated_context?.track_status_context?.total_neutralized_laps ?? 0;

  const validLapsA = a.actual_strategy.stints.flatMap((s) => [s.avg_lap_time]).filter((v): v is number => v != null);
  const validLapsB = b.actual_strategy.stints.flatMap((s) => [s.avg_lap_time]).filter((v): v is number => v != null);
  const bestA = validLapsA.length ? Math.min(...validLapsA) : null;
  const bestB = validLapsB.length ? Math.min(...validLapsB) : null;

  const cmpLower = (x: number | null, y: number | null): "A" | "B" | null => {
    if (x == null || y == null) return null;
    if (x < y) return "A";
    if (y < x) return "B";
    return null;
  };
  const cmpHigher = (x: number | null, y: number | null): "A" | "B" | null => {
    if (x == null || y == null) return null;
    if (x > y) return "A";
    if (y > x) return "B";
    return null;
  };

  const confOrder: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  const confWinner: "A" | "B" | null =
    confOrder[a.confidence] === confOrder[b.confidence]
      ? null
      : confOrder[a.confidence] > confOrder[b.confidence] ? "A" : "B";

  return [
    { label: "Tempo totale gara", valueA: fmtTime(totalA), valueB: fmtTime(totalB), winner: cmpLower(totalA, totalB) },
    { label: "Deviazione cumulativa finale", valueA: cumDevA != null ? `${cumDevA >= 0 ? "+" : ""}${cumDevA.toFixed(2)}s` : "—", valueB: cumDevB != null ? `${cumDevB >= 0 ? "+" : ""}${cumDevB.toFixed(2)}s` : "—", winner: cmpLower(cumDevA, cumDevB) },
    { label: "Numero pit stop", valueA: String(pitA), valueB: String(pitB), winner: cmpLower(pitA, pitB) },
    { label: "Sequenza mescole", valueA: compA, valueB: compB, winner: null },
    { label: "Risk mode suggerito", valueA: a.risk_mode, valueB: b.risk_mode, winner: null },
    { label: "Confidence analisi", valueA: a.confidence, valueB: b.confidence, winner: confWinner },
    { label: "Eventi battaglia", valueA: String(battlesA), valueB: String(battlesB), winner: cmpHigher(battlesA, battlesB) },
    { label: "Giri in neutralizzazione", valueA: String(neutLapsA), valueB: String(neutLapsB), winner: null },
    { label: "Best stint avg lap", valueA: fmtTime(bestA), valueB: fmtTime(bestB), winner: cmpLower(bestA, bestB) },
  ];
}

export function CompareMetricsGrid({ comparison, driverA, driverB }: Props) {
  const metrics = buildMetrics(comparison);
  const colorA = (driverA.team_colour || "888888").toLowerCase();
  const colorB = (driverB.team_colour || "888888").toLowerCase();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Metriche a confronto</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1.2fr_1fr_1fr] gap-px bg-border">
          <div className="bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Metrica</div>
          <div className="bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-center" style={{ color: `#${colorA}` }}>
            {driverA.name_acronym}
          </div>
          <div className="bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-center" style={{ color: `#${colorB}` }}>
            {driverB.name_acronym}
          </div>
          {metrics.map((m) => (
            <>
              <div key={m.label + "-l"} className="bg-background px-3 py-2 text-xs">{m.label}</div>
              <div
                key={m.label + "-a"}
                className={cn(
                  "bg-background px-3 py-2 text-xs font-mono text-center",
                  m.winner === "A" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold",
                )}
              >
                {m.valueA}
              </div>
              <div
                key={m.label + "-b"}
                className={cn(
                  "bg-background px-3 py-2 text-xs font-mono text-center",
                  m.winner === "B" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold",
                )}
              >
                {m.valueB}
              </div>
            </>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
