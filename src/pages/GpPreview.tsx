import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronDown, Loader2, Sparkles, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  
} from "@/lib/gpPreviewNarrative";
import { analyzeCornersForSession } from "@/lib/cornerAnalysis";
import { resolveCalendarGpName } from "@/lib/circuitGeometry";
import type { SessionInfo } from "@/lib/openf1";


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
          <CardTitle className="text-lg">Contesto: caratteristiche del circuito</CardTitle>
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
        <p className="text-[11px] text-muted-foreground pt-2 leading-relaxed">
          Descrizione del carattere del tracciato. <span className="font-medium">Non</span> entra nel
          punteggio dei team: il backtest ha mostrato che, con i dati 2026 attuali, l'analisi
          circuito-specifica non migliora ancora la previsione rispetto alla pura forza recente
          delle vetture.
        </p>
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

// ----- Per-team Technical Details (expandable, default closed) -----

function mapConfidenceLabel(c?: "high" | "medium" | "low"): string {
  if (c === "high") return "alta";
  if (c === "medium") return "media";
  if (c === "low") return "bassa";
  return "n/d";
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function TeamTechnicalDetails({
  team,
  car,
  circuit,
}: {
  team: import("@/lib/gpPrediction").TeamGpAffinity;
  car?: CarProfile;
  circuit: CircuitProfile;
}) {
  const [open, setOpen] = useState(false);
  // Show even without car (some fields still informative) but most useful with it.
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors pt-1"
          data-testid={`tech-toggle-${team.team_name}`}
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
          Dettagli tecnici
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent
        className="pt-2"
        data-testid={`tech-details-${team.team_name}`}
      >
        <div className="rounded-md border border-border/50 bg-background/60 p-3 space-y-3 text-[11px] text-muted-foreground">
          {/* Velocità di punta */}
          <div>
            <div className="font-medium text-foreground/90 mb-0.5">
              Indice velocità di punta
            </div>
            <div className="tabular-nums">
              {fmt(car?.top_speed_index)} <span className="opacity-70">(0–1, dove 1 = miglior valore del campo)</span>
            </div>
          </div>

          {/* Tenuta in curva — dipende dal corner_source */}
          <div>
            <div className="font-medium text-foreground/90 mb-0.5">Tenuta in curva</div>
            {team.corner_source === "location_geometry" && car?.corner_type_strength && (
              <div className="space-y-0.5 tabular-nums">
                <div>
                  Lente: {fmt(car.corner_type_strength.slow)} · Medie:{" "}
                  {fmt(car.corner_type_strength.medium)} · Veloci:{" "}
                  {fmt(car.corner_type_strength.fast)}
                </div>
                <div className="opacity-70 normal-case">
                  Misura per tipo di curva, ricostruita dalla geometria del tracciato.
                </div>
              </div>
            )}
            {team.corner_source === "sector_typed_history" && car?.corner_type_strength && (
              <div className="space-y-0.5 tabular-nums">
                <div>
                  Lente: {fmt(car.corner_type_strength.slow)} · Medie:{" "}
                  {fmt(car.corner_type_strength.medium)} · Veloci:{" "}
                  {fmt(car.corner_type_strength.fast)}
                </div>
                <div className="opacity-70 normal-case">
                  Stima per tipo dai settori delle gare precedenti, classificati per carattere di ciascun circuito.
                </div>
              </div>
            )}
            {team.corner_source === "sector_typed" && (
              <div className="space-y-0.5 tabular-nums">
                {team.corner_type_estimate ? (
                  <div>
                    Stima — Lente: {fmt(team.corner_type_estimate.slow)} · Medie:{" "}
                    {fmt(team.corner_type_estimate.medium)} · Veloci:{" "}
                    {fmt(team.corner_type_estimate.fast)}
                  </div>
                ) : null}
                {car && (
                  <div>
                    Forza per settore — S1: {fmt(car.sector_strength.s1)} · S2:{" "}
                    {fmt(car.sector_strength.s2)} · S3: {fmt(car.sector_strength.s3)}
                  </div>
                )}
                <div className="opacity-70 normal-case">
                  Affidabilità classificazione settori:{" "}
                  <span className="text-foreground/80">
                    {mapConfidenceLabel(team.sector_corner_map_confidence)}
                  </span>
                  .
                </div>
              </div>
            )}
            {team.corner_source === "sector_fallback" && car && (
              <div className="space-y-0.5 tabular-nums">
                <div>
                  Forza per settore — S1: {fmt(car.sector_strength.s1)} · S2:{" "}
                  {fmt(car.sector_strength.s2)} · S3: {fmt(car.sector_strength.s3)}
                </div>
                <div className="opacity-70 normal-case">
                  Media aggregata: non distingue per tipo di curva.
                </div>
              </div>
            )}
          </div>

          {/* Pesi del circuito */}
          <div>
            <div className="font-medium text-foreground/90 mb-0.5">
              Pesi del circuito (cosa premia)
            </div>
            <div className="tabular-nums">
              Velocità di punta: {fmt(circuit.top_speed)} · Lente:{" "}
              {fmt(circuit.slow_corner_traction)} · Medie: {fmt(circuit.medium_corner)} ·
              Veloci: {fmt(circuit.fast_corner)}
            </div>
          </div>

          {/* Campione */}
          {car && (
            <div>
              <div className="font-medium text-foreground/90 mb-0.5">Campione usato</div>
              <div className="tabular-nums">
                Gare: {car.sample_races} · Equivalente a peso pieno:{" "}
                {fmt(car.effective_sample_races, 2)} · Giri: {car.sample_laps}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function GpPredictionResultView({
  circuit,
  prediction,
  dataContext,
  profiles,
}: {
  circuit: CircuitProfile;
  prediction: GpPrediction;
  dataContext?: {
    totalPastRaces?: number;
    racesConsidered?: number;
    racesWithData?: number;
    diagnostics?: Array<{ name: string; date_end: string; status: "used" | "no_data" | "fetch_failed" }>;
  };
  profiles?: CarProfile[];
}) {
  const profileByTeam = useMemo(() => {
    const m = new Map<string, CarProfile>();
    for (const p of profiles ?? []) m.set(p.team_name, p);
    return m;
  }, [profiles]);
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
            <CardTitle className="text-lg">Forza recente stimata per team</CardTitle>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              Confidenza complessiva: {confidenceLabelIt(prediction.global_confidence)}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground pt-1 space-y-2 leading-relaxed">
            <p>
              Il punteggio (0–1) riflette la <span className="font-medium">forza recente
              complessiva</span> di ciascuna vettura — velocità di punta e tenuta in curva
              aggregate dalle gare già disputate. Non incorpora il carattere specifico di
              questo circuito: l'analisi per tipo di curva è mostrata sotto come
              <span className="font-medium"> contesto descrittivo</span>, ma non viene usata
              per la previsione perché, con i dati 2026 attuali, non ha ancora dimostrato
              di migliorarla.
            </p>
            <p>
              Accanto a ogni numero compare un piccolo margine di incertezza (ad esempio
              &ldquo;0,72 ± 0,05&rdquo;): quando i margini di due team si sovrappongono, la
              loro differenza è troppo piccola per essere considerata affidabile — è più
              corretto considerarli <span className="font-medium">alla pari</span>, come
              segnala il badge &ldquo;Equivalenti entro l&apos;incertezza&rdquo;.
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
                          title="Con i dati attuali non si può dire con sicurezza chi dei team marcati così sia avanti: vanno considerati alla pari."
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
                  {/* Contributions + verbal strength tag */}
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
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
                    <span
                      className="text-[10px] uppercase tracking-wider border rounded px-1.5 py-0.5 bg-muted/40 text-foreground/80 border-border"
                      data-testid={`strength-tag-${t.team_name}`}
                    >
                      Più forte in:{" "}
                      {strengthLabel(topPct) === "rettilineo"
                        ? "rettilineo"
                        : strengthLabel(topPct) === "curve"
                          ? "curve"
                          : "equilibrato"}
                    </span>
                    {t.corner_source === "location_geometry" && (
                      <span
                        className="text-[10px] uppercase tracking-wider border rounded px-1.5 py-0.5 bg-sky-500/10 text-sky-300 border-sky-500/40"
                        data-testid={`corner-source-${t.team_name}`}
                        title="La tenuta in curva per tipo (lente/medie/veloci) è ricostruita dalla geometria del circuito e dalla posizione GPS in qualifica: lettura più granulare ma sperimentale, può contenere imprecisioni di allineamento."
                      >
                        Curve da geometria GPS
                      </span>
                    )}
                    {t.corner_source === "sector_typed_history" && (
                      <span
                        className="text-[10px] uppercase tracking-wider border rounded px-1.5 py-0.5 bg-emerald-500/10 text-emerald-300 border-emerald-500/40"
                        data-testid={`corner-source-${t.team_name}`}
                        title="La tenuta in curva per tipo (lente/medie/veloci) è stimata dalla prestazione nei settori delle gare precedenti, classificati secondo il carattere di ciascun circuito. È la stima più solida disponibile quando non c'è la ricostruzione GPS."
                      >
                        Curve: stima per tipo (storico settori)
                      </span>
                    )}
                    {t.corner_source === "sector_typed" && (
                      <>
                        <span
                          className="text-[10px] uppercase tracking-wider border rounded px-1.5 py-0.5 bg-amber-500/10 text-amber-300 border-amber-500/40"
                          data-testid={`corner-source-${t.team_name}`}
                          title="La tenuta in curva per tipo (lente/medie/veloci) è stimata dalla prestazione nei diversi settori del circuito, ciascuno con il suo carattere. È una stima a grana di settore — più ricca della semplice media, ma non una misura diretta per singola curva."
                        >
                          Curve: stima per tipo (settori)
                        </span>
                        {t.sector_corner_map_confidence === "low" && (
                          <span
                            className="text-[10px] uppercase tracking-wider border rounded px-1.5 py-0.5 bg-muted/40 text-muted-foreground border-amber-500/30"
                            data-testid={`map-confidence-low-${t.team_name}`}
                            title="La classificazione per-settore di questo circuito è meno solida nelle fonti pubbliche: trattare come stima approssimata."
                          >
                            stima approssimata
                          </span>
                        )}
                      </>
                    )}
                    {t.corner_source === "sector_fallback" && (
                      <span
                        className="text-[10px] uppercase tracking-wider border rounded px-1.5 py-0.5 bg-muted/40 text-muted-foreground border-border"
                        data-testid={`corner-source-${t.team_name}`}
                        title="La tenuta in curva è stimata dai tempi di settore aggregati (metodo robusto ma meno granulare: non distingue fra curve lente, medie e veloci)."
                      >
                        Curve da settori (stima)
                      </span>
                    )}

                    <span className="ml-auto opacity-70">
                      Confidenza team: {confidenceLabelIt(t.confidence)}
                    </span>
                  </div>
                  {/* Per-team plain-language explanation */}
                  {perTeamMap.get(t.team_name) && (
                    <p
                      className="text-xs text-foreground/80 leading-relaxed pt-1 border-t border-border/40"
                      data-testid={`team-explanation-${t.team_name}`}
                    >
                      {perTeamMap.get(t.team_name)}
                    </p>
                  )}
                  <TeamTechnicalDetails
                    team={t}
                    car={profileByTeam.get(t.team_name)}
                    circuit={circuit}
                  />
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
        analyzeQualiCorners: async (qualiSession: SessionInfo, driverNumbers: number[]) => {
          // BUG-FIX: previously this passed qualiSession.location /
          // country_name (e.g. "Monaco", "Suzuka") directly as gpName, but
          // GP_TO_CIRCUIT_ID is keyed on the Italian calendar gpName
          // ("Gran Premio di Monaco", ...). The keys NEVER matched, so
          // fetchCircuitOutline always returned null and the geometric
          // corner analysis silently no-opped on every historical race.
          //
          // We CAN'T just pass circuit.gpName (the upcoming GP) either,
          // because the historical qualifying being analyzed is from a
          // DIFFERENT circuit — using the next GP's layout would mis-align
          // GPS points against a track the cars never drove.
          //
          // Correct resolution: normalize OpenF1 location/country_name into
          // the calendar gpName via the explicit lookup table in
          // circuitGeometry. If the historical race is on a circuit not in
          // GP_TO_CIRCUIT_ID, the resolver returns null and we degrade to
          // sector_fallback (real degradation, no fake layout).
          const loc = (qualiSession as { location?: string }).location;
          const country = (qualiSession as { country_name?: string }).country_name;
          const ckey = (qualiSession as { circuit_key?: number }).circuit_key;
          const gpName = resolveCalendarGpName(loc, country, ckey);
          if (!gpName) return null;
          const dateStart = qualiSession.date_start ?? qualiSession.date_end ?? "";
          const dateEnd = qualiSession.date_end ?? qualiSession.date_start ?? "";
          if (!dateStart || !dateEnd) return null;
          try {
            return await analyzeCornersForSession(gpName, qualiSession.session_key, driverNumbers, {
              signal: ctrl.signal,
              dateStart,
              dateEnd,
            });
          } catch {
            return null;
          }
        },
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
              <GpPredictionResultView circuit={circuit} prediction={prediction} dataContext={dataContext} profiles={profiles} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
