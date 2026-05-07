import { useEffect, useMemo, useState } from "react";
import {
  fetchLivedata,
  type LiveSession,
  type LiveDriver,
  type LiveLap,
  type LiveStint,
  type LivePosition,
  type LiveInterval,
  type LivePit,
} from "@/lib/livedataClient";
import { useLivePolling } from "@/hooks/useLivePolling";
import { meanStintLap } from "@/lib/strategyMonitorHelpers";
import { computeLiveStrategyAdvice, type LiveStrategyAdvice } from "@/lib/liveVRE";

function estimateTotalSessionLaps(
  _laps: LiveLap[],
  _stints: LiveStint[],
): number | null {
  // Heuristic placeholder: OpenF1 doesn't expose total race laps directly.
  // Future: derive from circuit_short_name → total laps map.
  return null;
}

interface Props {
  session: LiveSession;
  drivers: LiveDriver[];
  selectedDriver: number | null;
}

const COMPOUND_COLOR: Record<string, string> = {
  SOFT: "bg-red-600 text-white",
  MEDIUM: "bg-yellow-400 text-black",
  HARD: "bg-zinc-200 text-black",
  INTERMEDIATE: "bg-green-600 text-white",
  WET: "bg-blue-600 text-white",
};

interface MonitorData {
  laps: LiveLap[];
  stints: LiveStint[];
  positions: LivePosition[];
  intervals: LiveInterval[];
  pits: LivePit[];
}

