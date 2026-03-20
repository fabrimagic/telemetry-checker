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

interface TelemetryPoint {
  time: number;
  speed: number;
  throttle: number;
  brake: number;
  rpm: number;
  gear: number;
  date: string;
}

interface Props {
  data: TelemetryPoint[];
  teamColor: string;
  cursorTime: number | null;
  onCursorChange: (time: number | null) => void;
  onCursorClick: (time: number) => void;
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

function ChartWrapper({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="relative">
      <span className="absolute top-1 left-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider z-10">
        {label}
      </span>
      {children}
    </div>
  );
}

export function TelemetryCharts({ data, teamColor, cursorTime, onCursorChange, onCursorClick }: Props) {
  const color = `#${teamColor}`;
  const domain = useMemo(() => {
    if (!data.length) return [0, 0];
    return [data[0].time, data[data.length - 1].time];
  }, [data]);

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

  const commonProps = {
    data,
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
    onClick: handleClick,
  };

  const refLine = cursorTime != null ? (
    <ReferenceLine x={cursorTime} stroke="hsl(0 0% 50%)" strokeDasharray="2 2" />
  ) : null;

  if (!data.length) return null;

  return (
    <div className="space-y-0">
      {/* Speed */}
      <ChartWrapper label="Speed (km/h)">
        <ResponsiveContainer width="100%" height={140}>
          <LineChart {...commonProps} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis {...commonXAxis} hide />
            <YAxis width={42} tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_STYLE} labelFormatter={formatTimeAxis} />
            {refLine}
            <Line type="monotone" dataKey="speed" stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartWrapper>

      {/* Throttle */}
      <ChartWrapper label="Throttle (%)">
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart {...commonProps} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis {...commonXAxis} hide />
            <YAxis width={42} domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_STYLE} labelFormatter={formatTimeAxis} />
            {refLine}
            <Area type="stepAfter" dataKey="throttle" stroke="hsl(142 70% 45%)" fill="hsl(142 70% 45% / 0.15)" strokeWidth={1} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartWrapper>

      {/* Brake */}
      <ChartWrapper label="Brake">
        <ResponsiveContainer width="100%" height={60}>
          <AreaChart {...commonProps} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
            <XAxis {...commonXAxis} hide />
            <YAxis width={42} domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} ticks={[0, 100]} />
            {refLine}
            <Area type="stepAfter" dataKey="brake" stroke="hsl(0 76% 50%)" fill="hsl(0 76% 50% / 0.3)" strokeWidth={1} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartWrapper>

      {/* RPM */}
      <ChartWrapper label="RPM">
        <ResponsiveContainer width="100%" height={100}>
          <LineChart {...commonProps} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis {...commonXAxis} hide />
            <YAxis width={42} tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_STYLE} labelFormatter={formatTimeAxis} />
            {refLine}
            <Line type="monotone" dataKey="rpm" stroke="hsl(217 91% 60%)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartWrapper>

      {/* Gear */}
      <ChartWrapper label="Gear">
        <ResponsiveContainer width="100%" height={80}>
          <LineChart {...commonProps} margin={{ top: 20, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis {...commonXAxis} />
            <YAxis width={42} domain={[0, 8]} ticks={[1, 2, 3, 4, 5, 6, 7, 8]} tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_STYLE} labelFormatter={formatTimeAxis} />
            {refLine}
            <Line type="stepAfter" dataKey="gear" stroke="hsl(45 93% 58%)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartWrapper>
    </div>
  );
}
