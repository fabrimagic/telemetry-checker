import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import type { ComparisonResult, DivergenceEventType } from "@/lib/headToHeadComparison";
import type { Driver } from "@/lib/openf1";
import { cn } from "@/lib/utils";

interface Props {
  comparison: ComparisonResult;
  driverA: Driver;
  driverB: Driver;
}

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: "#ef4444",
  MEDIUM: "#facc15",
  HARD: "#f4f4f5",
  INTERMEDIATE: "#22c55e",
  WET: "#3b82f6",
  UNKNOWN: "#6b7280",
};

function compoundColor(c: string | null): string {
  if (!c) return COMPOUND_COLORS.UNKNOWN;
  return COMPOUND_COLORS[c.toUpperCase()] ?? COMPOUND_COLORS.UNKNOWN;
}

function divergenceIcon(t: DivergenceEventType): string {
  switch (t) {
    case "PIT_A_ONLY": return "🅰️→P";
    case "PIT_B_ONLY": return "🅱️→P";
    case "COMPOUND_DIVERGENCE": return "◇";
    case "POSITION_SWAP": return "⇄";
  }
}

export function CompareTimeline({ comparison, driverA, driverB }: Props) {
  const { total_laps, stint_alignment, lap_by_lap_delta, strategic_divergence_points } = comparison;

  // Build stint segments per driver from actual_strategy (more reliable per-driver than alignment)
  const stintsA = comparison.driver_a.actual_strategy.stints;
  const stintsB = comparison.driver_b.actual_strategy.stints;

  const chartData = useMemo(
    () => lap_by_lap_delta.map((p) => ({
      lap: p.lap,
      delta: p.delta_a_minus_b,
      cumulative: p.cumulative_delta,
    })),
    [lap_by_lap_delta],
  );

  const renderRow = (
    stints: typeof stintsA,
    pits: number[],
    driverLabel: string,
    color: string,
  ) => {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: `#${color}` }}
          />
          {driverLabel}
        </div>
        <div className="relative h-7 bg-muted/30 rounded overflow-hidden border border-border/50">
          {stints.map((s) => {
            const left = ((s.lap_start - 1) / total_laps) * 100;
            const width = ((s.lap_end - s.lap_start + 1) / total_laps) * 100;
            return (
              <div
                key={s.stint_number}
                title={`Stint ${s.stint_number}: ${s.compound} (giri ${s.lap_start}-${s.lap_end})`}
                className="absolute top-0 h-full flex items-center justify-center text-[9px] font-bold text-black/80 border-r border-background/40"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: compoundColor(s.compound),
                }}
              >
                {width > 6 ? s.compound.charAt(0) : ""}
              </div>
            );
          })}
          {pits.map((lap) => {
            const left = ((lap - 0.5) / total_laps) * 100;
            return (
              <div
                key={`pit-${lap}`}
                title={`Pit stop al giro ${lap}`}
                className="absolute top-0 h-full w-[2px] bg-[hsl(var(--f1-red))] z-10"
                style={{ left: `${left}%` }}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const colorA = (driverA.team_colour || "888888").toLowerCase();
  const colorB = (driverB.team_colour || "888888").toLowerCase();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Timeline strategica</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 overflow-x-auto">
          <div className="min-w-[600px] space-y-3">
            {renderRow(stintsA, comparison.driver_a.actual_strategy.pit_laps, driverA.name_acronym, colorA)}
            {renderRow(stintsB, comparison.driver_b.actual_strategy.pit_laps, driverB.name_acronym, colorB)}

            {/* Divergence markers band */}
            {strategic_divergence_points.length > 0 && (
              <div className="relative h-6 mt-1">
                {strategic_divergence_points.map((d, i) => {
                  const left = ((d.lap - 0.5) / total_laps) * 100;
                  return (
                    <div
                      key={i}
                      title={d.description}
                      className="absolute top-0 -translate-x-1/2 text-[11px] cursor-help"
                      style={{ left: `${left}%` }}
                    >
                      <span className="bg-background border border-border rounded px-1 py-0.5 text-[9px] font-mono">
                        {divergenceIcon(d.event_type)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Lap axis */}
            <div className="flex justify-between text-[9px] text-muted-foreground/70 font-mono px-0.5">
              <span>L1</span>
              <span>L{Math.floor(total_laps / 2)}</span>
              <span>L{total_laps}</span>
            </div>
          </div>
        </div>

        {/* Cumulative delta chart */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            Delta cumulativo (s) — positivo = {driverA.name_acronym} più lento
          </div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: -8 }}>
                <XAxis dataKey="lap" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                  formatter={(value: any) => (value == null ? "—" : `${Number(value).toFixed(2)}s`)}
                  labelFormatter={(l) => `Giro ${l}`}
                />
                <Bar dataKey="cumulative" name="Cumulativo">
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.cumulative > 0 ? "hsl(var(--destructive))" : d.cumulative < 0 ? "#22c55e" : "hsl(var(--muted))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
