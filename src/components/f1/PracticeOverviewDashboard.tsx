import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
  Legend,
} from "recharts";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Timer,
  TrendingUp,
  Activity,
  Layers,
  Gauge,
  Info,
} from "lucide-react";
import type { Lap, StintData, WeatherData } from "@/lib/openf1";
import type { LongRunResult } from "@/lib/longRunDetector";
import type { DegradationResult } from "@/lib/tyreDegradation";

interface Props {
  driverAcronym: string;
  driverColor: string;
  laps: Lap[];
  stints: StintData[];
  longRuns: LongRunResult[];
  degradationResults: DegradationResult[];
  sessionWeather: WeatherData[];
}

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: "#ef4444",
  MEDIUM: "#eab308",
  HARD: "#e5e7eb",
  INTERMEDIATE: "#22c55e",
  WET: "#3b82f6",
};

function compoundColor(c?: string | null): string {
  if (!c) return "#94a3b8";
  return COMPOUND_COLORS[c.toUpperCase()] ?? "#94a3b8";
}

function fmtTime(s: number | null | undefined): string {
  if (s == null || !isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return m > 0 ? `${m}:${rem.toFixed(3).padStart(6, "0")}` : rem.toFixed(3);
}

function fmtDelta(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "—";
  const sign = s >= 0 ? "+" : "−";
  return `${sign}${Math.abs(s).toFixed(3)}s`;
}

const Placeholder = ({ children = "Dati non disponibili" }: { children?: React.ReactNode }) => (
  <div className="text-xs text-muted-foreground italic">{children}</div>
);

const StatCard = ({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
}) => (
  <div className="bg-card rounded-lg border border-border p-3 flex flex-col gap-1.5">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
      {icon}
      <span>{label}</span>
    </div>
    <div
      className="font-mono tabular-nums text-xl font-semibold"
      style={accent ? { color: accent } : undefined}
    >
      {value}
    </div>
    {sub != null && (
      <div className="text-[11px] text-muted-foreground leading-tight">{sub}</div>
    )}
  </div>
);

const SectionTitle = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em]">
    {icon}
    <span>{children}</span>
  </div>
);

