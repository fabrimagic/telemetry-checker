import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

interface DriverLapTimes {
  driverNumber: number;
  acronym: string;
  color: string;
  laps: { lap_number: number; lap_duration: number | null }[];
}

interface Props {
  drivers: DriverLapTimes[];
}

const GRID_STROKE = "hsl(220 14% 16%)";
const AXIS_TICK = { fill: "hsl(215 12% 45%)", fontSize: 10 };

function formatLapTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const sWhole = Math.floor(s);
  const ms = Math.round((s - sWhole) * 1000);
  return `${m}:${sWhole.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

export function LapTimesChart({ drivers }: Props) {
  const data = useMemo(() => {
    const map = new Map<number, Record<string, any>>();
    for (const d of drivers) {
      for (const lap of d.laps) {
        if (lap.lap_duration == null || lap.lap_duration <= 0) continue;
        if (!map.has(lap.lap_number)) map.set(lap.lap_number, { lap: lap.lap_number });
        map.get(lap.lap_number)![`t_${d.driverNumber}`] = lap.lap_duration;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.lap - b.lap);
  }, [drivers]);

  if (!data.length) return null;

  // Compute Y domain with some padding
  const allTimes = data.flatMap((d) =>
    drivers.map((dr) => d[`t_${dr.driverNumber}`]).filter((v): v is number => v != null)
  );
  const yMin = Math.floor(Math.min(...allTimes));
  const yMax = Math.ceil(Math.max(...allTimes));

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
        Lap Times
      </h3>
      <div className="flex gap-3 mb-2">
        {drivers.map((d) => (
          <span key={d.driverNumber} className="flex items-center gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${d.color}` }} />
            <span className="font-mono font-bold">{d.acronym}</span>
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="lap"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            label={{ value: "Lap", position: "insideBottom", offset: -2, style: { fill: "hsl(215 12% 45%)", fontSize: 10 } }}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatLapTime}
            width={60}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(220 18% 10%)",
              border: "1px solid hsl(220 14% 18%)",
              borderRadius: 6,
              fontSize: 11,
            }}
            labelStyle={{ color: "hsl(215 12% 55%)" }}
            labelFormatter={(v) => `Lap ${v}`}
            formatter={(value: number) => [formatLapTime(value), ""]}
          />
          {drivers.map((d) => (
            <Line
              key={d.driverNumber}
              type="monotone"
              dataKey={`t_${d.driverNumber}`}
              name={d.acronym}
              stroke={`#${d.color}`}
              dot={{ r: 2, fill: `#${d.color}` }}
              strokeWidth={1.5}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
