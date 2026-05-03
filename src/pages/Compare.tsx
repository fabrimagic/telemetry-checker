import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, RotateCcw, AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionPicker } from "@/components/f1/SessionPicker";
import { CompareHeader } from "@/components/f1/compare/CompareHeader";
import { CompareTimeline } from "@/components/f1/compare/CompareTimeline";
import { CompareMetricsGrid } from "@/components/f1/compare/CompareMetricsGrid";
import { CompareNarrative } from "@/components/f1/compare/CompareNarrative";
import { CompareAlternativeStrategies } from "@/components/f1/compare/CompareAlternativeStrategies";
import { CompareDriverContext } from "@/components/f1/compare/CompareDriverContext";
import {
  getDrivers, getWeatherForSession, getRaceControl,
  getAllLaps, getSessionResult,
  type Driver, type WeatherData, type RaceControlMessage, type PositionData,
  type SessionResult,
} from "@/lib/openf1";
import { loadVreForDriver, type VreLoaderOutput } from "@/lib/vreLoader";
import { computeHeadToHead, type ComparisonResult } from "@/lib/headToHeadComparison";
import { computeCumulativeDeviation, type CumulativeDeviationResult } from "@/lib/cumulativeDeviation";

interface DualState {
  outA: VreLoaderOutput | null;
  outB: VreLoaderOutput | null;
  loading: boolean;
  sessionResults: SessionResult[] | null;
}

