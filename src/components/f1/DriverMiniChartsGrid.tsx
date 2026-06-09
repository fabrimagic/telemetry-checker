import { useMemo } from "react";
import { TrendingUp, ListOrdered, Flag, ChevronsRight } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { Lap, PositionData, IntervalData, Driver } from "@/lib/openf1";

interface CumDevPoint {
  lap_number: number;
  cumulative_delta: number | null;
}

interface Props {
  driverNumber: number;
  driverColor: string; // hex without '#'
  driverAcronym: string;
  laps: Lap[];
  positions: PositionData[];
  intervals: IntervalData[];
  cumDev: CumDevPoint[] | null;
  isRace: boolean;
  allDrivers?: Driver[];
}

// Max time tolerance (ms) for aligning a position snapshot to an interval sample
// when no prior snapshot exists for that driver.
const POSITION_ALIGN_TOLERANCE_MS = 60_000;

/**
 * Resolves which driver was in `position - 1` at the given timestamp.
 * Uses the latest PositionData entry per driver with date <= refDate
 * (with a small tolerance to allow a slightly-later snapshot when no earlier
 * one exists). Returns null when no driver matches honestly.
 */
function resolveAheadDriverNumber(
  refDate: string,
  selectedDriverNumber: number,
  positions: PositionData[],
): number | null {
  if (!positions.length) return null;
  const refTs = new Date(refDate).getTime();
  if (!Number.isFinite(refTs)) return null;

  // Latest known position per driver up to refTs (or closest later within tolerance).
  const lastPos = new Map<number, { pos: number; dt: number }>();
  for (const p of positions) {
    if (typeof p.position !== "number") continue;
    const t = new Date(p.date).getTime();
    if (!Number.isFinite(t)) continue;
    const dt = t - refTs;
    if (dt > POSITION_ALIGN_TOLERANCE_MS) continue;
    const cur = lastPos.get(p.driver_number);
    // Prefer the latest snapshot at or before refTs; fall back to closest later one.
    if (!cur) {
      lastPos.set(p.driver_number, { pos: p.position, dt });
    } else if (dt <= 0 && (cur.dt > 0 || dt > cur.dt)) {
      lastPos.set(p.driver_number, { pos: p.position, dt });
    } else if (dt > 0 && cur.dt > 0 && dt < cur.dt) {
      lastPos.set(p.driver_number, { pos: p.position, dt });
    }
  }

  const selected = lastPos.get(selectedDriverNumber);
  if (!selected) return null;
  if (selected.pos <= 1) return null; // leader → nobody ahead

  const targetPos = selected.pos - 1;
  for (const [num, v] of lastPos) {
    if (num === selectedDriverNumber) continue;
    if (v.pos === targetPos) return num;
  }
  return null;
}


/**
 * Maps each (sorted) sample date to a driver lap number using the driver's own laps
 * (latest lap whose date_start <= sample.date). Pure presentation glue, mirrors
 * the same approach used by SessionReport.
 */
function mapByLap<T extends { date: string; driver_number: number }>(
  samples: T[],
  driverNumber: number,
  driverLaps: Lap[],
): Map<number, T> {
  const myLaps = driverLaps
    .filter((l) => l.date_start)
    .slice()
    .sort((a, b) => a.lap_number - b.lap_number);
  if (!myLaps.length) return new Map();
  const byLap = new Map<number, T>();
  const filtered = samples.filter((s) => s.driver_number === driverNumber);
  for (const s of filtered) {
    let matched: number | null = null;
    for (let i = myLaps.length - 1; i >= 0; i--) {
      if (myLaps[i].date_start! <= s.date) {
        matched = myLaps[i].lap_number;
        break;
      }
    }
    if (matched == null) continue;
    // Keep latest sample per lap (samples likely chronological; overwrite).
    byLap.set(matched, s);
  }
  return byLap;
}

interface MiniPanelProps {
  title: string;
  icon: React.ReactNode;
  available: boolean;
  data: Array<Record<string, any>>;
  dataKey: string;
  color: string;
  yReversed?: boolean;
  yDomain?: [number | string, number | string];
  tooltipFormatter: (v: number, payload?: Record<string, any>) => [string, string];
  emptyText: string;
}

