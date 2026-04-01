import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, Trophy, Flag, Cloud, CircleDot, ArrowUpDown, BarChart3, Timer } from "lucide-react";
import {
  getSessionResult,
  getStartingGrid,
  getPositions,
  getAllStints,
  getAllPitStops,
  getWeatherForSession,
  getDrivers,
  getIntervals,
  getAllLaps,
  type SessionResult,
  type StartingGridEntry,
  type PositionData,
  type StintData,
  type PitData,
  type WeatherData,
  type Driver,
  type IntervalData,
  type Lap,
} from "@/lib/openf1";
import { Watermark } from "./Watermark";
import { CumulativeDeviationCard } from "./CumulativeDeviationCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Props {
  sessionKey: number;
  sessionType: string;
}

const compoundColors: Record<string, string> = {
  SOFT: "hsl(0, 85%, 55%)",
  MEDIUM: "hsl(45, 95%, 55%)",
  HARD: "hsl(0, 0%, 75%)",
  INTERMEDIATE: "hsl(140, 70%, 45%)",
  WET: "hsl(210, 80%, 50%)",
};

function formatDuration(seconds: number | number[] | null): string {
  if (seconds == null) return "—";
  const val = Array.isArray(seconds) ? seconds[seconds.length - 1] : seconds;
  if (val == null) return "—";
  const mins = Math.floor(val / 60);
  const secs = val - mins * 60;
  if (mins > 0) return `${mins}:${secs.toFixed(3).padStart(6, "0")}`;
  return secs.toFixed(3);
}

function formatGap(gap: number | string | null): string {
  if (gap == null || gap === 0) return "—";
  if (typeof gap === "string") return gap;
  return `+${gap.toFixed(3)}`;
}

