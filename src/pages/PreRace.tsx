import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Loader2, RotateCcw, AlertTriangle, ArrowLeft, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionPicker } from "@/components/f1/SessionPicker";
import { getDrivers, type Driver } from "@/lib/openf1";
import { loadPreRaceAnalysis, type PreRaceLoaderOutput } from "@/lib/preRaceLoader";
import { RankingCard } from "@/components/f1/preRace/RankingCard";
import { CompoundStressCard } from "@/components/f1/preRace/CompoundStressCard";
import { FingerprintCard } from "@/components/f1/preRace/FingerprintCard";
import { WatchListCard } from "@/components/f1/preRace/WatchListCard";

export default function PreRace() {
  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [, setMeetingKey] = useState<number>(0);
  const [, setDrivers] = useState<Driver[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysis, setAnalysis] = useState<PreRaceLoaderOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSessionSubmit = useCallback(
    async (key: number, _type: string, mKey: number) => {
      setError(null);
      setAnalysis(null);
      setSessionKey(key);
      setMeetingKey(mKey);
      setLoadingDrivers(true);
      try {
        const drv = await getDrivers(key);
        setDrivers(drv);
        if (!drv.length) {
          setError("Nessun pilota trovato per la gara selezionata");
          setLoadingDrivers(false);
          return;
        }
        setLoadingDrivers(false);
        setLoadingAnalysis(true);
        const result = await loadPreRaceAnalysis({
          meetingKey: mKey,
          drivers: drv,
          narrativeSessionKey: key,
        });
        setAnalysis(result);
        if (result.error) setError(result.error);
      } catch (e: any) {
        setError(e?.message ?? "Errore durante il caricamento");
      } finally {
        setLoadingDrivers(false);
        setLoadingAnalysis(false);
      }
    },
    [],
  );

  const handleReset = useCallback(() => {
    setSessionKey(null);
    setMeetingKey(0);
    setDrivers([]);
    setAnalysis(null);
    setError(null);
  }, []);

  const isLoading = loadingDrivers || loadingAnalysis;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-1 h-6 rounded-full bg-[hsl(var(--f1-red))]" />
            <h1 className="text-lg font-bold tracking-tight">PitWall AI · Pre-Race Analysis</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted/50 inline-flex items-center gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Torna alla home
            </Link>
            {sessionKey && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="gap-1.5 text-xs text-muted-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Cambia gara
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <section className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Analisi pre-gara basata sui long run di pratica e sulla qualifica del weekend.
          </p>
        </section>

        {!sessionKey && (
          <section className="space-y-3">
            <SessionPicker
              onSelect={handleSessionSubmit}
              isLoading={loadingDrivers}
              sessionTypeFilter={["Race"]}
            />
            <p className="text-xs text-muted-foreground">
              Scegli la gara di cui vuoi vedere l'analisi pre-gara. Pitwall recupererà
              automaticamente le sessioni di pratica e di qualifica del meeting.
            </p>
          </section>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm flex gap-2 items-start">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Errore</p>
              <p className="text-muted-foreground">{error}</p>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {loadingDrivers
                ? "Caricamento piloti…"
                : "Analisi long run di pratica in corso (può richiedere fino a 10 minuti la prima volta)…"}
            </div>
            <Skeleton className="h-32" />
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        )}

        {analysis && !analysis.error && (
          <div className="space-y-6">
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                Durante il weekend di gara, le squadre usano le pratiche per fare "long run",
                cioè sequenze di giri consecutivi che simulano il passo gara reale. Pitwall
                analizza questi long run cross-pilota per costruire un'idea di chi avrà il
                passo migliore in gara, indipendentemente dalla posizione di qualifica. Le
                quattro sezioni sotto mostrano: chi è veloce sul lungo, come reagiscono le
                mescole, quali piloti hanno qualificato meglio o peggio del loro passo gara, e
                chi tenere d'occhio. I dati provengono da OpenF1; le analisi sono solo
                indicative.
              </p>
            </div>

            <div className="rounded-md border border-border bg-muted/30 px-4 py-3 space-y-2">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                  <span className="text-muted-foreground">Format: </span>
                  <span className="font-medium">
                    {analysis.weekendFormat === "SPRINT" ? "Sprint Weekend" : "Standard Weekend"}
                  </span>
                </span>
                <span>
                  <span className="text-muted-foreground">Sessioni analizzate: </span>
                  <span className="font-medium">
                    {analysis.practiceSessionsUsed.map((s) => s.session_name).join(", ") ||
                      "nessuna"}
                  </span>
                </span>
              </div>
              {analysis.preRaceAnalysis.lowSampleCaveat &&
                analysis.preRaceAnalysis.totalDriversWithLongRun > 0 && (
                  <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Solo {analysis.preRaceAnalysis.totalDriversWithLongRun} piloti con long run
                      statisticamente significativi
                    </span>
                  </div>
                )}
            </div>

            {analysis.warnings.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> Avvertenze
                </div>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {analysis.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            <RankingCard ranking={analysis.preRaceAnalysis.ranking} />

            <CompoundStressCard
              compoundStress={analysis.preRaceAnalysis.compoundStress}
              insights={analysis.narrative.compoundStressInsights}
            />

            <FingerprintCard
              fingerprint={analysis.qualifyingFingerprint}
              insights={analysis.narrative.qualiAnomalyInsights}
            />

            <WatchListCard
              watchList={analysis.preRaceAnalysis.watchList}
              insights={analysis.narrative.watchListInsights}
            />
          </div>
        )}
      </main>

      <footer className="mt-12 border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        Questo è un progetto sviluppato da Fabrizio Monaco
      </footer>
    </div>
  );
}
