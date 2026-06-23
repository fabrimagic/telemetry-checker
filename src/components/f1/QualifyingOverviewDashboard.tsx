import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Timer,
  Target,
  Layers,
  TrendingUp,
  Swords,
  Info,
  Gauge,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCarData } from "@/lib/openf1";
import type { CarData, Driver, Lap, SessionResult, WeatherData } from "@/lib/openf1";
import { computeZones, type DrivingZoneStats } from "@/lib/raceDrivingAverages";

// Telemetry sample enriched with cumulative distance estimated by integrating speed.
interface TelemetrySample {
  time: number;       // seconds since start of lap
  distance: number;   // meters since start of lap (estimated by ∫v dt)
  speed: number | null;
  throttle: number | null;
  brake: number | null;
  rpm: number | null;
  gear: number | null;
}

// Aligned point on the common distance grid.
interface AlignedPoint {
  distance: number;
  speed_you: number | null;
  speed_ref: number | null;
  throttle_you: number | null;
  throttle_ref: number | null;
  brake_you: number | null;
  brake_ref: number | null;
  rpm_you: number | null;
  rpm_ref: number | null;
  gear_you: number | null;
  gear_ref: number | null;
}

interface Props {
  driver: Driver;
  driverColor: string; // hex without #
  laps: Lap[];
  sessionAllLaps: Lap[];
  sessionResults: SessionResult[];
  allDrivers: Driver[];
  sessionWeather: WeatherData[];
  getColor: (driverNumber: number) => string;
  sessionKey: number;
}


