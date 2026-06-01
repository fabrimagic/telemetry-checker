import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  getCircuitProfileForNextGP,
  type CircuitProfile,
} from "@/lib/circuitProfiles";
import { getNextSession } from "@/lib/f1Calendar2026";
import {
  computeCarProfiles,
  type CarProfile,
} from "@/lib/carProfiles";
import { predictGpAffinity, type GpPrediction } from "@/lib/gpPrediction";
import {
  buildGpPreviewNarrative,
  buildPerTeamExplanations,
  strengthLabel,
} from "@/lib/gpPreviewNarrative";


// ----- Helpers -----

function qualLabel(v: number): { label: string; tone: string } {
  if (v >= 0.7) return { label: "Alto", tone: "bg-[hsl(var(--f1-red))]/20 text-[hsl(var(--f1-red-glow))] border-[hsl(var(--f1-red))]/40" };
  if (v >= 0.4) return { label: "Medio", tone: "bg-amber-500/15 text-amber-300 border-amber-500/40" };
  return { label: "Basso", tone: "bg-muted/40 text-muted-foreground border-border" };
}

function confidenceLabelIt(c: "high" | "medium" | "low"): string {
  return c === "high" ? "Alta" : c === "medium" ? "Media" : "Bassa";
}

interface CircuitDim {
  key: string;
  label: string;
  value: number;
  help?: string;
}

