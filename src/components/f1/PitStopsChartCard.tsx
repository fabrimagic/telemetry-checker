import { Square } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PitData } from "@/lib/openf1";

interface Props {
  pitStops: PitData[];
}

interface ChartRow {
  lapLabel: string;
  lap_number: number;
  lane_duration: number;
  stop_duration: number | null;
  stopAvailable: boolean;
}

const COLOR_LANE = "hsl(var(--chart-blue))";
const COLOR_STOP = "hsl(var(--chart-orange))";
const COLOR_NA = "hsl(var(--muted))";

function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/d";
  return `${v.toFixed(1)}s`;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold mb-1">Giro {row.lap_number}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Pit lane</span>
        <span className="font-mono tabular-nums">{fmt(row.lane_duration)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Stop ai box</span>
        <span className="font-mono tabular-nums">
          {row.stopAvailable ? fmt(row.stop_duration) : "Stop non disponibile"}
        </span>
      </div>
    </div>
  );
}

export function PitStopsChartCard({ pitStops }: Props) {
  if (!pitStops || pitStops.length === 0) return null;

  const data: ChartRow[] = [...pitStops]
    .sort((a, b) => a.lap_number - b.lap_number)
    .map((p) => {
      const stopAvailable = p.stop_duration != null && Number.isFinite(p.stop_duration);
      return {
        lapLabel: `Giro ${p.lap_number}`,
        lap_number: p.lap_number,
        lane_duration: Number.isFinite(p.lane_duration) ? p.lane_duration : 0,
        stop_duration: stopAvailable ? (p.stop_duration as number) : null,
        stopAvailable,
      };
    });

  return (
    <div className="bg-card rounded-lg border border-border p-3" data-testid="pit-stops-chart-card">
      <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Square className="h-3 w-3" />
        Pit Stop ({data.length})
      </h3>

      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="lapLabel"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontFamily: "monospace" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={false}
              label={{
                value: "s",
                angle: -90,
                position: "insideLeft",
                style: { fill: "hsl(var(--muted-foreground))", fontSize: 9 },
              }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
            <Legend
              wrapperStyle={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}
              iconType="square"
            />
            <Bar dataKey="lane_duration" name="Pit lane" fill={COLOR_LANE} radius={[2, 2, 0, 0]} />
            <Bar dataKey="stop_duration" name="Stop ai box" fill={COLOR_STOP} radius={[2, 2, 0, 0]}>
              {data.map((row, i) => (
                <Cell
                  key={`stop-${i}`}
                  fill={row.stopAvailable ? COLOR_STOP : COLOR_NA}
                  fillOpacity={row.stopAvailable ? 1 : 0.25}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-[9px] text-muted-foreground/80 italic leading-snug">
        Valori dal cronometraggio ufficiale (OpenF1). Lo stop può non essere disponibile.
      </p>
    </div>
  );
}
