import { useState, useCallback, useMemo } from "react";
import { SessionPicker } from "@/components/f1/SessionPicker";
import { DriverPicker } from "@/components/f1/DriverPicker";
import { LapTable } from "@/components/f1/LapTable";
import { TelemetryCharts, type DriverTelemetry, type TelemetryPoint } from "@/components/f1/TelemetryCharts";
import { TrackMap } from "@/components/f1/TrackMap";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import {
  getDrivers,
  getLaps,
  getCarData,
  getLocation,
  type Driver,
  type Lap,
  type CarData,
  type LocationData,
} from "@/lib/openf1";

interface DriverState {
  driver: Driver;
  laps: Lap[];
  selectedLap: number | null;
  carData: CarData[];
  locationData: LocationData[];
}

export default function Index() {
  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [selectedDriverNumbers, setSelectedDriverNumbers] = useState<number[]>([]);
  const [driverStates, setDriverStates] = useState<Map<number, DriverState>>(new Map());

  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [loadingLaps, setLoadingLaps] = useState<Set<number>>(new Set());
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [clickedTime, setClickedTime] = useState<number | null>(null);

  // Load drivers for session
  const handleSessionSubmit = useCallback(async (key: number) => {
    setError(null);
    setSessionKey(key);
    setSelectedDriverNumbers([]);
    setDriverStates(new Map());
    setLoadingDrivers(true);
    try {
      const d = await getDrivers(key);
      setAllDrivers(d);
      if (!d.length) setError("No drivers found for this session.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  // Add driver
  const handleAddDriver = useCallback(
    async (driverNumber: number) => {
      if (!sessionKey) return;
      setSelectedDriverNumbers((prev) => [...prev, driverNumber]);

      const driver = allDrivers.find((d) => d.driver_number === driverNumber);
      if (!driver) return;

      setLoadingLaps((prev) => new Set(prev).add(driverNumber));
      setError(null);
      try {
        const laps = await getLaps(sessionKey, driverNumber);
        setDriverStates((prev) => {
          const next = new Map(prev);
          next.set(driverNumber, { driver, laps, selectedLap: null, carData: [], locationData: [] });
          return next;
        });
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoadingLaps((prev) => {
          const next = new Set(prev);
          next.delete(driverNumber);
          return next;
        });
      }
    },
    [sessionKey, allDrivers]
  );

  // Remove driver
  const handleRemoveDriver = useCallback((driverNumber: number) => {
    setSelectedDriverNumbers((prev) => prev.filter((n) => n !== driverNumber));
    setDriverStates((prev) => {
      const next = new Map(prev);
      next.delete(driverNumber);
      return next;
    });
  }, []);

  // Select lap for a driver
  const handleSelectLap = useCallback(
    (driverNumber: number, lapNumber: number) => {
      setDriverStates((prev) => {
        const next = new Map(prev);
        const state = next.get(driverNumber);
        if (state) next.set(driverNumber, { ...state, selectedLap: lapNumber });
        return next;
      });
    },
    []
  );

  // Fastest lap for a driver
  const handleFastest = useCallback(
    (driverNumber: number) => {
      const state = driverStates.get(driverNumber);
      if (!state) return;
      const valid = state.laps.filter((l) => l.lap_duration != null);
      if (!valid.length) return;
      const fastest = valid.reduce((a, b) => (a.lap_duration! < b.lap_duration! ? a : b));
      handleSelectLap(driverNumber, fastest.lap_number);
    },
    [driverStates, handleSelectLap]
  );

  // Load telemetry for all drivers with selected laps
  const handleLoadTelemetry = useCallback(async () => {
    if (!sessionKey) return;
    setLoadingTelemetry(true);
    setError(null);
    setClickedTime(null);
    setCursorTime(null);

    const updates: [number, CarData[], LocationData[]][] = [];

    try {
      // Sequential to respect rate limits
      for (const [num, state] of driverStates) {
        if (!state.selectedLap) continue;
        const lap = state.laps.find((l) => l.lap_number === state.selectedLap);
        if (!lap?.date_start || !lap.lap_duration) continue;

        const start = lap.date_start;
        const endDate = new Date(new Date(start).getTime() + lap.lap_duration * 1000).toISOString();

        const car = await getCarData(sessionKey, num, start, endDate);
        const loc = await getLocation(sessionKey, num, start, endDate);
        updates.push([num, car, loc]);
      }

      setDriverStates((prev) => {
        const next = new Map(prev);
        for (const [num, car, loc] of updates) {
          const state = next.get(num);
          if (state) next.set(num, { ...state, carData: car, locationData: loc });
        }
        return next;
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingTelemetry(false);
    }
  }, [sessionKey, driverStates]);

  // Check if we have laps selected ready to load
  const hasLapsSelected = useMemo(
    () => [...driverStates.values()].some((s) => s.selectedLap != null),
    [driverStates]
  );

  // Build telemetry data for charts
  const chartDrivers: DriverTelemetry[] = useMemo(() => {
    return [...driverStates.values()]
      .filter((s) => s.carData.length > 0)
      .map((s) => {
        const t0 = new Date(s.carData[0].date).getTime();
        const data: TelemetryPoint[] = s.carData.map((d) => ({
          time: (new Date(d.date).getTime() - t0) / 1000,
          speed: d.speed,
          throttle: d.throttle,
          brake: d.brake ? 100 : 0,
          rpm: d.rpm,
          gear: d.n_gear,
          date: d.date,
        }));
        return {
          driverNumber: s.driver.driver_number,
          acronym: s.driver.name_acronym,
          color: s.driver.team_colour || "ffffff",
          data,
        };
      });
  }, [driverStates]);

  // Build location data for track map
  const mapDrivers = useMemo(() => {
    return [...driverStates.values()]
      .filter((s) => s.locationData.length > 0)
      .map((s) => ({
        driverNumber: s.driver.driver_number,
        acronym: s.driver.name_acronym,
        color: s.driver.team_colour || "ffffff",
        locations: s.locationData,
      }));
  }, [driverStates]);

  // Find date for cursor (use first driver's data as reference)
  const activeDate = useMemo(() => {
    const t = clickedTime ?? cursorTime;
    if (t == null || !chartDrivers.length || !chartDrivers[0].data.length) return null;
    const pts = chartDrivers[0].data;
    let closest = pts[0];
    let minDiff = Infinity;
    for (const pt of pts) {
      const diff = Math.abs(pt.time - t);
      if (diff < minDiff) {
        minDiff = diff;
        closest = pt;
      }
    }
    return closest.date;
  }, [clickedTime, cursorTime, chartDrivers]);

  // Lap table data
  const driversLaps = useMemo(
    () =>
      selectedDriverNumbers
        .map((num) => driverStates.get(num))
        .filter((s): s is DriverState => !!s)
        .map((s) => ({
          driver: s.driver,
          laps: s.laps,
          selectedLap: s.selectedLap,
        })),
    [selectedDriverNumbers, driverStates]
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-[hsl(var(--f1-red))]" />
          <h1 className="text-lg font-bold tracking-tight">F1 Telemetry</h1>
          <span className="text-xs text-muted-foreground ml-1">OpenF1 Data</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Controls */}
        <section className="flex flex-wrap gap-6 items-start">
          <SessionPicker onSelect={handleSessionSubmit} isLoading={loadingDrivers} />
          {allDrivers.length > 0 && (
            <DriverPicker
              drivers={allDrivers}
              selected={selectedDriverNumbers}
              onAdd={handleAddDriver}
              onRemove={handleRemoveDriver}
            />
          )}
        </section>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-4 py-2.5">{error}</div>
        )}

        {loadingLaps.size > 0 && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading laps…
          </div>
        )}

        {/* Lap Tables */}
        {driversLaps.length > 0 && loadingLaps.size === 0 && (
          <>
            <LapTable driversLaps={driversLaps} onSelectLap={handleSelectLap} onFastest={handleFastest} />
            {hasLapsSelected && (
              <Button
                onClick={handleLoadTelemetry}
                disabled={loadingTelemetry}
                className="gap-2"
              >
                {loadingTelemetry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Load Telemetry
              </Button>
            )}
          </>
        )}

        {loadingTelemetry && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading telemetry…
          </div>
        )}

        {/* Telemetry + Map */}
        {chartDrivers.length > 0 && !loadingTelemetry && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
            <section className="bg-card rounded-lg border border-border p-4 overflow-hidden">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Telemetry</h3>
                <div className="flex gap-3">
                  {chartDrivers.map((d) => (
                    <span key={d.driverNumber} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${d.color}` }} />
                      <span className="font-mono font-bold">{d.acronym}</span>
                    </span>
                  ))}
                </div>
              </div>
              <TelemetryCharts
                drivers={chartDrivers}
                cursorTime={clickedTime ?? cursorTime}
                onCursorChange={setCursorTime}
                onCursorClick={setClickedTime}
              />
            </section>
            <TrackMap drivers={mapDrivers} activeDate={activeDate} />
          </div>
        )}
      </main>
    </div>
  );
}
