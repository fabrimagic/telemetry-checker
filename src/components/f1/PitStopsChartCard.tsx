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

const COLOR_LANE = "hsl(var(--primary))";
const COLOR_STOP = "hsl(var(--destructive))";
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
    <div className="bg-card rounded-lg border border-border p-4" data-testid="pit-stops-chart-card">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Square className="h-3.5 w-3.5" />
        Pit Stop ({data.length})
      </h3>

      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="lapLabel"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11, fontFamily: "monospace" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={false}
              label={{
                value: "Secondi",
                angle: -90,
                position: "insideLeft",
                style: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
              }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}
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

      <p className="mt-3 text-[10px] text-muted-foreground/80 italic leading-snug">
        Valori dal cronometraggio ufficiale della sessione (OpenF1). La durata dello stop ai box può non essere
        disponibile per tutti i pit stop: in tal caso viene indicata come non disponibile.
      </p>
    </div>
  );
}
