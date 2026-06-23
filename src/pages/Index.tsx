import { useState, useCallback, useMemo, useRef } from "react";
import { CountdownBanner } from "@/components/f1/CountdownBanner";
import { WeekendWeatherCard } from "@/components/f1/WeekendWeatherCard";
import { NextCircuitCard } from "@/components/f1/NextCircuitCard";
import { Link } from "react-router-dom";
import { SessionPicker } from "@/components/f1/SessionPicker";
import { ChampionshipSummaryCard } from "@/components/f1/championship/ChampionshipSummaryCard";
import { LapTimesChart } from "@/components/f1/LapTimesChart";
import { DriverPicker } from "@/components/f1/DriverPicker";
import { LapTable } from "@/components/f1/LapTable";
import { TelemetryCharts, type DriverTelemetry, type TelemetryPoint } from "@/components/f1/TelemetryCharts";
import { TrackMap } from "@/components/f1/TrackMap";
import { SectorMiniSectors } from "@/components/f1/SectorMiniSectors";
import { DrivingAnalysis, computeDriverZones } from "@/components/f1/DrivingAnalysis";
import { PerLapDrivingCharts } from "@/components/f1/PerLapDrivingCharts";
import { TyreDegradationCard } from "@/components/f1/TyreDegradationCard";
import { DashboardSummary } from "@/components/f1/DashboardSummary";
import { calculateTyreDegradation } from "@/lib/tyreDegradation";
import { calculateCorrectedTyreDegradation } from "@/lib/correctedDegradation";
import { detectLongRuns, longRunToStintsAndLaps } from "@/lib/longRunDetector";
import { classifyLapsWeather, type WeatherCondition } from "@/lib/weatherClassification";
import { WeatherCard } from "@/components/f1/WeatherCard";
import { SoftSensorsLapCard } from "@/components/f1/SoftSensorsLapCard";
import { LapPrecipOutlookCard } from "@/components/f1/LapPrecipOutlookCard";
import { fetchLapPrecipOutlook, type LapPrecipOutlook } from "@/lib/precipForecast";
import { OvertakesCard } from "@/components/f1/OvertakesCard";
import { StintsCard } from "@/components/f1/StintsCard";
import { PitStopsCard } from "@/components/f1/PitStopsCard";
import { DataIntegrityNotice } from "@/components/f1/DataIntegrityNotice";
import { detectDataIntegrityIssues } from "@/lib/dataIntegrity";
import { SessionReport } from "@/components/f1/SessionReport";
import { Loader2, RotateCcw, TrendingDown, Info, ChevronDown, BarChart3, Eye, Gauge, Target, Wrench, User, Swords, ArrowRight, ArrowLeft } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { DriverDashboardCockpit } from "@/components/f1/DriverDashboardCockpit";
import { DriverMiniChartsGrid } from "@/components/f1/DriverMiniChartsGrid";
import { SectorVsWinnerGrid } from "@/components/f1/SectorVsWinnerGrid";
import { RaceEventTimeline } from "@/components/f1/RaceEventTimeline";
import { SoftSensorsTimelineCard } from "@/components/f1/SoftSensorsTimelineCard";
import { PitStopsChartCard } from "@/components/f1/PitStopsChartCard";
import { AppShell } from "@/components/layout/AppShell";
import { ToolbarSection } from "@/components/layout/ToolbarSection";
import { ContentGrid } from "@/components/layout/ContentGrid";
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
  getOvertakesReceived,
  getStints,
  getPitStops,
  getWeatherForSession,
  getRaceControl,
  getIntervals,
  getPositions,
  getSessionsByMeetingKey,
  getSessionResult,
  getAllLaps,
  type Driver,
  type Lap,
  type CarData,
  type LocationData,
  type WeatherData,
  type OvertakeData,
  type StintData,
  type PitData,
  type RaceControlMessage,
  type IntervalData,
  type PositionData,
  type SessionInfo,
} from "@/lib/openf1";
import { buildRaceDiary, type DiaryEvent } from "@/lib/raceDiary";
import { RaceDiaryCard } from "@/components/f1/RaceDiaryCard";
import { computeVirtualRaceEngineer, type VirtualRaceEngineerResult, type PracticeCompoundModel, type AnalysisMode } from "@/lib/virtualRaceEngineer";
import { VirtualRaceEngineerCard } from "@/components/f1/VirtualRaceEngineerCard";
import { VRESetupCard } from "@/components/f1/VRESetupCard";
import type { ViewMode } from "@/components/f1/VREViewModes";
import type { RiskMode } from "@/lib/riskAppetite";
import { computeKeyDecisionMoments, type KeyDecisionMomentsResult } from "@/lib/keyDecisionMoments";
import { KeyDecisionMomentsCard } from "@/components/f1/KeyDecisionMomentsCard";
import { classifyLapsTrackStatus } from "@/lib/trackStatusClassification";
import { computeCumulativeDeviation, type CumulativeDeviationResult } from "@/lib/cumulativeDeviation";
import { FullGasFeedSection } from "@/components/landing/FullGasFeedSection";
import { BuyMeCoffeePopup } from "@/components/landing/BuyMeCoffeePopup";

interface DriverState {
  driver: Driver;
  laps: Lap[];
  stints: StintData[];
  selectedLap: number | null;
  carData: CarData[];
  locationData: LocationData[];
}

