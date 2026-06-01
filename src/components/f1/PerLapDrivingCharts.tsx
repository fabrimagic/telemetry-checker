import { ZONE_COLORS } from "@/lib/zoneIntervals";
import type { RaceDrivingAverages } from "@/lib/raceDrivingAverages";
import type { LapDeviation } from "@/lib/cumulativeDeviation";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface Props {
  avg: RaceDrivingAverages;
  driverCumulativeDeviation?: LapDeviation[] | null;
}

export function PerLapDrivingCharts({ avg, driverCumulativeDeviation }: Props) {
  if (!avg.per_lap.length) return null;

  const driverDev = driverCumulativeDeviation ?? null;
  const lapNumbersUnion = new Set<number>();
  avg.per_lap.forEach((p) => lapNumbersUnion.add(p.lap_number));
  driverDev?.forEach((p) => lapNumbersUnion.add(p.lap_number));
  const allLaps = Array.from(lapNumbersUnion).sort((a, b) => a - b);
  if (!allLaps.length) return null;
  const xMin = allLaps[0];
  const xMax = allLaps[allLaps.length - 1];

  const perLapByNum = new Map(avg.per_lap.map((p) => [p.lap_number, p]));
  const dataA = allLaps.map((n) => {
    const p = perLapByNum.get(n);
    return {
      lap_number: n,
      superclip: p ? p.superclip_duration : null,
      liftcoast: p ? p.liftcoast_duration : null,
    };
  });

  const devByNum = new Map((driverDev ?? []).map((d) => [d.lap_number, d]));
  const dataB = allLaps.map((n) => {
    const d = devByNum.get(n);
    return {
      lap_number: n,
      cumulative_delta: d ? d.cumulative_delta : null,
    };
  });

  const indicativeBadge =
    avg.low_sample || avg.aborted ? (
      <Badge variant="outline" className="text-[9px] py-0 px-1.5 ml-2">
        {avg.aborted ? "annullato — parziale" : "campione ridotto — indicativo"}
      </Badge>
    ) : null;

  return (
    <div className="space-y-3">
      {/* Chart A — Superclipping & Lift & Coast per lap */}
      <div className="bg-muted/20 rounded-md p-3 border border-border/40">
        <div className="flex items-center mb-2">
          <span className="text-[11px] font-medium text-foreground">
            Superclipping & Lift &amp; Coast per giro
          </span>
          {indicativeBadge}
          <span className="text-[10px] text-muted-foreground ml-auto">
            secondi per giro
          </span>
        </div>
        <div style={{ width: "100%", height: 180 }}>
          <ResponsiveContainer>
            <ComposedChart
              data={dataA}
              margin={{ top: 4, right: 8, left: -8, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                opacity={0.4}
              />
              <XAxis
                dataKey="lap_number"
                type="number"
                domain={[xMin, xMax]}
                allowDecimals={false}
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 11,
                }}
                formatter={(value: number | string | null, name: string) =>
                  value == null
                    ? ["—", name]
                    : [`${Number(value).toFixed(2)}s`, name]
                }
                labelFormatter={(l) => `Giro ${l}`}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar
                dataKey="superclip"
                name="Superclipping"
                fill={ZONE_COLORS.superclipping}
                isAnimationActive={false}
              />
              <Bar
                dataKey="liftcoast"
                name="Lift & Coast"
                fill={ZONE_COLORS.liftcoast}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart B — Cumulative deviation */}
      {driverDev && driverDev.length > 0 && (
        <div className="bg-muted/20 rounded-md p-3 border border-border/40">
          <div className="flex items-center mb-2">
            <span className="text-[11px] font-medium text-foreground">
              Deviazione cumulativa (distacco dal leader)
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              secondi
            </span>
          </div>
          <div style={{ width: "100%", height: 160 }}>
            <ResponsiveContainer>
              <LineChart
                data={dataB}
                margin={{ top: 4, right: 8, left: -8, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  opacity={0.4}
                />
                <XAxis
                  dataKey="lap_number"
                  type="number"
                  domain={[xMin, xMax]}
                  allowDecimals={false}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    fontSize: 11,
                  }}
                  formatter={(value: number | string | null) =>
                    value == null ? "—" : `${Number(value).toFixed(2)}s`
                  }
                  labelFormatter={(l) => `Giro ${l}`}
                />
                <Line
                  type="monotone"
                  dataKey="cumulative_delta"
                  name="Distacco cumulativo"
                  stroke="hsl(var(--foreground))"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground leading-relaxed px-1">
        I due grafici sono allineati sullo stesso asse dei giri per evidenziare{" "}
        <em>coincidenze</em> temporali. Un giro con molto lift &amp; coast o
        superclipping che coincide con un aumento del distacco NON implica
        necessariamente un nesso causale: il lift &amp; coast può essere una
        scelta di gestione (carburante, gomme, freni) e il distacco può
        dipendere da traffico, neutralizzazioni o strategia. Usa il confronto
        come spunto di esplorazione, non come prova.
      </p>
    </div>
  );
}
