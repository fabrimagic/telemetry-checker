/**
 * Competitor Strategy Tracking — page
 *
 * Side-by-side strategy matrix for N drivers in the same session.
 * - Re-uses SessionPicker (filtered to Race/Sprint, identical pattern as Compare.tsx)
 * - Re-uses loadVreForDriver via loadCompetitorMatrix (no logic duplication)
 * - TanStack Query: cache key ['competitorMatrix', sessionKey, drivers]
 * - Layout: ResizablePanels (desktop) / Drawer FAB (mobile)
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, ArrowLeft, RotateCcw, Info, AlertTriangle, ChevronDown, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SessionPicker } from "@/components/f1/SessionPicker";
import {
  getDrivers, getRaceControl, getWeatherForSession, getSessionResult,
  type Driver, type RaceControlMessage, type SessionResult, type WeatherData,
} from "@/lib/openf1";
import {
  loadCompetitorMatrix, compoundColour,
  type CompetitorMatrix, type CompetitorEntry, type PitCluster,
} from "@/lib/competitorTracking";

const DEFAULT_TOP_N = 10;
const TOP_5 = 5;

/* ───────────────────────── Hook: viewport ───────────────────────── */

function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 1024 : false);
  useEffect(() => {
    const onResize = () => setM(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return m;
}

/* ───────────────────────── Page ───────────────────────── */

export default function Competitors() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState<string>("");
  const [meetingKey, setMeetingKey] = useState<number>(0);
  const [sessionLabel, setSessionLabel] = useState<string>("");

  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [sessionWeather, setSessionWeather] = useState<WeatherData[]>([]);
  const [raceControl, setRaceControl] = useState<RaceControlMessage[]>([]);
  const [sessionResults, setSessionResults] = useState<SessionResult[]>([]);
  const [bootstrapping, setBootstrapping] = useState(false);

  const [selectedDrivers, setSelectedDrivers] = useState<number[]>([]);
  const [highlightCluster, setHighlightCluster] = useState<PitCluster | null>(null);
  const [topFilter, setTopFilter] = useState<"top5" | "all">("all");

  const isMobile = useIsMobile();
  const isRace = sessionType === "Race" || sessionType === "Sprint";

  /* ── Persist session+drivers to URL ── */
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (sessionKey) next.set("session", String(sessionKey)); else next.delete("session");
    if (selectedDrivers.length) next.set("drivers", selectedDrivers.join(",")); else next.delete("drivers");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, selectedDrivers]);

  /* ── Session bootstrap ── */
  const handleSessionSubmit = useCallback(
    async (key: number, type: string, mKey: number) => {
      setSessionKey(key);
      setSessionType(type);
      setMeetingKey(mKey);
      setSelectedDrivers([]);
      setAllDrivers([]);
      setSessionResults([]);
      setSessionWeather([]);
      setRaceControl([]);
      setBootstrapping(true);
      try {
        const [drivers, weather, rc, results] = await Promise.all([
          getDrivers(key),
          getWeatherForSession(key).catch(() => [] as WeatherData[]),
          getRaceControl(key).catch(() => [] as RaceControlMessage[]),
          getSessionResult(key).catch(() => [] as SessionResult[]),
        ]);
        setAllDrivers(drivers);
        setSessionWeather(weather);
        setRaceControl(rc);
        setSessionResults(results);

        // Default selection: top-N by final position; URL override wins if present
        const urlDrivers = searchParams.get("drivers");
        if (urlDrivers) {
          const parsed = urlDrivers.split(",").map((s) => Number(s)).filter(Boolean);
          const valid = parsed.filter((n) => drivers.some((d) => d.driver_number === n));
          if (valid.length) {
            setSelectedDrivers(valid);
            setBootstrapping(false);
            return;
          }
        }

        const sorted = [...results]
          .filter((r) => r.position != null)
          .sort((a, b) => a.position - b.position);
        const topN = sorted.slice(0, DEFAULT_TOP_N).map((r) => r.driver_number);
        // Fallback if no results yet: pick first DEFAULT_TOP_N drivers
        const initial = topN.length ? topN : drivers.slice(0, DEFAULT_TOP_N).map((d) => d.driver_number);
        setSelectedDrivers(initial);
      } finally {
        setBootstrapping(false);
      }
    },
    [searchParams],
  );

  /* ── Persisted session label for breadcrumb ── */
  useEffect(() => {
    if (!allDrivers.length || !sessionType) return;
    setSessionLabel(`${sessionType} · session ${sessionKey}`);
  }, [allDrivers.length, sessionType, sessionKey]);

  /* ── TanStack Query: matrix ── */
  const queryEnabled = !!(sessionKey && isRace && allDrivers.length && selectedDrivers.length);

  const queryKey = useMemo(
    () => ["competitorMatrix", sessionKey, [...selectedDrivers].sort((a, b) => a - b)] as const,
    [sessionKey, selectedDrivers],
  );

  const matrixQuery = useQuery({
    queryKey,
    enabled: queryEnabled,
    staleTime: Infinity, // session data is immutable for past sessions
    queryFn: async () => {
      if (!sessionKey) throw new Error("session missing");
      return loadCompetitorMatrix({
        sessionKey,
        meetingKey,
        driverNumbers: selectedDrivers,
        sessionWeather,
        raceControlMessages: raceControl,
        allDrivers,
        sessionResults,
        riskMode: "BALANCED",
        analysisMode: "RACE_ENGINEER",
      });
    },
  });

  const matrix = matrixQuery.data ?? null;

  /* ── Derived: filtered drivers (top5 toggle) ── */
  const visibleDrivers = useMemo(() => {
    if (!matrix) return [];
    if (topFilter === "top5") return matrix.drivers.slice(0, TOP_5);
    return matrix.drivers;
  }, [matrix, topFilter]);

  /* ── Helpers ── */
  const handleReset = () => {
    setSessionKey(null);
    setSessionType("");
    setMeetingKey(0);
    setAllDrivers([]);
    setSessionWeather([]);
    setRaceControl([]);
    setSessionResults([]);
    setSelectedDrivers([]);
    setHighlightCluster(null);
    setSearchParams({}, { replace: true });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["competitorMatrix", sessionKey] });
  };

  const toggleDriver = (n: number) => {
    setSelectedDrivers((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
    );
  };

  /* ── Render ── */
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 sticky top-0 z-30 bg-background/95 backdrop-blur">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-6 rounded-full bg-[hsl(var(--f1-red))]" />
            <h1 className="text-lg font-bold tracking-tight">PitWall AI · Competitor Tracking</h1>
            {sessionLabel && (
              <Badge variant="outline" className="ml-2 text-[10px] font-mono uppercase tracking-wider">
                {sessionLabel}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted/50 inline-flex items-center gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Home
            </Link>
            <Link
              to="/compare"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted/50"
            >
              Head-to-Head
            </Link>
            {sessionKey && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5 text-xs text-muted-foreground">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-6 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Sessione</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SessionPicker
              onSelect={handleSessionSubmit}
              isLoading={bootstrapping}
              sessionTypeFilter={["Race", "Sprint"]}
            />

            {sessionKey && !isRace && (
              <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground flex gap-2 items-start">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Il Competitor Tracking è disponibile solo per sessioni Race o Sprint.</span>
              </div>
            )}

            {sessionKey && isRace && allDrivers.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <DriverMultiSelect
                  drivers={allDrivers}
                  selected={selectedDrivers}
                  onToggle={toggleDriver}
                  results={sessionResults}
                />

                <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                  <Button
                    size="sm"
                    variant={topFilter === "top5" ? "default" : "ghost"}
                    onClick={() => setTopFilter("top5")}
                    className="h-7 px-3 text-xs"
                  >
                    Top 5
                  </Button>
                  <Button
                    size="sm"
                    variant={topFilter === "all" ? "default" : "ghost"}
                    onClick={() => setTopFilter("all")}
                    className="h-7 px-3 text-xs"
                  >
                    Tutti
                  </Button>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRefresh}
                  disabled={matrixQuery.isFetching}
                  className="h-7 text-xs"
                >
                  {matrixQuery.isFetching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : null}
                  Aggiorna analisi
                </Button>

                {matrix && (
                  <Badge
                    variant={
                      matrix.common_confidence === "HIGH" ? "default"
                        : matrix.common_confidence === "MEDIUM" ? "secondary" : "outline"
                    }
                    className="text-[10px] uppercase tracking-wider font-mono"
                  >
                    Confidence: {matrix.common_confidence}
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {matrixQuery.isError && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-4 py-2.5">
            Errore caricamento analisi: {(matrixQuery.error as Error)?.message ?? "sconosciuto"}
          </div>
        )}

        {matrixQuery.isFetching && !matrix && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Caricamento parallelo dei piloti (può richiedere 30–60s la prima volta)…
            </div>
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        )}

        {matrix && visibleDrivers.length > 0 && (
          <>
            {isMobile ? (
              <MobileLayout
                matrix={matrix}
                visible={visibleDrivers}
                highlightCluster={highlightCluster}
                onClusterClick={setHighlightCluster}
              />
            ) : (
              <DesktopLayout
                matrix={matrix}
                visible={visibleDrivers}
                highlightCluster={highlightCluster}
                onClusterClick={setHighlightCluster}
              />
            )}

            {/* Metrics table */}
            <Accordion type="single" collapsible>
              <AccordionItem value="metrics" className="border rounded-md">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <ChevronDown className="h-4 w-4" /> Tabella metriche complete
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-2 pb-2">
                  <MetricsTable matrix={matrix} visible={visibleDrivers} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </>
        )}

        {matrix && visibleDrivers.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nessun pilota selezionato. Usa il selettore in alto per scegliere chi confrontare.
            </CardContent>
          </Card>
        )}

        {!sessionKey && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Seleziona una sessione Race o Sprint per visualizzare la matrice strategica.
            </CardContent>
          </Card>
        )}
      </main>

      <footer className="mt-12 border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        Questo è un progetto sviluppato da Fabrizio Monaco
      </footer>
    </div>
  );
}

