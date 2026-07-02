import { useState, useEffect, useMemo } from "react";
import { Loader2, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import {
  getAllLaps,
  type SessionResult,
  type Driver,
  type Lap,
} from "@/lib/openf1";
import { computeCumulativeDeviation, type CumulativeDeviationResult } from "@/lib/cumulativeDeviation";
import { Watermark } from "./Watermark";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface Props {
  sessionKey: number;
  results: SessionResult[];
  drivers: Driver[];
  visibleDrivers: Set<number> | null;
}

export function CumulativeDeviationCard({ sessionKey, results, drivers, visibleDrivers }: Props) {
  const [loading, setLoading] = useState(true);
  const [allLaps, setAllLaps] = useState<Lap[]>([]);
  const [legendOpen, setLegendOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getAllLaps(sessionKey)
      .then((laps) => {
        if (!cancelled) setAllLaps(laps);
      })
      .catch(() => {
        if (!cancelled) setAllLaps([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [sessionKey]);

  const data: CumulativeDeviationResult | null = useMemo(() => {
    if (loading || !allLaps.length || !results.length || !drivers.length) return null;
    return computeCumulativeDeviation(sessionKey, allLaps, results, drivers);
  }, [sessionKey, allLaps, results, drivers, loading]);

  const filteredDriverData = useMemo(() => {
    if (!data) return [];
    if (!visibleDrivers) return data.drivers;
    return data.drivers.filter((d) => visibleDrivers.has(d.driver_number));
  }, [data, visibleDrivers]);

  const chartData = useMemo(() => {
    if (!filteredDriverData.length) return [];
    const maxLap = Math.max(...filteredDriverData.flatMap((d) => d.laps.map((l) => l.lap_number)));
    const points: Record<string, any>[] = [];
    for (let lap = 1; lap <= maxLap; lap++) {
      const point: Record<string, any> = { lap };
      for (const drv of filteredDriverData) {
        const l = drv.laps.find((x) => x.lap_number === lap);
        if (l) point[`d${drv.driver_number}`] = l.cumulative_delta;
      }
      if (Object.keys(point).length > 1) points.push(point);
    }
    return points;
  }, [filteredDriverData]);

  if (loading) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Calcolo deviazione cumulativa…
        </div>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" /> Deviazione Cumulativa
        </h3>
        <p className="text-xs text-muted-foreground">
          {data?.error ?? "Deviazione cumulativa non disponibile per dati insufficienti"}
        </p>
      </div>
    );
  }

  if (!filteredDriverData.length) return null;

  const sortedTable = [...filteredDriverData].sort(
    (a, b) => (a.final_cumulative_delta ?? 9999) - (b.final_cumulative_delta ?? 9999)
  );

  return (
    <div className="bg-card rounded-lg border border-border p-4 relative overflow-hidden">
      <Watermark />
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5" /> Deviazione Cumulativa
      </h3>
      <p className="text-[10px] text-muted-foreground mb-3">
        Deviazione di passo cumulata rispetto al passo medio del vincitore ({data.winner_driver_code} — benchmark: {data.winner_reference_avg_lap?.toFixed(3)}s).
        Valori crescenti indicano una perdita progressiva di performance.
      </p>

      {/* Chart */}
      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={380}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="lap"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              label={{ value: "Giro", position: "insideBottomRight", offset: -5, fontSize: 10 }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              label={{ value: "Δ cumulativo (s)", angle: -90, position: "insideLeft", fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                fontSize: 11,
              }}
              formatter={(value: any, name: string) => {
                const num = parseInt(name.replace("d", ""));
                const drv = filteredDriverData.find((d) => d.driver_number === num);
                return [`${Number(value).toFixed(3)}s`, drv?.driver_code ?? `#${num}`];
              }}
              labelFormatter={(label) => `Giro ${label}`}
            />
            {filteredDriverData.map((drv) => (
              <Line
                key={drv.driver_number}
                type="monotone"
                dataKey={`d${drv.driver_number}`}
                stroke={`#${drv.team_colour}`}
                dot={false}
                strokeWidth={1.5}
                connectNulls
                name={`d${drv.driver_number}`}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Driver legend */}
      <div className="flex flex-wrap gap-2 mt-2 mb-4">
        {filteredDriverData.map((drv) => (
          <span key={drv.driver_number} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${drv.team_colour}` }} />
            {drv.driver_code}
          </span>
        ))}
      </div>

      {/* Summary table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pilota</TableHead>
              <TableHead className="text-right">Giri validi</TableHead>
              <TableHead className="text-right">Δ cumulativo finale</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTable.map((drv) => (
              <TableRow key={drv.driver_number}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: `#${drv.team_colour}` }}
                    />
                    <span className="font-mono font-bold text-xs">{drv.driver_code}</span>
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-xs">{drv.valid_laps_count}</TableCell>
                <TableCell className="text-right font-mono tabular-nums text-xs">
                  {drv.final_cumulative_delta != null
                    ? `${drv.final_cumulative_delta > 0 ? "+" : ""}${drv.final_cumulative_delta.toFixed(3)}s`
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Collapsible legend */}
      <Collapsible open={legendOpen} onOpenChange={setLegendOpen} className="mt-3">
        <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
          {legendOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Legenda
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-1.5 text-[10px] text-muted-foreground bg-muted/30 rounded-md p-3">
          <p><strong className="text-foreground">Deviazione cumulativa:</strong> somma dei delta giro per giro rispetto al tempo medio del vincitore. Indica il ritardo totale accumulato.</p>
          <p><strong className="text-foreground">Benchmark:</strong> tempo medio del vincitore calcolato escludendo out lap, primo giro, e giri anomali ({">"} 1.5× mediana).</p>
          <p><strong className="text-foreground">Delta giro:</strong> differenza tra il tempo sul giro del pilota e il benchmark del vincitore.</p>
          <p><strong className="text-foreground">Nota:</strong> questa metrica è descrittiva e non rappresenta direttamente il degrado gomme. Giri con pit stop, out lap o tempi anomali sono esclusi dal calcolo.</p>
          {filteredDriverData.some((d) => d.final_cumulative_delta != null && d.final_cumulative_delta < 0) && (
            <p><strong className="text-foreground">Valori negativi:</strong> un valore negativo indica che il pilota ha avuto un passo medio sui giri validi più veloce rispetto al benchmark del vincitore. Questo può accadere quando un pilota ha un ritmo puro superiore ma perde la gara per fattori esterni al passo (strategia, pit stop, safety car, incidenti o penalità).</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