// Micro-sector color codes — same semantics as SectorMiniSectors.tsx
function segmentColor(value: number | null): string {
  switch (value) {
    case 2049: return "hsl(142 70% 45%)"; // green — session best
    case 2051: return "hsl(270 80% 55%)"; // purple — overall best
    case 2064: return "hsl(210 80% 55%)"; // blue — pit/slow
    case 2048: return "hsl(45 90% 55%)";  // yellow — personal
    default:   return "hsl(220 10% 25%)"; // grey — unknown
  }
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

function isValidLap(l: Lap): boolean {
  return (
    typeof l.lap_duration === "number" &&
    l.lap_duration > 0 &&
    !l.is_pit_out_lap &&
    typeof l.duration_sector_1 === "number" &&
    typeof l.duration_sector_2 === "number" &&
    typeof l.duration_sector_3 === "number"
  );
}

function bestLapOf(laps: Lap[]): Lap | null {
  const v = laps.filter(isValidLap);
  if (!v.length) return null;
  return v.reduce((b, l) =>
    (l.lap_duration as number) < (b.lap_duration as number) ? l : b,
  );
}

const Placeholder = ({ children = "Dati non disponibili" }: { children?: React.ReactNode }) => (
  <div className="text-xs text-muted-foreground italic">{children}</div>
);

// Self-contained distance-aligned compare chart for the qualifying telemetry section.
// Renders two overlaid lines (you vs reference) on a shared distance axis (meters),
// or — when deltaFields is provided — a single delta line (a − b).
interface DistanceCompareChartProps {
  label: string;
  data: AlignedPoint[];
  fieldYou?: keyof AlignedPoint;
  fieldRef?: keyof AlignedPoint;
  deltaFields?: { a: keyof AlignedPoint; b: keyof AlignedPoint };
  youColor: string;
  refColor: string;
  youName: string;
  refName: string;
  height: number;
  unit?: string;
  yDomain?: [number, number];
  cursor: number | null;
  onCursor: (d: number | null) => void;
  showXAxis: boolean;
}

function DistanceCompareChart({
  label,
  data,
  fieldYou,
  fieldRef,
  deltaFields,
  youColor,
  refColor,
  youName,
  refName,
  height,
  unit = "",
  yDomain,
  cursor,
  onCursor,
  showXAxis,
}: DistanceCompareChartProps) {
  const series = deltaFields
    ? data.map((p) => {
        const a = p[deltaFields.a] as number | null;
        const b = p[deltaFields.b] as number | null;
        return { distance: p.distance, delta: a != null && b != null ? a - b : null };
      })
    : data;
  return (
    <div className="relative">
      <span className="absolute top-0 left-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider z-10">
        {label}
      </span>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={series}
          margin={{ top: 18, right: 12, left: 0, bottom: showXAxis ? 18 : 0 }}
          onMouseMove={(s: any) => {
            const d = s?.activePayload?.[0]?.payload?.distance;
            if (typeof d === "number") onCursor(d);
          }}
          onMouseLeave={() => onCursor(null)}
        >
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.4} vertical={false} />
          <XAxis
            dataKey="distance"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            hide={!showXAxis}
            tickFormatter={(v) => `${Math.round(v as number)}`}
            label={
              showXAxis
                ? {
                    value: "Distanza (m)",
                    position: "insideBottom",
                    offset: -4,
                    style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                  }
                : undefined
            }
          />
          <YAxis
            width={42}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            domain={yDomain ?? ["auto", "auto"]}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              fontSize: 11,
            }}
            labelFormatter={(v) => `${Math.round(v as number)} m`}
            formatter={(val: any, name: any) => {
              if (val == null || !Number.isFinite(val)) return ["—", name];
              const v = Number(val);
              return [`${v.toFixed(unit === "%" ? 0 : 1)}${unit}`, name];
            }}
          />
          {cursor != null && (
            <ReferenceLine x={cursor} stroke="hsl(0 0% 50%)" strokeDasharray="2 2" />
          )}
          {deltaFields ? (
            <Line
              type="monotone"
              dataKey="delta"
              name={youName}
              stroke={youColor}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ) : (
            <>
              <Line
                type="monotone"
                dataKey={fieldYou as string}
                name={youName}
                stroke={youColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey={fieldRef as string}
                name={refName}
                stroke={refColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </>
          )}
          {!deltaFields && <Legend wrapperStyle={{ fontSize: 10 }} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}




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

export function QualifyingOverviewDashboard({
  driver,
  driverColor,
  laps,
  sessionAllLaps,
  sessionResults,
  allDrivers,
  sessionWeather,
  getColor,
  sessionKey,
}: Props) {
  const validLaps = useMemo(() => laps.filter(isValidLap), [laps]);


  // PUNTO 1 — best real & theoretical best
  const bestLap = useMemo(() => bestLapOf(laps), [laps]);

  const bestSectors = useMemo(() => {
    if (!validLaps.length) return null;
    const pick = (key: "duration_sector_1" | "duration_sector_2" | "duration_sector_3") => {
      let best: Lap | null = null;
      for (const l of validLaps) {
        const v = l[key] as number | null;
        if (v == null || v <= 0) continue;
        if (!best || (v < (best[key] as number))) best = l;
      }
      return best;
    };
    const s1 = pick("duration_sector_1");
    const s2 = pick("duration_sector_2");
    const s3 = pick("duration_sector_3");
    return { s1, s2, s3 };
  }, [validLaps]);

  const theoreticalBest = useMemo(() => {
    if (!bestSectors) return null;
    const { s1, s2, s3 } = bestSectors;
    if (!s1 || !s2 || !s3) return null;
    return (
      (s1.duration_sector_1 as number) +
      (s2.duration_sector_2 as number) +
      (s3.duration_sector_3 as number)
    );
  }, [bestSectors]);

  const deltaIdeal =
    bestLap && theoreticalBest != null && bestLap.lap_duration != null
      ? (bestLap.lap_duration as number) - theoreticalBest
      : null;

  // PUNTO 3 — comparison selector
  const pole = useMemo(
    () => sessionResults.find((r) => r.position === 1) ?? null,
    [sessionResults],
  );
  const isSelectedPole = pole?.driver_number === driver.driver_number;

  const otherDrivers = useMemo(
    () => allDrivers.filter((d) => d.driver_number !== driver.driver_number),
    [allDrivers, driver.driver_number],
  );

  const [compareMode, setCompareMode] = useState<"pole" | "other">(
    isSelectedPole ? "other" : "pole",
  );
  const [otherDriverNum, setOtherDriverNum] = useState<number | null>(() => {
    // default: pole if available and not self, else first other driver
    if (pole && pole.driver_number !== driver.driver_number) return pole.driver_number;
    return otherDrivers[0]?.driver_number ?? null;
  });

  const referenceDriverNumber =
    compareMode === "pole" && pole && !isSelectedPole
      ? pole.driver_number
      : otherDriverNum;

  const referenceDriver = useMemo(
    () => allDrivers.find((d) => d.driver_number === referenceDriverNumber) ?? null,
    [allDrivers, referenceDriverNumber],
  );

  const referenceLap = useMemo(() => {
    if (referenceDriverNumber == null) return null;
    const refLaps = sessionAllLaps.filter((l) => l.driver_number === referenceDriverNumber);
    return bestLapOf(refLaps);
  }, [referenceDriverNumber, sessionAllLaps]);

  const sectorCompare = useMemo(() => {
    if (!bestLap || !referenceLap) return null;
    const rows = (["duration_sector_1", "duration_sector_2", "duration_sector_3"] as const).map(
      (k, i) => {
        const a = bestLap[k] as number | null;
        const b = referenceLap[k] as number | null;
        const delta = a != null && b != null ? a - b : null;
        return { label: `S${i + 1}`, you: a, ref: b, delta };
      },
    );
    const totalYou = bestLap.lap_duration as number;
    const totalRef = referenceLap.lap_duration as number;
    const totalDelta =
      typeof totalYou === "number" && typeof totalRef === "number"
        ? totalYou - totalRef
        : null;
    return { rows, totalYou, totalRef, totalDelta };
  }, [bestLap, referenceLap]);

  // PUNTO 4 — track evolution
  const evolutionData = useMemo(() => {
    const sorted = [...validLaps].sort((a, b) => {
      const da = a.date_start ? new Date(a.date_start).getTime() : a.lap_number;
      const db = b.date_start ? new Date(b.date_start).getTime() : b.lap_number;
      return da - db;
    });
    let best = Infinity;
    return sorted.map((l, idx) => {
      const t = l.lap_duration as number;
      if (t < best) best = t;
      // pick closest track_temperature snapshot if present
      let trackTemp: number | null = null;
      if (sessionWeather.length && l.date_start) {
        const lapTs = new Date(l.date_start).getTime();
        let closest: WeatherData | null = null;
        let closestDelta = Infinity;
        for (const w of sessionWeather) {
          if (!w.date) continue;
          const wt = new Date(w.date).getTime();
          const d = Math.abs(wt - lapTs);
          if (d < closestDelta) {
            closestDelta = d;
            closest = w;
          }
        }
        if (closest && typeof closest.track_temperature === "number") {
          trackTemp = closest.track_temperature;
        }
      }
      return {
        idx: idx + 1,
        lap: l.lap_number,
        time: t,
        cumBest: best,
        trackTemp,
      };
    });
  }, [validLaps, sessionWeather]);

  const evolutionDelta = useMemo(() => {
    if (evolutionData.length < 2) return null;
    const firstHalf = evolutionData.slice(0, Math.ceil(evolutionData.length / 2));
    const secondHalf = evolutionData.slice(Math.ceil(evolutionData.length / 2));
    const minA = Math.min(...firstHalf.map((d) => d.time));
    const minB = Math.min(...secondHalf.map((d) => d.time));
    return minB - minA; // negative = improved
  }, [evolutionData]);


  // ── Telemetry compare (Punto 3b — on-demand fetch, distance-aligned) ──
  type TeleState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        you: TelemetrySample[];
        ref: TelemetrySample[];
        youZones: DrivingZoneStats;
        refZones: DrivingZoneStats;
      };
  const [teleState, setTeleState] = useState<TeleState>({ status: "idle" });
  const [cursorDistance, setCursorDistance] = useState<number | null>(null);

  // Reset when the laps to compare change.
  useEffect(() => {
    setTeleState({ status: "idle" });
    setCursorDistance(null);
  }, [bestLap?.date_start, referenceLap?.date_start, referenceDriverNumber]);

  // Map raw CarData[] → TelemetrySample[] with cumulative distance estimated by
  // trapezoidal integration of speed (km/h → m/s). OpenF1 does not provide a
  // direct distance channel: this is an estimate.
  const mapToSamples = (car: CarData[]): TelemetrySample[] => {
    if (!car.length) return [];
    const t0 = new Date(car[0].date).getTime();
    let prevT: number | null = null;
    let prevSpeedMs: number | null = null;
    let distance = 0;
    const out: TelemetrySample[] = [];
    for (const c of car) {
      const ts = new Date(c.date).getTime();
      if (!Number.isFinite(ts)) continue;
      const tSec = (ts - t0) / 1000;
      const speed = typeof c.speed === "number" && Number.isFinite(c.speed) ? c.speed : null;
      const speedMs = speed != null ? speed / 3.6 : null;

      if (prevT != null) {
        let dt = tSec - prevT;
        if (!Number.isFinite(dt) || dt <= 0) dt = 0;
        if (dt > 0 && speedMs != null) {
          const vAvg = prevSpeedMs != null ? (prevSpeedMs + speedMs) / 2 : speedMs;
          distance += vAvg * dt;
        }
      }
      out.push({
        time: tSec,
        distance,
        speed,
        throttle: typeof c.throttle === "number" ? c.throttle : null,
        brake: typeof c.brake === "number" ? c.brake : null,
        rpm: typeof c.rpm === "number" ? c.rpm : null,
        gear: typeof c.n_gear === "number" ? c.n_gear : null,
      });
      prevT = tSec;
      if (speedMs != null) prevSpeedMs = speedMs;
    }
    return out;
  };

  const loadTelemetry = async () => {
    if (!bestLap || !referenceLap || !referenceDriver) return;
    setTeleState({ status: "loading" });
    try {
      const ownStart = bestLap.date_start!;
      const ownEnd = new Date(
        new Date(ownStart).getTime() + (bestLap.lap_duration as number) * 1000,
      ).toISOString();
      const refStart = referenceLap.date_start!;
      const refEnd = new Date(
        new Date(refStart).getTime() + (referenceLap.lap_duration as number) * 1000,
      ).toISOString();
      // Sequential fetch to respect the openf1 client rate limiter.
      const ownCar = await getCarData(sessionKey, driver.driver_number, ownStart, ownEnd);
      const refCar = await getCarData(sessionKey, referenceDriver.driver_number, refStart, refEnd);
      const you = mapToSamples(ownCar);
      const ref = mapToSamples(refCar);
      if (you.length < 2 || ref.length < 2) {
        setTeleState({ status: "error", message: "Telemetria non disponibile per questi giri." });
        return;
      }
      const youZones = computeZones(ownCar);
      const refZones = computeZones(refCar);
      setTeleState({ status: "ready", you, ref, youZones, refZones });
    } catch {
      setTeleState({ status: "error", message: "Errore nel caricamento della telemetria." });
    }
  };

  // Interpolate a single channel value at a given distance over a monotone-in-distance series.
  const interpolateAt = (
    samples: TelemetrySample[],
    distance: number,
    field: keyof Pick<TelemetrySample, "speed" | "throttle" | "brake" | "rpm" | "gear">,
  ): number | null => {
    if (!samples.length) return null;
    // Binary search for the right bracket.
    let lo = 0, hi = samples.length - 1;
    if (distance <= samples[0].distance) return samples[0][field];
    if (distance >= samples[hi].distance) return samples[hi][field];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].distance <= distance) lo = mid;
      else hi = mid;
    }
    const a = samples[lo], b = samples[hi];
    const va = a[field], vb = b[field];
    if (va == null && vb == null) return null;
    if (va == null) return vb;
    if (vb == null) return va;
    const span = b.distance - a.distance;
    if (span <= 0) return va;
    const t = (distance - a.distance) / span;
    // Gear is integer-like; snap to nearest to avoid fractional gears.
    if (field === "gear") return t < 0.5 ? va : vb;
    return va + (vb - va) * t;
  };

  // Interpolate the lap TIME (seconds since lap start) at a given cumulative distance.
  // Same linear-interpolation / binary-search scheme as interpolateAt, applied to the
  // monotone-in-distance series of TelemetrySample.time.
  const interpolateTimeAt = (samples: TelemetrySample[], distance: number): number | null => {
    if (!samples.length) return null;
    let lo = 0, hi = samples.length - 1;
    if (distance <= samples[0].distance) return samples[0].time;
    if (distance >= samples[hi].distance) return samples[hi].time;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].distance <= distance) lo = mid;
      else hi = mid;
    }
    const a = samples[lo], b = samples[hi];
    const span = b.distance - a.distance;
    if (span <= 0) return a.time;
    const t = (distance - a.distance) / span;
    return a.time + (b.time - a.time) * t;
  };

  // Build the distance-aligned dataset on a common grid (500 points, capped at min lap distance).
  const alignedData: AlignedPoint[] = useMemo(() => {
    if (teleState.status !== "ready") return [];
    const youMax = teleState.you[teleState.you.length - 1].distance;
    const refMax = teleState.ref[teleState.ref.length - 1].distance;
    const maxD = Math.min(youMax, refMax);
    if (!Number.isFinite(maxD) || maxD <= 0) return [];
    const N = 500;
    const out: AlignedPoint[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const d = (maxD * i) / (N - 1);
      out[i] = {
        distance: d,
        speed_you: interpolateAt(teleState.you, d, "speed"),
        speed_ref: interpolateAt(teleState.ref, d, "speed"),
        throttle_you: interpolateAt(teleState.you, d, "throttle"),
        throttle_ref: interpolateAt(teleState.ref, d, "throttle"),
        brake_you: interpolateAt(teleState.you, d, "brake"),
        brake_ref: interpolateAt(teleState.ref, d, "brake"),
        rpm_you: interpolateAt(teleState.you, d, "rpm"),
        rpm_ref: interpolateAt(teleState.ref, d, "rpm"),
        gear_you: interpolateAt(teleState.you, d, "gear"),
        gear_ref: interpolateAt(teleState.ref, d, "gear"),
      };
    }
    return out;
  }, [teleState]);

  // Delta-time per distance: time_you(d) − time_ref(d). Negative ⇒ selected driver ahead.
  // Same distance grid as alignedData so the cursor stays coordinated across charts.
  const deltaTimeData = useMemo(() => {
    if (teleState.status !== "ready" || alignedData.length === 0) return [];
    return alignedData.map((p) => {
      const ty = interpolateTimeAt(teleState.you, p.distance);
      const tr = interpolateTimeAt(teleState.ref, p.distance);
      const dt = ty != null && tr != null ? ty - tr : null;
      return { distance: p.distance, dt };
    });
  }, [teleState, alignedData]);

  const refColorHex = referenceDriver ? `#${getColor(referenceDriver.driver_number)}` : "#888";
  const youColorHex = `#${driverColor}`;
  const youAcr = driver.name_acronym;
  const refAcr = referenceDriver?.name_acronym ?? "REF";



  // ── Render ──
  const accent = `#${driverColor}`;



  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4" style={{ color: accent }} />
        <h3 className="text-[11px] font-black uppercase tracking-[0.22em]">
          Qualifica · Dashboard ingegneristica
        </h3>
        <span className="text-[10px] text-muted-foreground">· {driver.name_acronym}</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Timer className="h-3 w-3" />}
          label="Miglior giro"
          value={fmtTime(bestLap?.lap_duration ?? null)}
          sub={bestLap ? `Giro #${bestLap.lap_number}` : "Nessun giro valido"}
          accent={accent}
        />
        <StatCard
          icon={<Target className="h-3 w-3" />}
          label="Giro ideale"
          value={fmtTime(theoreticalBest)}
          sub="Somma dei migliori settori"
        />
        <StatCard
          icon={<Layers className="h-3 w-3" />}
          label="Margine ideale"
          value={deltaIdeal != null ? fmtDelta(deltaIdeal) : "—"}
          sub="Tempo lasciato sul tavolo"
        />
        <StatCard
          icon={<TrendingUp className="h-3 w-3" />}
          label="Evoluzione pista"
          value={evolutionDelta != null ? fmtDelta(evolutionDelta) : "—"}
          sub="Delta tra 1ª e 2ª metà sessione"
        />
      </div>

      {/* Accordion drill-down */}
      <Accordion type="multiple" defaultValue={["ideal"]} className="w-full space-y-3">
        {/* PUNTO 1 — Giro ideale vs reale */}
        <AccordionItem
          value="ideal"
          className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" style={{ color: accent }} />
              <span className="text-[11px] font-black uppercase tracking-[0.22em]">
                Giro ideale vs reale
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-3">
            {!bestLap || !bestSectors ? (
              <Placeholder />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground text-left">
                      <th className="py-1.5 pr-2 font-medium">Settore</th>
                      <th className="py-1.5 pr-2 font-medium">Miglior tempo</th>
                      <th className="py-1.5 pr-2 font-medium">Giro</th>
                      <th className="py-1.5 pr-2 font-medium">Nel miglior giro</th>
                      <th className="py-1.5 pr-2 font-medium">Delta</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {(["s1", "s2", "s3"] as const).map((k, i) => {
                      const sectorLap = bestSectors[k];
                      const key = (`duration_sector_${i + 1}`) as
                        | "duration_sector_1"
                        | "duration_sector_2"
                        | "duration_sector_3";
                      const bestSec = sectorLap ? (sectorLap[key] as number) : null;
                      const inBest = bestLap[key] as number | null;
                      const delta =
                        bestSec != null && inBest != null ? inBest - bestSec : null;
                      return (
                        <tr key={k} className="border-t border-border/40">
                          <td className="py-1.5 pr-2 text-muted-foreground">S{i + 1}</td>
                          <td className="py-1.5 pr-2">{fmtTime(bestSec)}</td>
                          <td className="py-1.5 pr-2 text-muted-foreground">
                            {sectorLap ? `#${sectorLap.lap_number}` : "—"}
                          </td>
                          <td className="py-1.5 pr-2">{fmtTime(inBest)}</td>
                          <td
                            className="py-1.5 pr-2"
                            style={{
                              color:
                                delta == null
                                  ? undefined
                                  : delta <= 0.001
                                  ? "hsl(142 70% 45%)"
                                  : "hsl(45 90% 55%)",
                            }}
                          >
                            {delta != null ? fmtDelta(delta) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-border/60 font-semibold">
                      <td className="py-1.5 pr-2">Totale</td>
                      <td className="py-1.5 pr-2">{fmtTime(theoreticalBest)}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground">ideale</td>
                      <td className="py-1.5 pr-2">{fmtTime(bestLap.lap_duration)}</td>
                      <td
                        className="py-1.5 pr-2"
                        style={{ color: "hsl(45 90% 55%)" }}
                      >
                        {deltaIdeal != null ? fmtDelta(deltaIdeal) : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* PUNTO 2 — Micro-settori */}
        <AccordionItem
          value="microsectors"
          className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4" style={{ color: accent }} />
              <span className="text-[11px] font-black uppercase tracking-[0.22em]">
                Micro-settori del miglior giro
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-3">
            {!bestLap ? (
              <Placeholder />
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(
                    [
                      { label: "S1", segs: (bestLap as any).segments_sector_1 as (number | null)[] | undefined, time: bestLap.duration_sector_1 },
                      { label: "S2", segs: (bestLap as any).segments_sector_2 as (number | null)[] | undefined, time: bestLap.duration_sector_2 },
                      { label: "S3", segs: (bestLap as any).segments_sector_3 as (number | null)[] | undefined, time: bestLap.duration_sector_3 },
                    ]
                  ).map((s) => (
                    <div key={s.label} className="bg-muted/30 rounded-md p-2.5">
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {s.label}
                        </span>
                        <span className="text-xs font-mono tabular-nums font-semibold">
                          {fmtTime(s.time)}
                        </span>
                      </div>
                      {s.segs && s.segs.length ? (
                        <div className="flex gap-[2px]">
                          {s.segs.map((v, i) => (
                            <div
                              key={i}
                              className="h-3 flex-1 rounded-[2px]"
                              style={{ backgroundColor: segmentColor(v) }}
                              title={`Micro-settore ${i + 1}`}
                            />
                          ))}
                        </div>
                      ) : (
                        <Placeholder>Micro-settori non disponibili</Placeholder>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3 pt-1">
                  {[
                    { c: "hsl(270 80% 55%)", l: "Miglior assoluto" },
                    { c: "hsl(142 70% 45%)", l: "Miglior di sessione" },
                    { c: "hsl(45 90% 55%)", l: "Personale" },
                    { c: "hsl(210 80% 55%)", l: "Pit / lento" },
                    { c: "hsl(220 10% 25%)", l: "N/D" },
                  ].map((it) => (
                    <span key={it.l} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: it.c }} />
                      {it.l}
                    </span>
                  ))}
                </div>
                <div className="text-[10px] text-muted-foreground leading-snug flex gap-1.5">
                  <Info className="h-3 w-3 flex-shrink-0 mt-px" />
                  <span>
                    I micro-settori OpenF1 sono codici di stato/colore, non tempi cronometrati.
                    Indicano la qualità relativa del tratto (viola/verde = forte, giallo/grigio = margine),
                    non un delta in secondi.
                  </span>
                </div>
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* PUNTO 3 — Confronto */}
        <AccordionItem
          value="compare"
          className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <Swords className="h-4 w-4" style={{ color: accent }} />
              <span className="text-[11px] font-black uppercase tracking-[0.22em]">
                Confronto giro di riferimento
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Tabs
                value={compareMode}
                onValueChange={(v) => setCompareMode(v as "pole" | "other")}
              >
                <TabsList className="h-8">
                  {!isSelectedPole && pole && (
                    <TabsTrigger value="pole" className="text-[10px] uppercase tracking-wider">
                      Pole
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="other" className="text-[10px] uppercase tracking-wider">
                    Altro pilota
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {compareMode === "other" && otherDrivers.length > 0 && (
                <Select
                  value={otherDriverNum != null ? String(otherDriverNum) : ""}
                  onValueChange={(v) => setOtherDriverNum(Number(v))}
                >
                  <SelectTrigger className="h-8 w-[200px] text-xs">
                    <SelectValue placeholder="Seleziona pilota" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherDrivers.map((d) => (
                      <SelectItem key={d.driver_number} value={String(d.driver_number)}>
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ backgroundColor: `#${getColor(d.driver_number)}` }}
                          />
                          <span className="font-mono">{d.name_acronym}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {isSelectedPole && (
                <span className="text-[10px] text-muted-foreground italic">
                  Pilota selezionato è il poleman: confronto con un altro pilota.
                </span>
              )}
            </div>

            {!bestLap ? (
              <Placeholder>Miglior giro del pilota non disponibile.</Placeholder>
            ) : !referenceLap || !referenceDriver || !sectorCompare ? (
              <Placeholder>Miglior giro valido del riferimento non disponibile.</Placeholder>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground text-left">
                      <th className="py-1.5 pr-2 font-medium">Settore</th>
                      <th className="py-1.5 pr-2 font-medium font-mono">
                        {driver.name_acronym}
                      </th>
                      <th className="py-1.5 pr-2 font-medium font-mono">
                        {referenceDriver.name_acronym}
                      </th>
                      <th className="py-1.5 pr-2 font-medium">Delta</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {sectorCompare.rows.map((r) => {
                      const faster =
                        r.delta == null ? null : r.delta < 0 ? "you" : r.delta > 0 ? "ref" : null;
                      const color =
                        faster === "you"
                          ? `#${driverColor}`
                          : faster === "ref"
                          ? `#${getColor(referenceDriver.driver_number)}`
                          : undefined;
                      return (
                        <tr key={r.label} className="border-t border-border/40">
                          <td className="py-1.5 pr-2 text-muted-foreground">{r.label}</td>
                          <td className="py-1.5 pr-2">{fmtTime(r.you)}</td>
                          <td className="py-1.5 pr-2">{fmtTime(r.ref)}</td>
                          <td className="py-1.5 pr-2" style={{ color }}>
                            {r.delta != null ? fmtDelta(r.delta) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-border/60 font-semibold">
                      <td className="py-1.5 pr-2">Totale</td>
                      <td className="py-1.5 pr-2">{fmtTime(sectorCompare.totalYou)}</td>
                      <td className="py-1.5 pr-2">{fmtTime(sectorCompare.totalRef)}</td>
                      <td
                        className="py-1.5 pr-2"
                        style={{
                          color:
                            sectorCompare.totalDelta == null
                              ? undefined
                              : sectorCompare.totalDelta < 0
                              ? `#${driverColor}`
                              : `#${getColor(referenceDriver.driver_number)}`,
                        }}
                      >
                        {sectorCompare.totalDelta != null
                          ? fmtDelta(sectorCompare.totalDelta)
                          : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="text-[10px] text-muted-foreground mt-2">
                  Riferimento: miglior giro valido della sessione di {referenceDriver.name_acronym}.
                </div>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* PUNTO 3b — Confronto telemetria */}
        <AccordionItem
          value="telemetry"
          className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" style={{ color: accent }} />
              <span className="text-[11px] font-black uppercase tracking-[0.22em]">
                Confronto telemetria miglior giro
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={loadTelemetry}
                disabled={
                  !bestLap ||
                  !referenceLap ||
                  !referenceDriver ||
                  teleState.status === "loading"
                }
              >
                {teleState.status === "loading"
                  ? "Caricamento…"
                  : teleState.status === "ready"
                  ? "Ricarica telemetria"
                  : "Carica confronto telemetria"}
              </Button>
              {referenceDriver && bestLap && referenceLap && (
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: `#${driverColor}` }}
                    />
                    <span className="font-mono">{driver.name_acronym}</span>
                    <span>(selezionato)</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: `#${getColor(referenceDriver.driver_number)}` }}
                    />
                    <span className="font-mono">{referenceDriver.name_acronym}</span>
                    <span>
                      ({compareMode === "pole" ? "pole" : "riferimento"})
                    </span>
                  </span>
                </div>
              )}
            </div>

            {!bestLap ? (
              <Placeholder>Miglior giro del pilota non disponibile.</Placeholder>
            ) : !referenceLap || !referenceDriver ? (
              <Placeholder>Giro di riferimento non disponibile.</Placeholder>
            ) : teleState.status === "idle" ? (
              <div className="text-[11px] text-muted-foreground">
                La telemetria viene scaricata solo su richiesta per non sovraccaricare le API.
                Premi il pulsante per caricare il confronto tra i due migliori giri.
              </div>
            ) : teleState.status === "loading" ? (
              <div className="text-[11px] text-muted-foreground">Caricamento telemetria…</div>
            ) : teleState.status === "error" ? (
              <Placeholder>{teleState.message}</Placeholder>
            ) : alignedData.length === 0 ? (
              <Placeholder>Telemetria non sufficiente per costruire l'asse distanza.</Placeholder>
            ) : (
              <>
                <DistanceCompareChart
                  label="Velocità (km/h)"
                  data={alignedData}
                  fieldYou="speed_you"
                  fieldRef="speed_ref"
                  youColor={youColorHex}
                  refColor={refColorHex}
                  youName={youAcr}
                  refName={refAcr}
                  height={180}
                  unit=" km/h"
                  cursor={cursorDistance}
                  onCursor={setCursorDistance}
                  showXAxis={false}
                />
                <DistanceCompareChart
                  label="Delta velocità (selezionato − riferimento)"
                  data={alignedData}
                  deltaFields={{ a: "speed_you", b: "speed_ref" }}
                  youColor={youColorHex}
                  refColor={refColorHex}
                  youName={`${youAcr} − ${refAcr}`}
                  refName=""
                  height={120}
                  unit=" km/h"
                  cursor={cursorDistance}
                  onCursor={setCursorDistance}
                  showXAxis={false}
                />
                <DistanceCompareChart
                  label="Gas (%)"
                  data={alignedData}
                  fieldYou="throttle_you"
                  fieldRef="throttle_ref"
                  youColor={youColorHex}
                  refColor={refColorHex}
                  youName={youAcr}
                  refName={refAcr}
                  height={110}
                  unit="%"
                  yDomain={[0, 100]}
                  cursor={cursorDistance}
                  onCursor={setCursorDistance}
                  showXAxis={false}
                />
                <DistanceCompareChart
                  label="Freno (%)"
                  data={alignedData}
                  fieldYou="brake_you"
                  fieldRef="brake_ref"
                  youColor={youColorHex}
                  refColor={refColorHex}
                  youName={youAcr}
                  refName={refAcr}
                  height={90}
                  unit="%"
                  yDomain={[0, 100]}
                  cursor={cursorDistance}
                  onCursor={setCursorDistance}
                  showXAxis={true}
                />
                <div className="text-[10px] text-muted-foreground leading-snug flex gap-1.5">
                  <Info className="h-3 w-3 flex-shrink-0 mt-px" />
                  <span>
                    I due tracciati sono allineati sulla <strong>distanza percorsa in pista</strong> (posizione lungo il giro),
                    così da confrontare i piloti nello stesso punto del tracciato. La distanza è <strong>stimata</strong>{" "}
                    integrando la velocità nel tempo (OpenF1 non fornisce un canale distanza diretto), quindi è soggetta a
                    piccole imprecisioni dovute al campionamento. L'allineamento è limitato alla porzione di giro coperta
                    da entrambi i tracciati.
                  </span>
                </div>
              </>
            )}
          </AccordionContent>
        </AccordionItem>


        {/* PUNTO 4 — Track evolution */}
        <AccordionItem
          value="evolution"
          className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" style={{ color: accent }} />
              <span className="text-[11px] font-black uppercase tracking-[0.22em]">
                Evoluzione pista
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-3">
            {evolutionData.length < 2 ? (
              <Placeholder>Servono almeno 2 giri validi.</Placeholder>
            ) : (
              <>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={evolutionData} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.4} />
                      <XAxis
                        dataKey="idx"
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fontSize: 10 }}
                        label={{
                          value: "Tentativo",
                          position: "insideBottom",
                          offset: -2,
                          style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                        }}
                      />
                      <YAxis
                        yAxisId="time"
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fontSize: 10 }}
                        domain={["dataMin - 0.3", "dataMax + 0.3"]}
                        tickFormatter={(v) => fmtTime(v as number)}
                      />
                      <YAxis
                        yAxisId="temp"
                        orientation="right"
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => `${(v as number).toFixed(0)}°`}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          fontSize: 11,
                        }}
                        formatter={(val: any, name: any) => {
                          if (name === "Track °C") return [`${Number(val).toFixed(1)}°C`, name];
                          return [fmtTime(Number(val)), name];
                        }}
                        labelFormatter={(l) => `Tentativo ${l}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line
                        yAxisId="time"
                        type="monotone"
                        dataKey="time"
                        name="Tempo giro"
                        stroke={accent}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                      />
                      <Line
                        yAxisId="time"
                        type="monotone"
                        dataKey="cumBest"
                        name="Miglior cumulativo"
                        stroke="hsl(142 70% 45%)"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        dot={false}
                      />
                      {evolutionData.some((d) => d.trackTemp != null) && (
                        <Line
                          yAxisId="temp"
                          type="monotone"
                          dataKey="trackTemp"
                          name="Track °C"
                          stroke="hsl(25 80% 55%)"
                          strokeWidth={1.25}
                          dot={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-[10px] text-muted-foreground leading-snug flex gap-1.5">
                  <Info className="h-3 w-3 flex-shrink-0 mt-px" />
                  <span>
                    I tempi non sono normalizzati per traffico, vento o condizioni puntuali; la temperatura pista
                    proviene da rilevazioni di sessione non sincronizzate giro per giro.
                  </span>
                </div>
              </>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Global transparency notes */}
      <div className="text-[10px] text-muted-foreground leading-snug">
        Dati da cronometraggio e telemetria di sessione OpenF1. Tempi sul giro e di settore sono cronometrici reali;
        i micro-settori sono indicatori di stato/colore e non tempi. OpenF1 non fornisce dati di carburante o peso vettura,
        quindi nessuna sezione li considera. I tempi non sono corretti per traffico, vento o evoluzione puntuale della pista.
      </div>
    </div>
  );
}