export default function Index() {
  const [analysisMode, setAnalysisMode] = useState<"single" | null>(null);
  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState<string>("");
  const [meetingKey, setMeetingKey] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"drivers" | "report">("drivers");
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [selectedDriverNumbers, setSelectedDriverNumbers] = useState<number[]>([]);
  const [driverStates, setDriverStates] = useState<Map<number, DriverState>>(new Map());

  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [loadingLaps, setLoadingLaps] = useState<Set<number>>(new Set());
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  // Purely informative; never feeds any computation.
  const [lapPrecip, setLapPrecip] = useState<LapPrecipOutlook | null>(null);
  const [circuitKey, setCircuitKey] = useState<string | null>(null);
  const [overtakesData, setOvertakesData] = useState<OvertakeData[]>([]);
  const [overtakesReceivedData, setOvertakesReceivedData] = useState<OvertakeData[]>([]);
  const [stintsData, setStintsData] = useState<StintData[]>([]);
  const [pitStopsData, setPitStopsData] = useState<PitData[]>([]);
  const [diaryIntervals, setDiaryIntervals] = useState<IntervalData[]>([]);
  const [diaryPositions, setDiaryPositions] = useState<PositionData[]>([]);
  const [diaryEvents, setDiaryEvents] = useState<DiaryEvent[]>([]);
  const [sessionWeather, setSessionWeather] = useState<WeatherData[]>([]);
  const [raceControlMessages, setRaceControlMessages] = useState<RaceControlMessage[]>([]);
  const [sessionAllLaps, setSessionAllLaps] = useState<import("@/lib/openf1").Lap[]>([]);
  const [vreResult, setVreResult] = useState<VirtualRaceEngineerResult | null>(null);
  const [vreError, setVreError] = useState<string | null>(null);
  const [cumDevResult, setCumDevResult] = useState<CumulativeDeviationResult | null>(null);
  const [kdmResult, setKdmResult] = useState<KeyDecisionMomentsResult | null>(null);
  const [raceAvg, setRaceAvg] = useState<import("@/lib/raceDrivingAverages").RaceDrivingAverages | null>(null);
  const [loadingVre, setLoadingVre] = useState(false);
  const [vreRiskMode, setVreRiskMode] = useState<RiskMode>("BALANCED");
  const [vreScenario, setVreScenario] = useState<import("@/lib/scenarioContext").ScenarioId>("REAL_CONTEXT");
  const [vreScenarioLap, setVreScenarioLap] = useState<number | null>(null);
  const [vreScenarioDuration, setVreScenarioDuration] = useState<number | null>(null);
  const [vreCustomDeg, setVreCustomDeg] = useState<Record<string, number> | null>(null);
  const [vreAnalysisMode, setVreAnalysisMode] = useState<AnalysisMode>("RACE_ENGINEER");
  const [vreViewMode, setVreViewMode] = useState<ViewMode>("ENGINEER");
  const vreArgsRef = useRef<{
    driverNumber: number; driverAcronym: string; sessionKey: number;
    laps: any; stints: any; pits: any; weather: any; raceControl: any;
    intervals: any; positions: any; allDrivers: any; practiceModels: any;
    diaryEvents: DiaryEvent[] | null; cumDevResult: CumulativeDeviationResult | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [clickedTime, setClickedTime] = useState<number | null>(null);

  // Load drivers for session
  const handleSessionSubmit = useCallback(async (key: number, type: string, mKey: number) => {
    setError(null);
    setSessionKey(key);
    setSessionType(type);
    setMeetingKey(mKey);
    setViewMode("drivers");
    setSelectedDriverNumbers([]);
    setDriverStates(new Map());
    setSessionWeather([]);
    setRaceControlMessages([]);
    setLoadingDrivers(true);
    try {
      const d = await getDrivers(key);
      setAllDrivers(d);
      if (!d.length) setError("No drivers found for this session.");
      // Fetch session weather for lap classification (fire and forget)
      getWeatherForSession(key).then((w) => setSessionWeather(w)).catch(() => {});
      getRaceControl(key).then((rc) => setRaceControlMessages(rc)).catch(() => {});
      // Resolve circuit location/country for the per-lap precipitation outlook
      // card. Best-effort; failure simply leaves the card hidden.
      setCircuitKey(null);
      getSessionsByMeetingKey(mKey).then((sessions) => {
        const match = sessions.find((s) => s.session_key === key);
        const ck = match?.location ?? match?.country_name ?? null;
        setCircuitKey(ck);
      }).catch(() => {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  // Build diary when driver selection changes
  const [loadingDiary, setLoadingDiary] = useState(false);

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
        const laps = await getLaps(sessionKey, driverNumber, { forceFresh: true });
        let driverStints: StintData[] = [];
        try {
          driverStints = await getStints(sessionKey, driverNumber, { forceFresh: true });
        } catch { /* optional */ }
        setDriverStates((prev) => {
          const next = new Map(prev);
          next.set(driverNumber, { driver, laps, stints: driverStints, selectedLap: null, carData: [], locationData: [] });
          return next;
        });

        // Always fetch stints for display
        setStintsData((prev) => {
          const filtered = prev.filter((s) => s.driver_number !== driverNumber);
          return [...filtered, ...driverStints];
        });

        // Fetch pit stops for Race/Sprint
        if (sessionType === "Race" || sessionType === "Sprint") {
          try {
            const pits = await getPitStops(sessionKey, driverNumber, { forceFresh: true });
            setPitStopsData((prev) => {
              const filtered = prev.filter((p) => p.driver_number !== driverNumber);
              return [...filtered, ...pits].sort((a, b) => a.lap_number - b.lap_number);
            });
          } catch { /* optional */ }
        }

        // Fetch overtakes for single driver Race/Sprint
        const willBeSingle = selectedDriverNumbers.length === 0;
        if (willBeSingle && (sessionType === "Race" || sessionType === "Sprint")) {
          try { const ot = await getOvertakes(sessionKey, driverNumber, { forceFresh: true }); setOvertakesData(ot); } catch {}
          try { const otR = await getOvertakesReceived(sessionKey, driverNumber, { forceFresh: true }); setOvertakesReceivedData(otR); } catch {}
        }

        // Build diary immediately for single driver Race/Sprint
        if (willBeSingle && (sessionType === "Race" || sessionType === "Sprint")) {
          let ivls: IntervalData[] = [];
          let pos: PositionData[] = [];

          let diaryForVre: DiaryEvent[] = [];
          setLoadingDiary(true);
          try {
            try { ivls = await getIntervals(sessionKey); setDiaryIntervals(ivls); } catch {}
            try { pos = await getPositions(sessionKey); setDiaryPositions(pos); } catch {}

            const diary = buildRaceDiary(
              driverNumber,
              overtakesData.length ? overtakesData : await getOvertakes(sessionKey, driverNumber, { forceFresh: true }).catch(() => []),
              overtakesReceivedData.length ? overtakesReceivedData : await getOvertakesReceived(sessionKey, driverNumber, { forceFresh: true }).catch(() => []),
              raceControlMessages,
              pitStopsData.length ? pitStopsData : await getPitStops(sessionKey, driverNumber, { forceFresh: true }).catch(() => []),
              driverStints, ivls, pos, allDrivers, laps,
            );
            setDiaryEvents(diary);
            diaryForVre = diary;
          } catch { /* optional */ }
          setLoadingDiary(false);

          // Build Virtual Race Engineer (with practice compound models)
          setLoadingVre(true);
          setVreError(null);
          try {
            const pitsForVre = pitStopsData.length ? pitStopsData.filter(p => p.driver_number === driverNumber) : await getPitStops(sessionKey, driverNumber, { forceFresh: true }).catch(() => []);

            // Fetch practice compound models from same weekend
            let practiceModels: PracticeCompoundModel[] = [];
            if (meetingKey) {
              try {
                const meetingSessions = await getSessionsByMeetingKey(meetingKey);
                const practiceSessions = meetingSessions.filter(
                  (s: SessionInfo) => s.session_type === "Practice" && s.session_key !== sessionKey
                );

                for (const ps of practiceSessions) {
                  try {
                    const [pLaps, pStints] = await Promise.all([
                      getLaps(ps.session_key, driverNumber),
                      getStints(ps.session_key, driverNumber),
                    ]);
                    if (!pLaps.length || !pStints.length) continue;

                    // Practice compound models — fully delegated to the main engine.
                    const pitInLaps: PitData[] = pStints
                      .slice(0, -1)
                      .map((s) => ({ lap_number: s.lap_end } as PitData));
                    const longRuns = detectLongRuns(
                      driverNumber, driver.name_acronym, "ffffff",
                      pLaps, pStints, pitInLaps, 5,
                    );
                    const validRuns = longRuns.filter((lr) => lr.isValidLongRun);

                    for (const lr of validRuns) {
                      const originalStint = pStints.find((s) => s.stint_number === lr.stintNumber);
                      if (!originalStint) continue;

                      const virtualStint: StintData = {
                        ...originalStint,
                        lap_start: lr.lapStartLongRun,
                        lap_end: lr.lapEndLongRun,
                      };
                      const runLaps = pLaps.filter(
                        (l) => l.lap_number >= lr.lapStartLongRun && l.lap_number <= lr.lapEndLongRun,
                      );

                      const degResults = calculateTyreDegradation(
                        driverNumber, driver.name_acronym, "ffffff",
                        runLaps, [virtualStint],
                      );
                      if (!degResults.length) continue;
                      const deg = degResults[0];

                      const existing = practiceModels.find((m) => m.compound === lr.compound);
                      if (!existing || deg.rSquared > existing.rSquared) {
                        practiceModels = practiceModels.filter((m) => m.compound !== lr.compound);
                        practiceModels.push({
                          compound: lr.compound,
                          slope: deg.slopeSecPerLap,
                          intercept: deg.intercept,
                          rSquared: deg.rSquared,
                          source: ps.session_name,
                        });
                      }
                    }
                  } catch { /* skip individual practice session errors */ }
                }
              } catch { /* optional */ }
            }

            // Compute cumulative deviation for VRE integration
            let cumDevForVre: CumulativeDeviationResult | null = null;
            try {
              const [sessionAllLaps, sessionResults] = await Promise.all([
                getAllLaps(sessionKey),
                getSessionResult(sessionKey),
              ]);
              if (sessionAllLaps.length && sessionResults.length) {
                cumDevForVre = computeCumulativeDeviation(sessionKey, sessionAllLaps, sessionResults, allDrivers);
              }
              setSessionAllLaps(sessionAllLaps);
            } catch { /* optional */ }
            setCumDevResult(cumDevForVre);

            // diaryForVre captured from diary build above

            vreArgsRef.current = {
              driverNumber, driverAcronym: driver.name_acronym, sessionKey,
              laps, stints: driverStints, pits: pitsForVre,
              weather: sessionWeather, raceControl: raceControlMessages,
              intervals: ivls, positions: pos, allDrivers, practiceModels,
              diaryEvents: diaryForVre, cumDevResult: cumDevForVre,
            };
            const vre = computeVirtualRaceEngineer(
              driverNumber, driver.name_acronym, sessionKey,
              laps, driverStints, pitsForVre,
              sessionWeather, raceControlMessages,
              ivls, pos, allDrivers, practiceModels, vreRiskMode,
              diaryForVre, cumDevForVre, vreScenario, vreScenarioLap, vreScenarioDuration, vreCustomDeg,
              vreAnalysisMode,
            );
            setVreResult(vre);

            // Compute Key Decision Moments from VRE data
            if (vre) {
              try {
                const weatherMapForKdm = classifyLapsWeather(laps, sessionWeather);
                const trackStatusMapForKdm = classifyLapsTrackStatus(laps, raceControlMessages);
                const driverCumDevForKdm = cumDevForVre?.drivers.find(d => d.driver_number === driverNumber) ?? null;
                const kdm = computeKeyDecisionMoments({
                  laps,
                  stints: driverStints,
                  pitStops: pitsForVre,
                  weatherMap: weatherMapForKdm,
                  trackStatusMap: trackStatusMapForKdm,
                  trafficAnalysis: vre.traffic_analysis,
                  paceLossResults: vre.pace_loss_results,
                  degradationValidations: vre.degradation_validations,
                  diaryEvents: diaryForVre,
                  driverCumDev: driverCumDevForKdm,
                  positions: pos,
                  intervals: ivls,
                  driverNumber,
                  driverAcronym: driver.name_acronym,
                  sessionKey,
                  totalLaps: Math.max(...laps.map(l => l.lap_number)),
                  softSensorsTimeline: vre.soft_sensors_timeline,
                });
                setKdmResult(kdm);
              } catch { setKdmResult(null); }
            } else {
              setKdmResult(null);
            }
          } catch (e) {
            console.error("[VRE] compute failed:", e);
            setVreError(String(e));
            setVreResult(null);
          }
          setLoadingVre(false);
        }
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
    [sessionKey, allDrivers, selectedDriverNumbers, sessionType, raceControlMessages, overtakesData, overtakesReceivedData, pitStopsData, meetingKey, sessionWeather]
  );

  // Remove driver
  const handleRemoveDriver = useCallback((driverNumber: number) => {
    setSelectedDriverNumbers((prev) => prev.filter((n) => n !== driverNumber));
    setDriverStates((prev) => {
      const next = new Map(prev);
      next.delete(driverNumber);
      return next;
    });
    // Clean up per-driver aggregated data
    setStintsData((prev) => prev.filter((s) => s.driver_number !== driverNumber));
    setPitStopsData((prev) => prev.filter((p) => p.driver_number !== driverNumber));
    // Clear single-driver data
    setOvertakesData([]);
    setOvertakesReceivedData([]);
    setDiaryEvents([]);
    setVreResult(null); setVreError(null); setCumDevResult(null); vreArgsRef.current = null; setVreRiskMode("BALANCED"); setVreScenario("REAL_CONTEXT"); setVreScenarioLap(null); setVreScenarioDuration(null); setVreAnalysisMode("RACE_ENGINEER"); setVreViewMode("ENGINEER");
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

        if (!weatherStart) {
          weatherStart = start;
          weatherEnd = endDate;
        }

        const car = await getCarData(sessionKey, num, start, endDate);
        const loc = await getLocation(sessionKey, num, start, endDate);
        updates.push([num, car, loc]);
      }

      // Fetch weather for selected lap (single driver)
      if (selectedDriverNumbers.length === 1 && weatherStart && weatherEnd) {
        try {
          const weather = await getWeather(sessionKey, weatherStart, weatherEnd);
          if (weather.length > 0) {
            setWeatherData(weather[weather.length - 1]);
          }
        } catch { /* optional */ }
      }

      // Per-lap precipitation outlook — purely informative card.
      // Race/Sprint single-driver only. NEVER used in any calculation.
      setLapPrecip(null);
      const isRaceOrSprintLocal = sessionType === "Race" || sessionType === "Sprint";
      if (selectedDriverNumbers.length === 1 && isRaceOrSprintLocal && weatherStart && circuitKey) {
        fetchLapPrecipOutlook(circuitKey, weatherStart)
          .then((o) => setLapPrecip(o))
          .catch(() => setLapPrecip(null));
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
  }, [sessionKey, driverStates, selectedDriverNumbers, sessionType, circuitKey]);

  const handleReset = useCallback(() => {
    setAnalysisMode(null);
    setSessionKey(null);
    setSessionType("");
    setAllDrivers([]);
    setSelectedDriverNumbers([]);
    setDriverStates(new Map());
    setWeatherData(null);
    setLapPrecip(null);
    setCircuitKey(null);
    setOvertakesData([]);
    setOvertakesReceivedData([]);
    setStintsData([]);
    setPitStopsData([]);
    setDiaryIntervals([]);
    setDiaryPositions([]);
    setDiaryEvents([]);
    setVreResult(null); setVreError(null); setCumDevResult(null); vreArgsRef.current = null; setVreRiskMode("BALANCED"); setVreScenario("REAL_CONTEXT"); setVreScenarioLap(null); setVreScenarioDuration(null); setVreAnalysisMode("RACE_ENGINEER"); setVreViewMode("ENGINEER");
    setRaceControlMessages([]);
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

  // Active marker info: formatted time + lap number for the reference driver
  const activeInfo = useMemo(() => {
    if (!activeDate || !chartDrivers.length) return null;
    const refDriverNum = chartDrivers[0].driverNumber;
    const refState = driverStates.get(refDriverNum);
    const targetMs = new Date(activeDate).getTime();
    let lapNumber: number | null = null;
    if (refState?.laps?.length) {
      // Find the lap whose [date_start, date_start + lap_duration] contains targetMs
      for (const lap of refState.laps) {
        if (!lap.date_start || !lap.lap_duration) continue;
        const start = new Date(lap.date_start).getTime();
        const end = start + lap.lap_duration * 1000;
        if (targetMs >= start && targetMs <= end) {
          lapNumber = lap.lap_number;
          break;
        }
      }
      // Fallback: closest lap by date_start
      if (lapNumber == null) {
        let best = refState.laps[0];
        let bestDiff = Infinity;
        for (const lap of refState.laps) {
          if (!lap.date_start) continue;
          const diff = Math.abs(new Date(lap.date_start).getTime() - targetMs);
          if (diff < bestDiff) { bestDiff = diff; best = lap; }
        }
        lapNumber = best?.lap_number ?? null;
      }
    }
    const d = new Date(activeDate);
    const timestamp = d.toLocaleTimeString("it-IT", { hour12: false }) +
      "." + String(d.getUTCMilliseconds()).padStart(3, "0");
    return { timestamp, lapNumber, acronym: chartDrivers[0].acronym, pinned: clickedTime != null };
  }, [activeDate, chartDrivers, driverStates, clickedTime]);

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
    const isRaceOrSprint = sessionType === "Race" || sessionType === "Sprint";
    const totalLaps = isRaceOrSprint
      ? Math.max(0, ...selectedDriverNumbers.flatMap(num => {
          const state = driverStates.get(num);
          return state ? state.laps.map(l => l.lap_number) : [];
        }))
      : 0;

    return selectedDriverNumbers.flatMap((num) => {
      const state = driverStates.get(num);
      if (!state) return [];

      // For Practice: use only long-run laps (simple model)
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

      // For Race/Sprint: use corrected multivariate model
      if (isRaceOrSprint && sessionWeather.length > 0) {
        return calculateCorrectedTyreDegradation(
          num,
          state.driver.name_acronym,
          getColor(num),
          state.laps,
          state.stints,
          sessionWeather,
          totalLaps,
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
  }, [selectedDriverNumbers, driverStates, sessionType, getColor, longRunResults, sessionWeather]);

  // VRE recomputation handler — same logic that was previously inlined inside the JSX IIFE.
  // Extracted so the toolbar (sidebar) can invoke it from any layout slot.
  const recomputeVre = useCallback((overrides: {
    riskMode?: RiskMode; scenario?: import("@/lib/scenarioContext").ScenarioId;
    scenarioLap?: number | null; scenarioDuration?: number | null;
    analysisMode?: AnalysisMode; customDeg?: Record<string, number> | null;
  }) => {
    const args = vreArgsRef.current;
    if (!args) return;
    setVreError(null);
    const rm = overrides.riskMode ?? vreRiskMode;
    const sc = overrides.scenario ?? vreScenario;
    const sl = overrides.scenarioLap !== undefined ? overrides.scenarioLap : vreScenarioLap;
    const sd = overrides.scenarioDuration !== undefined ? overrides.scenarioDuration : vreScenarioDuration;
    const am = overrides.analysisMode ?? vreAnalysisMode;
    const cd = overrides.customDeg !== undefined ? overrides.customDeg : vreCustomDeg;
    let newVre: VirtualRaceEngineerResult | null = null;
    try {
      newVre = computeVirtualRaceEngineer(
        args.driverNumber, args.driverAcronym, args.sessionKey,
        args.laps, args.stints, args.pits,
        args.weather, args.raceControl,
        args.intervals, args.positions, args.allDrivers, args.practiceModels, rm,
        args.diaryEvents, args.cumDevResult, sc, sl, sd, cd, am,
      );
      setVreResult(newVre);
    } catch (e) {
      console.error("[VRE] compute failed:", e);
      setVreError(String(e));
      setVreResult(null);
      setKdmResult(null);
      return;
    }
    if (newVre) {
      try {
        const weatherMapForKdm = classifyLapsWeather(args.laps, args.weather);
        const trackStatusMapForKdm = classifyLapsTrackStatus(args.laps, args.raceControl);
        const driverCumDevForKdm = args.cumDevResult?.drivers.find(d => d.driver_number === args.driverNumber) ?? null;
        const kdm = computeKeyDecisionMoments({
          laps: args.laps, stints: args.stints, pitStops: args.pits,
          weatherMap: weatherMapForKdm, trackStatusMap: trackStatusMapForKdm,
          trafficAnalysis: newVre.traffic_analysis, paceLossResults: newVre.pace_loss_results,
          degradationValidations: newVre.degradation_validations, diaryEvents: args.diaryEvents,
          driverCumDev: driverCumDevForKdm, positions: args.positions, intervals: args.intervals,
          driverNumber: args.driverNumber, driverAcronym: args.driverAcronym,
          sessionKey: args.sessionKey, totalLaps: Math.max(...args.laps.map(l => l.lap_number)),
          softSensorsTimeline: newVre.soft_sensors_timeline,
        });
        setKdmResult(kdm);
      } catch { setKdmResult(null); }
    } else {
      setKdmResult(null);
    }
  }, [vreRiskMode, vreScenario, vreScenarioLap, vreScenarioDuration, vreAnalysisMode, vreCustomDeg]);

  const showVreSetup = selectedDriverNumbers.length === 1
    && (sessionType === "Race" || sessionType === "Sprint")
    && !loadingVre && vreResult != null;

  const setupCard = showVreSetup ? (
    <VRESetupCard
      analysisMode={vreAnalysisMode}
      onAnalysisModeChange={(mode) => {
        setVreAnalysisMode(mode);
        if (mode === "RACE_ENGINEER") {
          setVreScenario("REAL_CONTEXT");
          setVreScenarioLap(null);
          setVreScenarioDuration(null);
        }
        recomputeVre({
          analysisMode: mode,
          scenario: mode === "RACE_ENGINEER" ? "REAL_CONTEXT" : undefined,
          scenarioLap: mode === "RACE_ENGINEER" ? null : undefined,
          scenarioDuration: mode === "RACE_ENGINEER" ? null : undefined,
        });
      }}
      viewMode={vreViewMode}
      onViewModeChange={setVreViewMode}
      riskMode={vreRiskMode}
      onRiskModeChange={(mode) => { setVreRiskMode(mode); recomputeVre({ riskMode: mode }); }}
      scenarioId={vreScenario}
      onScenarioChange={(scenario) => {
        setVreScenario(scenario);
        const isReal = scenario === "REAL_CONTEXT";
        if (isReal) { setVreScenarioLap(null); setVreScenarioDuration(null); }
        recomputeVre({
          scenario,
          scenarioLap: isReal ? null : undefined,
          scenarioDuration: isReal ? null : undefined,
        });
      }}
      scenarioActivationLap={vreScenarioLap}
      onScenarioActivationLapChange={(lap) => { setVreScenarioLap(lap); recomputeVre({ scenarioLap: lap }); }}
      scenarioDurationLaps={vreScenarioDuration}
      onScenarioDurationChange={(duration) => { setVreScenarioDuration(duration); recomputeVre({ scenarioDuration: duration }); }}
      scenarioDescription={vreResult?.scenario_description}
      scenarioIsSimulated={vreResult?.scenario_is_simulated}
      scenarioWindow={vreResult?.scenario_window}
      scenarioActivationWarning={vreResult?.scenario_activation_warning}
      maxLap={vreResult?.actual_strategy?.stints?.length ? Math.max(...vreResult.actual_strategy.stints.map(s => s.lap_end)) : 99}
      degradationValidations={vreResult?.degradation_validations}
      customDegradationOverride={vreResult?.custom_degradation_override}
      onCustomDegradationChange={(deg) => { setVreCustomDeg(deg); recomputeVre({ customDeg: deg }); }}
    />
  ) : null;

  // ───────── Toolbar (sidebar sinistra) ─────────
  const toolbar = (
    <>
      <ToolbarSection title="Sessione" defaultOpen={!sessionKey}>
        <SessionPicker onSelect={handleSessionSubmit} isLoading={loadingDrivers} />
      </ToolbarSection>

      {allDrivers.length > 0 && (
        <ToolbarSection title="Vista" defaultOpen>
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "drivers" | "report")}>
            <TabsList className="w-full">
              <TabsTrigger value="drivers" className="flex-1 text-[11px]">Analisi Pilota</TabsTrigger>
              <TabsTrigger value="report" className="flex-1 text-[11px]">Report</TabsTrigger>
            </TabsList>
          </Tabs>
        </ToolbarSection>
      )}

      {allDrivers.length > 0 && viewMode === "drivers" && (
        <ToolbarSection title="Pilota" defaultOpen>
          <DriverPicker
            drivers={allDrivers}
            selected={selectedDriverNumbers}
            onAdd={handleAddDriver}
            onRemove={handleRemoveDriver}
            max={1}
          />
        </ToolbarSection>
      )}

      {setupCard && (
        <ToolbarSection title="VRE Setup" defaultOpen>
          {setupCard}
        </ToolbarSection>
      )}
    </>
  );

  // ───────── Contenuto centrale ─────────
  const singleDriverState = selectedDriverNumbers.length === 1 ? driverStates.get(selectedDriverNumbers[0]) : null;
  const isRaceOrSprint = sessionType === "Race" || sessionType === "Sprint";
  const isSingleDriverRaceLike = selectedDriverNumbers.length === 1 && isRaceOrSprint;
  const selectedLapSoftSensor = (isSingleDriverRaceLike && singleDriverState?.selectedLap != null)
    ? (vreResult?.soft_sensors_timeline?.by_lap.find(s => s.lap_number === singleDriverState.selectedLap) ?? null)
    : null;

  // Driving-style zones for visual overlay on TrackMap + TelemetryCharts.
  // Single-driver Race/Sprint only, to avoid color ambiguity in multi-driver views.
  const singleDriverZones = useMemo(() => {
    if (!isSingleDriverRaceLike || !singleDriverState || singleDriverState.carData.length === 0) return null;
    return computeDriverZones(
      singleDriverState.carData,
      singleDriverState.driver.driver_number,
      getColor(singleDriverState.driver.driver_number)
    );
  }, [isSingleDriverRaceLike, singleDriverState]);

  const telemetryZones = useMemo(() => {
    if (!singleDriverZones) return null;
    return {
      superclipping: singleDriverZones.zones.filter((z) => z.type === "superclipping").map((z) => z.date),
      liftcoast: singleDriverZones.zones.filter((z) => z.type === "liftcoast").map((z) => z.date),
    };
  }, [singleDriverZones]);

  const driverCumDev = useMemo(() => {
    if (!isSingleDriverRaceLike || !singleDriverState || !cumDevResult) return null;
    return cumDevResult.drivers.find((d) => d.driver_number === singleDriverState.driver.driver_number)?.laps ?? null;
  }, [isSingleDriverRaceLike, singleDriverState, cumDevResult]);


  const workspaceContent = (
    <>
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-4 py-2.5">{error}</div>
      )}

      {loadingLaps.size > 0 && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Caricamento dati…
        </div>
      )}

      {viewMode === "report" && sessionKey && (
        <SessionReport sessionKey={sessionKey} sessionType={sessionType} />
      )}

      {viewMode === "drivers" && (
        <>
          {/* Dashboard Summary */}
          {selectedDriverNumbers.length === 1 && isRaceOrSprint && singleDriverState && (
            loadingVre ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Analisi strategica in corso…
              </div>
            ) : (
              <DashboardSummary
                vreResult={vreResult}
                kdmResult={kdmResult}
                diaryEvents={diaryEvents}
                driverHeadshotUrl={singleDriverState.driver.headshot_url}
                driverAcronym={singleDriverState.driver.name_acronym}
                driverColor={getColor(singleDriverState.driver.driver_number)}
                sessionType={sessionType}
              />
            )
          )}

          {selectedDriverNumbers.length === 1 && singleDriverState && (() => {
            const issues = detectDataIntegrityIssues({
              laps: singleDriverState.laps,
              stints: singleDriverState.stints,
              pits: pitStopsData.filter((p) => p.driver_number === singleDriverState.driver.driver_number),
              isRaceOrSprint,
            });
            return issues.length > 0 ? (
              <DataIntegrityNotice issues={issues} driverAcronym={singleDriverState.driver.name_acronym} />
            ) : null;
          })()}

          {driversLaps.length > 0 && loadingLaps.size === 0 && (
            <div className="w-full space-y-5">
              {/* ═══════════════════════════════════════════
                  DASHBOARD DI SINTESI — "centro di controllo"
                  Sempre visibile in cima.
                  ═══════════════════════════════════════════ */}
              {selectedDriverNumbers.length === 1 && singleDriverState && (
                <DriverDashboardCockpit
                  laps={singleDriverState.laps}
                  pitStops={pitStopsData}
                  driverNumber={singleDriverState.driver.driver_number}
                  finalPosition={
                    diaryPositions.length
                      ? (() => {
                          const driverPos = diaryPositions
                            .filter((p) => p.driver_number === singleDriverState.driver.driver_number)
                            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                          return driverPos[0]?.position ?? null;
                        })()
                      : null
                  }
                  driverColor={getColor(singleDriverState.driver.driver_number)}
                />
              )}

              {selectedDriverNumbers.length === 1 && isRaceOrSprint && singleDriverState && (
                <SectorVsWinnerGrid
                  selectedDriverNumber={singleDriverState.driver.driver_number}
                  selectedAcronym={singleDriverState.driver.name_acronym}
                  selectedLaps={singleDriverState.laps}
                  sessionAllLaps={sessionAllLaps}
                  winnerDriverNumber={cumDevResult?.winner_driver_number ?? null}
                  winnerAcronym={cumDevResult?.winner_driver_code ?? null}
                  pitStops={pitStopsData}
                  raceControlMessages={raceControlMessages}
                  isRace={isRaceOrSprint}
                />
              )}


              {selectedDriverNumbers.length === 1 && isRaceOrSprint && singleDriverState && (
                <DriverMiniChartsGrid
                  driverNumber={singleDriverState.driver.driver_number}
                  driverColor={getColor(singleDriverState.driver.driver_number)}
                  driverAcronym={singleDriverState.driver.name_acronym}
                  laps={singleDriverState.laps}
                  positions={diaryPositions}
                  intervals={diaryIntervals}
                  cumDev={driverCumDev}
                  isRace={isRaceOrSprint}
                  allDrivers={allDrivers}
                />
              )}

              {selectedDriverNumbers.length === 1 && isRaceOrSprint && singleDriverState && (
                <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5">
                  <SoftSensorsTimelineCard timeline={vreResult?.soft_sensors_timeline ?? null} />
                  <PitStopsChartCard
                    pitStops={pitStopsData.filter((p) => p.driver_number === singleDriverState.driver.driver_number)}
                  />
                </div>
              )}



              {selectedDriverNumbers.length === 1 && isRaceOrSprint && singleDriverState && !loadingDiary && (
                <RaceEventTimeline
                  events={diaryEvents}
                  driverAcronym={singleDriverState.driver.name_acronym}
                  driverColor={getColor(singleDriverState.driver.driver_number)}
                />
              )}



              {kdmResult && kdmResult.decision_points.length > 0 && (
                <KeyDecisionMomentsCard result={kdmResult} />
              )}

              {/* ═══════════════════════════════════════════
                  DRILL-DOWN A FISARMONICA
                  4 sezioni, di default tutte collassate.
                  ═══════════════════════════════════════════ */}
              <Accordion type="multiple" defaultValue={["strategy"]} className="w-full space-y-3">
                {/* ── Passo & Gomme ── */}
                <AccordionItem
                  value="pace-tyres"
                  className="border border-border/60 rounded-xl card-premium overflow-hidden !border-b"
                >
                  <AccordionTrigger className="px-4 sm:px-5 py-3.5 hover:no-underline group">
                    <div className="flex items-center gap-3">
                      <Gauge className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />
                      <span className="text-[11px] font-black uppercase tracking-[0.22em]">
                        Passo &amp; Gomme
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 sm:px-5 pb-5 space-y-4">
                    <LapTimesChart
                      drivers={driversLaps.map((dl) => ({
                        driverNumber: dl.driver.driver_number,
                        acronym: dl.driver.name_acronym,
                        color: getColor(dl.driver.driver_number),
                        laps: dl.laps,
                        stints: dl.stints,
                      }))}
                      sessionWeather={sessionWeather}
                      raceControlMessages={raceControlMessages}
                      selectedLaps={driversLaps.map((dl) => ({
                        driverNumber: dl.driver.driver_number,
                        lapNumber: dl.selectedLap,
                      }))}
                      onSelectLap={handleSelectLap}
                    />

                    {stintsData.length > 0 && <StintsCard stints={stintsData} />}

                    {(() => {
                      const isPractice = sessionType.includes("Practice");
                      const manualSelectionDrivers = isPractice
                        ? selectedDriverNumbers
                            .map((num) => {
                              const state = driverStates.get(num);
                              if (!state) return null;
                              return {
                                driverNumber: num,
                                acronym: state.driver.name_acronym,
                                color: getColor(num),
                                laps: state.laps,
                                stints: state.stints,
                              };
                            })
                            .filter((d): d is NonNullable<typeof d> => d !== null)
                        : undefined;
                      const showCard =
                        degradationResults.length > 0 ||
                        (isPractice && !!manualSelectionDrivers && manualSelectionDrivers.length > 0);
                      if (!showCard) return null;
                      return (
                        <TyreDegradationCard
                          results={degradationResults}
                          longRuns={isPractice ? longRunResults : undefined}
                          manualSelectionDrivers={manualSelectionDrivers}
                        />
                      );
                    })()}
                  </AccordionContent>
                </AccordionItem>

                {sessionType !== "Practice" && (
                  <>
                    {/* ── Strategia ── */}
                    <AccordionItem
                      value="strategy"
                      className="border border-border/60 rounded-xl card-premium overflow-hidden !border-b"
                    >
                      <AccordionTrigger className="px-4 sm:px-5 py-3.5 hover:no-underline group">
                        <div className="flex items-center gap-3">
                          <Target className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />
                          <span className="text-[11px] font-black uppercase tracking-[0.22em]">
                            Strategia
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 sm:px-5 pb-5 space-y-4">
                        {selectedDriverNumbers.length === 1 && isRaceOrSprint && (
                          loadingVre ? (
                            <div className="flex items-center gap-2 text-muted-foreground text-sm">
                              <Loader2 className="h-4 w-4 animate-spin" /> Analisi strategica in corso…
                            </div>
                          ) : vreResult ? (
                            <VirtualRaceEngineerCard
                              result={vreResult}
                              analysisMode={vreAnalysisMode}
                              viewMode={vreViewMode}
                              laps={singleDriverState?.laps}
                              positions={diaryPositions}
                              allDrivers={allDrivers}
                              driverAcronym={singleDriverState?.driver.name_acronym}
                            />
                          ) : (
                            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
                              <div className="flex items-start gap-2">
                                <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  <h3 className="text-sm font-semibold text-amber-200">
                                    Virtual Race Engineer non disponibile
                                  </h3>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {vreError || "VRE non disponibile per questa sessione (dati stint/giri insufficienti o compound singolo)."}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )
                        )}

                        {pitStopsData.length > 0 && isRaceOrSprint && (
                          <PitStopsCard
                            pitStops={pitStopsData}
                            allDrivers={allDrivers}
                            multiDriver={selectedDriverNumbers.length > 1}
                          />
                        )}

                        {selectedDriverNumbers.length === 1 && isRaceOrSprint && singleDriverState && (
                          loadingDiary ? (
                            <div className="flex items-center gap-2 text-muted-foreground text-sm">
                              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento diario di gara…
                            </div>
                          ) : (
                            <RaceDiaryCard
                              events={diaryEvents}
                              driverAcronym={singleDriverState.driver.name_acronym}
                              driverColor={getColor(singleDriverState.driver.driver_number)}
                            />
                          )
                        )}

                        {overtakesData.length > 0 && selectedDriverNumbers.length === 1 && (
                          <OvertakesCard overtakes={overtakesData} allDrivers={allDrivers} />
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  </>
                )}

                {/* ── Telemetria & Guida ── */}
                <AccordionItem
                  value="telemetry"
                  className="border border-border/60 rounded-xl card-premium overflow-hidden !border-b"
                >
                  <AccordionTrigger className="px-4 sm:px-5 py-3.5 hover:no-underline group">
                    <div className="flex items-center gap-3">
                      <Wrench className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />
                      <span className="text-[11px] font-black uppercase tracking-[0.22em]">
                        Telemetria &amp; Guida
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 sm:px-5 pb-5 space-y-4">
                    <LapTable driversLaps={driversLaps} onSelectLap={handleSelectLap} onFastest={handleFastest} />

                    {hasLapsSelected && (
                      <Button onClick={handleLoadTelemetry} disabled={loadingTelemetry} className="gap-2">
                        {loadingTelemetry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        Carica Telemetria
                      </Button>
                    )}

                    {loadingTelemetry && (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> Caricamento telemetria…
                      </div>
                    )}

                    {chartDrivers.length > 0 && !loadingTelemetry && (
                      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
                        <section className="bg-card rounded-lg border border-border p-4 overflow-hidden min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <BarChart3 className="h-4 w-4 text-muted-foreground" />
                            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Telemetria</h2>
                          </div>
                          <TelemetryCharts
                            drivers={chartDrivers}
                            cursorTime={cursorTime}
                            onCursorChange={setCursorTime}
                            onCursorClick={setClickedTime}
                            lapSoftSensor={selectedLapSoftSensor}
                            zones={telemetryZones}
                          />
                          {raceAvg && raceAvg.per_lap.length > 0 && (
                            <PerLapDrivingCharts
                              avg={raceAvg}
                              driverCumulativeDeviation={driverCumDev}
                            />
                          )}
                        </section>
                        <aside className="space-y-4 min-w-0">
                          {mapDrivers.length > 0 && (
                            <TrackMap
                              drivers={mapDrivers}
                              activeDate={activeDate}
                              driverZones={singleDriverZones ? [singleDriverZones] : undefined}
                              activeInfo={activeInfo}
                              onClearPin={() => setClickedTime(null)}
                            />
                          )}
                          {(() => {
                            const analysisDrivers = [...driverStates.values()]
                              .filter((s) => s.carData.length > 0 && s.locationData.length > 0)
                              .map((s) => ({
                                driverNumber: s.driver.driver_number,
                                acronym: s.driver.name_acronym,
                                color: getColor(s.driver.driver_number),
                                carData: s.carData,
                              }));
                            if (!analysisDrivers.length) return null;
                            const raceAvgCtx = (isSingleDriverRaceLike && singleDriverState && sessionKey)
                              ? {
                                  sessionKey,
                                  driverNumber: singleDriverState.driver.driver_number,
                                  laps: singleDriverState.laps,
                                  trackStatusMap: classifyLapsTrackStatus(singleDriverState.laps, raceControlMessages),
                                  fetchCarData: getCarData,
                                  enabled: true,
                                }
                              : null;
                            return <DrivingAnalysis drivers={analysisDrivers} raceAverageContext={raceAvgCtx} onAvgChange={setRaceAvg} />;
                          })()}
                          {selectedLapSoftSensor && <SoftSensorsLapCard state={selectedLapSoftSensor} />}
                          {(() => {
                            const driversForMiniSectors = [...driverStates.values()]
                              .filter((s) => s.selectedLap != null)
                              .map((s) => {
                                const lap = s.laps.find((l) => l.lap_number === s.selectedLap);
                                if (!lap) return null;
                                return { driver: s.driver, lap, color: getColor(s.driver.driver_number) };
                              })
                              .filter((d): d is NonNullable<typeof d> => d != null);
                            if (!driversForMiniSectors.length) return null;
                            return <SectorMiniSectors drivers={driversForMiniSectors} />;
                          })()}
                        </aside>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* ── Contesto ── */}
                <AccordionItem
                  value="context"
                  className="border border-border/60 rounded-xl card-premium overflow-hidden !border-b"
                >
                  <AccordionTrigger className="px-4 sm:px-5 py-3.5 hover:no-underline group">
                    <div className="flex items-center gap-3">
                      <Info className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />
                      <span className="text-[11px] font-black uppercase tracking-[0.22em]">
                        Contesto
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 sm:px-5 pb-5 space-y-4">
                    {sessionWeather.length > 0 && selectedDriverNumbers.length === 1 && (
                      <WeatherCard weather={sessionWeather[sessionWeather.length - 1]} />
                    )}
                    {weatherData && <WeatherCard weather={weatherData} />}
                    {lapPrecip && <LapPrecipOutlookCard outlook={lapPrecip} />}
                    {sessionKey && <SessionReport sessionKey={sessionKey} sessionType={sessionType} />}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <CountdownBanner />
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/75 border-b border-border/60 px-6 py-3.5 shadow-[0_1px_0_hsl(var(--f1-red)/0.25)]">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="w-1.5 h-7 rounded-full bg-gradient-to-b from-[hsl(var(--f1-red-glow))] to-[hsl(var(--f1-red-deep))] group-hover:shadow-[0_0_12px_hsl(var(--f1-red))] transition-shadow" />
            </div>
            <h1 className="text-base font-black tracking-tight uppercase">
              <span className="text-foreground">Pit</span>
              <span className="text-gradient-primary">Wall</span>
              <span className="text-muted-foreground font-bold ml-1.5 text-xs tracking-[0.25em]">AI</span>
            </h1>
          </Link>
          <div className="flex items-center gap-1.5">
            <Link to="/compare" className="text-[11px] font-black uppercase tracking-[0.15em] px-3.5 py-2 rounded-md inline-flex items-center gap-1.5 bg-gradient-to-br from-[hsl(var(--f1-red))]/15 to-[hsl(var(--f1-red))]/5 text-[hsl(var(--f1-red-glow))] border border-[hsl(var(--f1-red))]/40 hover:border-[hsl(var(--f1-red))] hover:shadow-[0_0_16px_hsl(var(--f1-red)/0.4)] transition-all" title="Apri la modalità head-to-head">
              ⚔︎ H2H
            </Link>
            <Link to="/campionato" className="text-[11px] font-bold uppercase tracking-[0.15em] px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
              🏆 Mondiale
            </Link>
            <Link to="/anteprima-gp" className="text-[11px] font-bold uppercase tracking-[0.15em] px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title="Anteprima ragionata del prossimo GP">
              🔮 Anteprima GP
            </Link>
            <Link to="/docs" className="text-[11px] font-bold uppercase tracking-[0.15em] px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
              📖 Docs
            </Link>
            {sessionKey && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5 text-[11px] uppercase tracking-wider font-bold text-muted-foreground hover:text-[hsl(var(--f1-red))]">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Landing: hero + mode chooser quando non c'è sessione e non si è scelta modalità */}
        {!sessionKey && analysisMode === null && (
          <>
            <section className="relative overflow-hidden rounded-2xl border border-border/60 px-6 sm:px-10 py-10 sm:py-14 card-premium">
              <div className="absolute inset-0 bg-grid opacity-[0.06] pointer-events-none" />
              <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-[hsl(var(--f1-red))]/20 blur-3xl pointer-events-none" />
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-stripe opacity-50" style={{ background: "var(--gradient-stripe)" }} />
              <div className="relative max-w-3xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[hsl(var(--f1-red))]/10 border border-[hsl(var(--f1-red))]/30 text-[hsl(var(--f1-red-glow))] text-[10px] font-black uppercase tracking-[0.2em] mb-5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--f1-red))] animate-pulse" />
                  Formula 1 Race Strategy and Analysis tool
                </div>
                <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05] mb-4">
                  Visualizza, analizza e <span className="text-gradient-primary">simula</span><br />
                  il corso degli eventi di ogni gara di Formula 1
                </h2>
                <p className="text-base sm:text-lg text-muted-foreground max-w-2xl leading-relaxed">
                  Analisi pilota, strategia gara, degrado gomme, telemetria, micro-settori e Virtual Race Engineer.
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[hsl(var(--f1-red-glow))]">▸ Step 01 — Scegli la modalità</span>
                <div className="h-px flex-1 bg-gradient-to-r from-[hsl(var(--f1-red))]/40 to-transparent" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <button
                  type="button"
                  onClick={() => setAnalysisMode("single")}
                  className="group relative overflow-hidden rounded-2xl border border-border/60 card-premium p-7 text-left transition-all hover:border-[hsl(var(--f1-red))]/70 hover:shadow-[0_0_32px_hsl(var(--f1-red)/0.25)] hover:-translate-y-0.5"
                >
                  <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-[hsl(var(--f1-red))]/10 blur-3xl pointer-events-none" />
                  <div className="relative flex items-start gap-5">
                    <div className="shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-[hsl(var(--f1-red))]/25 to-[hsl(var(--f1-red-deep))]/15 border border-[hsl(var(--f1-red))]/40 flex items-center justify-center text-[hsl(var(--f1-red-glow))]">
                      <User className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground mb-1.5">Modalità A</div>
                      <h3 className="text-2xl font-black tracking-tight mb-2">Analisi Singolo Pilota</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                        Telemetria, degrado, strategia, VRE e diario gara.
                      </p>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-[hsl(var(--f1-red-glow))]">
                        Inizia <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </button>

                <Link
                  to="/compare"
                  className="group relative overflow-hidden rounded-2xl border border-border/60 card-premium p-7 text-left transition-all hover:border-[hsl(var(--f1-red))]/70 hover:shadow-[0_0_32px_hsl(var(--f1-red)/0.25)] hover:-translate-y-0.5"
                >
                  <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-[hsl(var(--f1-red))]/10 blur-3xl pointer-events-none" />
                  <div className="relative flex items-start gap-5">
                    <div className="shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-[hsl(var(--f1-red))]/25 to-[hsl(var(--f1-red-deep))]/15 border border-[hsl(var(--f1-red))]/40 flex items-center justify-center text-[hsl(var(--f1-red-glow))]">
                      <Swords className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground mb-1.5">Modalità B</div>
                      <h3 className="text-2xl font-black tracking-tight mb-2">Head-to-Head</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                        Confronta due piloti fianco a fianco.
                      </p>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-[hsl(var(--f1-red-glow))]">
                        Apri H2H <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              </div>

              <div className="pt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
                <ChampionshipSummaryCard />
                <WeekendWeatherCard />
                <NextCircuitCard />
              </div>
            </section>
          </>
        )}

        {/* Modalità singolo pilota scelta, ma nessuna sessione: solo SessionPicker centrato */}
        {!sessionKey && analysisMode === "single" && (
          <section className="grid grid-cols-1 lg:grid-cols-[minmax(280px,1fr)_auto] gap-6 items-start">
            <div className="card-premium rounded-xl p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[hsl(var(--f1-red-glow))]">▸ Step 02 — Seleziona la sessione</span>
                  <div className="h-px flex-1 bg-gradient-to-r from-[hsl(var(--f1-red))]/40 to-transparent" />
                </div>
                <button
                  type="button"
                  onClick={() => setAnalysisMode(null)}
                  className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground hover:text-[hsl(var(--f1-red-glow))] transition-colors"
                >
                  <ArrowLeft className="w-3 h-3" /> Cambia modalità
                </button>
              </div>
              <SessionPicker onSelect={handleSessionSubmit} isLoading={loadingDrivers} />
            </div>
            <ChampionshipSummaryCard />
          </section>
        )}

        {/* Workspace con toolbar laterale */}
        {sessionKey && (
          <AppShell toolbar={toolbar} headerOffset={72}>
            {workspaceContent}
          </AppShell>
        )}
      </main>

      {!sessionKey && <FullGasFeedSection />}
      {!sessionKey && <BuyMeCoffeePopup />}
      <footer className="border-t border-border px-6 py-4 mt-8">
        <p className="text-center text-xs text-muted-foreground">
          Questo è un progetto sviluppato da Fabrizio Monaco
        </p>
      </footer>
    </div>
  );
}
