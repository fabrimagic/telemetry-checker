import { useState, useCallback, useMemo } from "react";
import { SessionInput } from "@/components/f1/SessionInput";
import { DriverPicker } from "@/components/f1/DriverPicker";
import { LapTable } from "@/components/f1/LapTable";
import { TelemetryCharts } from "@/components/f1/TelemetryCharts";
import { TrackMap } from "@/components/f1/TrackMap";
import { Loader2 } from "lucide-react";
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

export default function Index() {
  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [selectedLap, setSelectedLap] = useState<number | null>(null);
  const [carData, setCarData] = useState<CarData[]>([]);
  const [locationData, setLocationData] = useState<LocationData[]>([]);

  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [loadingLaps, setLoadingLaps] = useState(false);
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [clickedTime, setClickedTime] = useState<number | null>(null);

  const selectedDriverObj = drivers.find((d) => d.driver_number === selectedDriver);
  const teamColor = selectedDriverObj?.team_colour || "ffffff";

  // Load drivers for session
  const handleSessionSubmit = useCallback(async (key: number) => {
    setError(null);
    setSessionKey(key);
    setSelectedDriver(null);
    setLaps([]);
    setSelectedLap(null);
    setCarData([]);
    setLocationData([]);
    setLoadingDrivers(true);
    try {
      const d = await getDrivers(key);
      setDrivers(d);
      if (!d.length) setError("No drivers found for this session.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  // Load laps for driver
  const handleDriverSelect = useCallback(
    async (driverNumber: number) => {
      if (!sessionKey) return;
      setSelectedDriver(driverNumber);
      setSelectedLap(null);
      setCarData([]);
      setLocationData([]);
      setLoadingLaps(true);
      setError(null);
      try {
        const l = await getLaps(sessionKey, driverNumber);
        setLaps(l);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoadingLaps(false);
      }
    },
    [sessionKey]
  );

  // Load telemetry for lap
  const handleLapSelect = useCallback(
    async (lapNumber: number) => {
      if (!sessionKey || !selectedDriver) return;
      setSelectedLap(lapNumber);
      setClickedTime(null);
      setCursorTime(null);
      setLoadingTelemetry(true);
      setError(null);

      const lap = laps.find((l) => l.lap_number === lapNumber);
      if (!lap?.date_start || !lap.lap_duration) {
        setError("Lap data incomplete (missing start time or duration).");
        setLoadingTelemetry(false);
        return;
      }

      const start = lap.date_start;
      const endDate = new Date(new Date(start).getTime() + lap.lap_duration * 1000).toISOString();

      try {
        const [car, loc] = await Promise.all([
          getCarData(sessionKey, selectedDriver, start, endDate),
          getLocation(sessionKey, selectedDriver, start, endDate),
        ]);
        setCarData(car);
        setLocationData(loc);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoadingTelemetry(false);
      }
    },
    [sessionKey, selectedDriver, laps]
  );

  const handleFastest = useCallback(() => {
    const valid = laps.filter((l) => l.lap_duration != null);
    if (!valid.length) return;
    const fastest = valid.reduce((a, b) => (a.lap_duration! < b.lap_duration! ? a : b));
    handleLapSelect(fastest.lap_number);
  }, [laps, handleLapSelect]);

  // Transform car data to chart-friendly format
  const telemetryPoints = useMemo(() => {
    if (!carData.length) return [];
    const t0 = new Date(carData[0].date).getTime();
    return carData.map((d) => ({
      time: (new Date(d.date).getTime() - t0) / 1000,
      speed: d.speed,
      throttle: d.throttle,
      brake: d.brake ? 100 : 0,
      rpm: d.rpm,
      gear: d.n_gear,
      date: d.date,
    }));
  }, [carData]);

  // Find date string for active cursor
  const activeDate = useMemo(() => {
    const t = clickedTime ?? cursorTime;
    if (t == null || !telemetryPoints.length) return null;
    let closest = telemetryPoints[0];
    let minDiff = Infinity;
    for (const pt of telemetryPoints) {
      const diff = Math.abs(pt.time - t);
      if (diff < minDiff) {
        minDiff = diff;
        closest = pt;
      }
    }
    return closest.date;
  }, [clickedTime, cursorTime, telemetryPoints]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-[hsl(var(--f1-red))]" />
          <h1 className="text-lg font-bold tracking-tight">F1 Telemetry</h1>
          <span className="text-xs text-muted-foreground ml-1">OpenF1 Data</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Controls */}
        <section className="flex flex-wrap gap-6 items-end">
          <SessionInput onSubmit={handleSessionSubmit} isLoading={loadingDrivers} />
          {drivers.length > 0 && (
            <DriverPicker drivers={drivers} selected={selectedDriver} onSelect={handleDriverSelect} />
          )}
        </section>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-4 py-2.5">{error}</div>
        )}

        {loadingLaps && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading laps…
          </div>
        )}

        {/* Lap Table */}
        {laps.length > 0 && !loadingLaps && (
          <LapTable laps={laps} selectedLap={selectedLap} onSelectLap={handleLapSelect} onFastest={handleFastest} />
        )}

        {loadingTelemetry && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading telemetry…
          </div>
        )}

        {/* Telemetry + Map */}
        {telemetryPoints.length > 0 && !loadingTelemetry && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
            <section className="bg-card rounded-lg border border-border p-4 overflow-hidden">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Lap {selectedLap} Telemetry
              </h3>
              <TelemetryCharts
                data={telemetryPoints}
                teamColor={teamColor}
                cursorTime={clickedTime ?? cursorTime}
                onCursorChange={setCursorTime}
                onCursorClick={setClickedTime}
              />
            </section>
            <TrackMap locations={locationData} activeDate={activeDate} teamColor={teamColor} />
          </div>
        )}
      </main>
    </div>
  );
}