export function SessionReport({ sessionKey, sessionType }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [startingGrid, setStartingGrid] = useState<StartingGridEntry[]>([]);
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [stints, setStints] = useState<StintData[]>([]);
  const [pitStops, setPitStops] = useState<PitData[]>([]);
  const [weather, setWeather] = useState<WeatherData[]>([]);
  const [intervals, setIntervals] = useState<IntervalData[]>([]);
  const [allLaps, setAllLaps] = useState<Lap[]>([]);
  const [visibleDrivers, setVisibleDrivers] = useState<Set<number> | null>(null); // null = all

  const isRace = sessionType === "Race" || sessionType === "Sprint";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const drv = await getDrivers(sessionKey);
        if (cancelled) return;
        setDrivers(drv);

        try {
          const res = await getSessionResult(sessionKey);
          if (cancelled) return;
          setResults(res.sort((a, b) => a.position - b.position));
        } catch { /* optional */ }

        try {
          const w = await getWeatherForSession(sessionKey);
          if (cancelled) return;
          setWeather(w);
        } catch { /* optional */ }

        if (isRace) {
          try {
            const grid = await getStartingGrid(sessionKey);
            if (cancelled) return;
            setStartingGrid(grid.sort((a, b) => a.position - b.position));
          } catch { /* optional */ }

          try {
            const st = await getAllStints(sessionKey);
            if (cancelled) return;
            setStints(st);
          } catch { /* optional */ }

          try {
            const pits = await getAllPitStops(sessionKey);
            if (cancelled) return;
            setPitStops(pits.sort((a, b) => a.lap_number - b.lap_number));
          } catch { /* optional */ }

          try {
            const pos = await getPositions(sessionKey);
            if (cancelled) return;
            setPositions(pos);
          } catch { /* optional */ }

          try {
            const ivl = await getIntervals(sessionKey);
            if (cancelled) return;
            setIntervals(ivl);
          } catch { /* optional */ }

          try {
            const laps = await getAllLaps(sessionKey);
            if (cancelled) return;
            setAllLaps(laps);
          } catch { /* optional */ }
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sessionKey, isRace]);

  const driverName = useCallback(
    (num: number) => {
      const d = drivers.find((dr) => dr.driver_number === num);
      return d ? d.name_acronym : `#${num}`;
    },
    [drivers]
  );

  const driverColor = useCallback(
    (num: number) => {
      const d = drivers.find((dr) => dr.driver_number === num);
      return d?.team_colour || "ffffff";
    },
    [drivers]
  );

  const driverTeam = useCallback(
    (num: number) => {
      const d = drivers.find((dr) => dr.driver_number === num);
      return d?.team_name || "";
    },
    [drivers]
  );

  const weatherSummary = useMemo(() => {
    if (!weather.length) return null;
    const last = weather[weather.length - 1];
    return last;
  }, [weather]);

  const tyreStrategy = useMemo(() => {
    if (!stints.length || !results.length) return [];
    const resultOrder = results.map((r) => r.driver_number);
    const grouped = new Map<number, StintData[]>();
    for (const s of stints) {
      if (!grouped.has(s.driver_number)) grouped.set(s.driver_number, []);
      grouped.get(s.driver_number)!.push(s);
    }
    return resultOrder
      .filter((num) => grouped.has(num))
      .map((num) => ({
        driverNumber: num,
        stints: grouped.get(num)!.sort((a, b) => a.stint_number - b.stint_number),
      }));
  }, [stints, results]);

  const maxLap = useMemo(() => {
    if (!stints.length) return 0;
    return Math.max(...stints.map((s) => s.lap_end));
  }, [stints]);

  const positionChartData = useMemo(() => {
    if (!positions.length || !results.length || !allLaps.length) return [];
    const driverNums = results.map((r) => r.driver_number);

    // Build driver laps map for timestamp-to-lap correlation
    const driverLapsMap = new Map<number, Lap[]>();
    for (const lap of allLaps) {
      if (!lap.date_start) continue;
      if (!driverLapsMap.has(lap.driver_number)) driverLapsMap.set(lap.driver_number, []);
      driverLapsMap.get(lap.driver_number)!.push(lap);
    }
    for (const [, laps] of driverLapsMap) {
      laps.sort((a, b) => a.lap_number - b.lap_number);
    }

    // For each position entry, find its lap number and keep last position per driver per lap
    const lapPositions = new Map<number, Map<number, number>>(); // lap -> driver -> position
    for (const p of positions) {
      // Find lap for this driver at this timestamp
      const dLaps = driverLapsMap.get(p.driver_number);
      if (!dLaps?.length) continue;
      let matchedLap: number | null = null;
      for (let i = dLaps.length - 1; i >= 0; i--) {
        if (dLaps[i].date_start! <= p.date) { matchedLap = dLaps[i].lap_number; break; }
      }
      if (matchedLap == null) continue;
      if (!lapPositions.has(matchedLap)) lapPositions.set(matchedLap, new Map());
      lapPositions.get(matchedLap)!.set(p.driver_number, p.position);
    }

    const lapNumbers = [...lapPositions.keys()].sort((a, b) => a - b);
    const data: Record<string, any>[] = [];
    for (const lap of lapNumbers) {
      const point: Record<string, any> = { lap };
      const posMap = lapPositions.get(lap)!;
      for (const num of driverNums) {
        if (posMap.has(num)) point[`d${num}`] = posMap.get(num);
      }
      if (Object.keys(point).length > 1) data.push(point);
    }
    return data;
  }, [positions, results, allLaps]);
  

  const positionDrivers = useMemo(() => {
    return results.slice(0, 20).map((r) => r.driver_number);
  }, [results]);

  const filteredDrivers = useMemo(() => {
    if (!visibleDrivers) return positionDrivers;
    return positionDrivers.filter((num) => visibleDrivers.has(num));
  }, [positionDrivers, visibleDrivers]);

  const toggleDriver = useCallback((num: number) => {
    setVisibleDrivers((prev) => {
      const current = prev ?? new Set(positionDrivers);
      const next = new Set(current);
      if (next.has(num)) {
        next.delete(num);
        if (next.size === 0) return null; // re-show all if none left
      } else {
        next.add(num);
      }
      return next;
    });
  }, [positionDrivers]);

  const selectAllDrivers = useCallback(() => setVisibleDrivers(null), []);
  const selectNoneDrivers = useCallback(() => setVisibleDrivers(new Set()), []);

  // Build position lookup: lap -> position -> driver_number (with carry-forward)
  const positionByLap = useMemo(() => {
    if (!positions.length || !allLaps.length) return new Map<number, Map<number, number>>();

    // 1. Build driver laps map for timestamp-to-lap correlation
    const driverLapsMap = new Map<number, Lap[]>();
    for (const lap of allLaps) {
      if (!lap.date_start) continue;
      if (!driverLapsMap.has(lap.driver_number)) driverLapsMap.set(lap.driver_number, []);
      driverLapsMap.get(lap.driver_number)!.push(lap);
    }
    for (const [, laps] of driverLapsMap) laps.sort((a, b) => a.lap_number - b.lap_number);

    // 2. Map each position entry to a lap number, keep last per driver per lap
    const lapDriverPos = new Map<number, Map<number, number>>(); // lap -> driver -> position
    for (const p of positions) {
      const dLaps = driverLapsMap.get(p.driver_number);
      if (!dLaps?.length) continue;
      let matchedLap: number | null = null;
      for (let i = dLaps.length - 1; i >= 0; i--) {
        if (dLaps[i].date_start! <= p.date) { matchedLap = dLaps[i].lap_number; break; }
      }
      if (matchedLap == null) {
        // If timestamp is before first lap, assign to lap 1
        matchedLap = dLaps[0].lap_number;
      }
      if (!lapDriverPos.has(matchedLap)) lapDriverPos.set(matchedLap, new Map());
      lapDriverPos.get(matchedLap)!.set(p.driver_number, p.position);
    }

    // 3. Determine all laps and all drivers
    const allLapNumbers = new Set<number>();
    for (const lap of allLaps) allLapNumbers.add(lap.lap_number);
    const sortedLaps = [...allLapNumbers].sort((a, b) => a - b);

    const allDriverNums = new Set<number>();
    for (const [, dMap] of lapDriverPos) {
      for (const dNum of dMap.keys()) allDriverNums.add(dNum);
    }

    // 4. Carry-forward: for each lap, use current position or last known
    const lastKnownPos = new Map<number, number>(); // driver -> last known position
    const result = new Map<number, Map<number, number>>(); // lap -> position -> driver

    for (const lap of sortedLaps) {
      const currentLapData = lapDriverPos.get(lap);
      // Update last known positions with any new data from this lap
      if (currentLapData) {
        for (const [dNum, pos] of currentLapData) {
          lastKnownPos.set(dNum, pos);
        }
      }

      // Build position -> driver map from all last-known positions
      const posMap = new Map<number, number>();
      for (const [dNum, pos] of lastKnownPos) {
        // If multiple drivers share a position, the latest update wins
        posMap.set(pos, dNum);
      }
      if (posMap.size > 0) result.set(lap, posMap);
    }

    return result;
  }, [positions, allLaps]);

  // Build lap-based gap/interval data by correlating intervals with laps
  const gapChartData = useMemo(() => {
    if (!intervals.length || !results.length || !allLaps.length) return [];
    const driverNums = results.slice(0, 20).map((r) => r.driver_number);

    const driverLapsMap = new Map<number, Lap[]>();
    for (const lap of allLaps) {
      if (!lap.date_start) continue;
      if (!driverLapsMap.has(lap.driver_number)) driverLapsMap.set(lap.driver_number, []);
      driverLapsMap.get(lap.driver_number)!.push(lap);
    }
    for (const [, laps] of driverLapsMap) laps.sort((a, b) => a.lap_number - b.lap_number);

    const lapGap = new Map<number, Map<number, { gap: number | null; ivl: number | null }>>();

    for (const item of intervals) {
      if (!driverNums.includes(item.driver_number)) continue;
      const dLaps = driverLapsMap.get(item.driver_number);
      if (!dLaps || !dLaps.length) continue;
      let matchedLap: number | null = null;
      for (let i = dLaps.length - 1; i >= 0; i--) {
        if (dLaps[i].date_start! <= item.date) { matchedLap = dLaps[i].lap_number; break; }
      }
      if (matchedLap == null) continue;
      if (!lapGap.has(matchedLap)) lapGap.set(matchedLap, new Map());
      const lapMap = lapGap.get(matchedLap)!;
      const gap = typeof item.gap_to_leader === "number" ? item.gap_to_leader : null;
      const ivl = typeof item.interval === "number" ? item.interval : null;
      lapMap.set(item.driver_number, { gap, ivl });
    }

    const lapNumbers = [...lapGap.keys()].sort((a, b) => a - b);
    const data: Record<string, any>[] = [];
    for (const lap of lapNumbers) {
      const point: Record<string, any> = { lap };
      const lapMap = lapGap.get(lap)!;
      const posMap = positionByLap.get(lap); // position -> driver_number
      for (const num of driverNums) {
        const vals = lapMap.get(num);
        if (vals?.gap != null) point[`gap_${num}`] = vals.gap;
        if (vals?.ivl != null) point[`ivl_${num}`] = vals.ivl;
        // Determine car ahead driver from position data
        // Try current lap, then nearby laps as fallback
        let aheadFound = false;
        const lapsToTry = [lap, lap - 1, lap + 1];
        for (const tryLap of lapsToTry) {
          const posMap = positionByLap.get(tryLap);
          if (!posMap) continue;
          let driverPos: number | null = null;
          for (const [pos, dNum] of posMap) {
            if (dNum === num) { driverPos = pos; break; }
          }
          if (driverPos != null) {
            if (driverPos === 1) {
              point[`ahead_${num}`] = -1; // sentinel for "Leader"
            } else {
              const aheadNum = posMap.get(driverPos - 1);
              if (aheadNum != null) point[`ahead_${num}`] = aheadNum;
            }
            aheadFound = true;
            break;
          }
        }
      }
      if (Object.keys(point).length > 1) data.push(point);
    }
    return data;
  }, [intervals, results, allLaps, positionByLap]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading session report…
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-destructive bg-destructive/10 rounded-md px-4 py-2.5">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Trophy className="h-3.5 w-3.5" />
          Session Results
        </h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Pos</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead className="text-right">Gap</TableHead>
                <TableHead className="text-right">Laps</TableHead>
                <TableHead className="w-16">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.driver_number}>
                  <TableCell className="font-mono font-bold">{r.position}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: `#${driverColor(r.driver_number)}` }}
                      />
                      <span className="font-mono font-bold">{driverName(r.driver_number)}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{driverTeam(r.driver_number)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-xs">
                    {formatDuration(r.duration)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-xs text-muted-foreground">
                    {formatGap(r.gap_to_leader)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-xs">{r.number_of_laps}</TableCell>
                  <TableCell className="text-xs">
                    {r.dnf ? <span className="text-destructive">DNF</span> :
                     r.dns ? <span className="text-muted-foreground">DNS</span> :
                     r.dsq ? <span className="text-destructive">DSQ</span> :
                     <span className="text-green-500">✓</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {weatherSummary && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Cloud className="h-3.5 w-3.5" />
            Weather Conditions
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <span className="text-xs text-muted-foreground">Air Temp</span>
              <p className="font-mono font-bold text-sm">{weatherSummary.air_temperature}°C</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Track Temp</span>
              <p className="font-mono font-bold text-sm">{weatherSummary.track_temperature}°C</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Humidity</span>
              <p className="font-mono font-bold text-sm">{weatherSummary.humidity}%</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Wind</span>
              <p className="font-mono font-bold text-sm">{weatherSummary.wind_speed} km/h</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Pressure</span>
              <p className="font-mono font-bold text-sm">{weatherSummary.pressure} hPa</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Rainfall</span>
              <p className="font-mono font-bold text-sm">{weatherSummary.rainfall > 0 ? "Yes 🌧" : "No ☀️"}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Wind Direction</span>
              <p className="font-mono font-bold text-sm">{weatherSummary.wind_direction}°</p>
            </div>
          </div>
        </div>
      )}

      {isRace && startingGrid.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Flag className="h-3.5 w-3.5" />
            Starting Grid
          </h3>
          <div className="grid grid-cols-2 gap-1">
            {startingGrid.map((g) => (
              <div
                key={g.driver_number}
                className={`flex items-center gap-3 text-xs py-1.5 px-3 rounded bg-muted/50 ${
                  g.position % 2 === 1 ? "" : "ml-8"
                }`}
              >
                <span className="font-mono font-bold w-5 text-right">{g.position}</span>
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: `#${driverColor(g.driver_number)}` }}
                />
                <span className="font-mono font-bold">{driverName(g.driver_number)}</span>
                <span className="text-muted-foreground ml-auto tabular-nums font-mono">
                  {formatDuration(g.lap_duration)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Driver Filter */}
      {isRace && positionDrivers.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filter Drivers</h3>
            <div className="flex gap-2">
              <button onClick={selectAllDrivers} className="text-[10px] text-primary hover:underline">All</button>
              <button onClick={selectNoneDrivers} className="text-[10px] text-primary hover:underline">None</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {positionDrivers.map((num) => {
              const active = !visibleDrivers || visibleDrivers.has(num);
              return (
                <button
                  key={num}
                  onClick={() => toggleDriver(num)}
                  className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-all ${
                    active
                      ? "border-border bg-muted/80 text-foreground"
                      : "border-transparent bg-muted/20 text-muted-foreground opacity-40"
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: `#${driverColor(num)}` }}
                  />
                  {driverName(num)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isRace && tyreStrategy.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <CircleDot className="h-3.5 w-3.5" />
            Tyre Strategy
          </h3>
          <div className="space-y-1">
            {tyreStrategy.filter(({ driverNumber }) => !visibleDrivers || visibleDrivers.has(driverNumber)).map(({ driverNumber, stints: dStints }) => (
              <div key={driverNumber} className="flex items-center gap-2 text-xs">
                <span className="font-mono font-bold w-10 shrink-0 text-right">
                  {driverName(driverNumber)}
                </span>
                <div className="flex-1 flex h-5 rounded overflow-hidden bg-muted/30 relative">
                  {dStints.map((s) => {
                    const left = ((s.lap_start - 1) / maxLap) * 100;
                    const width = ((s.lap_end - s.lap_start + 1) / maxLap) * 100;
                    return (
                      <div
                        key={s.stint_number}
                        className="absolute h-full flex items-center justify-center text-[9px] font-bold text-black/70 border-r border-background/50"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          backgroundColor: compoundColors[s.compound] ?? "hsl(0,0%,50%)",
                        }}
                        title={`${s.compound} L${s.lap_start}-${s.lap_end}`}
                      >
                        {width > 5 ? s.compound.charAt(0) : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-3">
            {Object.entries(compoundColors).map(([compound, color]) => (
              <span key={compound} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                {compound}
              </span>
            ))}
          </div>
        </div>
      )}

      {isRace && pitStops.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Pit Stops ({pitStops.length})
          </h3>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {pitStops.filter((p) => !visibleDrivers || visibleDrivers.has(p.driver_number)).map((p, i) => (
              <div key={i} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded bg-muted/50">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: `#${driverColor(p.driver_number)}` }}
                />
                <span className="font-mono font-bold w-10">{driverName(p.driver_number)}</span>
                <span className="text-muted-foreground">Lap {p.lap_number}</span>
                <span className="font-mono tabular-nums ml-auto">
                  {p.lane_duration.toFixed(1)}s
                  <span className="text-muted-foreground ml-1">lane</span>
                </span>
                {p.stop_duration != null && (
                  <span className="font-mono tabular-nums">
                    {p.stop_duration.toFixed(1)}s
                    <span className="text-muted-foreground ml-1">stop</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isRace && positionChartData.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4 relative overflow-hidden">
          <Watermark />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5" />
            Position Evolution
          </h3>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={positionChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="lap"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Lap", position: "insideBottomRight", offset: -5, fontSize: 10 }}
                tickFormatter={(v) => String(Math.round(v))}
                allowDecimals={false}
              />
              <YAxis
                reversed
                domain={[1, 20]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Position", angle: -90, position: "insideLeft", fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 11,
                }}
                formatter={(value: any, name: string) => {
                  const num = parseInt(name.replace("d", ""));
                  return [`P${value}`, driverName(num)];
                }}
                labelFormatter={(label) => `Lap ${label}`}
              />
              {filteredDrivers.map((num) => (
                <Line
                  key={num}
                  type="stepAfter"
                  dataKey={`d${num}`}
                  stroke={`#${driverColor(num)}`}
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls
                  name={`d${num}`}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-2">
            {filteredDrivers.map((num) => (
              <span key={num} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${driverColor(num)}` }} />
                {driverName(num)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Gap to Leader */}
      {isRace && gapChartData.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4 relative overflow-hidden">
          <Watermark />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5" />
            Gap to Leader (seconds)
          </h3>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={gapChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="lap"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Lap", position: "insideBottomRight", offset: -5, fontSize: 10 }}
                tickFormatter={(v) => String(Math.round(v))}
                allowDecimals={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Gap (s)", angle: -90, position: "insideLeft", fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 11,
                }}
                formatter={(value: any, name: string) => {
                  const num = parseInt(name.replace("gap_", ""));
                  return [`${Number(value).toFixed(3)}s`, driverName(num)];
                }}
                labelFormatter={(label) => `Lap ${label}`}
              />
              {filteredDrivers.map((num) => (
                <Line
                  key={num}
                  type="monotone"
                  dataKey={`gap_${num}`}
                  stroke={`#${driverColor(num)}`}
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls
                  name={`gap_${num}`}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-2">
            {filteredDrivers.map((num) => (
              <span key={num} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${driverColor(num)}` }} />
                {driverName(num)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Interval to Car Ahead */}
      {isRace && gapChartData.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4 relative overflow-hidden">
          <Watermark />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5" />
            Interval to Car Ahead (seconds)
          </h3>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={gapChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="lap"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Lap", position: "insideBottomRight", offset: -5, fontSize: 10 }}
                tickFormatter={(v) => String(Math.round(v))}
                allowDecimals={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Interval (s)", angle: -90, position: "insideLeft", fontSize: 10 }}
                domain={[0, 10]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 11,
                }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div style={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      fontSize: 11,
                      padding: "8px 12px",
                      borderRadius: 4,
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Lap {label}</div>
                      {payload.map((entry: any) => {
                        const num = parseInt(entry.dataKey.replace("ivl_", ""));
                        const lapData = gapChartData.find((d: any) => d.lap === label);
                        const aheadNum = lapData?.[`ahead_${num}`];
                        const aheadLabel = aheadNum != null ? driverName(aheadNum) : (
                          // Check if driver is P1 (no car ahead)
                          lapData?.[`ivl_${num}`] != null ? "N/A" : "N/A"
                        );
                        // If interval exists but is the leader, show "Leader"
                        const posMap = positionByLap.get(label as number);
                        let isLeader = false;
                        if (posMap) {
                          for (const [pos, dNum] of posMap) {
                            if (dNum === num && pos === 1) { isLeader = true; break; }
                          }
                        }
                        return (
                          <div key={entry.dataKey} style={{ display: "flex", flexDirection: "column", marginBottom: 3 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: entry.color, display: "inline-block" }} />
                              <span style={{ fontWeight: 500 }}>{driverName(num)}</span>
                              <span style={{ marginLeft: "auto", fontFamily: "monospace" }}>{Number(entry.value).toFixed(3)}s</span>
                            </div>
                            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginLeft: 14 }}>
                              Ahead: {isLeader ? "Leader" : aheadNum != null ? aheadLabel : "N/A"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              {filteredDrivers.map((num) => (
                <Line
                  key={num}
                  type="monotone"
                  dataKey={`ivl_${num}`}
                  stroke={`#${driverColor(num)}`}
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls
                  name={`ivl_${num}`}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-2">
            {filteredDrivers.map((num) => (
              <span key={num} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${driverColor(num)}` }} />
                {driverName(num)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cumulative Deviation */}
      {isRace && results.length > 0 && (
        <CumulativeDeviationCard
          sessionKey={sessionKey}
          results={results}
          drivers={drivers}
          visibleDrivers={visibleDrivers}
        />
      )}
    </div>
  );
}
