import { useMemo } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { Info } from "lucide-react";
import {
  AXIS_LABELS,
  buildAxisNarrative,
  buildH2HAxisNarrative,
  type DriverRadar,
  type PerformanceRadarResult,
  type RadarAxisKey,
} from "@/lib/performanceRadar";

interface PerformanceRadarCardProps {
  /**
   * Either single-driver (drivers.length === 1, reference set is the whole field)
   * or H2H (drivers.length === 2, reference set is the two drivers themselves).
   */
  result: PerformanceRadarResult;
  /** Optional title override. */
  title?: string;
  /** Optional additional informative notice line. */
  notice?: string;
}

const AXIS_ORDER: RadarAxisKey[] = ["trap", "sector1", "sector2", "sector3", "degradation"];

interface ChartRow {
  axisKey: RadarAxisKey;
  axisLabel: string;
  [acronym: string]: number | string | null;
}

export function PerformanceRadarCard({ result, title, notice }: PerformanceRadarCardProps) {
  const drivers = result.drivers;
  const isH2H = drivers.length === 2;

  const chartData = useMemo<ChartRow[]>(() => {
    return AXIS_ORDER.map((key) => {
      const row: ChartRow = { axisKey: key, axisLabel: AXIS_LABELS[key] };
      drivers.forEach((d) => {
        const s = d.axes[key].score;
        // Use 0 as a visual placeholder for unavailable axes; the badge below
        // ensures honest disclosure ("non disponibile").
        row[d.acronym] = s == null ? 0 : Number(s.toFixed(3));
      });
      return row;
    });
  }, [drivers]);

  if (!drivers.length) {
    return (
      <div className="bg-card border border-border rounded-lg p-4 text-sm text-muted-foreground">
        Nessun pilota disponibile per il radar prestazionale.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-semibold tracking-tight">
            {title ?? (isH2H ? "Radar prestazionale (H2H)" : "Radar prestazionale (pentagonale)")}
          </h3>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Cinque assi solidi 0–1, normalizzati relative-to-best
          {isH2H ? " sui due piloti confrontati" : " sul campo della sessione"}.
          Esclusi giri sotto neutralizzazione (SC/VSC/red flag), out/in-lap e outlier (MAD).
        </p>
        {notice && (
          <p className="text-[11px] text-amber-500/90 mt-1 flex items-start gap-1">
            <Info className="h-3 w-3 mt-[2px] shrink-0" />
            <span>{notice}</span>
          </p>
        )}
      </div>

      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} outerRadius="75%">
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis
              dataKey="axisLabel"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 1]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
            />
            {drivers.map((d) => (
              <Radar
                key={d.driverNumber}
                name={d.acronym}
                dataKey={d.acronym}
                stroke={d.color}
                fill={d.color}
                fillOpacity={isH2H ? 0.18 : 0.35}
              />
            ))}
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                fontSize: 11,
              }}
              formatter={(value: number | string) => {
                if (typeof value === "number") return `${Math.round(value * 100)}%`;
                return String(value);
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-axis narrative */}
      <div className="space-y-3">
        {isH2H ? (
          <H2HNarrative driverA={drivers[0]} driverB={drivers[1]} />
        ) : (
          <SingleDriverNarrative driver={drivers[0]} />
        )}
      </div>
    </div>
  );
}

function SingleDriverNarrative({ driver }: { driver: DriverRadar }) {
  const narrative = buildAxisNarrative(driver);
  return (
    <ul className="space-y-1.5 text-[11px] text-muted-foreground">
      {AXIS_ORDER.map((key) => {
        const v = driver.axes[key];
        const unavailable = v.raw == null;
        return (
          <li key={key} className="flex items-start gap-2">
            <span
              className={`mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                unavailable ? "bg-muted-foreground/40" : ""
              }`}
              style={!unavailable ? { backgroundColor: driver.color } : undefined}
            />
            <span className={unavailable ? "italic opacity-70" : ""}>
              {narrative[key]}
              {unavailable && (
                <span className="ml-1 inline-block rounded bg-muted px-1 py-px text-[9px] uppercase tracking-wider">
                  non disponibile
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function H2HNarrative({ driverA, driverB }: { driverA: DriverRadar; driverB: DriverRadar }) {
  const narrative = buildH2HAxisNarrative(driverA, driverB);
  return (
    <ul className="space-y-1.5 text-[11px] text-muted-foreground">
      {AXIS_ORDER.map((key) => {
        const unavailable =
          driverA.axes[key].raw == null && driverB.axes[key].raw == null;
        return (
          <li key={key} className="flex items-start gap-2">
            <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0 bg-muted-foreground/60" />
            <span className={unavailable ? "italic opacity-70" : ""}>
              {narrative[key]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