function MiniPanel({
  title,
  icon,
  available,
  data,
  dataKey,
  color,
  yReversed,
  yDomain,
  tooltipFormatter,
  emptyText,
}: MiniPanelProps) {
  return (
    <div className="bg-card rounded-lg border border-border p-3 flex flex-col aspect-square min-h-[200px] relative overflow-hidden">
      <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5 shrink-0">
        {icon}
        <span className="truncate">{title}</span>
      </h4>
      {!available || data.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground/70 text-center px-2">
          {emptyText}
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis
                dataKey="lap"
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
              />
              <YAxis
                reversed={yReversed}
                domain={yDomain ?? ["auto", "auto"]}
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 10,
                  padding: "4px 8px",
                }}
                formatter={(v: any, _name: string, props: any) =>
                  tooltipFormatter(Number(v), props?.payload)
                }
                labelFormatter={(l) => `Giro ${l}`}
              />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={`#${color}`}
                strokeWidth={1.6}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}


export function DriverMiniChartsGrid({
  driverNumber,
  driverColor,
  driverAcronym,
  laps,
  positions,
  intervals,
  cumDev,
  isRace,
}: Props) {
  const cumDevData = useMemo(() => {
    if (!cumDev || cumDev.length === 0) return [];
    return cumDev
      .filter((p) => p.cumulative_delta != null && Number.isFinite(p.cumulative_delta))
      .map((p) => ({ lap: p.lap_number, value: p.cumulative_delta as number }));
  }, [cumDev]);

  const positionData = useMemo(() => {
    if (!isRace) return [];
    const m = mapByLap(positions, driverNumber, laps);
    const out: Array<{ lap: number; value: number }> = [];
    for (const [lap, p] of m) {
      if (typeof p.position === "number") out.push({ lap, value: p.position });
    }
    return out.sort((a, b) => a.lap - b.lap);
  }, [positions, driverNumber, laps, isRace]);

  const gapToLeaderData = useMemo(() => {
    if (!isRace) return [];
    const m = mapByLap(intervals, driverNumber, laps);
    const out: Array<{ lap: number; value: number }> = [];
    for (const [lap, item] of m) {
      const g = typeof item.gap_to_leader === "number" ? item.gap_to_leader : null;
      if (g != null && Number.isFinite(g)) out.push({ lap, value: g });
    }
    return out.sort((a, b) => a.lap - b.lap);
  }, [intervals, driverNumber, laps, isRace]);

  const intervalAheadData = useMemo(() => {
    if (!isRace) return [];
    const m = mapByLap(intervals, driverNumber, laps);
    const out: Array<{ lap: number; value: number }> = [];
    for (const [lap, item] of m) {
      const v = typeof item.interval === "number" ? item.interval : null;
      if (v != null && Number.isFinite(v)) out.push({ lap, value: v });
    }
    return out.sort((a, b) => a.lap - b.lap);
  }, [intervals, driverNumber, laps, isRace]);

  const nonRaceMsg = "Dato disponibile solo in gara";

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"
      data-testid="driver-mini-charts-grid"
      aria-label={`Mini grafici sintetici ${driverAcronym}`}
    >
      <MiniPanel
        title="Deviazione cumulativa"
        icon={<TrendingUp className="h-3 w-3" />}
        available={cumDevData.length > 0}
        data={cumDevData}
        dataKey="value"
        color={driverColor}
        tooltipFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(3)}s`}
        emptyText="Dato non disponibile per questa sessione"
        yLabel="Δ (s)"
      />
      <MiniPanel
        title="Posizione"
        icon={<ListOrdered className="h-3 w-3" />}
        available={isRace && positionData.length > 0}
        data={positionData}
        dataKey="value"
        color={driverColor}
        yReversed
        yDomain={[1, 20]}
        tooltipFormatter={(v) => `P${v}`}
        emptyText={isRace ? "Dato non disponibile per questa sessione" : nonRaceMsg}
        yLabel="Pos"
      />
      <MiniPanel
        title="Gap al leader"
        icon={<Flag className="h-3 w-3" />}
        available={isRace && gapToLeaderData.length > 0}
        data={gapToLeaderData}
        dataKey="value"
        color={driverColor}
        tooltipFormatter={(v) => `+${v.toFixed(3)}s`}
        emptyText={isRace ? "Dato non disponibile per questa sessione" : nonRaceMsg}
        yLabel="Gap (s)"
      />
      <MiniPanel
        title="Distacco da chi precede"
        icon={<ChevronsRight className="h-3 w-3" />}
        available={isRace && intervalAheadData.length > 0}
        data={intervalAheadData}
        dataKey="value"
        color={driverColor}
        tooltipFormatter={(v) => `+${v.toFixed(3)}s`}
        emptyText={isRace ? "Dato non disponibile per questa sessione" : nonRaceMsg}
        yLabel="Δ ahead"
      />
    </div>
  );
}
