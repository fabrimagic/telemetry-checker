import { useMemo, useState, useRef, useEffect } from "react";
import type { CarData, Lap } from "@/lib/openf1";
import type { TrackStatus } from "@/lib/trackStatusClassification";
import {
  computeZones,
  computeRaceDrivingAverages,
  type CarDataFetcher,
  type RaceDrivingAverages,
} from "@/lib/raceDrivingAverages";

import { ZONE_COLORS } from "@/lib/zoneIntervals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
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

interface DriverAnalysis {
  driverNumber: number;
  acronym: string;
  color: string;
  carData: CarData[];
}

export interface ZoneDate {
  date: string;
  type: "superclipping" | "liftcoast";
}

export interface DriverZones {
  driverNumber: number;
  color: string;
  zones: ZoneDate[];
}

export interface RaceAverageContext {
  sessionKey: number;
  driverNumber: number;
  laps: Lap[];
  trackStatusMap: Map<number, TrackStatus>;
  fetchCarData: CarDataFetcher;
  /** True only for single-driver Race/Sprint views. */
  enabled: boolean;
}

interface Props {
  drivers: DriverAnalysis[];
  raceAverageContext?: RaceAverageContext | null;
  /** Called when the race-average comparison result changes (including reset to null). */
  onAvgChange?: (avg: RaceDrivingAverages | null) => void;
}

