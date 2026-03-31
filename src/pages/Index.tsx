import { useState, useCallback, useMemo } from "react";
import { SessionPicker } from "@/components/f1/SessionPicker";
import { LapTimesChart } from "@/components/f1/LapTimesChart";
import { DriverPicker } from "@/components/f1/DriverPicker";
import { LapTable } from "@/components/f1/LapTable";
import { TelemetryCharts, type DriverTelemetry, type TelemetryPoint } from "@/components/f1/TelemetryCharts";
import { TrackMap } from "@/components/f1/TrackMap";
import { SectorMiniSectors } from "@/components/f1/SectorMiniSectors";
import { DrivingAnalysis, computeDriverZones } from "@/components/f1/DrivingAnalysis";
import { TyreDegradationCard } from "@/components/f1/TyreDegradationCard";
import { calculateTyreDegradation } from "@/lib/tyreDegradation";
import { detectLongRuns, longRunToStintsAndLaps } from "@/lib/longRunDetector";
import { classifyLapsWeather, type WeatherCondition } from "@/lib/weatherClassification";
import { WeatherCard } from "@/components/f1/WeatherCard";
import { OvertakesCard } from "@/components/f1/OvertakesCard";
import { StintsCard } from "@/components/f1/StintsCard";
import { PitStopsCard } from "@/components/f1/PitStopsCard";
import { SessionReport } from "@/components/f1/SessionReport";
import { Loader2, RotateCcw, TrendingDown, Info, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Play } from "lucide-react";
import {
  getDrivers,
  getLaps,
  getCarData,
  getLocation,
  getWeather,
  getOvertakes,
  getStints,
  getPitStops,
  getWeatherForSession,
  type Driver,
  type Lap,
  type CarData,
  type LocationData,
  type WeatherData,
  type OvertakeData,
  type StintData,
  type PitData,
} from "@/lib/openf1";

interface DriverState {
  driver: Driver;
  laps: Lap[];
  stints: StintData[];
  selectedLap: number | null;
  carData: CarData[];
  locationData: LocationData[];
}

