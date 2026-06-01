import { useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import type { SoftSensorsLapState } from "@/lib/softSensors";

export interface DriverTelemetry {
  driverNumber: number;
  acronym: string;
  color: string; // hex without #
  data: TelemetryPoint[];
}

export interface TelemetryPoint {
  time: number;
  speed: number;
  throttle: number;
  brake: number;
  rpm: number;
  gear: number;
  date: string;
}

interface Props {
  drivers: DriverTelemetry[];
  cursorTime: number | null;
  onCursorChange: (time: number | null) => void;
  onCursorClick: (time: number) => void;
  lapSoftSensor?: SoftSensorsLapState | null;
}

const GRID_STROKE = "hsl(220 14% 16%)";
const AXIS_TICK = { fill: "hsl(215 12% 45%)", fontSize: 10 };
const TOOLTIP_STYLE = {
  contentStyle: {
    background: "hsl(220 18% 10%)",
    border: "1px solid hsl(220 14% 18%)",
    borderRadius: 6,
    fontSize: 11,
  },
  labelStyle: { color: "hsl(215 12% 55%)" },
};

function formatTimeAxis(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

import { Watermark } from "./Watermark";

function ChartWrapper({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="relative overflow-hidden">
      <span className="absolute top-1 left-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider z-10">
        {label}
      </span>
      <Watermark />
      {children}
    </div>
  );
}

// Merge multiple drivers' data into a single array keyed by time
function mergeData(drivers: DriverTelemetry[], field: string) {
  const map = new Map<number, Record<string, any>>();
  for (const d of drivers) {
    for (const pt of d.data) {
      const key = Math.round(pt.time * 10); // 0.1s precision
      if (!map.has(key)) map.set(key, { time: pt.time });
      map.get(key)![`${field}_${d.driverNumber}`] = (pt as any)[field];
    }
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

export function TelemetryCharts({ drivers, cursorTime, onCursorChange, onCursorClick }: Props) {
  const domain = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const d of drivers) {
      if (d.data.length) {
        min = Math.min(min, d.data[0].time);
        max = Math.max(max, d.data[d.data.length - 1].time);
      }
    }
    return min === Infinity ? [0, 0] : [min, max];
  }, [drivers]);

  const speedData = useMemo(() => mergeData(drivers, "speed"), [drivers]);
  const throttleData = useMemo(() => mergeData(drivers, "throttle"), [drivers]);
  const brakeData = useMemo(() => mergeData(drivers, "brake"), [drivers]);
  const rpmData = useMemo(() => mergeData(drivers, "rpm"), [drivers]);
  const gearData = useMemo(() => mergeData(drivers, "gear"), [drivers]);

  const handleMouseMove = useCallback(
    (state: any) => {
      if (state?.activePayload?.[0]) {
        onCursorChange(state.activePayload[0].payload.time);
      }
    },
    [onCursorChange]
  );

  const handleClick = useCallback(
    (state: any) => {
      if (state?.activePayload?.[0]) {
        onCursorClick(state.activePayload[0].payload.time);
      }
    },
    [onCursorClick]
  );

  const handleMouseLeave = useCallback(() => onCursorChange(null), [onCursorChange]);

  const commonXAxis = {
    dataKey: "time",
    domain,
    type: "number" as const,
    tickFormatter: formatTimeAxis,
    tick: AXIS_TICK,
    axisLine: false,
    tickLine: false,
  };

  const chartHandlers = {
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
    onClick: handleClick,
  };

  const refLine = cursorTime != null ? (
    <ReferenceLine x={cursorTime} stroke="hsl(0 0% 50%)" strokeDasharray="2 2" />
  ) : null;

  if (!drivers.length || !drivers.some((d) => d.data.length > 0)) return null;

  const renderLineChart = (
    label: string,
    data: Record<string, any>[],
    field: string,
    height: number,
    yProps?: Record<string, any>,
    showXAxis?: boolean,
    lineType?: string
  ) => (
    <ChartWrapper label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} {...chartHandlers} margin={{ top: 20, right: 12, left: 0, bottom: showXAxis ? 4 : 0 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis {...commonXAxis} hide={!showXAxis} />
          <YAxis width={42} tick={AXIS_TICK} axisLine={false} tickLine={false} {...yProps} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={formatTimeAxis} />
          {refLine}
          {drivers.map((d) => (
            <Line
              key={d.driverNumber}
              type={(lineType as any) || "monotone"}
              dataKey={`${field}_${d.driverNumber}`}
              name={d.acronym}
              stroke={`#${d.color}`}
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartWrapper>
  );

  return (
    <div className="space-y-0">
      {renderLineChart("Speed (km/h)", speedData, "speed", 140)}

      {/* Throttle as area */}
      <ChartWrapper label="Throttle (%)">
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart data={throttleData} {...chartHandlers} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis {...commonXAxis} hide />
            <YAxis width={42} domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_STYLE} labelFormatter={formatTimeAxis} />
            {refLine}
            {drivers.map((d) => (
              <Area
                key={d.driverNumber}
                type="stepAfter"
                dataKey={`throttle_${d.driverNumber}`}
                name={d.acronym}
                stroke={`#${d.color}`}
                fill={`#${d.color}`}
                fillOpacity={0.08}
                strokeWidth={1}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </ChartWrapper>

      {/* Brake as area */}
      <ChartWrapper label="Brake">
        <ResponsiveContainer width="100%" height={60}>
          <AreaChart data={brakeData} {...chartHandlers} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
            <XAxis {...commonXAxis} hide />
            <YAxis width={42} domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} ticks={[0, 100]} />
            {refLine}
            {drivers.map((d) => (
              <Area
                key={d.driverNumber}
                type="stepAfter"
                dataKey={`brake_${d.driverNumber}`}
                name={d.acronym}
                stroke={`#${d.color}`}
                fill={`#${d.color}`}
                fillOpacity={0.15}
                strokeWidth={1}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </ChartWrapper>

      {renderLineChart("RPM", rpmData, "rpm", 100)}
      {renderLineChart("Gear", gearData, "gear", 80, { domain: [0, 8], ticks: [1, 2, 3, 4, 5, 6, 7, 8] }, true, "stepAfter")}
    </div>
  );
}
