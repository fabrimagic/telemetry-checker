import { useMemo, useState, useCallback } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Info, ChevronDown } from "lucide-react";
import type { StintData, WeatherData, Lap, RaceControlMessage } from "@/lib/openf1";
import { classifyLapsWeather, type WeatherCondition } from "@/lib/weatherClassification";
import { classifyLapsTrackStatus, type TrackStatus } from "@/lib/trackStatusClassification";
import { Watermark } from "./Watermark";

interface DriverLapTimes {
  driverNumber: number;
  acronym: string;
  color: string;
  laps: { lap_number: number; lap_duration: number | null; date_start?: string | null }[];
  stints?: StintData[];
}

interface Props {
  drivers: DriverLapTimes[];
  sessionWeather?: WeatherData[];
  raceControlMessages?: RaceControlMessage[];
  selectedLaps?: { driverNumber: number; lapNumber: number | null }[];
  onSelectLap?: (driverNumber: number, lapNumber: number) => void;
}

const GRID_STROKE = "hsl(220 14% 16%)";
const AXIS_TICK = { fill: "hsl(215 12% 45%)", fontSize: 10 };
const OUTLIER_THRESHOLD = 0.07;

const compoundColors: Record<string, string> = {
  SOFT: "#e53935",
  MEDIUM: "#f9a825",
  HARD: "#bdbdbd",
  INTERMEDIATE: "#43a047",
  WET: "#1e88e5",
};

const weatherBandColors: Record<WeatherCondition, string> = {
  DRY: "transparent",
  WET: "hsla(210, 80%, 50%, 0.12)",
  MIXED: "hsla(35, 90%, 55%, 0.10)",
};

const trackStatusColors: Record<TrackStatus, string> = {
  GREEN: "transparent",
  YELLOW: "hsla(50, 100%, 50%, 0.15)",
  DOUBLE_YELLOW: "hsla(50, 100%, 50%, 0.25)",
  VSC: "hsla(270, 70%, 55%, 0.15)",
  SC: "hsla(30, 90%, 50%, 0.18)",
  RED: "hsla(0, 85%, 50%, 0.18)",
  MIXED: "hsla(0, 0%, 50%, 0.12)",
};

const trackStatusLabels: Record<TrackStatus, { icon: string; label: string; description: string }> = {
  GREEN: { icon: "🟢", label: "Green", description: "Condizioni normali, pista libera" },
  YELLOW: { icon: "🟡", label: "Yellow Flag", description: "Bandiera gialla — pericolo in pista, ridurre velocità" },
  DOUBLE_YELLOW: { icon: "🟡🟡", label: "Double Yellow", description: "Doppia bandiera gialla — pericolo grave, essere pronti a fermarsi" },
  VSC: { icon: "🟣", label: "Virtual Safety Car", description: "VSC attiva — rispettare il delta time imposto" },
  SC: { icon: "🟠", label: "Safety Car", description: "Safety Car in pista — seguire la Safety Car" },
  RED: { icon: "🔴", label: "Red Flag", description: "Bandiera rossa — sessione interrotta" },
  MIXED: { icon: "⚪", label: "Mixed", description: "Più condizioni durante il giro" },
};

function formatLapTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const sWhole = Math.floor(s);
  const ms = Math.round((s - sWhole) * 1000);
  return `${m}:${sWhole.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

export function LapTimesChart({ drivers, sessionWeather, raceControlMessages, selectedLaps, onSelectLap }: Props) {
  const [showOutliers, setShowOutliers] = useState(false);

  // Build compound lookup: driverNumber -> lapNumber -> compound
  const compoundMap = useMemo(() => {
    const map = new Map<number, Map<number, string>>();
    for (const d of drivers) {
      if (!d.stints?.length) continue;
      const lapMap = new Map<number, string>();
      for (const stint of d.stints) {
        for (let lap = stint.lap_start; lap <= stint.lap_end; lap++) {
          lapMap.set(lap, stint.compound);
        }
      }
      map.set(d.driverNumber, lapMap);
    }
    return map;
  }, [drivers]);

  // Build weather classification per lap using first driver's lap data (all drivers share same weather)
  const weatherMap = useMemo(() => {
    if (!sessionWeather?.length || !drivers.length) return new Map<number, WeatherCondition>();
    // Use the first driver that has laps with date_start
    const refDriver = drivers.find((d) => d.laps.some((l) => l.date_start));
    if (!refDriver) return new Map<number, WeatherCondition>();
    // Cast laps to the format expected by classifyLapsWeather
    const lapsWithDates = refDriver.laps.filter((l) => l.date_start) as any as import("@/lib/openf1").Lap[];
    return classifyLapsWeather(lapsWithDates, sessionWeather);
  }, [sessionWeather, drivers]);

  // Build contiguous weather bands for ReferenceArea rendering
  const weatherBands = useMemo(() => {
    if (!weatherMap.size) return [];
    const entries = Array.from(weatherMap.entries())
      .filter(([, c]) => c !== "DRY")
      .sort(([a], [b]) => a - b);
    if (!entries.length) return [];

    const bands: { start: number; end: number; condition: WeatherCondition }[] = [];
    let current: { start: number; end: number; condition: WeatherCondition } | null = null;

    for (const [lap, cond] of entries) {
      if (current && current.condition === cond && lap === current.end + 1) {
        current.end = lap;
      } else {
        if (current) bands.push(current);
        current = { start: lap, end: lap, condition: cond };
      }
    }
    if (current) bands.push(current);
    return bands;
  }, [weatherMap]);

  const hasWeatherData = weatherBands.length > 0;

  // Track status classification
  const trackStatusMap = useMemo(() => {
    if (!raceControlMessages?.length || !drivers.length) return new Map<number, TrackStatus>();
    const refDriver = drivers.find((d) => d.laps.some((l) => l.date_start));
    if (!refDriver) return new Map<number, TrackStatus>();
    const lapsWithDates = refDriver.laps.filter((l) => l.date_start) as any as Lap[];
    return classifyLapsTrackStatus(lapsWithDates, raceControlMessages);
  }, [raceControlMessages, drivers]);

  // Build contiguous track status bands
  const trackStatusBands = useMemo(() => {
    if (!trackStatusMap.size) return [];
    const entries = Array.from(trackStatusMap.entries())
      .filter(([, s]) => s !== "GREEN")
      .sort(([a], [b]) => a - b);
    if (!entries.length) return [];

    const bands: { start: number; end: number; status: TrackStatus }[] = [];
    let current: { start: number; end: number; status: TrackStatus } | null = null;

    for (const [lap, status] of entries) {
      if (current && current.status === status && lap === current.end + 1) {
        current.end = lap;
      } else {
        if (current) bands.push(current);
        current = { start: lap, end: lap, status };
      }
    }
    if (current) bands.push(current);
    return bands;
  }, [trackStatusMap]);

  const hasTrackStatusData = trackStatusBands.length > 0;

  const outlierLaps = useMemo(() => {
    const set = new Set<string>();
    for (const d of drivers) {
      const valid = d.laps.filter((l) => l.lap_duration != null && l.lap_duration > 0);
      if (!valid.length) continue;
      const avg = valid.reduce((s, l) => s + l.lap_duration!, 0) / valid.length;
      for (const l of valid) {
        if (l.lap_duration! > avg * (1 + OUTLIER_THRESHOLD)) {
          set.add(`${d.driverNumber}_${l.lap_number}`);
        }
      }
    }
    return set;
  }, [drivers]);

  const data = useMemo(() => {
    const map = new Map<number, Record<string, any>>();
    for (const d of drivers) {
      for (const lap of d.laps) {
        if (lap.lap_duration == null || lap.lap_duration <= 0) continue;
        if (!showOutliers && outlierLaps.has(`${d.driverNumber}_${lap.lap_number}`)) continue;
        if (!map.has(lap.lap_number)) map.set(lap.lap_number, { lap: lap.lap_number });
        map.get(lap.lap_number)![`t_${d.driverNumber}`] = lap.lap_duration;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.lap - b.lap);
  }, [drivers, outlierLaps, showOutliers]);

  // Custom dot renderer that colors by compound
  const renderDot = useCallback(
    (driverNumber: number, defaultColor: string) =>
      (props: any) => {
        const { cx, cy, payload } = props;
        if (cx == null || cy == null) return null;
        const lapNum = payload?.lap;
        const driverCompounds = compoundMap.get(driverNumber);
        const compound = driverCompounds?.get(lapNum);
        const fill = compound ? compoundColors[compound] || defaultColor : defaultColor;
        return (
          <circle
            key={`dot-${driverNumber}-${lapNum}`}
            cx={cx}
            cy={cy}
            r={3}
            fill={fill}
            stroke={fill}
            strokeWidth={0.5}
            cursor="pointer"
          />
        );
      },
    [compoundMap]
  );

  if (!data.length) return null;

  const allTimes = data.flatMap((d) =>
    drivers.map((dr) => d[`t_${dr.driverNumber}`]).filter((v): v is number => v != null)
  );
  const yMin = Math.floor(Math.min(...allTimes));
  const yMax = Math.ceil(Math.max(...allTimes));

  // Check if any driver has stint data
  const hasStintData = drivers.some((d) => d.stints && d.stints.length > 0);

  return (
    <div className="bg-card rounded-lg border border-border p-4 relative overflow-hidden">
      <Watermark />
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Lap Times
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowOutliers((v) => !v)}
          className="gap-1.5 text-xs text-muted-foreground h-7 px-2"
        >
          {showOutliers ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showOutliers ? "Nascondi outlier" : `Mostra outlier (>${OUTLIER_THRESHOLD * 100}%)`}
        </Button>
      </div>
      <div className="flex gap-3 mb-2">
        {drivers.map((d) => (
          <span key={d.driverNumber} className="flex items-center gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${d.color}` }} />
            <span className="font-mono font-bold">{d.acronym}</span>
          </span>
        ))}
      </div>
      {hasStintData && (
        <div className="flex gap-3 mb-2">
          {Object.entries(compoundColors).map(([compound, color]) => (
            <span key={compound} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              {compound}
            </span>
          ))}
        </div>
      )}
      {hasWeatherData && (
        <div className="flex gap-3 mb-2">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: "hsla(210, 80%, 50%, 0.35)" }} />
            🌧 Wet
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: "hsla(35, 90%, 55%, 0.30)" }} />
            🌦 Mixed
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: "transparent", border: "1px dashed hsl(215 12% 35%)" }} />
            ☀️ Dry
          </span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
          onClick={(e) => {
            if (e?.activePayload?.length && onSelectLap) {
              const lapNumber = Number(e.activeLabel);
              for (const d of drivers) {
                const key = `t_${d.driverNumber}`;
                const payload = e.activePayload.find((p: any) => p.dataKey === key && p.value != null);
                if (payload) {
                  onSelectLap(d.driverNumber, lapNumber);
                }
              }
            }
          }}
        >
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          {/* Weather bands */}
          {weatherBands.map((band, i) => (
            <ReferenceArea
              key={`weather-${i}`}
              x1={band.start - 0.5}
              x2={band.end + 0.5}
              fill={weatherBandColors[band.condition]}
              fillOpacity={1}
              strokeOpacity={0}
            />
          ))}
          {/* Track status bands */}
          {trackStatusBands.map((band, i) => (
            <ReferenceArea
              key={`track-${i}`}
              x1={band.start - 0.5}
              x2={band.end + 0.5}
              fill={trackStatusColors[band.status]}
              fillOpacity={1}
              strokeOpacity={0}
            />
          ))}
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
            labelFormatter={(v) => {
              const lapNum = Number(v);
              const cond = weatherMap.get(lapNum);
              const condLabel = cond === "WET" ? " 🌧" : cond === "MIXED" ? " 🌦" : "";
              const ts = trackStatusMap.get(lapNum);
              const tsLabel = ts && ts !== "GREEN" ? ` ${trackStatusLabels[ts].icon} ${trackStatusLabels[ts].label}` : "";
              return `Lap ${v}${condLabel}${tsLabel}`;
            }}
            formatter={(value: number, name: string) => {
              const driverNum = parseInt(name.replace("t_", ""));
              const driver = drivers.find((d) => d.driverNumber === driverNum);
              return [formatLapTime(value), driver?.acronym || ""];
            }}
          />
          {selectedLaps?.filter((s) => s.lapNumber != null).map((s) => (
            <ReferenceLine
              key={`ref_${s.driverNumber}_${s.lapNumber}`}
              x={s.lapNumber!}
              stroke={`#${drivers.find((d) => d.driverNumber === s.driverNumber)?.color || "ffffff"}`}
              strokeDasharray="4 3"
              strokeOpacity={0.6}
            />
          ))}
          {drivers.map((d) => (
            <Line
              key={d.driverNumber}
              type="monotone"
              dataKey={`t_${d.driverNumber}`}
              name={`t_${d.driverNumber}`}
              stroke={`#${d.color}`}
              dot={renderDot(d.driverNumber, `#${d.color}`)}
              activeDot={{ r: 5, cursor: "pointer" }}
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