function formatLap(s: number | null | undefined): string {
  if (s == null || isNaN(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(3).padStart(6, "0")}`;
}

function formatGap(g: number | string | null | undefined): string {
  if (g == null) return "—";
  if (typeof g === "string") return g;
  if (g === 0) return "leader";
  return `+${g.toFixed(3)}s`;
}

function MiniSparkline({
  values,
  width = 80,
  height = 20,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(" ");
  const trendColor =
    values[values.length - 1] > values[0] ? "stroke-red-500" : "stroke-emerald-500";
  return (
    <svg width={width} height={height} className="inline-block align-middle">
      <polyline points={points} fill="none" strokeWidth={1.5} className={trendColor} />
    </svg>
  );
}

export function LiveStrategyMonitor({ session, drivers, selectedDriver }: Props) {
  const fetcher = useMemo(
    () => async (): Promise<MonitorData> => {
      const sk = session.session_key;
      const [laps, stints, positions, intervals, pits] = await Promise.all([
        fetchLivedata<LiveLap>("/v1/laps", { session_key: sk }),
        fetchLivedata<LiveStint>("/v1/stints", { session_key: sk }),
        fetchLivedata<LivePosition>("/v1/position", { session_key: sk }),
        fetchLivedata<LiveInterval>("/v1/intervals", { session_key: sk }),
        fetchLivedata<LivePit>("/v1/pit", { session_key: sk }),
      ]);
      return { laps, stints, positions, intervals, pits };
    },
    [session.session_key],
  );

  const { data, error, loading } = useLivePolling(fetcher, 1000, selectedDriver != null);

  if (selectedDriver == null) {
    return (
      <div>
        <h2 className="text-sm font-semibold mb-2">Monitor Strategia</h2>
        <p className="text-xs text-muted-foreground">Seleziona un pilota per vedere il monitor.</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div>
        <h2 className="text-sm font-semibold mb-2">Monitor Strategia</h2>
        <p className="text-xs text-muted-foreground">Caricamento monitor…</p>
      </div>
    );
  }

  const driver = drivers.find((d) => d.driver_number === selectedDriver);
  const driverLaps = (data?.laps ?? []).filter((l) => l.driver_number === selectedDriver);
  const driverStints = (data?.stints ?? []).filter((s) => s.driver_number === selectedDriver);
  const lastLap = [...driverLaps]
    .filter((l) => l.lap_duration != null && l.lap_duration > 0)
    .sort((a, b) => b.lap_number - a.lap_number)[0];
  const currentStint = [...driverStints].sort((a, b) => b.stint_number - a.stint_number)[0];
  const driverPositions = (data?.positions ?? [])
    .filter((p) => p.driver_number === selectedDriver)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const currentPos = driverPositions[0];
  const driverIntervals = (data?.intervals ?? [])
    .filter((i) => i.driver_number === selectedDriver)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const currentInterval = driverIntervals[0];
  const pitCount = (data?.pits ?? []).filter((p) => p.driver_number === selectedDriver).length;

  const tyreAge =
    currentStint && lastLap
      ? currentStint.tyre_age_at_start +
        Math.max(0, lastLap.lap_number - currentStint.lap_start)
      : currentStint?.tyre_age_at_start ?? null;

  const stintMean = currentStint ? meanStintLap(currentStint, driverLaps) : null;
  const lastLapDelta =
    lastLap?.lap_duration != null && stintMean != null
      ? lastLap.lap_duration - stintMean
      : null;

  const recentLapTimes = currentStint
    ? driverLaps
        .filter(
          (l) =>
            l.lap_number > currentStint.lap_start &&
            l.lap_duration != null &&
            l.lap_duration > 0 &&
            (currentStint.lap_end == null || l.lap_number <= currentStint.lap_end),
        )
        .sort((a, b) => a.lap_number - b.lap_number)
        .slice(-5)
        .map((l) => l.lap_duration as number)
    : [];

  const allPositions = (data?.positions ?? []).reduce((map, p) => {
    const cur = map.get(p.driver_number);
    const a = new Date(p.date).getTime();
    const b = cur ? new Date(cur.date).getTime() : 0;
    if (!cur || a > b) map.set(p.driver_number, p);
    return map;
  }, new Map<number, LivePosition>());
  const sortedByPos = Array.from(allPositions.values()).sort((a, b) => a.position - b.position);
  const myIdx = sortedByPos.findIndex((p) => p.driver_number === selectedDriver);
  const driverAhead = myIdx > 0 ? sortedByPos[myIdx - 1] : null;
  const driverBehind =
    myIdx >= 0 && myIdx < sortedByPos.length - 1 ? sortedByPos[myIdx + 1] : null;
  const driverAheadAcronym = drivers.find(
    (d) => d.driver_number === driverAhead?.driver_number,
  )?.name_acronym;
  const driverBehindAcronym = drivers.find(
    (d) => d.driver_number === driverBehind?.driver_number,
  )?.name_acronym;

  const compoundClass =
    currentStint?.compound && COMPOUND_COLOR[currentStint.compound]
      ? COMPOUND_COLOR[currentStint.compound]
      : "bg-muted text-foreground";

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Monitor Strategia</h2>
        <span className="text-xs text-muted-foreground">
          {driver ? `#${driver.driver_number} ${driver.name_acronym}` : ""}
        </span>
      </div>

      {error && (
        <p className="text-xs text-amber-500">Errore di connessione, ritento…</p>
      )}

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-muted/40 p-2">
          <div className="text-muted-foreground">Pos</div>
          <div className="text-lg font-bold tabular-nums">{currentPos?.position ?? "—"}</div>
        </div>
        <div className="rounded bg-muted/40 p-2">
          <div className="text-muted-foreground truncate">
            {driverAheadAcronym ? `vs ${driverAheadAcronym} (avanti)` : "vs avanti"}
          </div>
          <div className="text-lg font-bold tabular-nums">
            {formatGap(currentInterval?.interval)}
          </div>
        </div>
        <div className="rounded bg-muted/40 p-2">
          <div className="text-muted-foreground truncate">
            {driverBehindAcronym ? `vs ${driverBehindAcronym} (dietro)` : "vs dietro"}
          </div>
          <div className="text-lg font-bold italic text-muted-foreground">—</div>
        </div>
      </div>

      <div className="rounded bg-muted/40 p-2 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground">Stint:</span>
          <span className="font-semibold">{currentStint?.stint_number ?? "—"}</span>
          {currentStint?.compound && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${compoundClass}`}
              title={currentStint.compound}
            >
              {currentStint.compound[0]}
            </span>
          )}
          <span className="text-muted-foreground ml-2">Età gomma:</span>
          <span className="font-semibold tabular-nums">{tyreAge ?? "—"} giri</span>
        </div>
      </div>

      <div className="rounded bg-muted/40 p-2 text-xs space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-muted-foreground">Last lap:</span>
          <span className="font-semibold tabular-nums">
            {formatLap(lastLap?.lap_duration ?? null)}
          </span>
          {lastLapDelta != null && (
            <span
              className={`text-[11px] tabular-nums ${
                lastLapDelta > 0 ? "text-amber-500" : "text-emerald-500"
              }`}
            >
              {lastLapDelta > 0 ? "+" : ""}
              {lastLapDelta.toFixed(3)}s vs media stint
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Trend ult. 5:</span>
          <MiniSparkline values={recentLapTimes} />
        </div>
      </div>

      <div className="rounded bg-muted/40 p-2 text-xs flex items-center justify-between">
        <span className="text-muted-foreground">Pit stops effettuati:</span>
        <span className="font-semibold tabular-nums">{pitCount}</span>
      </div>
    </div>
  );
}