export default function Compare() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState<string>("");
  const [meetingKey, setMeetingKey] = useState<number>(0);
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [sessionWeather, setSessionWeather] = useState<WeatherData[]>([]);
  const [raceControlMessages, setRaceControlMessages] = useState<RaceControlMessage[]>([]);

  const [driverA, setDriverA] = useState<number | null>(null);
  const [driverB, setDriverB] = useState<number | null>(null);

  const [dual, setDual] = useState<DualState>({ outA: null, outB: null, loading: false, sessionResults: null });
  const [error, setError] = useState<string | null>(null);

  // Hydrate from URL on mount only — once we have allDrivers, set initial selection
  useEffect(() => {
    const sk = searchParams.get("session");
    const dA = searchParams.get("driverA");
    const dB = searchParams.get("driverB");
    if (sk && !sessionKey) {
      // We need session metadata; SessionPicker fetches its own list. Defer: ignore deep-link for session
      // until user picks via SessionPicker (avoids needing a separate /sessions fetch).
    }
    if (dA && allDrivers.length && driverA == null) setDriverA(Number(dA));
    if (dB && allDrivers.length && driverB == null) setDriverB(Number(dB));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDrivers]);

  // Persist selection to URL
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (sessionKey) next.set("session", String(sessionKey)); else next.delete("session");
    if (driverA != null) next.set("driverA", String(driverA)); else next.delete("driverA");
    if (driverB != null) next.set("driverB", String(driverB)); else next.delete("driverB");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, driverA, driverB]);

  const handleSessionSubmit = useCallback(async (key: number, type: string, mKey: number) => {
    setError(null);
    setSessionKey(key);
    setSessionType(type);
    setMeetingKey(mKey);
    setDriverA(null);
    setDriverB(null);
    setDual({ outA: null, outB: null, loading: false, sessionResults: null });
    setLoadingDrivers(true);
    try {
      const d = await getDrivers(key);
      setAllDrivers(d);
      if (!d.length) setError("Nessun pilota trovato per questa sessione.");
      // Hydrate driverA/B from URL if present
      const dA = searchParams.get("driverA");
      const dB = searchParams.get("driverB");
      if (dA && d.some((x) => x.driver_number === Number(dA))) setDriverA(Number(dA));
      if (dB && d.some((x) => x.driver_number === Number(dB))) setDriverB(Number(dB));

      getWeatherForSession(key).then(setSessionWeather).catch(() => {});
      getRaceControl(key).then(setRaceControlMessages).catch(() => {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingDrivers(false);
    }
  }, [searchParams]);

  const isRace = sessionType === "Race" || sessionType === "Sprint";

  const driverObjA = driverA != null ? allDrivers.find((d) => d.driver_number === driverA) ?? null : null;
  const driverObjB = driverB != null ? allDrivers.find((d) => d.driver_number === driverB) ?? null : null;

  // Trigger comparison when both drivers are selected and we have weather+RC bootstrapped
  useEffect(() => {
    if (!sessionKey || !isRace) return;
    if (!driverObjA || !driverObjB) return;
    if (driverObjA.driver_number === driverObjB.driver_number) return;

    let cancelled = false;
    setDual({ outA: null, outB: null, loading: true, sessionResults: null });
    setError(null);

    // Fetch session-scoped cumulative-deviation data ONCE and share between
    // both loaders. Without this, each loader fetches /laps?session_key and
    // /session_result independently → 4 extra requests in parallel that often
    // collide with OpenF1's rate limit (15/10s) and produce asymmetric results
    // where one driver's cumulative_deviation_context is "non disponibile".
    (async () => {
      let sharedCumDev: CumulativeDeviationResult | null = null;
      try {
        const [sessionAllLaps, sessionResults] = await Promise.all([
          getAllLaps(sessionKey),
          getSessionResult(sessionKey),
        ]);
        if (sessionAllLaps.length && sessionResults.length) {
          sharedCumDev = computeCumulativeDeviation(sessionKey, sessionAllLaps, sessionResults, allDrivers);
        }
      } catch { /* optional — loaders will fall back to their own fetch */ }

      if (cancelled) return;

      try {
        const [outA, outB] = await Promise.all([
          loadVreForDriver({
            driverNumber: driverObjA.driver_number,
            driver: driverObjA,
            sessionKey,
            meetingKey,
            sessionWeather,
            raceControlMessages,
            allDrivers,
            riskMode: "BALANCED",
            analysisMode: "RACE_ENGINEER",
            computeAlternative: true,
            precomputedCumDev: sharedCumDev,
          }),
          loadVreForDriver({
            driverNumber: driverObjB.driver_number,
            driver: driverObjB,
            sessionKey,
            meetingKey,
            sessionWeather,
            raceControlMessages,
            allDrivers,
            riskMode: "BALANCED",
            analysisMode: "RACE_ENGINEER",
            computeAlternative: true,
            precomputedCumDev: sharedCumDev,
          }),
        ]);
        if (cancelled) return;
        setDual({ outA, outB, loading: false });
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Errore caricamento confronto");
        setDual({ outA: null, outB: null, loading: false, sessionResults: null });
      }
    })();

    return () => { cancelled = true; };
  }, [sessionKey, isRace, driverObjA, driverObjB, meetingKey, sessionWeather, raceControlMessages, allDrivers]);

  const comparison: ComparisonResult | null = useMemo(() => {
    if (!dual.outA?.vreResult || !dual.outB?.vreResult) return null;
    try {
      // Merge positions (intervals/positions are session-wide; both outputs should have same data)
      const positions: PositionData[] = dual.outA.positions.length ? dual.outA.positions : dual.outB.positions;
      return computeHeadToHead({
        resultA: dual.outA.vreResult,
        resultB: dual.outB.vreResult,
        lapsA: dual.outA.laps,
        lapsB: dual.outB.laps,
        positions,
        alternativeA: dual.outA.alternativeVreResult,
        alternativeB: dual.outB.alternativeVreResult,
      });
    } catch (e: any) {
      setError(e?.message ?? "Errore comparazione");
      return null;
    }
  }, [dual]);

  const handleSwap = () => {
    setDriverA(driverB);
    setDriverB(driverA);
  };

  const handleReset = () => {
    setSessionKey(null);
    setSessionType("");
    setMeetingKey(0);
    setAllDrivers([]);
    setDriverA(null);
    setDriverB(null);
    setDual({ outA: null, outB: null, loading: false, sessionResults: null });
    setError(null);
    setSearchParams({}, { replace: true });
  };

  const availableForA = allDrivers.filter((d) => d.driver_number !== driverB);
  const availableForB = allDrivers.filter((d) => d.driver_number !== driverA);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-1 h-6 rounded-full bg-[hsl(var(--f1-red))]" />
            <h1 className="text-lg font-bold tracking-tight">PitWall AI · Head-to-Head</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted/50 inline-flex items-center gap-1">
              <ArrowLeft className="h-3.5 w-3.5" /> Analisi singolo pilota
            </Link>
            {sessionKey && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5 text-xs text-muted-foreground">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <section className="flex flex-wrap gap-6 items-start">
          <SessionPicker
            onSelect={handleSessionSubmit}
            isLoading={loadingDrivers}
            sessionTypeFilter={["Race", "Sprint"]}
          />
        </section>

        {/* Defensive guard: SessionPicker is filtered to Race/Sprint only,
            but if a stale URL or upstream change ever surfaces another type, warn the user. */}
        {sessionKey && !isRace && (
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground flex gap-2 items-start">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Il confronto head-to-head è disponibile solo per sessioni Race o Sprint.</span>
          </div>
        )}

        {sessionKey && isRace && allDrivers.length > 0 && (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">Pilota A</label>
              <Select value={driverA?.toString() ?? ""} onValueChange={(v) => setDriverA(Number(v))}>
                <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleziona pilota A" /></SelectTrigger>
                <SelectContent>
                  {availableForA.map((d) => (
                    <SelectItem key={d.driver_number} value={d.driver_number.toString()}>
                      <span className="flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: `#${d.team_colour || "ffffff"}` }} />
                        <span className="font-mono font-bold text-xs">{d.name_acronym}</span>
                        <span className="text-muted-foreground text-xs">{d.full_name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">Pilota B</label>
              <Select value={driverB?.toString() ?? ""} onValueChange={(v) => setDriverB(Number(v))}>
                <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleziona pilota B" /></SelectTrigger>
                <SelectContent>
                  {availableForB.map((d) => (
                    <SelectItem key={d.driver_number} value={d.driver_number.toString()}>
                      <span className="flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: `#${d.team_colour || "ffffff"}` }} />
                        <span className="font-mono font-bold text-xs">{d.name_acronym}</span>
                        <span className="text-muted-foreground text-xs">{d.full_name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>
        )}

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-4 py-2.5">{error}</div>
        )}

        {dual.loading && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Analisi parallela in corso (può richiedere 20–40s la prima volta)…
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <Skeleton className="h-48" />
            <Skeleton className="h-72" />
          </div>
        )}

        {!dual.loading && dual.outA && !dual.outA.vreResult && driverObjA && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            Analisi non disponibile per <strong>{driverObjA.name_acronym}</strong>
            {dual.outA.error ? `: ${dual.outA.error}` : ""}.
          </div>
        )}
        {!dual.loading && dual.outB && !dual.outB.vreResult && driverObjB && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            Analisi non disponibile per <strong>{driverObjB.name_acronym}</strong>
            {dual.outB.error ? `: ${dual.outB.error}` : ""}.
          </div>
        )}

        {comparison && driverObjA && driverObjB && (
          <div className="space-y-6">
            {/* ═══ STRATEGIA REALE ═══ */}
            <section className="space-y-5">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground px-2">
                  Strategia reale eseguita
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <CompareHeader comparison={comparison} driverA={driverObjA} driverB={driverObjB} onSwap={handleSwap} />
              <CompareTimeline comparison={comparison} driverA={driverObjA} driverB={driverObjB} />
              <CompareDriverContext
                driverA={driverObjA}
                driverB={driverObjB}
                resultA={dual.outA?.vreResult ?? null}
                resultB={dual.outB?.vreResult ?? null}
              />
              <CompareMetricsGrid comparison={comparison} driverA={driverObjA} driverB={driverObjB} />
              <CompareNarrative comparison={comparison} driverA={driverObjA} driverB={driverObjB} />
            </section>

            {/* ═══ STRATEGIA ALTERNATIVA ═══ */}
            <section className="space-y-5">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-[hsl(var(--f1-red))]/30" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-[hsl(var(--f1-red))] px-2">
                  Strategia alternativa (ex-ante · balanced)
                </span>
                <div className="h-px flex-1 bg-[hsl(var(--f1-red))]/30" />
              </div>
              <CompareAlternativeStrategies comparison={comparison} driverA={driverObjA} driverB={driverObjB} />
            </section>
          </div>
        )}
      </main>

      <footer className="mt-12 border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        Questo è un progetto sviluppato da Fabrizio Monaco
      </footer>
    </div>
  );
}