export function DrivingAnalysis({ drivers, raceAverageContext, onAvgChange }: Props) {
  const analyses = useMemo(
    () => drivers.map((d) => ({ ...d, zones: computeZones(d.carData) })),
    [drivers],
  );

  // Race-average comparison state (single-driver only).
  const [avg, setAvg] = useState<RaceDrivingAverages | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset on context change (session / driver swap).
  useEffect(() => {
    setAvg(null);
    onAvgChange?.(null);
    setProgress(null);
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, [raceAverageContext?.sessionKey, raceAverageContext?.driverNumber, onAvgChange]);

  const canCompareAvg =
    !!raceAverageContext?.enabled && analyses.length === 1;

  const handleCompute = async () => {
    if (!raceAverageContext || !canCompareAvg) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setAvg(null);
    setProgress({ done: 0, total: 0 });
    try {
      const result = await computeRaceDrivingAverages(
        raceAverageContext.sessionKey,
        raceAverageContext.driverNumber,
        raceAverageContext.laps,
        raceAverageContext.trackStatusMap,
        raceAverageContext.fetchCarData,
        {
          signal: ctrl.signal,
          onProgress: (done, total) => setProgress({ done, total }),
        },
      );
      setAvg(result);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  // Export zone dates for TrackMap
  const allZones: DriverZones[] = useMemo(
    () =>
      analyses.map((a) => ({
        driverNumber: a.driverNumber,
        color: a.color,
        zones: [
          ...a.zones.superclipping.dates.map((date) => ({ date, type: "superclipping" as const })),
          ...a.zones.liftcoast.dates.map((date) => ({ date, type: "liftcoast" as const })),
        ],
      })),
    [analyses],
  );
  void allZones;

  if (!analyses.length) return null;

  const single = analyses.length === 1 ? analyses[0] : null;

  const fmtDelta = (lapVal: number, avgVal: number, unit: string, kind: "superclip" | "liftcoast") => {
    const delta = lapVal - avgVal;
    const abs = Math.abs(delta);
    const sign = delta >= 0 ? "+" : "−";
    const direction = delta >= 0 ? "sopra" : "sotto";
    let hint = "";
    if (kind === "liftcoast") {
      hint = delta >= 0 ? " (suggerisce gestione)" : " (suggerisce spinta)";
    } else {
      hint = delta >= 0 ? " (suggerisce più spinta)" : "";
    }
    return `${sign}${abs.toFixed(unit === "s" ? 2 : 1)}${unit} ${direction} media${hint}`;
  };

  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      {/* Superclipping */}
      <div className="bg-muted/30 rounded-md p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: "hsl(0 85% 55%)" }} />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Superclipping</span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">
          Deceleration while throttle is at 100%
        </p>
        {analyses.map((a) => (
          <div key={a.driverNumber} className="flex items-center gap-2 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: `#${a.color}` }} />
            <span className="text-xs font-mono font-bold">{a.acronym}</span>
            <span className="text-xs font-mono text-foreground ml-auto">{a.zones.superclipping.duration.toFixed(2)}s</span>
            <span className="text-[10px] text-muted-foreground">({a.zones.superclipping.count}×)</span>
          </div>
        ))}
        {single && avg && (
          <div className="mt-2 pt-2 border-t border-border/50 space-y-0.5">
            <div className="text-[10px] text-muted-foreground">
              Media gara: <span className="font-mono">{avg.superclip_avg_duration.toFixed(2)}s</span>{" "}
              ({avg.superclip_avg_count.toFixed(1)}×)
            </div>
            <div className="text-[10px] text-foreground/80">
              {fmtDelta(single.zones.superclipping.duration, avg.superclip_avg_duration, "s", "superclip")}
            </div>
          </div>
        )}
      </div>

      {/* Lift & Coast */}
      <div className="bg-muted/30 rounded-md p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: "hsl(200 85% 55%)" }} />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Lift & Coast</span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">
          Throttle &gt;90% → 0% with no braking
        </p>
        {analyses.map((a) => (
          <div key={a.driverNumber} className="flex items-center gap-2 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: `#${a.color}` }} />
            <span className="text-xs font-mono font-bold">{a.acronym}</span>
            <span className="text-xs font-mono text-foreground ml-auto">{a.zones.liftcoast.duration.toFixed(2)}s</span>
            <span className="text-[10px] text-muted-foreground">({a.zones.liftcoast.count}×)</span>
          </div>
        ))}
        {single && avg && (
          <div className="mt-2 pt-2 border-t border-border/50 space-y-0.5">
            <div className="text-[10px] text-muted-foreground">
              Media gara: <span className="font-mono">{avg.liftcoast_avg_duration.toFixed(2)}s</span>{" "}
              ({avg.liftcoast_avg_count.toFixed(1)}×)
            </div>
            <div className="text-[10px] text-foreground/80">
              {fmtDelta(single.zones.liftcoast.duration, avg.liftcoast_avg_duration, "s", "liftcoast")}
            </div>
          </div>
        )}
      </div>

      {/* Race average control — single driver Race/Sprint only */}
      {canCompareAvg && (
        <div className="col-span-2 bg-muted/20 rounded-md p-3 border border-border/40">
          {!avg && !running && (
            <>
              <Button size="sm" variant="outline" onClick={handleCompute}>
                Confronta con media gara
              </Button>
              <p className="text-[10px] text-muted-foreground mt-2">
                L'operazione scarica la telemetria di tutti i giri comparabili e può richiedere alcuni minuti.
                La media è calcolata solo sui giri verdi comparabili (esclusi pit-out, pit-in e neutralizzazioni).
              </p>
            </>
          )}
          {running && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {progress && progress.total > 0
                  ? `Scaricamento giro ${progress.done} di ${progress.total}…`
                  : "Preparazione…"}
              </span>
              <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={handleCancel}>
                Annulla
              </Button>
            </div>
          )}
          {avg && !running && (
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span>
                Media su {avg.laps_used}/{avg.laps_total_comparable} giri verdi comparabili.
              </span>
              {(avg.low_sample || avg.aborted) && (
                <Badge variant="outline" className="text-[9px] py-0 px-1.5">
                  {avg.aborted ? "annullato — parziale" : "campione ridotto — indicativo"}
                </Badge>
              )}
              <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={handleCompute}>
                Ricalcola
              </Button>
            </div>
          )}
        </div>
      )}

      {avg && canCompareAvg && avg.per_lap.length > 0 && (() => {
        const driverDev = driverCumulativeDeviation ?? null;
        const lapNumbersUnion = new Set<number>();
        avg.per_lap.forEach((p) => lapNumbersUnion.add(p.lap_number));
        driverDev?.forEach((p) => lapNumbersUnion.add(p.lap_number));
        const allLaps = Array.from(lapNumbersUnion).sort((a, b) => a - b);
        if (!allLaps.length) return null;
        const xMin = allLaps[0];
        const xMax = allLaps[allLaps.length - 1];

        // Data A: driving series — gaps stay as undefined values so bars show absence naturally.
        const perLapByNum = new Map(avg.per_lap.map((p) => [p.lap_number, p]));
        const dataA = allLaps.map((n) => {
          const p = perLapByNum.get(n);
          return {
            lap_number: n,
            superclip: p ? p.superclip_duration : null,
            liftcoast: p ? p.liftcoast_duration : null,
          };
        });

        // Data B: cumulative deviation — null where missing, connectNulls=false.
        const devByNum = new Map((driverDev ?? []).map((d) => [d.lap_number, d]));
        const dataB = allLaps.map((n) => {
          const d = devByNum.get(n);
          return {
            lap_number: n,
            cumulative_delta: d ? d.cumulative_delta : null,
          };
        });

        const indicativeBadge = (avg.low_sample || avg.aborted) ? (
          <Badge variant="outline" className="text-[9px] py-0 px-1.5 ml-2">
            {avg.aborted ? "annullato — parziale" : "campione ridotto — indicativo"}
          </Badge>
        ) : null;

        return (
          <div className="col-span-2 space-y-3">
            {/* Chart A — Superclipping & Lift & Coast per lap */}
            <div className="bg-muted/20 rounded-md p-3 border border-border/40">
              <div className="flex items-center mb-2">
                <span className="text-[11px] font-medium text-foreground">
                  Superclipping & Lift &amp; Coast per giro
                </span>
                {indicativeBadge}
                <span className="text-[10px] text-muted-foreground ml-auto">secondi per giro</span>
              </div>
              <div style={{ width: "100%", height: 180 }}>
                <ResponsiveContainer>
                  <ComposedChart data={dataA} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis
                      dataKey="lap_number"
                      type="number"
                      domain={[xMin, xMax]}
                      allowDecimals={false}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={10}
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 11,
                      }}
                      formatter={(value: number | string | null, name: string) =>
                        value == null ? ["—", name] : [`${Number(value).toFixed(2)}s`, name]
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
                  <span className="text-[10px] text-muted-foreground ml-auto">secondi</span>
                </div>
                <div style={{ width: "100%", height: 160 }}>
                  <ResponsiveContainer>
                    <LineChart data={dataB} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis
                        dataKey="lap_number"
                        type="number"
                        domain={[xMin, xMax]}
                        allowDecimals={false}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={10}
                      />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
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
              I due grafici sono allineati sullo stesso asse dei giri per evidenziare <em>coincidenze</em>{" "}
              temporali. Un giro con molto lift &amp; coast o superclipping che coincide con un aumento del
              distacco NON implica necessariamente un nesso causale: il lift &amp; coast può essere una scelta
              di gestione (carburante, gomme, freni) e il distacco può dipendere da traffico, neutralizzazioni
              o strategia. Usa il confronto come spunto di esplorazione, non come prova.
            </p>
          </div>
        );
      })()}
    </div>
  );
}

// Helper to extract zones for TrackMap usage
export function computeDriverZones(carData: CarData[], driverNumber: number, color: string): DriverZones {
  const zones = computeZones(carData);
  return {
    driverNumber,
    color,
    zones: [
      ...zones.superclipping.dates.map((date) => ({ date, type: "superclipping" as const })),
      ...zones.liftcoast.dates.map((date) => ({ date, type: "liftcoast" as const })),
    ],
  };
}