/* ───────────────────────── DriverMultiSelect ───────────────────────── */

function DriverMultiSelect({
  drivers, selected, onToggle, results,
}: {
  drivers: Driver[];
  selected: number[];
  onToggle: (n: number) => void;
  results: SessionResult[];
}) {
  const sorted = useMemo(() => {
    const posOf = (n: number) => results.find((r) => r.driver_number === n)?.position ?? 99;
    return [...drivers].sort((a, b) => posOf(a.driver_number) - posOf(b.driver_number));
  }, [drivers, results]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Piloti ({selected.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <ScrollArea className="h-72">
          <div className="p-2 space-y-1">
            {sorted.map((d) => {
              const checked = selected.includes(d.driver_number);
              return (
                <label
                  key={d.driver_number}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox checked={checked} onCheckedChange={() => onToggle(d.driver_number)} />
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: `#${d.team_colour || "888888"}` }}
                  />
                  <span className="font-mono font-bold text-xs">{d.name_acronym}</span>
                  <span className="text-muted-foreground text-xs truncate">{d.full_name}</span>
                </label>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/* ───────────────────────── DesktopLayout ───────────────────────── */

function DesktopLayout({
  matrix, visible, highlightCluster, onClusterClick,
}: {
  matrix: CompetitorMatrix;
  visible: CompetitorEntry[];
  highlightCluster: PitCluster | null;
  onClusterClick: (c: PitCluster | null) => void;
}) {
  return (
    <ResizablePanelGroup direction="horizontal" className="min-h-[500px] rounded-md border">
      <ResizablePanel defaultSize={70} minSize={50}>
        <MatrixTimeline matrix={matrix} visible={visible} highlightCluster={highlightCluster} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={30} minSize={20}>
        <RaceInsights matrix={matrix} highlightCluster={highlightCluster} onClusterClick={onClusterClick} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/* ───────────────────────── MobileLayout ───────────────────────── */

function MobileLayout({
  matrix, visible, highlightCluster, onClusterClick,
}: {
  matrix: CompetitorMatrix;
  visible: CompetitorEntry[];
  highlightCluster: PitCluster | null;
  onClusterClick: (c: PitCluster | null) => void;
}) {
  return (
    <div className="relative">
      <div className="rounded-md border overflow-x-auto">
        <MatrixTimeline matrix={matrix} visible={visible} highlightCluster={highlightCluster} />
      </div>
      <Drawer>
        <DrawerTrigger asChild>
          <Button
            size="icon"
            variant="default"
            className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full shadow-lg"
          >
            <Info className="h-5 w-5" />
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Insights di gara</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 max-h-[70vh] overflow-y-auto">
            <RaceInsights matrix={matrix} highlightCluster={highlightCluster} onClusterClick={onClusterClick} />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/* ───────────────────────── MatrixTimeline ───────────────────────── */

function MatrixTimeline({
  matrix, visible, highlightCluster,
}: {
  matrix: CompetitorMatrix;
  visible: CompetitorEntry[];
  highlightCluster: PitCluster | null;
}) {
  const { total_laps, session_wide_events } = matrix;

  // Banded background segments for SC/VSC (assume each event lasts until next event of same type ends ~3 laps default)
  const neutralisationBands = useMemo(() => {
    const bands: { start: number; end: number; type: string }[] = [];
    const events = session_wide_events.filter((e) => e.type === "SC" || e.type === "VSC" || e.type === "RED");
    for (let i = 0; i < events.length; i++) {
      const cur = events[i];
      const next = events[i + 1];
      const end = next ? next.lap : Math.min(cur.lap + 3, total_laps);
      bands.push({ start: cur.lap, end, type: cur.type });
    }
    return bands;
  }, [session_wide_events, total_laps]);

  return (
    <div className="overflow-y-auto max-h-[700px]">
      <div className="min-w-[700px]">
        {/* Header axis */}
        <div className="flex sticky top-0 bg-background z-10 border-b">
          <div className="w-[180px] shrink-0 px-3 py-2 text-[10px] uppercase font-mono tracking-wider text-muted-foreground border-r">
            Pilota
          </div>
          <div className="flex-1 relative px-2 py-2 text-[10px] uppercase font-mono tracking-wider text-muted-foreground">
            <div className="flex justify-between">
              <span>Giro 1</span>
              <span>{Math.round(total_laps / 2)}</span>
              <span>Giro {total_laps}</span>
            </div>
          </div>
        </div>

        {/* Driver rows */}
        {visible.map((entry) => (
          <DriverStrip
            key={entry.driver_number}
            entry={entry}
            totalLaps={total_laps}
            bands={neutralisationBands}
            highlighted={
              !!highlightCluster && highlightCluster.driver_numbers.includes(entry.driver_number)
            }
          />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── DriverStrip ───────────────────────── */

function DriverStrip({
  entry, totalLaps, bands, highlighted,
}: {
  entry: CompetitorEntry;
  totalLaps: number;
  bands: { start: number; end: number; type: string }[];
  highlighted: boolean;
}) {
  const teamHex = `#${entry.team_colour}`;
  const stintData = entry.stint_summary;
  const hasData = stintData.length > 0;

  return (
    <div
      className={cn(
        "flex border-b last:border-b-0 transition-colors",
        highlighted && "ring-2 ring-[hsl(var(--f1-red))] ring-inset bg-muted/30",
      )}
    >
      {/* Left card */}
      <div
        className="w-[180px] shrink-0 px-3 py-2 border-r flex items-center gap-2 sticky left-0 z-[5] bg-background"
        style={{ borderLeft: `3px solid ${teamHex}` }}
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground w-5">
              {entry.final_position ?? "—"}
            </span>
            <span className="font-mono font-bold text-sm">{entry.driver_acronym}</span>
            {entry.had_issues && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                </TooltipTrigger>
                <TooltipContent>
                  Problemi durante la gara (DNF/DNS/DSQ o molti sorpassi subiti)
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {entry.confidence && (
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-0.5">
              conf · {entry.confidence}
            </span>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 relative h-12">
        {!hasData ? (
          <div className="h-full flex items-center px-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="h-3 w-full rounded bg-muted/50" />
              </TooltipTrigger>
              <TooltipContent>
                Analisi non disponibile: {entry.error ?? "dati insufficienti"}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <Popover>
            <PopoverTrigger asChild>
              <button className="absolute inset-0 px-2 py-2.5 cursor-pointer w-full text-left">
                {/* Neutralisation bands */}
                {bands.map((b, i) => {
                  const left = ((b.start - 1) / totalLaps) * 100;
                  const width = ((b.end - b.start + 1) / totalLaps) * 100;
                  return (
                    <div
                      key={`band-${i}`}
                      className="absolute top-0 bottom-0 bg-muted-foreground/10 border-x border-muted-foreground/20 pointer-events-none"
                      style={{ left: `${left}%`, width: `${width}%` }}
                      aria-hidden
                    />
                  );
                })}

                {/* Stint segments */}
                <div className="relative h-7 rounded overflow-hidden flex">
                  {stintData.map((s) => {
                    const w = ((s.lap_end - s.lap_start + 1) / totalLaps) * 100;
                    const colour = compoundColour(s.compound);
                    return (
                      <div
                        key={s.stint_number}
                        className="h-full relative flex items-center justify-center"
                        style={{ width: `${w}%`, backgroundColor: colour }}
                        title={`Stint ${s.stint_number} · ${s.compound} · L${s.lap_start}-${s.lap_end}`}
                      >
                        {w > 8 && (
                          <span
                            className="text-[9px] font-bold font-mono"
                            style={{
                              color:
                                s.compound.toUpperCase() === "MEDIUM" || s.compound.toUpperCase() === "HARD"
                                  ? "#000"
                                  : "#fff",
                            }}
                          >
                            {s.compound.charAt(0)}
                          </span>
                        )}
                        {s.cliff_risk && (
                          <AlertTriangle className="absolute top-0.5 right-0.5 h-3 w-3 text-foreground/80" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Pit ticks */}
                {entry.pit_laps.map((lap, i) => {
                  const left = (lap / totalLaps) * 100;
                  return (
                    <div
                      key={`pit-${i}`}
                      className="absolute top-1.5 bottom-1.5 w-[2px] bg-foreground"
                      style={{ left: `${left}%` }}
                      aria-label={`Pit stop al giro ${lap}`}
                    />
                  );
                })}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <StintDetails entry={entry} />
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── StintDetails (popover) ───────────────────────── */

function StintDetails({ entry }: { entry: CompetitorEntry }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono font-bold text-sm">{entry.driver_acronym}</span>
        <Badge variant="outline" className="text-[10px] font-mono">
          P{entry.final_position ?? "—"}
        </Badge>
      </div>
      <div className="space-y-1.5">
        {entry.stint_summary.map((s) => (
          <div key={s.stint_number} className="text-xs flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: compoundColour(s.compound) }}
            />
            <span className="font-mono font-bold w-6">S{s.stint_number}</span>
            <span className="font-mono text-muted-foreground">
              L{s.lap_start}-{s.lap_end}
            </span>
            <span className="ml-auto font-mono text-muted-foreground">
              {s.avg_pace ? `${s.avg_pace.toFixed(2)}s` : "—"}
            </span>
            {s.cliff_risk && (
              <AlertTriangle className="h-3 w-3 text-amber-500" />
            )}
          </div>
        ))}
      </div>
      <Link
        to={`/compare?driverA=${entry.driver_number}`}
        className="block text-xs text-center py-1.5 rounded-md bg-muted hover:bg-muted/80 transition-colors"
      >
        Apri Head-to-Head
      </Link>
    </div>
  );
}

/* ───────────────────────── RaceInsights (sidebar) ───────────────────────── */

function RaceInsights({
  matrix, highlightCluster, onClusterClick,
}: {
  matrix: CompetitorMatrix;
  highlightCluster: PitCluster | null;
  onClusterClick: (c: PitCluster | null) => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-4 space-y-5 text-sm">
      <section>
        <h3 className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-2">
          Pit clusters
        </h3>
        {matrix.pit_clusters.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nessun cluster di pit rilevato.</p>
        ) : (
          <div className="space-y-2">
            {matrix.pit_clusters.map((c, i) => {
              const isActive = highlightCluster === c;
              return (
                <button
                  key={i}
                  onClick={() => onClusterClick(isActive ? null : c)}
                  className={cn(
                    "w-full text-left rounded-md border px-3 py-2 transition-colors",
                    isActive ? "border-[hsl(var(--f1-red))] bg-[hsl(var(--f1-red))]/5" : "hover:bg-muted/50",
                  )}
                >
                  <div className="text-xs font-mono mb-1">
                    Giro {c.lap_range[0]}–{c.lap_range[1]}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.driver_numbers.map((dn) => {
                      const e = matrix.drivers.find((x) => x.driver_number === dn);
                      return (
                        <Badge key={dn} variant="secondary" className="text-[10px] font-mono">
                          {e?.driver_acronym ?? `#${dn}`}
                        </Badge>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-2">
          Compound allo start
        </h3>
        {matrix.compound_divergence_at_start.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">N/D</p>
        ) : (
          <div className="space-y-2">
            {matrix.compound_divergence_at_start.map((g) => {
              const total = matrix.drivers.length || 1;
              const pct = (g.driver_numbers.length / total) * 100;
              return (
                <div key={g.compound}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-mono font-bold flex items-center gap-1.5">
                      <span
                        className="inline-block w-3 h-3 rounded-sm"
                        style={{ backgroundColor: compoundColour(g.compound) }}
                      />
                      {g.compound}
                    </span>
                    <span className="text-muted-foreground font-mono">
                      {g.driver_numbers.length}/{total}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full"
                      style={{ width: `${pct}%`, backgroundColor: compoundColour(g.compound) }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-2">
          Eventi sessione
        </h3>
        {matrix.session_wide_events.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nessun evento di rilievo.</p>
        ) : (
          <ul className="space-y-1.5">
            {matrix.session_wide_events.map((e, i) => (
              <li key={i} className="text-xs flex gap-2">
                <span className="font-mono w-10 text-muted-foreground">L{e.lap}</span>
                <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                  {e.type}
                </Badge>
                <span className="text-muted-foreground">{e.description}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ───────────────────────── MetricsTable ───────────────────────── */

function MetricsTable({
  matrix, visible,
}: {
  matrix: CompetitorMatrix;
  visible: CompetitorEntry[];
}) {
  const winner = matrix.drivers.find((d) => d.final_position === 1);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">Pos</TableHead>
          <TableHead>Pilota</TableHead>
          <TableHead className="text-right">Pit</TableHead>
          <TableHead>Compound</TableHead>
          <TableHead className="text-right">Tempo</TableHead>
          <TableHead className="text-right">Δ vs P1</TableHead>
          <TableHead>Confidence</TableHead>
          <TableHead className="text-center">Issues</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map((e) => {
          const linkTo =
            winner && winner.driver_number !== e.driver_number
              ? `/compare?driverA=${e.driver_number}&driverB=${winner.driver_number}`
              : `/compare?driverA=${e.driver_number}`;
          return (
            <TableRow key={e.driver_number} className="cursor-pointer">
              <TableCell className="font-mono">{e.final_position ?? "—"}</TableCell>
              <TableCell>
                <Link to={linkTo} className="flex items-center gap-2 hover:text-foreground">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: `#${e.team_colour}` }}
                  />
                  <span className="font-mono font-bold">{e.driver_acronym}</span>
                </Link>
              </TableCell>
              <TableCell className="text-right font-mono">{e.pit_laps.length}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {e.compound_sequence.map((c, i) => (
                    <span
                      key={i}
                      className="inline-block w-3 h-3 rounded-sm"
                      style={{ backgroundColor: compoundColour(c) }}
                      title={c}
                    />
                  ))}
                </div>
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {e.total_race_time != null ? `${(e.total_race_time / 60).toFixed(2)}m` : "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {e.cumulative_delta_final != null ? `${e.cumulative_delta_final >= 0 ? "+" : ""}${e.cumulative_delta_final.toFixed(2)}s` : "—"}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    e.confidence === "HIGH" ? "default"
                      : e.confidence === "MEDIUM" ? "secondary" : "outline"
                  }
                  className="text-[10px] font-mono"
                >
                  {e.confidence ?? "N/D"}
                </Badge>
              </TableCell>
              <TableCell className="text-center">
                {e.had_issues && <AlertTriangle className="h-4 w-4 text-amber-500 inline" />}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