export function PracticeOverviewDashboard({
  driverAcronym,
  driverColor,
  laps,
  stints,
  longRuns,
  degradationResults,
  sessionWeather,
}: Props) {
  // ── valid laps (exclude null and pit-out) ──
  const validLaps = useMemo(
    () =>
      laps.filter(
        (l) =>
          typeof l.lap_duration === "number" &&
          l.lap_duration > 0 &&
          !l.is_pit_out_lap,
      ),
    [laps],
  );

  // ── PUNTO 1: best lap & theoretical best ──
  const bestLap = useMemo(() => {
    if (!validLaps.length) return null;
    return validLaps.reduce((b, l) =>
      (l.lap_duration as number) < (b.lap_duration as number) ? l : b,
    );
  }, [validLaps]);

  const bestSectors = useMemo(() => {
    const pick = (k: "duration_sector_1" | "duration_sector_2" | "duration_sector_3") => {
      let best: { v: number; lap: number } | null = null;
      for (const l of laps) {
        const v = l[k];
        if (typeof v === "number" && v > 0) {
          if (!best || v < best.v) best = { v, lap: l.lap_number };
        }
      }
      return best;
    };
    return {
      s1: pick("duration_sector_1"),
      s2: pick("duration_sector_2"),
      s3: pick("duration_sector_3"),
    };
  }, [laps]);

  const theoreticalBest = useMemo(() => {
    const { s1, s2, s3 } = bestSectors;
    if (!s1 || !s2 || !s3) return null;
    return s1.v + s2.v + s3.v;
  }, [bestSectors]);

  const timeLeft = useMemo(() => {
    if (!bestLap || bestLap.lap_duration == null || theoreticalBest == null) return null;
    return bestLap.lap_duration - theoreticalBest;
  }, [bestLap, theoreticalBest]);

  // Inferenza qualitativa "tipo di giro" del best lap (dichiarata, mai misura)
  const bestLapInference = useMemo(() => {
    if (!bestLap || validLaps.length < 3) return null;
    const idx = laps.findIndex((l) => l.lap_number === bestLap.lap_number);
    if (idx < 0) return null;
    const prev = laps[idx - 1];
    const next = laps[idx + 1];
    const isolated =
      (!prev || prev.is_pit_out_lap || (prev.lap_duration ?? 1e9) > (bestLap.lap_duration as number) * 1.05) &&
      (!next || (next.lap_duration ?? 1e9) > (bestLap.lap_duration as number) * 1.05);
    return isolated ? "possibile giro da prestazione (isolato)" : "possibile giro in sequenza regolare";
  }, [bestLap, validLaps, laps]);

  // ── sorted laps table ──
  const sortedLaps = useMemo(
    () => [...validLaps].sort((a, b) => (a.lap_duration as number) - (b.lap_duration as number)),
    [validLaps],
  );

  // ── PUNTO 2: track evolution ──
  const evolutionData = useMemo(() => {
    const sorted = [...validLaps].sort((a, b) => {
      const ta = a.date_start ? Date.parse(a.date_start) : a.lap_number;
      const tb = b.date_start ? Date.parse(b.date_start) : b.lap_number;
      return ta - tb;
    });
    let running = Infinity;
    return sorted.map((l) => {
      running = Math.min(running, l.lap_duration as number);
      return {
        lap: l.lap_number,
        lapTime: l.lap_duration as number,
        bestSoFar: running,
      };
    });
  }, [validLaps]);

  const tempByLap = useMemo(() => {
    if (!sessionWeather.length || !evolutionData.length) return new Map<number, number>();
    const weatherSorted = [...sessionWeather]
      .filter((w) => w.date && typeof w.track_temperature === "number")
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    if (!weatherSorted.length) return new Map();
    const m = new Map<number, number>();
    for (const l of validLaps) {
      if (!l.date_start) continue;
      const t = Date.parse(l.date_start);
      let nearest = weatherSorted[0];
      let nd = Math.abs(Date.parse(nearest.date) - t);
      for (const w of weatherSorted) {
        const d = Math.abs(Date.parse(w.date) - t);
        if (d < nd) {
          nd = d;
          nearest = w;
        }
      }
      m.set(l.lap_number, nearest.track_temperature as number);
    }
    return m;
  }, [sessionWeather, validLaps, evolutionData.length]);

  const evolutionChartData = useMemo(
    () =>
      evolutionData.map((d) => ({
        ...d,
        trackTemp: tempByLap.get(d.lap) ?? null,
      })),
    [evolutionData, tempByLap],
  );

  const evolutionDelta = useMemo(() => {
    if (evolutionData.length < 4) return null;
    const half = Math.floor(evolutionData.length / 2);
    const first = evolutionData.slice(0, half);
    const last = evolutionData.slice(half);
    const minF = Math.min(...first.map((d) => d.lapTime));
    const minL = Math.min(...last.map((d) => d.lapTime));
    return minL - minF; // negative = improved
  }, [evolutionData]);

  // ── PUNTO 3: dispersion per long run ──
  const validLongRuns = useMemo(
    () => longRuns.filter((lr) => lr.isValidLongRun),
    [longRuns],
  );

  const longRunStats = useMemo(() => {
    return validLongRuns.map((lr) => {
      const lrLaps = laps
        .filter(
          (l) =>
            l.lap_number >= lr.lapStartLongRun &&
            l.lap_number <= lr.lapEndLongRun &&
            typeof l.lap_duration === "number" &&
            l.lap_duration > 0,
        )
        .map((l) => l.lap_duration as number);
      if (lrLaps.length < 2) {
        return { lr, stdDev: null, cv: null };
      }
      const mean = lrLaps.reduce((a, b) => a + b, 0) / lrLaps.length;
      const variance =
        lrLaps.reduce((acc, v) => acc + (v - mean) ** 2, 0) / lrLaps.length;
      const sd = Math.sqrt(variance);
      return { lr, stdDev: sd, cv: mean > 0 ? sd / mean : null };
    });
  }, [validLongRuns, laps]);

  const bestConsistency = useMemo(() => {
    const withCv = longRunStats.filter((s) => s.cv != null);
    if (!withCv.length) return null;
    return withCv.reduce((b, s) => ((s.cv as number) < (b.cv as number) ? s : b));
  }, [longRunStats]);

  // ── PUNTO 4: compound comparison ──
  const compoundComparison = useMemo(() => {
    const byCompound = new Map<
      string,
      { laps: number; paces: number[]; slopes: number[] }
    >();
    for (const stat of longRunStats) {
      const c = stat.lr.compound;
      if (!c) continue;
      const entry = byCompound.get(c) ?? { laps: 0, paces: [], slopes: [] };
      entry.laps += stat.lr.lapsCount;
      if (typeof stat.lr.avgLapTime === "number" && stat.lr.avgLapTime > 0)
        entry.paces.push(stat.lr.avgLapTime);
      if (typeof stat.lr.degradationSlope === "number")
        entry.slopes.push(stat.lr.degradationSlope);
      byCompound.set(c, entry);
    }
    return Array.from(byCompound.entries()).map(([compound, e]) => ({
      compound,
      avgPace: e.paces.length ? e.paces.reduce((a, b) => a + b, 0) / e.paces.length : null,
      avgSlope: e.slopes.length ? e.slopes.reduce((a, b) => a + b, 0) / e.slopes.length : null,
      laps: e.laps,
    }));
  }, [longRunStats]);

  // ── PUNTO 6: top speed ──
  const topSpeed = useMemo(() => {
    const speeds = laps
      .map((l) => l.st_speed)
      .filter((s): s is number => typeof s === "number" && s > 0);
    if (!speeds.length) return null;
    const max = Math.max(...speeds);
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    return { max, avg, count: speeds.length, totalLaps: laps.length };
  }, [laps]);

  const speedSeries = useMemo(
    () =>
      laps
        .filter((l) => typeof l.st_speed === "number" && (l.st_speed as number) > 0)
        .map((l) => ({ lap: l.lap_number, speed: l.st_speed as number })),
    [laps],
  );

  const accentColor = driverColor || "#ef4444";

  return (
    <div className="space-y-4">
      <SectionTitle icon={<Gauge className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />}>
        Practice · Panoramica {driverAcronym}
      </SectionTitle>

      {/* ── Summary grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Timer className="h-3 w-3" />}
          label="Miglior giro"
          value={fmtTime(bestLap?.lap_duration ?? null)}
          sub={bestLap ? `Giro ${bestLap.lap_number}` : "—"}
          accent={accentColor}
        />
        <StatCard
          icon={<Timer className="h-3 w-3" />}
          label="Best teorico"
          value={fmtTime(theoreticalBest)}
          sub={timeLeft != null ? `Tempo lasciato: ${fmtDelta(timeLeft)}` : "—"}
        />
        <StatCard
          icon={<TrendingUp className="h-3 w-3" />}
          label="Evoluzione pista"
          value={
            evolutionDelta == null
              ? "—"
              : fmtDelta(evolutionDelta)
          }
          sub="Δ best 2ª metà vs 1ª metà sessione"
        />
        <StatCard
          icon={<Gauge className="h-3 w-3" />}
          label="Top speed"
          value={topSpeed ? `${Math.round(topSpeed.max)} km/h` : "—"}
          sub={topSpeed ? `Media trappola: ${Math.round(topSpeed.avg)} km/h` : "—"}
        />
      </div>

      {/* Second row: consistency + compound count */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Activity className="h-3 w-3" />}
          label="Consistenza long run"
          value={
            bestConsistency && bestConsistency.cv != null
              ? `${(bestConsistency.cv * 100).toFixed(2)}%`
              : "—"
          }
          sub={
            bestConsistency
              ? `${bestConsistency.lr.compound} · ${bestConsistency.lr.lapsCount} giri`
              : "Nessun long run valido"
          }
          accent={bestConsistency ? compoundColor(bestConsistency.lr.compound) : undefined}
        />
        <StatCard
          icon={<Layers className="h-3 w-3" />}
          label="Long run validi"
          value={validLongRuns.length.toString()}
          sub={`${compoundComparison.length} mescola/e`}
        />
        <StatCard
          icon={<Layers className="h-3 w-3" />}
          label="Stint totali"
          value={stints.length.toString()}
          sub={`${validLaps.length}/${laps.length} giri validi`}
        />
        <StatCard
          icon={<Info className="h-3 w-3" />}
          label="Tipo best lap"
          value={
            <span className="text-sm font-normal text-muted-foreground italic">
              {bestLapInference ?? "—"}
            </span>
          }
          sub="Inferenza qualitativa · non misura"
        />
      </div>

      {/* ── Drill-down ── */}
      <Accordion type="multiple" defaultValue={["best-lap"]} className="w-full space-y-3">
        {/* PUNTO 1 drill-down */}
        <AccordionItem
          value="best-lap"
          className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <SectionTitle icon={<Timer className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />}>
              Giro secco · Potenziale
            </SectionTitle>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-4">
            {!bestLap ? (
              <Placeholder />
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(["s1", "s2", "s3"] as const).map((k, i) => {
                    const s = bestSectors[k];
                    return (
                      <div key={k} className="bg-background/40 rounded-md border border-border p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Best Settore {i + 1}
                        </div>
                        <div className="font-mono tabular-nums text-lg">
                          {s ? s.v.toFixed(3) : "—"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {s ? `Giro ${s.lap}` : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="overflow-auto max-h-64 border border-border rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium">#</th>
                        <th className="text-left px-2 py-1.5 font-medium">Giro</th>
                        <th className="text-right px-2 py-1.5 font-medium">Tempo</th>
                        <th className="text-right px-2 py-1.5 font-medium">Δ best</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLaps.slice(0, 15).map((l, i) => (
                        <tr key={l.lap_number} className="border-t border-border/40">
                          <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-1">{l.lap_number}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {fmtTime(l.lap_duration)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                            {i === 0
                              ? "—"
                              : fmtDelta(
                                  (l.lap_duration as number) -
                                    (sortedLaps[0].lap_duration as number),
                                )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground italic">
                  L'eventuale etichetta "tipo di giro" è un'inferenza qualitativa basata
                  sui tempi adiacenti, non una misura di carburante o assetto.
                </p>
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* PUNTO 2 drill-down */}
        <AccordionItem
          value="evolution"
          className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <SectionTitle icon={<TrendingUp className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />}>
              Evoluzione pista
            </SectionTitle>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {evolutionChartData.length < 2 ? (
              <Placeholder />
            ) : (
              <>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={evolutionChartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="lap" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 10 }}
                        stroke="hsl(var(--muted-foreground))"
                        domain={["dataMin - 0.5", "dataMax + 0.5"]}
                        tickFormatter={(v) => (typeof v === "number" ? v.toFixed(1) : v)}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10 }}
                        stroke="hsl(var(--muted-foreground))"
                        hide={tempByLap.size === 0}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          fontSize: 11,
                        }}
                        formatter={(v: number | string, name) => {
                          if (typeof v !== "number") return [v, name];
                          if (name === "Track Temp °C") return [v.toFixed(1), name];
                          return [v.toFixed(3) + "s", name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="lapTime"
                        name="Giro"
                        stroke={accentColor}
                        strokeWidth={1.5}
                        dot={{ r: 2 }}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="bestSoFar"
                        name="Best progressivo"
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="4 3"
                        strokeWidth={1.2}
                        dot={false}
                        isAnimationActive={false}
                      />
                      {tempByLap.size > 0 && (
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="trackTemp"
                          name="Track Temp °C"
                          stroke="#f97316"
                          strokeWidth={1}
                          dot={false}
                          isAnimationActive={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-muted-foreground italic mt-2">
                  Tempi non normalizzati per traffico né per condizioni puntuali. La
                  track temperature deriva da rilevazioni di sessione non sincronizzate
                  giro-per-giro.
                </p>
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* PUNTO 3 drill-down */}
        <AccordionItem
          value="longruns"
          className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <SectionTitle icon={<Activity className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />}>
              Long run · consistenza e finestra di guidabilità
            </SectionTitle>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {!longRunStats.length ? (
              <Placeholder>Nessun long run valido in questa sessione.</Placeholder>
            ) : (
              <>
                <div className="overflow-auto border border-border rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium">Compound</th>
                        <th className="text-right px-2 py-1.5 font-medium">Giri</th>
                        <th className="text-right px-2 py-1.5 font-medium">Range</th>
                        <th className="text-right px-2 py-1.5 font-medium">Passo medio</th>
                        <th className="text-right px-2 py-1.5 font-medium">Degrado s/giro</th>
                        <th className="text-right px-2 py-1.5 font-medium">Disp. σ</th>
                        <th className="text-right px-2 py-1.5 font-medium">CV</th>
                        <th className="text-right px-2 py-1.5 font-medium">R²</th>
                        <th className="text-right px-2 py-1.5 font-medium">Fit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {longRunStats.map((s) => (
                        <tr key={s.lr.stintNumber} className="border-t border-border/40">
                          <td className="px-2 py-1">
                            <span
                              className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                              style={{ background: compoundColor(s.lr.compound) }}
                            />
                            {s.lr.compound}
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{s.lr.lapsCount}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                            {s.lr.lapStartLongRun}–{s.lr.lapEndLongRun}
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {fmtTime(s.lr.avgLapTime)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {s.lr.degradationSlope != null
                              ? `${s.lr.degradationSlope >= 0 ? "+" : ""}${s.lr.degradationSlope.toFixed(3)}`
                              : "—"}
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {s.stdDev != null ? s.stdDev.toFixed(3) : "—"}
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {s.cv != null ? `${(s.cv * 100).toFixed(2)}%` : "—"}
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {s.lr.rSquared != null ? s.lr.rSquared.toFixed(2) : "—"}
                          </td>
                          <td className="px-2 py-1 text-right text-muted-foreground">
                            {s.lr.fitRobustness ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground italic mt-2">
                  Dispersione e degrado descrivono finestra di guidabilità e usura, NON
                  includono correzioni carburante (dato non disponibile in OpenF1).
                </p>
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* PUNTO 4 drill-down */}
        <AccordionItem
          value="compounds"
          className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <SectionTitle icon={<Layers className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />}>
              Confronto mescole · stessa sessione
            </SectionTitle>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {compoundComparison.length === 0 ? (
              <Placeholder>Nessun long run valido per confrontare mescole.</Placeholder>
            ) : compoundComparison.length === 1 ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  Una sola mescola disponibile: confronto non possibile.
                </div>
                <div className="bg-background/40 rounded-md border border-border p-3 inline-block">
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                    style={{ background: compoundColor(compoundComparison[0].compound) }}
                  />
                  <span className="font-mono text-sm">{compoundComparison[0].compound}</span>
                  <span className="ml-3 text-xs text-muted-foreground">
                    Passo {fmtTime(compoundComparison[0].avgPace)} · Degrado{" "}
                    {compoundComparison[0].avgSlope != null
                      ? `${compoundComparison[0].avgSlope.toFixed(3)} s/giro`
                      : "—"}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={compoundComparison.map((c) => ({
                        compound: c.compound,
                        pace: c.avgPace ?? 0,
                        slope: c.avgSlope ?? 0,
                      }))}
                      margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="compound" tick={{ fontSize: 10 }} />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 10 }}
                        domain={["dataMin - 0.5", "dataMax + 0.5"]}
                        tickFormatter={(v) => (typeof v === "number" ? v.toFixed(1) : v)}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          fontSize: 11,
                        }}
                        formatter={(v: number, name) => {
                          if (name === "Passo medio") return [`${v.toFixed(3)}s`, name];
                          return [`${v.toFixed(3)} s/giro`, name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar yAxisId="left" dataKey="pace" name="Passo medio" radius={[2, 2, 0, 0]}>
                        {compoundComparison.map((c) => (
                          <Cell key={c.compound} fill={compoundColor(c.compound)} />
                        ))}
                      </Bar>
                      <Bar yAxisId="right" dataKey="slope" name="Degrado s/giro" radius={[2, 2, 0, 0]}>
                        {compoundComparison.map((c) => (
                          <Cell key={c.compound} fill={compoundColor(c.compound)} fillOpacity={0.5} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-muted-foreground italic mt-2">
                  Confronto valido solo tra long run della stessa sessione; passi
                  assoluti non comparabili tra sessioni con condizioni diverse.
                </p>
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* PUNTO 6 drill-down */}
        <AccordionItem
          value="speed"
          className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <SectionTitle icon={<Gauge className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />}>
              Velocità di punta · trappola
            </SectionTitle>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {!topSpeed || speedSeries.length < 2 ? (
              <Placeholder>
                {!topSpeed
                  ? "Dato velocità trappola non disponibile."
                  : "Dato insufficiente per la distribuzione."}
              </Placeholder>
            ) : (
              <>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={speedSeries} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="lap" tick={{ fontSize: 10 }} />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        domain={["dataMin - 5", "dataMax + 5"]}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          fontSize: 11,
                        }}
                        formatter={(v: number) => [`${Math.round(v)} km/h`, "Speed trap"]}
                      />
                      <ReferenceLine
                        y={topSpeed.avg}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="3 3"
                        label={{ value: "Media", fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      />
                      <Bar dataKey="speed" fill={accentColor} fillOpacity={0.65} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-muted-foreground italic mt-2">
                  Top speed come indicatore qualitativo indiretto del livello di carico
                  aerodinamico: NON è una misura del setup né del carburante.
                </p>
              </>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Dati provenienti dal cronometraggio e dalla telemetria di sessione OpenF1.
        OpenF1 <strong>non</strong> fornisce dati di carburante: nessuna sezione
        distingue il regime di benzina e qualunque indicazione su "tipo di giro" o
        carico aerodinamico è un'inferenza qualitativa a bassa confidenza basata su
        pattern osservabili, non una misura. I tempi non sono corretti per traffico,
        vento o evoluzione puntuale della pista.
      </p>
    </div>
  );
}