function CircuitProfileCard({ circuit }: { circuit: CircuitProfile }) {
  const dims: CircuitDim[] = [
    { key: "top_speed", label: "Velocità di punta", value: circuit.top_speed },
    { key: "slow", label: "Trazione curve lente", value: circuit.slow_corner_traction },
    { key: "medium", label: "Curve medie", value: circuit.medium_corner },
    { key: "fast", label: "Curve veloci", value: circuit.fast_corner },
    { key: "tyre", label: "Degrado gomme", value: circuit.tyre_deg },
    {
      key: "overtake",
      label: "Difficoltà di sorpasso",
      value: circuit.overtaking_difficulty,
      help: "Se alta, la qualifica conta di più dei pregi tecnici della vettura.",
    },
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-lg">Caratteristiche del circuito</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              Confidenza profilo: {confidenceLabelIt(circuit.confidence)}
            </Badge>
            {circuit.source === "layout_estimate" && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-amber-500/10 text-amber-300 border-amber-500/40">
                Profilo stimato dal layout
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {dims.map((d) => {
          const q = qualLabel(d.value);
          return (
            <div key={d.key} className="flex flex-col gap-1.5 p-3 rounded-md border border-border/60 bg-muted/20">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{d.label}</span>
                <span className={`text-[10px] uppercase tracking-wider border rounded px-1.5 py-0.5 ${q.tone}`}>
                  {q.label}
                </span>
              </div>
              <Progress value={Math.round(d.value * 100)} className="h-1.5" />
              {d.help && <p className="text-[11px] text-muted-foreground">{d.help}</p>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ----- Result rendering (exported for tests) -----

export function GpPredictionResultView({
  circuit,
  prediction,
  dataContext,
}: {
  circuit: CircuitProfile;
  prediction: GpPrediction;
  dataContext?: {
    totalPastRaces?: number;
    racesConsidered?: number;
    racesWithData?: number;
    diagnostics?: Array<{ name: string; date_end: string; status: "used" | "no_data" | "fetch_failed" }>;
  };
}) {
  const ranked = prediction.ranked;
  const groupOf = useMemo(() => {
    const m = new Map<string, number>();
    prediction.indistinguishable_groups.forEach((g, idx) => {
      for (const name of g) m.set(name, idx);
    });
    return m;
  }, [prediction.indistinguishable_groups]);

  const narrative = useMemo(
    () => buildGpPreviewNarrative(circuit, prediction, dataContext),
    [circuit, prediction, dataContext],
  );

  const perTeam = useMemo(
    () => buildPerTeamExplanations(circuit, prediction),
    [circuit, prediction],
  );
  const perTeamMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of perTeam) m.set(e.team_name, e.text);
    return m;
  }, [perTeam]);


  return (
    <div className="space-y-6">
      {narrative.length > 0 && (
        <Card data-testid="narrative-card" className="border-[hsl(var(--f1-red))]/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />
              In sintesi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed">
            {narrative.map((s, i) => (
              <p key={i} className="text-foreground/90">
                {s}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg">Affinità tecnica stimata per team</CardTitle>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              Confidenza complessiva: {confidenceLabelIt(prediction.global_confidence)}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground pt-1 space-y-2 leading-relaxed">
            <p>
              Il punteggio va da 0 a 1 ed è una <span className="font-medium">stima</span>,
              non una misura esatta: per questo accanto a ogni numero compare un piccolo
              margine (ad esempio &ldquo;0,72 ± 0,05&rdquo;), che rappresenta quanto la stima
              potrebbe variare avendo a disposizione più dati.
            </p>
            <p>
              Quando i margini di due team si sovrappongono, la loro differenza è troppo
              piccola per essere considerata affidabile — un po&apos; come due pesi così
              vicini che la bilancia non riesce a distinguerli con sicurezza. In quei
              casi è più corretto considerarli <span className="font-medium">alla pari</span>{" "}
              invece di metterli in ordine: è ciò che segnala il badge
              &ldquo;Equivalenti entro l&apos;incertezza&rdquo; qui sotto.
            </p>
          </div>

        </CardHeader>
        <CardContent className="space-y-3">
          {ranked.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun profilo-vettura disponibile per stimare l'affinità.
            </p>
          ) : (
            ranked.map((t) => {
              const gIdx = groupOf.get(t.team_name);
              const inGroup = gIdx != null;
              const lo = Math.max(0, t.affinity_score - t.uncertainty);
              const hi = Math.min(1, t.affinity_score + t.uncertainty);
              const total = t.contributions.top_speed + t.contributions.cornering;
              const topPct = total > 0 ? (t.contributions.top_speed / total) * 100 : 50;
              const cornerPct = 100 - topPct;
              return (
                <div
                  key={t.team_name}
                  className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2"
                  data-testid={`team-row-${t.team_name}`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{t.team_name}</span>
                      {inGroup && (
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wider bg-amber-500/10 text-amber-300 border-amber-500/40"
                          data-testid="equivalent-badge"
                        >
                          Equivalenti entro l'incertezza
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t.affinity_score.toFixed(2)} ± {t.uncertainty.toFixed(2)}
                      <span className="ml-1 opacity-70">
                        [{lo.toFixed(2)}–{hi.toFixed(2)}]
                      </span>
                    </span>
                  </div>
                  {/* Uncertainty band */}
                  <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="absolute h-full bg-[hsl(var(--f1-red))]/30"
                      style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }}
                    />
                    <div
                      className="absolute top-0 h-full w-[2px] bg-[hsl(var(--f1-red))]"
                      style={{ left: `calc(${t.affinity_score * 100}% - 1px)` }}
                    />
                  </div>
                  {/* Contributions */}
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>
                      Velocità di punta:&nbsp;
                      <span className="text-foreground font-medium tabular-nums">
                        {Math.round(topPct)}%
                      </span>
                    </span>
                    <span>
                      Curve:&nbsp;
                      <span className="text-foreground font-medium tabular-nums">
                        {Math.round(cornerPct)}%
                      </span>
                    </span>
                    <span className="ml-auto opacity-70">
                      Confidenza team: {confidenceLabelIt(t.confidence)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
          <p className="text-[11px] text-muted-foreground italic pt-2">
            Linguaggio prudente: il circuito <em>sembra adattarsi</em> ai team in cima alla lista,
            sui dati raccolti finora. Non è una previsione del risultato di gara.
          </p>
        </CardContent>
      </Card>

      <Card data-testid="caveats-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Cosa questo NON dice
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {prediction.notes.length > 0 && (
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              {prediction.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <div>
            <p className="font-medium mb-1">Fattori non modellati in questa analisi:</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Risultato della qualifica e griglia di partenza</li>
              <li>Meteo gara (pioggia, vento, temperatura asfalto)</li>
              <li>Safety Car, VSC e bandiere rosse</li>
              <li>Errori di guida ed episodi di gara</li>
              <li>Strategia gomme, undercut/overcut, soste</li>
              <li>Aggiornamenti tecnici introdotti nel weekend</li>
            </ul>
          </div>
          <p className="text-xs text-muted-foreground italic border-t border-border/60 pt-3">
            Anteprima ragionata basata sulle caratteristiche tecniche stimate,
            non una previsione del risultato.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ----- Page -----

export default function GpPreview() {
  const circuit = useMemo(() => getCircuitProfileForNextGP(), []);
  const next = useMemo(() => getNextSession(), []);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<CarProfile[] | null>(null);
  const [racesConsidered, setRacesConsidered] = useState<number>(0);
  const [dataContext, setDataContext] = useState<{
    totalPastRaces?: number;
    racesConsidered?: number;
    racesWithData?: number;
    diagnostics?: Array<{ name: string; date_end: string; status: "used" | "no_data" | "fetch_failed" }>;
  } | undefined>(undefined);
  const [aborted, setAborted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const prediction = useMemo(() => {
    if (!circuit || !profiles) return null;
    return predictGpAffinity(circuit, profiles, { racesConsidered });
  }, [circuit, profiles, racesConsidered]);

  const handleRun = useCallback(async () => {
    if (!circuit) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setError(null);
    setAborted(false);
    setProfiles(null);
    setRacesConsidered(0);
    setDataContext(undefined);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await computeCarProfiles({
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setProfiles(res.profiles);
      setRacesConsidered(res.races_used.length);
      setAborted(res.aborted);
      const racesWithData = res.profiles.reduce((m, p) => Math.max(m, p.sample_races), 0);
      setDataContext({
        totalPastRaces: res.total_past_races,
        racesConsidered: res.races_considered,
        racesWithData,
        diagnostics: res.races_diagnostics,
      });

    } catch (e: any) {
      setError(e?.message ?? "Errore durante il calcolo dei profili vettura");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [circuit]);


  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Home
              </Button>
            </Link>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Anteprima GP
            </h1>
          </div>
          {next && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Prossimo Gran Premio
              </div>
              <div className="text-sm font-semibold">{next.session.gpName}</div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {!circuit && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-base font-medium">Nessun Gran Premio mappato in arrivo.</p>
              <p className="text-sm text-muted-foreground mt-1">
                La stagione potrebbe essere terminata, oppure il prossimo GP non è ancora
                nel dataset dei profili-circuito.
              </p>
            </CardContent>
          </Card>
        )}

        {circuit && (
          <>
            <CircuitProfileCard circuit={circuit} />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Analisi tecnica dei team</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!profiles && !running && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Scarica i dati delle ultime gare per stimare le caratteristiche delle vetture —
                      può richiedere un minuto.
                    </p>
                    <Button onClick={handleRun} className="gap-2">
                      <Sparkles className="h-4 w-4" />
                      Analizza i team su questo circuito
                    </Button>
                  </>
                )}

                {running && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {progress && progress.total > 0
                        ? `Analisi gara ${Math.min(progress.done + 1, progress.total)} di ${progress.total}…`
                        : "Preparazione dati…"}
                    </div>
                    {progress && progress.total > 0 && (
                      <Progress
                        value={Math.round((progress.done / progress.total) * 100)}
                        className="h-2"
                      />
                    )}
                    <Button variant="outline" size="sm" onClick={handleAbort} className="gap-2">
                      <XCircle className="h-4 w-4" />
                      Annulla
                    </Button>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}

                {profiles && profiles.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Non sono disponibili abbastanza dati di gara per stimare i profili
                    delle vetture. Riprova dopo i prossimi Gran Premi.
                  </p>
                )}

                {aborted && profiles && profiles.length > 0 && (
                  <p className="text-xs text-amber-400">
                    Calcolo interrotto: risultati parziali sui dati già scaricati.
                  </p>
                )}
              </CardContent>
            </Card>

            {prediction && profiles && profiles.length > 0 && (
              <GpPredictionResultView circuit={circuit} prediction={prediction} dataContext={dataContext} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