export default function Index() {
  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState<string>("");
  const [viewMode, setViewMode] = useState<"drivers" | "report">("drivers");
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [selectedDriverNumbers, setSelectedDriverNumbers] = useState<number[]>([]);
  const [driverStates, setDriverStates] = useState<Map<number, DriverState>>(new Map());

  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [loadingLaps, setLoadingLaps] = useState<Set<number>>(new Set());
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [overtakesData, setOvertakesData] = useState<OvertakeData[]>([]);
  const [stintsData, setStintsData] = useState<StintData[]>([]);
  const [pitStopsData, setPitStopsData] = useState<PitData[]>([]);
  const [sessionWeather, setSessionWeather] = useState<WeatherData[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [clickedTime, setClickedTime] = useState<number | null>(null);

  // Load drivers for session
  const handleSessionSubmit = useCallback(async (key: number, type: string) => {
    setError(null);
    setSessionKey(key);
    setSessionType(type);
    setViewMode("drivers");
    setSelectedDriverNumbers([]);
    setDriverStates(new Map());
    setSessionWeather([]);
    setLoadingDrivers(true);
    try {
      const d = await getDrivers(key);
      setAllDrivers(d);
      if (!d.length) setError("No drivers found for this session.");
      // Fetch session weather for lap classification (fire and forget)
      getWeatherForSession(key).then((w) => setSessionWeather(w)).catch(() => {});
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
        let driverStints: StintData[] = [];
        try {
          driverStints = await getStints(sessionKey, driverNumber);
        } catch { /* optional */ }
        setDriverStates((prev) => {
          const next = new Map(prev);
          next.set(driverNumber, { driver, laps, stints: driverStints, selectedLap: null, carData: [], locationData: [] });
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
    setWeatherData(null);
    setOvertakesData([]);
    setStintsData([]);
    setPitStopsData([]);

    const updates: [number, CarData[], LocationData[]][] = [];

    try {
      let weatherStart: string | null = null;
      let weatherEnd: string | null = null;

      // Sequential to respect rate limits
      for (const [num, state] of driverStates) {
        if (!state.selectedLap) continue;
        const lap = state.laps.find((l) => l.lap_number === state.selectedLap);
        if (!lap?.date_start || !lap.lap_duration) continue;

        const start = lap.date_start;
        const endDate = new Date(new Date(start).getTime() + lap.lap_duration * 1000).toISOString();

        // Use first driver's lap time range for weather
        if (!weatherStart) {
          weatherStart = start;
          weatherEnd = endDate;
        }

        const car = await getCarData(sessionKey, num, start, endDate);
        const loc = await getLocation(sessionKey, num, start, endDate);
        updates.push([num, car, loc]);
      }

      // Fetch weather only when single driver selected
      if (selectedDriverNumbers.length === 1 && weatherStart && weatherEnd) {
        try {
          const weather = await getWeather(sessionKey, weatherStart, weatherEnd);
          if (weather.length > 0) {
            // Pick the weather reading closest to the lap start
            setWeatherData(weather[weather.length - 1]);
          }
        } catch {
          // Weather is optional, don't fail the whole load
        }
      }

      // Fetch overtakes for single driver in Race/Sprint sessions
      if (
        selectedDriverNumbers.length === 1 &&
        (sessionType === "Race" || sessionType === "Sprint")
      ) {
        try {
          const ot = await getOvertakes(sessionKey, selectedDriverNumbers[0]);
          setOvertakesData(ot);
        } catch {
          // Overtakes are optional
        }
        try {
          const st = await getStints(sessionKey, selectedDriverNumbers[0]);
          setStintsData(st);
        } catch {
          // Stints are optional
        }
      }

      // Fetch pit stops in Race/Sprint sessions for all selected drivers
      if (sessionType === "Race" || sessionType === "Sprint") {
        const allPits: PitData[] = [];
        for (const num of selectedDriverNumbers) {
          try {
            const pits = await getPitStops(sessionKey, num);
            allPits.push(...pits);
          } catch {
            // Pit data is optional
          }
        }
        allPits.sort((a, b) => a.lap_number - b.lap_number);
        setPitStopsData(allPits);
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
  }, [sessionKey, driverStates, selectedDriverNumbers, sessionType]);

  const handleReset = useCallback(() => {
    setSessionKey(null);
    setSessionType("");
    setAllDrivers([]);
    setSelectedDriverNumbers([]);
    setDriverStates(new Map());
    setWeatherData(null);
    setOvertakesData([]);
    setStintsData([]);
    setPitStopsData([]);
    setError(null);
    setCursorTime(null);
    setClickedTime(null);
  }, []);

  // Differentiate colors for teammates (same team_colour)
  const driverColorMap = useMemo(() => {
    const states = [...driverStates.values()];
    const map = new Map<number, string>();
    const seen = new Map<string, number>(); // color -> count
    for (const s of states) {
      const base = (s.driver.team_colour || "ffffff").toLowerCase();
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      if (count > 0) {
        // Lighten the color for the second teammate
        const r = parseInt(base.slice(0, 2), 16);
        const g = parseInt(base.slice(2, 4), 16);
        const b = parseInt(base.slice(4, 6), 16);
        const lighten = (v: number) => Math.min(255, v + 70);
        const alt = [lighten(r), lighten(g), lighten(b)]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
        map.set(s.driver.driver_number, alt);
      } else {
        map.set(s.driver.driver_number, base);
      }
    }
    return map;
  }, [driverStates]);

  const getColor = useCallback(
    (driverNumber: number) => driverColorMap.get(driverNumber) || "ffffff",
    [driverColorMap]
  );

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
          color: getColor(s.driver.driver_number),
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
        color: getColor(s.driver.driver_number),
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
          stints: s.stints,
          selectedLap: s.selectedLap,
        })),
    [selectedDriverNumbers, driverStates]
  );

  // Long-run detection for Practice sessions
  const longRunResults = useMemo(() => {
    if (!sessionType.includes("Practice")) return [];
    return selectedDriverNumbers.flatMap((num) => {
      const state = driverStates.get(num);
      if (!state) return [];
      // Infer pit-in laps from stints (last lap of each stint except final)
      const pitInLaps: import("@/lib/openf1").PitData[] = state.stints
        .slice(0, -1)
        .map((s) => ({ lap_number: s.lap_end } as import("@/lib/openf1").PitData));
      return detectLongRuns(
        num,
        state.driver.name_acronym,
        getColor(num),
        state.laps,
        state.stints,
        pitInLaps
      );
    });
  }, [selectedDriverNumbers, driverStates, sessionType, getColor]);

  // Tyre degradation results
  const degradationResults = useMemo(() => {
    const validTypes = ["Race", "Sprint", "Practice"];
    if (!validTypes.some((t) => sessionType.includes(t))) return [];
    return selectedDriverNumbers.flatMap((num) => {
      const state = driverStates.get(num);
      if (!state) return [];

      // For Practice: use only long-run laps
      if (sessionType.includes("Practice")) {
        const driverLongRuns = longRunResults.filter((lr) => lr.driverNumber === num);
        const { filteredLaps, virtualStints } = longRunToStintsAndLaps(
          state.laps,
          driverLongRuns,
          state.stints
        );
        if (!filteredLaps.length) return [];
        return calculateTyreDegradation(
          num,
          state.driver.name_acronym,
          getColor(num),
          filteredLaps,
          virtualStints
        );
      }

      return calculateTyreDegradation(
        num,
        state.driver.name_acronym,
        getColor(num),
        state.laps,
        state.stints
      );
    });
  }, [selectedDriverNumbers, driverStates, sessionType, getColor, longRunResults]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-1 h-6 rounded-full bg-[hsl(var(--f1-red))]" />
            <h1 className="text-lg font-bold tracking-tight">Formula Insights</h1>
          </div>
          {sessionKey && (
            <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5 text-xs text-muted-foreground">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Controls */}
        <section className="flex flex-wrap gap-6 items-start">
          <SessionPicker onSelect={handleSessionSubmit} isLoading={loadingDrivers} />
        </section>

        {/* Mode Toggle */}
        {allDrivers.length > 0 && (
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "drivers" | "report")}>
            <TabsList>
              <TabsTrigger value="drivers">Driver Analysis</TabsTrigger>
              <TabsTrigger value="report">Session Report</TabsTrigger>
            </TabsList>

            <TabsContent value="report" className="mt-4">
              {sessionKey && <SessionReport sessionKey={sessionKey} sessionType={sessionType} />}
            </TabsContent>

            <TabsContent value="drivers" className="mt-4 space-y-6">
              <DriverPicker
                drivers={allDrivers}
                selected={selectedDriverNumbers}
                onAdd={handleAddDriver}
                onRemove={handleRemoveDriver}
              />

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
            <LapTimesChart
              drivers={driversLaps.map((dl) => ({
                driverNumber: dl.driver.driver_number,
                acronym: dl.driver.name_acronym,
                color: getColor(dl.driver.driver_number),
                laps: dl.laps,
                stints: dl.stints,
              }))}
              selectedLaps={driversLaps.map((dl) => ({
                driverNumber: dl.driver.driver_number,
                lapNumber: dl.selectedLap,
              }))}
              onSelectLap={handleSelectLap}
            />
            <LapTable driversLaps={driversLaps} onSelectLap={handleSelectLap} onFastest={handleFastest} />
            {degradationResults.length > 0 ? (
              <TyreDegradationCard results={degradationResults} longRuns={sessionType.includes("Practice") ? longRunResults : undefined} />
            ) : sessionType.includes("Practice") && selectedDriverNumbers.length > 0 && (
              <div className="bg-card rounded-lg border border-border p-4">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <TrendingDown className="h-3.5 w-3.5" />
                  Tyre Degradation
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Dati insufficienti per calcolare il degrado gomme. Non sono state rilevate simulazioni passo gara (long run) con un numero sufficiente di giri validi per i piloti selezionati.
                </p>
                <details className="group">
                  <summary className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/40 rounded-md px-3 py-2 w-full hover:bg-muted/60 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium text-foreground/80">Come funziona il rilevamento Long Run</span>
                    <ChevronDown className="h-3 w-3 ml-auto transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="bg-muted/40 rounded-b-md px-3 py-2.5 space-y-2 text-[11px] text-muted-foreground -mt-1">
                    <ul className="space-y-1.5 pl-5 list-disc">
                      <li><span className="font-mono font-bold text-foreground/80">Long Run</span> — Sequenza di almeno 5 giri consecutivi validi all'interno di uno stint, che simula il passo gara in una sessione di prove libere.</li>
                      <li><span className="font-mono font-bold text-foreground/80">Filtro giri</span> — Vengono esclusi out lap, in lap e giri anomali (tempo &lt; 99% o &gt; 107% della mediana dello stint).</li>
                      <li><span className="font-mono font-bold text-foreground/80">Score</span> — Ogni sequenza riceve un punteggio basato su: lunghezza (max +30), regolarità del passo (max +25), trend di degrado positivo (max +20), con penalità per giri push (-25) o alta variabilità (-15).</li>
                      <li><span className="font-mono font-bold text-foreground/80">Classificazione</span> — Score ≥ 60: probabile long run • Score 40–59: possibile long run • Score &lt; 40: non long run.</li>
                      <li><span className="font-mono font-bold text-foreground/80">Soglia minima</span> — Solo le sequenze con score ≥ 40 vengono utilizzate per il calcolo del degrado gomme.</li>
                    </ul>
                    <p className="pt-1 italic">Se nessuna sequenza raggiunge lo score minimo, il degrado non viene calcolato per quel pilota.</p>
                  </div>
                </details>
              </div>
            )}
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
              <SectorMiniSectors
                drivers={[...driverStates.values()]
                  .filter((s) => s.selectedLap != null && s.carData.length > 0)
                  .map((s) => {
                    const lap = s.laps.find((l) => l.lap_number === s.selectedLap)!;
                    return {
                      driver: s.driver,
                      lap,
                      color: getColor(s.driver.driver_number),
                    };
                  })}
              />
              <DrivingAnalysis
                drivers={[...driverStates.values()]
                  .filter((s) => s.carData.length > 0)
                  .map((s) => ({
                    driverNumber: s.driver.driver_number,
                    acronym: s.driver.name_acronym,
                    color: getColor(s.driver.driver_number),
                    carData: s.carData,
                  }))}
              />
            </section>
            <div className="space-y-6">
              <TrackMap
                drivers={mapDrivers}
                activeDate={activeDate}
                driverZones={[...driverStates.values()]
                  .filter((s) => s.carData.length > 0)
                  .map((s) => computeDriverZones(s.carData, s.driver.driver_number, getColor(s.driver.driver_number)))}
              />
              {weatherData && selectedDriverNumbers.length === 1 && (
                <WeatherCard weather={weatherData} />
              )}
              {overtakesData.length > 0 && selectedDriverNumbers.length === 1 && (
                <OvertakesCard overtakes={overtakesData} allDrivers={allDrivers} />
              )}
              {stintsData.length > 0 && selectedDriverNumbers.length === 1 && (
                <StintsCard stints={stintsData} />
              )}
              {pitStopsData.length > 0 && (sessionType === "Race" || sessionType === "Sprint") && (
                <PitStopsCard
                  pitStops={pitStopsData}
                  allDrivers={allDrivers}
                  multiDriver={selectedDriverNumbers.length > 1}
                />
              )}
            </div>
          </div>
        )}
            </TabsContent>
          </Tabs>
        )}
      </main>
      <footer className="border-t border-border px-6 py-4 mt-8">
        <p className="text-center text-xs text-muted-foreground">
          Questo è un progetto sviluppato da Fabrizio Monaco
        </p>
      </footer>
    </div>
  );
}
