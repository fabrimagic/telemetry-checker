import { useEffect, useMemo, useState } from "react";
import {
  fetchLivedata,
  LiveDriver,
  LiveLap,
  LiveInterval,
  LivePosition,
  LiveStint,
  LivePit,
  LiveSession,
} from "@/lib/livedataClient";
import { useLivePolling } from "@/hooks/useLivePolling";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  session: LiveSession;
  selectedDriver: number | null;
  onSelectDriver: (n: number) => void;
}

const COMPOUND_COLOR: Record<string, string> = {
  SOFT: "bg-red-600 text-white",
  MEDIUM: "bg-yellow-400 text-black",
  HARD: "bg-zinc-200 text-black",
  INTERMEDIATE: "bg-green-600 text-white",
  WET: "bg-blue-600 text-white",
};

function formatLap(s: number | null | undefined): string {
  if (s == null || isNaN(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(3).padStart(6, "0")}`;
}

function formatGap(g: number | string | null | undefined): string {
  if (g == null) return "—";
  if (typeof g === "string") return g;
  if (g === 0) return "—";
  return `+${g.toFixed(3)}`;
}

function latestByDriver<T extends { driver_number: number; date?: string }>(
  rows: T[],
): Map<number, T> {
  const map = new Map<number, T>();
  for (const r of rows) {
    const cur = map.get(r.driver_number);
    if (!cur) {
      map.set(r.driver_number, r);
      continue;
    }
    const a = r.date ? new Date(r.date).getTime() : 0;
    const b = cur.date ? new Date(cur.date).getTime() : 0;
    if (a >= b) map.set(r.driver_number, r);
  }
  return map;
}

export function LiveTimingTable({ session, selectedDriver, onSelectDriver }: Props) {
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);
  const [bestLaps, setBestLaps] = useState<Record<number, number>>({});

  // Static driver roster (load once)
  useEffect(() => {
    let cancelled = false;
    fetchLivedata<LiveDriver>("/v1/drivers", { session_key: session.session_key })
      .then((d) => {
        if (!cancelled) setDrivers(d);
      })
      .catch(() => {
        /* ignored — table will show empty until next attempt */
      });
    return () => {
      cancelled = true;
    };
  }, [session.session_key]);

  const fetcher = useMemo(
    () => async () => {
      const sk = session.session_key;
      const [laps, intervals, positions, stints, pits] = await Promise.all([
        fetchLivedata<LiveLap>("/v1/laps", { session_key: sk }),
        fetchLivedata<LiveInterval>("/v1/intervals", { session_key: sk }),
        fetchLivedata<LivePosition>("/v1/position", { session_key: sk }),
        fetchLivedata<LiveStint>("/v1/stints", { session_key: sk }),
        fetchLivedata<LivePit>("/v1/pit", { session_key: sk }),
      ]);
      return { laps, intervals, positions, stints, pits };
    },
    [session.session_key],
  );

  const { data, error, loading } = useLivePolling(fetcher, 1000);

  // Update best laps incrementally
  useEffect(() => {
    if (!data?.laps) return;
    setBestLaps((prev) => {
      const next = { ...prev };
      for (const l of data.laps) {
        if (l.lap_duration && l.lap_duration > 0) {
          if (next[l.driver_number] == null || l.lap_duration < next[l.driver_number]) {
            next[l.driver_number] = l.lap_duration;
          }
        }
      }
      return next;
    });
  }, [data?.laps]);

  if (loading && !data) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 20 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const driverMap = new Map(drivers.map((d) => [d.driver_number, d]));
  const lastLapByDrv = new Map<number, LiveLap>();
  for (const l of data?.laps ?? []) {
    const cur = lastLapByDrv.get(l.driver_number);
    if (!cur || l.lap_number > cur.lap_number) lastLapByDrv.set(l.driver_number, l);
  }
  const intervalByDrv = latestByDriver(data?.intervals ?? []);
  const positionByDrv = latestByDriver(data?.positions ?? []);
  const stintsByDrv = new Map<number, LiveStint>();
  for (const s of data?.stints ?? []) {
    const cur = stintsByDrv.get(s.driver_number);
    if (!cur || s.stint_number > cur.stint_number) stintsByDrv.set(s.driver_number, s);
  }
  const pitCountByDrv = new Map<number, number>();
  for (const p of data?.pits ?? []) {
    pitCountByDrv.set(p.driver_number, (pitCountByDrv.get(p.driver_number) ?? 0) + 1);
  }

  const allDriverNums = Array.from(
    new Set([
      ...drivers.map((d) => d.driver_number),
      ...Array.from(positionByDrv.keys()),
    ]),
  );

  const rows = allDriverNums
    .map((n) => {
      const pos = positionByDrv.get(n)?.position ?? 999;
      return { n, pos };
    })
    .sort((a, b) => a.pos - b.pos);

  return (
    <div className="overflow-x-auto">
      {error && (
        <div className="text-xs text-yellow-500 mb-2">
          Errore di connessione, ritento…
        </div>
      )}
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left p-1">Pos</th>
            <th className="text-left p-1">#</th>
            <th className="text-left p-1">Pilota</th>
            <th className="text-left p-1">Team</th>
            <th className="text-right p-1">Last</th>
            <th className="text-right p-1">Best</th>
            <th className="text-right p-1">Gap Leader</th>
            <th className="text-right p-1">Interval</th>
            <th className="text-right p-1">S1</th>
            <th className="text-right p-1">S2</th>
            <th className="text-right p-1">S3</th>
            <th className="text-right p-1">ST</th>
            <th className="text-center p-1">Mescola</th>
            <th className="text-right p-1">Età</th>
            <th className="text-right p-1">Pit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ n, pos }) => {
            const drv = driverMap.get(n);
            const lap = lastLapByDrv.get(n);
            const intv = intervalByDrv.get(n);
            const stint = stintsByDrv.get(n);
            const isSelected = selectedDriver === n;
            const tyreAge =
              stint && lap
                ? stint.tyre_age_at_start + Math.max(0, lap.lap_number - stint.lap_start)
                : stint?.tyre_age_at_start ?? null;
            return (
              <tr
                key={n}
                onClick={() => onSelectDriver(n)}
                className={`cursor-pointer border-b border-border/40 hover:bg-muted/50 ${
                  isSelected ? "bg-blue-950/40" : ""
                }`}
              >
                <td className="p-1">{pos === 999 ? "—" : pos}</td>
                <td className="p-1 font-mono">{n}</td>
                <td className="p-1 font-medium">{drv?.name_acronym ?? "—"}</td>
                <td className="p-1 text-muted-foreground">{drv?.team_name ?? "—"}</td>
                <td className="p-1 text-right font-mono">{formatLap(lap?.lap_duration ?? null)}</td>
                <td className="p-1 text-right font-mono text-purple-400">
                  {formatLap(bestLaps[n] ?? null)}
                </td>
                <td className="p-1 text-right font-mono">{formatGap(intv?.gap_to_leader)}</td>
                <td className="p-1 text-right font-mono">{formatGap(intv?.interval)}</td>
                <td className="p-1 text-right font-mono">
                  {lap?.duration_sector_1 != null ? lap.duration_sector_1.toFixed(3) : "—"}
                </td>
                <td className="p-1 text-right font-mono">
                  {lap?.duration_sector_2 != null ? lap.duration_sector_2.toFixed(3) : "—"}
                </td>
                <td className="p-1 text-right font-mono">
                  {lap?.duration_sector_3 != null ? lap.duration_sector_3.toFixed(3) : "—"}
                </td>
                <td className="p-1 text-right font-mono">{lap?.st_speed ?? "—"}</td>
                <td className="p-1 text-center">
                  {stint?.compound ? (
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        COMPOUND_COLOR[stint.compound.toUpperCase()] ?? "bg-muted"
                      }`}
                    >
                      {stint.compound[0]}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-1 text-right">{tyreAge ?? "—"}</td>
                <td className="p-1 text-right">{pitCountByDrv.get(n) ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
