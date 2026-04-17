import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, BarChart3, Gauge, Brain, Cloud, Flag, Swords, TrendingDown, Timer, Shield, Beaker, Target, Layers, ChevronDown, Play, Users, Table, Map, Activity, Thermometer, Wrench, Eye, Zap, LayoutDashboard, Settings, Info, Lightbulb, Navigation, Scale, FlaskConical, ArrowRight } from "lucide-react";
import { useState } from "react";

/* ── Collapsible Section ── */

function DocSection({ id, title, icon, children, defaultOpen = false }: {
  id?: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={id} className="border border-border rounded-lg overflow-hidden scroll-mt-20">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left bg-card hover:bg-muted/50 transition-colors"
      >
        <span className="text-primary">{icon}</span>
        <span className="font-semibold text-foreground flex-1">{title}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-5 py-4 border-t border-border bg-background space-y-4 text-sm text-muted-foreground leading-relaxed">{children}</div>}
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return <code className="block bg-muted/60 border border-border rounded px-3 py-2 text-xs font-mono text-foreground overflow-x-auto">{children}</code>;
}

function Param({ name, desc }: { name: string; desc: string }) {
  return (
    <li className="flex gap-2">
      <code className="text-primary text-xs font-mono whitespace-nowrap">{name}</code>
      <span>— {desc}</span>
    </li>
  );
}

function TocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="block py-1.5 pl-3 border-l-2 border-border hover:border-primary text-primary hover:text-primary/80 hover:bg-primary/5 hover:translate-x-0.5 transition-all text-sm leading-snug rounded-r"
      onClick={(e) => {
        e.preventDefault();
        const el = document.querySelector(href);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          const btn = el.querySelector("button");
          const chevron = btn?.querySelector("svg:last-child");
          if (chevron && !chevron.classList.contains("rotate-180")) {
            btn?.click();
          }
        }
      }}
    >
      {children}
    </a>
  );
}

function SectionDivider({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-6 pb-1">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">{title}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-muted-foreground shrink-0 w-36">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}

/* ── Main Page ── */

export default function Documentation() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <BookOpen className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold tracking-tight">Documentazione Tecnica</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-4">

        {/* ═══════════════════════════════════════════════ */}
        {/* INTRO */}
        {/* ═══════════════════════════════════════════════ */}
        <div className="bg-card rounded-lg border border-border p-5 space-y-3">
          <p className="text-foreground font-semibold text-lg">F1 Telemetry Checker</p>
          <p className="text-sm text-muted-foreground">
            Applicazione web per l'analisi strategica e telemetrica delle sessioni di Formula 1,
            basata interamente su dati pubblici provenienti dall'API <strong className="text-foreground">OpenF1</strong>.
          </p>
          <p className="text-sm text-muted-foreground">
            Ogni modulo analitico è progettato per essere <strong className="text-foreground">trasparente</strong>, <strong className="text-foreground">tracciabile</strong> e <strong className="text-foreground">anti-allucinatorio</strong>:
            nessun dato viene inventato, nessuna stima viene presentata come certezza. Dove il modello
            è incerto, la confidenza viene ridotta e comunicata esplicitamente.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="text-[10px] px-2 py-1 rounded bg-muted border border-border text-muted-foreground">OpenF1 API</span>
            <span className="text-[10px] px-2 py-1 rounded bg-muted border border-border text-muted-foreground">Analisi in tempo reale</span>
            <span className="text-[10px] px-2 py-1 rounded bg-muted border border-border text-muted-foreground">Anti-allucinazione</span>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════ */}
        {/* TABLE OF CONTENTS */}
        {/* ═══════════════════════════════════════════════ */}
        <div className="bg-card rounded-lg border border-border p-5 space-y-4">
          <p className="text-foreground font-semibold flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            Indice
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-2 mb-2 pb-1.5 border-b border-border/60">Per iniziare</p>
              <TocLink href="#getting-started">Come iniziare</TocLink>
              <TocLink href="#data-source">Fonte Dati — OpenF1 API</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Visualizzazione dati</p>
              <TocLink href="#lap-times-chart">Grafico Tempi al Giro</TocLink>
              <TocLink href="#telemetry">Telemetria e Track Map</TocLink>
              <TocLink href="#sectors">Settori e Mini-Settori</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Report sessione</p>
              <TocLink href="#session-report">Session Report</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Analisi pilota</p>
              <TocLink href="#weather-card">Meteo</TocLink>
              <TocLink href="#pit-stops">Pit Stop</TocLink>
              <TocLink href="#stints">Stint</TocLink>
              <TocLink href="#overtakes">Sorpassi</TocLink>
              <TocLink href="#race-diary">Diario di Gara</TocLink>
              <TocLink href="#cumulative-deviation">Deviazione Cumulativa</TocLink>
              <TocLink href="#tyre-degradation-card">Degrado Gomme (Card)</TocLink>
              <TocLink href="#key-decision-moments">Key Decision Moments</TocLink>
              <TocLink href="#soft-sensors">Soft Sensors</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Confronto piloti</p>
              <TocLink href="#head-to-head-overview">Head-to-Head — Panoramica</TocLink>
              <TocLink href="#head-to-head-ui">Head-to-Head — Interfaccia</TocLink>
              <TocLink href="#head-to-head-engine">Head-to-Head — Motore di Confronto</TocLink>
              <TocLink href="#head-to-head-alternative">Head-to-Head — Strategia alternativa</TocLink>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-2 mb-2 pb-1.5 border-b border-border/60">Virtual Race Engineer</p>
              <TocLink href="#vre-overview">Panoramica VRE</TocLink>
              <TocLink href="#vre-analysis-modes">Modalità di Analisi (Race Engineer / Post-Race)</TocLink>
              <TocLink href="#vre-ui">Interfaccia a 4 Sezioni</TocLink>
              <TocLink href="#vre-view-modes">Modalità di Visualizzazione</TocLink>
              <TocLink href="#vre-cost-function">Funzione di Costo</TocLink>
              <TocLink href="#vre-risk-mode">Risk Mode & Decision Layer</TocLink>
              <TocLink href="#vre-scenarios">Scenari What-If</TocLink>
              <TocLink href="#vre-breakdown">Scomposizione del Giudizio</TocLink>
              <TocLink href="#vre-verdict">Verdetto e Confidenza</TocLink>
              <TocLink href="#vre-context">Contesto Integrato</TocLink>
              <TocLink href="#vre-delta-convention">Convenzione Delta</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Modelli di calcolo</p>
              <TocLink href="#tyre-degradation">Degrado Gomme (Modello)</TocLink>
              <TocLink href="#corrected-degradation">Degrado Corretto (Two-Stage)</TocLink>
              <TocLink href="#degradation-validation">Validazione Degrado</TocLink>
              <TocLink href="#tyre-warmup">Tyre Warmup</TocLink>
              <TocLink href="#weather-classification">Classificazione Meteo</TocLink>
              <TocLink href="#track-status">Track Status</TocLink>
              <TocLink href="#traffic-predictor">Traffic Predictor</TocLink>
              <TocLink href="#strategy-analysis">Strategy Analysis</TocLink>
              <TocLink href="#pace-loss">Pace Loss Rate</TocLink>
              <TocLink href="#battle-detection">Battle Detection</TocLink>
              <TocLink href="#long-run">Long Run Detector</TocLink>
              <TocLink href="#scenario-engine">Scenario Engine</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Principi</p>
              <TocLink href="#anti-hallucination">Anti-Allucinazione</TocLink>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Per iniziare" />
        {/* ═══════════════════════════════════════════════════════ */}

        <DocSection id="getting-started" title="Come iniziare" icon={<Play className="h-4 w-4" />} defaultOpen>
          <p>L'applicazione si articola in tre passaggi principali:</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <strong className="text-foreground">Seleziona una sessione</strong> — Puoi inserire manualmente una <em>Session Key</em> (es. 9161)
              oppure usare il <strong className="text-foreground">Session Picker</strong> per sfogliare le sessioni per anno, gran premio e tipo
              (Practice 1–3, Qualifying, Sprint, Race). Il picker carica automaticamente gli eventi disponibili dall'API OpenF1.
            </li>
            <li>
              <strong className="text-foreground">Seleziona uno o più piloti</strong> — Una volta caricata la sessione,
              compare l'elenco dei piloti con nome, acronimo e colore del team.
              Puoi selezionare <strong className="text-foreground">più piloti</strong> per confronti multi-driver
              oppure <strong className="text-foreground">un singolo pilota</strong> per attivare l'analisi individuale e il Virtual Race Engineer.
            </li>
            <li>
              <strong className="text-foreground">Esplora i dati</strong> — Il sistema carica automaticamente tempi al giro, stint, pit stop,
              meteo e posizioni. Le visualizzazioni e le card analitiche si adattano alla selezione corrente.
            </li>
          </ol>

          <h4 className="font-semibold text-foreground mt-3">Modalità di visualizzazione</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Multi-pilota</strong> — Confronto tempi al giro, posizioni, gap, deviazione cumulativa. Ideale per analisi comparative.</li>
            <li><strong className="text-foreground">Singolo pilota</strong> — Telemetria dettagliata, track map, analisi stint, pit stop, sorpassi, diario di gara, degrado gomme e <strong className="text-foreground">Virtual Race Engineer</strong> (solo per Race/Sprint).</li>
          </ul>
        </DocSection>

        <DocSection id="data-source" title="Fonte Dati — OpenF1 API" icon={<Layers className="h-4 w-4" />}>
          <p>
            Tutti i dati provengono dall'API pubblica <strong className="text-foreground">api.openf1.org</strong>.
            Gli endpoint utilizzati includono:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">sessions</strong> — elenco sessioni per anno e meeting</li>
            <li><strong className="text-foreground">meetings</strong> — elenco gran premi per anno</li>
            <li><strong className="text-foreground">drivers</strong> — elenco piloti, team, colori</li>
            <li><strong className="text-foreground">laps</strong> — tempi al giro, settori, pit out lap</li>
            <li><strong className="text-foreground">stints</strong> — stint, mescola, età gomma</li>
            <li><strong className="text-foreground">pit</strong> — pit stop, lane duration, stop duration</li>
            <li><strong className="text-foreground">car_data</strong> — RPM, velocità, marcia, freni, acceleratore</li>
            <li><strong className="text-foreground">location</strong> — coordinate X/Y/Z per track map</li>
            <li><strong className="text-foreground">weather</strong> — temperatura pista/aria, pioggia, umidità, pressione, vento</li>
            <li><strong className="text-foreground">race_control</strong> — messaggi bandiere, Safety Car, VSC, Red Flag</li>
            <li><strong className="text-foreground">intervals</strong> — gap to leader e interval al pilota davanti</li>
            <li><strong className="text-foreground">position</strong> — posizione in gara in tempo reale</li>
            <li><strong className="text-foreground">session_result</strong> — classifica finale</li>
          </ul>
          <p className="text-xs italic">
            Limitazione: OpenF1 non espone carico carburante reale, setup vettura, pressioni gomme
            o dati GPS di alta precisione. Ogni modulo tiene conto di questi limiti e utilizza proxy dove necessario.
          </p>
        </DocSection>

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Visualizzazione dati" />
        {/* ═══════════════════════════════════════════════════════ */}

        <DocSection id="lap-times-chart" title="Grafico Tempi al Giro" icon={<BarChart3 className="h-4 w-4" />}>
          <p>
            Mostra l'andamento dei tempi al giro per ogni pilota selezionato.
            I giri con <code className="text-primary">lap_duration == null</code> o con flag
            <code className="text-primary"> is_pit_out_lap</code> vengono comunque visualizzati
            ma segnalati visivamente con marker differenziati.
          </p>
          <p>
            Il confronto multi-pilota permette di sovrapporre le curve di passo per individuare
            cross-over points, stint differenziali e perdite di performance relative.
          </p>
          <h4 className="font-semibold text-foreground mt-3">Funzionalità</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Colore linea basato sul <code className="text-primary">team_colour</code> del pilota</li>
            <li>Tooltip con dettaglio tempo, settori e compound</li>
            <li>Selezione giro tramite click per caricare la telemetria</li>
            <li>Pulsante <strong className="text-foreground">"Fastest Lap"</strong> per selezionare automaticamente il giro più veloce</li>
          </ul>
        </DocSection>

        <DocSection id="telemetry" title="Telemetria — Car Data & Track Map" icon={<Gauge className="h-4 w-4" />}>
          <p>
            Per un singolo giro selezionato, il sistema carica i dati telemetrici ad alta frequenza
            dall'endpoint <code className="text-primary">car_data</code> nel range temporale corrispondente al giro:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Velocità</strong> — km/h nel tempo (grafico a linea)</li>
            <li><strong className="text-foreground">Throttle</strong> — percentuale acceleratore 0–100% (grafico area)</li>
            <li><strong className="text-foreground">Brake</strong> — stato freni attivo/inattivo (grafico step)</li>
            <li><strong className="text-foreground">RPM</strong> — regime motore (grafico a linea)</li>
            <li><strong className="text-foreground">Marcia</strong> — rapporto inserito 1–8 (grafico step)</li>
          </ul>
          <p>
            I 5 grafici sono allineati verticalmente con <strong className="text-foreground">asse X condiviso</strong> (tempo relativo dall'inizio giro).
            Un <strong className="text-foreground">cursore verticale sincronizzato</strong> si muove su tutti i grafici quando l'utente passa il mouse.
          </p>
          <h4 className="font-semibold text-foreground mt-3">Track Map</h4>
          <p>
            La <strong className="text-foreground">Track Map</strong> ricostruisce la traiettoria del giro usando
            le coordinate X/Y dal endpoint <code className="text-primary">location</code>, disegnate in SVG.
            Un <strong className="text-foreground">punto evidenziato</strong> mostra la posizione del pilota
            corrispondente al timestamp selezionato nei grafici telemetrici.
            La sincronizzazione è bidirezionale: cliccando sulla telemetria si aggiorna la mappa e viceversa.
          </p>
        </DocSection>

        <DocSection id="sectors" title="Settori e Mini-Settori" icon={<Timer className="h-4 w-4" />}>
          <p>
            Visualizza i tempi parziali per i tre settori di ogni giro con codifica cromatica per performance:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground" style={{ color: "hsl(270, 70%, 60%)" }}>Viola</strong> — miglior tempo assoluto della sessione (overall best)</li>
            <li><strong className="text-foreground" style={{ color: "hsl(142, 70%, 45%)" }}>Verde</strong> — miglior tempo personale del pilota</li>
            <li><strong className="text-foreground" style={{ color: "hsl(45, 93%, 58%)" }}>Giallo</strong> — tempo nella norma</li>
          </ul>
          <p>
            Questa codifica, identica a quella usata nella grafica TV ufficiale F1, permette di identificare
            rapidamente dove un pilota sta guadagnando o perdendo tempo.
          </p>
        </DocSection>

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Report sessione" />
        {/* ═══════════════════════════════════════════════════════ */}

        <DocSection id="session-report" title="Session Report" icon={<LayoutDashboard className="h-4 w-4" />}>
          <p>
            Vista aggregata della sessione, organizzata in tre schede per separare dati tabellari, grafici temporizzati e strategia:
          </p>
          <h4 className="font-semibold text-foreground mt-3">Overview</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Classifica finale della sessione con posizione, pilota, team, tempo, gap e stato</li>
            <li>Griglia di partenza con confronto posizione start/finish</li>
            <li>Condizioni meteo aggregate (temperatura pista/aria, pioggia, umidità, pressione, vento)</li>
          </ul>
          <h4 className="font-semibold text-foreground mt-3">Race Charts</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Position Chart</strong> — evoluzione delle posizioni giro per giro per tutti i piloti</li>
            <li><strong className="text-foreground">Gap to Leader</strong> — distacco dal leader nel tempo con tooltip dettagliato</li>
            <li><strong className="text-foreground">Deviazione Cumulativa</strong> — perdita di performance cumulativa rispetto al vincitore</li>
          </ul>
          <h4 className="font-semibold text-foreground mt-3">Strategy</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Mappa strategica</strong> — barre colorate per stint/compound di ogni pilota in ordine classifica</li>
            <li><strong className="text-foreground">Tabella pit stop</strong> — dettaglio timing, durata e compound per ogni sosta</li>
          </ul>
          <h4 className="font-semibold text-foreground mt-3">Filtro piloti</h4>
          <p>
            Una barra filtro in alto permette di selezionare/deselezionare piloti individualmente
            con pulsanti rapidi "All" e "None". Il filtro è condiviso tra tutte le schede.
          </p>
        </DocSection>

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Analisi pilota (singolo pilota)" />
        {/* ═══════════════════════════════════════════════════════ */}

        <DocSection id="weather-card" title="Card Meteo" icon={<Cloud className="h-4 w-4" />}>
          <p>Mostra le condizioni meteo durante la sessione:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Temperatura pista</strong> e <strong className="text-foreground">aria</strong> — andamento nel tempo</li>
            <li><strong className="text-foreground">Pioggia</strong> — intensità rilevata dal sensore meteo</li>
            <li><strong className="text-foreground">Umidità</strong>, <strong className="text-foreground">pressione</strong> e <strong className="text-foreground">vento</strong> — dati contestuali</li>
            <li>Classificazione per giro: <strong className="text-foreground">DRY</strong>, <strong className="text-foreground">WET</strong>, <strong className="text-foreground">MIXED</strong></li>
          </ul>
        </DocSection>

        <DocSection id="pit-stops" title="Card Pit Stop" icon={<Wrench className="h-4 w-4" />}>
          <p>Analisi dettagliata di ogni pit stop del pilota:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Giro</strong> di ingresso ai box</li>
            <li><strong className="text-foreground">Pit lane duration</strong> — tempo totale in pit lane (ingresso → uscita)</li>
            <li><strong className="text-foreground">Stop duration</strong> — tempo di sosta (solo il cambio gomme)</li>
            <li><strong className="text-foreground">Compound in → out</strong> — mescola montata prima e dopo la sosta</li>
            <li><strong className="text-foreground">Under neutralisation</strong> — indica se la sosta è avvenuta durante SC/VSC (con tipo)</li>
          </ul>
        </DocSection>

        <DocSection id="stints" title="Card Stint" icon={<Activity className="h-4 w-4" />}>
          <p>Riepilogo di ogni stint del pilota con:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Compound</strong> — mescola utilizzata (SOFT, MEDIUM, HARD, INTERMEDIATE, WET)</li>
            <li><strong className="text-foreground">Durata</strong> — numero di giri dello stint</li>
            <li><strong className="text-foreground">Tyre age</strong> — età della gomma all'inizio dello stint (utile per gomme usate)</li>
            <li><strong className="text-foreground">Passo medio</strong> — tempo medio al giro (esclusi outlier e pit-out)</li>
          </ul>
        </DocSection>

        <DocSection id="overtakes" title="Card Sorpassi" icon={<Swords className="h-4 w-4" />}>
          <p>Ricostruisce i sorpassi effettuati e subiti analizzando i cambi di posizione giro per giro:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Sorpassi effettuati</strong> — posizioni guadagnate in pista (escluse variazioni da pit stop)</li>
            <li><strong className="text-foreground">Sorpassi subiti</strong> — posizioni perse</li>
            <li>Dettaglio per giro con indicazione del pilota coinvolto</li>
          </ul>
        </DocSection>

        <DocSection id="race-diary" title="Card Diario di Gara" icon={<BookOpen className="h-4 w-4" />}>
          <p>Cronologia completa degli eventi significativi per il pilota durante la gara:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">OVERTAKE_DONE</strong> — sorpassi effettuati con dettaglio pilota</li>
            <li><strong className="text-foreground">OVERTAKE_RECEIVED</strong> — sorpassi subiti</li>
            <li><strong className="text-foreground">PIT_STOP</strong> — soste ai box con compound e durata</li>
            <li><strong className="text-foreground">RACE_CONTROL</strong> — messaggi bandiere, penalità, Safety Car</li>
            <li><strong className="text-foreground">BATTLE</strong> — episodi di battaglia ravvicinata</li>
          </ul>
          <p className="text-xs italic">
            Il diario viene costruito combinando dati di posizione, pit, race_control e intervals per offrire una narrativa completa della gara.
          </p>
        </DocSection>

        <DocSection id="cumulative-deviation" title="Card Deviazione Cumulativa" icon={<TrendingDown className="h-4 w-4" />}>
          <p>Misura la perdita cumulativa di performance rispetto al tempo medio del vincitore:</p>
          <Formula>delta_lap = lap_time_pilota - media_vincitore</Formula>
          <Formula>deviazione_cumulativa = Σ(delta_lap₁ ... delta_lapₙ)</Formula>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Vincitore</strong> — identificato da <code className="text-primary">session_result</code> (posizione 1, esclusi DNF/DNS/DSQ)</li>
            <li>Filtri identici per vincitore e piloti: escluso giro 1, pit-out, null, outlier &gt; 1.5× mediana</li>
            <li>La deviazione del vincitore è sempre esattamente zero per costruzione</li>
            <li>Valori negativi (passo superiore al vincitore) sono possibili e indicati con nota esplicativa</li>
          </ul>
        </DocSection>

        <DocSection id="tyre-degradation-card" title="Card Degrado Gomme" icon={<TrendingDown className="h-4 w-4" />}>
          <p>
            Per ogni stint del pilota mostra la stima del degrado (s/giro), il tipo di modello utilizzato
            (corrected two-stage, fuel-only, fallback) e la classificazione di validità (VALID, NEUTRAL, INVALID).
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Slope grezza e corretta a confronto</li>
            <li>Indicazione del compound e della durata dello stint</li>
            <li>R² e metadati statistici del modello</li>
            <li>Flag diagnostici per trasparenza</li>
          </ul>
          <p className="text-xs italic">
            Per il dettaglio del modello matematico, vedi le sezioni "Degrado Gomme — Modello" e "Validazione Degrado" più avanti.
          </p>
        </DocSection>

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Virtual Race Engineer" />
        {/* ═══════════════════════════════════════════════════════ */}

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Confronto piloti (Head-to-Head)" />
        {/* ═══════════════════════════════════════════════════════ */}

        <DocSection id="head-to-head-overview" title="Head-to-Head — Panoramica" icon={<Users className="h-4 w-4" />}>
          <p>
            La modalità <strong className="text-foreground">Head-to-Head</strong> permette di confrontare due piloti
            della stessa sessione affiancando le loro analisi del Virtual Race Engineer, lo stint-by-stint, il pace
            lap-by-lap e le decisioni strategiche.
          </p>
          <h4 className="font-semibold text-foreground mt-4">Come accedere</h4>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Nella pagina principale, seleziona <strong className="text-foreground">esattamente due piloti</strong> di una stessa sessione Race o Sprint.</li>
            <li>Apparirà un pulsante <strong className="text-foreground">"Confronta head-to-head"</strong> che apre la pagina dedicata.</li>
            <li>La selezione viene salvata nell'URL (parametri <code className="text-primary">session</code>, <code className="text-primary">driverA</code>, <code className="text-primary">driverB</code>) per condivisione e bookmark.</li>
          </ol>
          <h4 className="font-semibold text-foreground mt-4">Principio chiave</h4>
          <p>
            Il confronto <strong className="text-foreground">non duplica</strong> alcuna logica analitica: esegue il
            VRE due volte, una per pilota, sugli stessi parametri di sessione, e applica una funzione pura di confronto
            ai due risultati. Le metriche mostrate sono quindi <em>esattamente</em> quelle del VRE singolo pilota,
            affiancate per garantire coerenza e ripetibilità.
          </p>
          <h4 className="font-semibold text-foreground mt-4">Caricamento e robustezza</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>I due piloti vengono caricati <strong className="text-foreground">in parallelo</strong>, il rate limiter del client gestisce automaticamente l'ordine delle richieste verso OpenF1.</li>
            <li>Se l'analisi di uno dei due piloti fallisce, viene mostrato il pannello valido + un messaggio chiaro sull'altro, senza far crashare la pagina.</li>
            <li>Se le due sessioni non coincidono (caso impossibile da UI ma protetto a livello di motore), viene sollevato un errore esplicito.</li>
          </ul>
        </DocSection>

        <DocSection id="head-to-head-ui" title="Head-to-Head — Interfaccia" icon={<LayoutDashboard className="h-4 w-4" />}>
          <p>L'interfaccia è organizzata in <strong className="text-foreground">quattro zone verticali</strong> (su desktop ≥1024px alcune si affiancano):</p>

          <h4 className="font-semibold text-foreground mt-4">Zona 1 — Header comparativo</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Due card pilota affiancate con casco/colore team, acronimo, numero, team, posizione finale e gap dal leader.</li>
            <li>Badge centrale <strong className="text-foreground">"vs"</strong> e badge <strong className="text-foreground">verdetto</strong> con il pilota più veloce e il delta totale in secondi.</li>
            <li>Toggle <em>Swap sides</em> per invertire driver A e driver B.</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Zona 2 — Timeline strategica unificata</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Asse X: giri da 1 al totale.</li>
            <li>Due righe parallele (una per pilota) con segmenti colorati per mescola (Soft rossa, Medium gialla, Hard bianca, Inter verde, Wet blu — convenzioni Pirelli).</li>
            <li>Tick rossi sui pit stop e badge SC/VSC/RED sulle celle pertinenti.</li>
            <li>Sotto: grafico a barre del <strong className="text-foreground">delta cumulativo</strong> (A − B): rosso = A più lento, verde = A più veloce, zero-line evidenziata.</li>
            <li>Markers con icona sui <em>strategic divergence points</em> (tooltip con descrizione).</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Zona 3 — Metriche a confronto</h4>
          <p>Griglia a due colonne, ogni metrica è una riga con <em>label · valore A · valore B · highlight</em> verde sul migliore. Metriche incluse:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Tempo totale di gara</li>
            <li>Deviazione cumulativa finale (dal benchmark vincitore)</li>
            <li>Numero di pit stop</li>
            <li>Sequenza mescole</li>
            <li>Risk mode suggerito</li>
            <li>Confidenza dell'analisi</li>
            <li>Eventi battaglia (count)</li>
            <li>Giri trascorsi in neutralizzazione</li>
            <li>Best lap time</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Zona 4 — Narrativa a due colonne</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Top insight narrativi del pilota A (sinistra) e del pilota B (destra), filtrati per rilevanza.</li>
            <li>Una banda superiore <strong className="text-foreground">"Contesto condiviso"</strong> raggruppa i fatti comuni (Safety Car, pioggia, bandiera rossa) per evitare duplicazioni.</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Comportamento responsive</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Su mobile: priorità verticale, Zona 2 con scroll orizzontale, Zona 3 collassabile.</li>
            <li>I colori del team di ciascun pilota sono usati come <em>accent</em> ovunque (bordi card, serie del grafico) per distinguere visivamente A e B.</li>
            <li>Quando i due piloti appartengono allo stesso team, il colore del secondo viene schiarito automaticamente per garantire la leggibilità.</li>
          </ul>
        </DocSection>

        <DocSection id="head-to-head-engine" title="Head-to-Head — Motore di Confronto" icon={<Scale className="h-4 w-4" />}>
          <p>
            Il motore di confronto è una funzione pura, deterministica: prende i due risultati VRE e i giri allineati
            e produce un singolo oggetto risultato. <strong className="text-foreground">Non inventa metriche</strong>:
            ogni campo deriva esclusivamente dagli input, e quando un dato manca (es. posizioni per il rilevamento
            sorpassi) la sezione corrispondente viene semplicemente omessa anziché stimata.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Output del confronto</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">lap_by_lap_delta</strong> — Per ogni giro, delta A−B (positivo = A più lento) e delta cumulativo. Null se uno dei due giri non è valido (in/out lap, durata mancante).</li>
            <li><strong className="text-foreground">stint_alignment</strong> — La gara è segmentata sull'unione dei breakpoint di pit di entrambi i piloti; ogni segmento riporta stint e mescola di A e di B.</li>
            <li><strong className="text-foreground">strategic_divergence_points</strong> — Eventi di divergenza: <code className="text-primary">PIT_A_ONLY</code>, <code className="text-primary">PIT_B_ONLY</code>, <code className="text-primary">COMPOUND_DIVERGENCE</code> e (se le posizioni sono disponibili) <code className="text-primary">POSITION_SWAP</code>.</li>
            <li><strong className="text-foreground">head_to_head_verdict</strong> — Pilota più veloce (A / B / TIE), delta totale in secondi e fino a 5 fattori chiave narrativi.</li>
            <li><strong className="text-foreground">common_confidence</strong> — La confidenza minima fra le due analisi VRE: il confronto non è mai più affidabile del meno affidabile dei due.</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Criterio del verdetto</h4>
          <Formula>
            faster = TIE se |Σ delta valido| ≤ 0.5s · altrimenti A se Σ &lt; 0, B se Σ &gt; 0
          </Formula>
          <p className="text-xs italic">
            La soglia di 0.5s evita di dichiarare un vincitore su differenze inferiori al rumore tipico di
            cronometraggio + variazioni di pista.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Filtro giri comparabili</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Il giro deve avere <code className="text-primary">lap_duration</code> valida (&gt; 0).</li>
            <li>Esclusi i pit-out lap (out-lap dopo un pit stop).</li>
            <li>Non vengono applicati filtri meteo o track-status: il delta stesso assorbe naturalmente le neutralizzazioni condivise.</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Edge case gestiti</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">DNF</strong>: i giri mancanti del pilota ritirato producono delta <code className="text-primary">null</code>; il delta cumulativo si congela all'ultimo valore valido.</li>
            <li><strong className="text-foreground">Stint analyses incompleti</strong>: l'allineamento usa solo i breakpoint disponibili.</li>
            <li><strong className="text-foreground">Session key mismatch</strong>: errore esplicito (caso impossibile dall'UI ma protetto a livello di motore).</li>
            <li><strong className="text-foreground">Posizioni assenti</strong>: <code className="text-primary">POSITION_SWAP</code> viene omesso senza errori.</li>
          </ul>
        </DocSection>

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Virtual Race Engineer" />
        {/* ═══════════════════════════════════════════════════════ */}

        <DocSection id="vre-overview" title="VRE — Panoramica" icon={<Brain className="h-4 w-4" />} defaultOpen>
          <p>
            Il cuore analitico dell'applicazione. Disponibile solo per sessioni
            <strong className="text-foreground"> Race</strong> e <strong className="text-foreground">Sprint</strong>
            con un singolo pilota selezionato.
          </p>
          <p>
            Il VRE analizza la strategia realmente seguita in gara e la confronta con strategie alternative simulate,
            producendo un verdetto sulla qualità della scelta strategica con scomposizione dettagliata dei fattori.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Architettura a tre layer</h4>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <strong className="text-foreground">Simulation Layer</strong> — Calcolo dei costi strategici giro per giro:
              degrado, traffico, warmup, pit loss, cliff penalty, modulati da scenario e risk mode
            </li>
            <li>
              <strong className="text-foreground">Explanation Layer</strong> — Breakdown, analisi di robustezza,
              narrative insights, pros/cons, predizioni del traffico, analisi multi-obiettivo
            </li>
            <li>
              <strong className="text-foreground">Decision Layer</strong> — Scoring finale e ranking risk-aware
              tramite il modulo <code className="text-primary">riskAppetite</code> con context adjustment per-strategy
            </li>
          </ol>

          <h4 className="font-semibold text-foreground mt-4">Pipeline di calcolo</h4>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Ricostruzione strategia reale (stint, pit stop, tempi)</li>
            <li>Degrado baseline + degrado corretto a due stadi per ogni stint</li>
            <li>Validazione multi-criterio del degrado per ogni stint</li>
            <li>Pace Loss Rate per ogni stint (moltiplicatori degrado, cliff, urgency)</li>
            <li>Classificazione meteo e track status per giro</li>
            <li>Costruzione modelli per mescola (slope + intercept per compound)</li>
            <li>Simulazione strategie candidate (1, 2, 3 pit stop)</li>
            <li>Traffic prediction per ogni strategia simulata</li>
            <li>Warmup cost compound-specific per ogni strategia simulata</li>
            <li>Breakdown e analisi multi-obiettivo (EnrichedStrategyAnalysis)</li>
            <li>Context adjustment per-strategy (robustness, cliff, traffic, sensitivity)</li>
            <li>Ranking risk-aware finale tramite scoreStrategies</li>
            <li>Verdetto, confidenza e narrative insights</li>
          </ol>

          <h4 className="font-semibold text-foreground mt-4">Moduli utilizzati</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-border rounded mt-1">
              <thead><tr className="bg-muted/40 border-b border-border">
                <th className="px-3 py-1.5 text-left font-semibold text-foreground">Modulo</th>
                <th className="px-3 py-1.5 text-left font-semibold text-foreground">Ruolo</th>
              </tr></thead>
              <tbody>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">tyreDegradation</td><td className="px-3 py-1.5">Stima degrado baseline (regressione, cliff, outlier)</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">correctedDegradation</td><td className="px-3 py-1.5">Correzione a due stadi (fuel proxy + temperatura)</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">degradationValidation</td><td className="px-3 py-1.5">Classificazione VALID/NEUTRAL/INVALID + fallback ranking</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">trafficPredictor</td><td className="px-3 py-1.5">Predizione traffico post-pit (rejoin, pack, persistence)</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">tyreWarmup</td><td className="px-3 py-1.5">Penalità termica post-pit (compound-specific)</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">stintPaceLoss</td><td className="px-3 py-1.5">Pace loss rate + moltiplicatori degrado/cliff/urgency</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">weatherClassification</td><td className="px-3 py-1.5">DRY/WET/MIXED per giro (multi-signal, debounce)</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">trackStatusClassification</td><td className="px-3 py-1.5">GREEN/YELLOW/SC/VSC/RED per giro</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">scenarioContext</td><td className="px-3 py-1.5">Scenari what-if con modifier temporali</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">strategyAnalysis</td><td className="px-3 py-1.5">Analisi multi-obiettivo, robustezza, sensitivity</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">strategyBreakdown</td><td className="px-3 py-1.5">Scomposizione costi per componente</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-mono text-primary">riskAppetite</td><td className="px-3 py-1.5">Scoring risk-aware con context adjustment</td></tr>
                <tr><td className="px-3 py-1.5 font-mono text-primary">vreContext</td><td className="px-3 py-1.5">Contesto integrato (battle, meteo, track status, deviation)</td></tr>
              </tbody>
            </table>
          </div>
        </DocSection>

        <DocSection id="vre-analysis-modes" title="VRE — Modalità di Analisi" icon={<Eye className="h-4 w-4" />}>
          <p>
            Il VRE supporta due modalità operative fondamentali, selezionabili tramite il toggle nell'header della card.
            Le due modalità rappresentano prospettive temporali diverse sulla stessa gara e determinano
            quali informazioni il sistema può utilizzare.
          </p>

          <h4 className="font-semibold text-foreground mt-4">🔴 Race Engineer Mode (default)</h4>
          <p>
            Simula la prospettiva del race engineer <strong className="text-foreground">durante la gara</strong>,
            senza conoscenza degli eventi futuri.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Utilizza solo le informazioni disponibili fino al giro corrente</li>
            <li>Le strategie simulate <strong className="text-foreground">non beneficiano</strong> di SC/VSC futuri: il pit loss è calcolato senza sconti da neutralizzazione</li>
            <li>Scenario forzato su <strong className="text-foreground">Real Conditions</strong> — non modificabile</li>
            <li>Il selettore scenari what-if è nascosto</li>
            <li>Risk mode selezionabile normalmente</li>
            <li>Output: "Decisione ottimale in quel momento, basata sulle informazioni disponibili"</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">📊 Post-Race Analysis Mode</h4>
          <p>
            Analisi a posteriori con <strong className="text-foreground">conoscenza completa</strong> di tutti
            gli eventi della gara: safety car, VSC, meteo, traffico.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Utilizza la timeline reale completa della gara</li>
            <li>Le strategie simulate <strong className="text-foreground">beneficiano</strong> di SC/VSC reali: il pit loss è scontato se il pit cade durante una neutralizzazione</li>
            <li>Scenario selezionabile dall'utente (default: Real Conditions)</li>
            <li>Scenari what-if disponibili con giro di attivazione e durata</li>
            <li>Risk mode selezionabile normalmente</li>
            <li>Output: "Strategia ottimale a posteriori, considerando tutti gli eventi della gara"</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Ricalcolo completo</h4>
          <p>
            Ogni cambio di modalità (Race Engineer ↔ Post-Race), scenario o risk mode
            esegue un <strong className="text-foreground">ricalcolo completo</strong> dell'intero motore strategico:
            preprocessing, degrado, traffico, soft sensors, pace loss, strategia reale, raccomandata,
            alternative, scoring, decision moments e narrative. Nessuna cache è riutilizzata tra modalità diverse.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Differenze chiave</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-semibold text-foreground">Aspetto</th>
                  <th className="px-3 py-2 text-left font-semibold text-foreground">Race Engineer</th>
                  <th className="px-3 py-2 text-left font-semibold text-foreground">Post-Race</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5">Prospettiva</td><td className="px-3 py-1.5">Ex-ante (in tempo reale)</td><td className="px-3 py-1.5">Ex-post (a posteriori)</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5">Eventi futuri</td><td className="px-3 py-1.5">Non utilizzati nelle simulazioni</td><td className="px-3 py-1.5">Completamente disponibili</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5">SC/VSC pit loss</td><td className="px-3 py-1.5">Nessuno sconto (simulazioni)</td><td className="px-3 py-1.5">Sconto applicato se pit in neutralizzazione</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5">Scenari what-if</td><td className="px-3 py-1.5">Disabilitati (Real Conditions)</td><td className="px-3 py-1.5">Selezionabili</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5">Risk mode</td><td className="px-3 py-1.5">Selezionabile</td><td className="px-3 py-1.5">Selezionabile</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5">Ricalcolo</td><td className="px-3 py-1.5">Completo ad ogni cambio</td><td className="px-3 py-1.5">Completo ad ogni cambio</td></tr>
                <tr><td className="px-3 py-1.5">Soft sensors</td><td className="px-3 py-1.5">Invariati (dati osservati)</td><td className="px-3 py-1.5">Invariati (dati osservati)</td></tr>
              </tbody>
            </table>
          </div>

          <h4 className="font-semibold text-foreground mt-4">Limitazioni</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Race Engineer Mode non conosce il futuro — le raccomandazioni riflettono solo ciò che era noto al momento</li>
            <li>Post-Race Mode non è predittiva — è un'analisi retrospettiva, non una previsione</li>
            <li>I soft sensors sono sempre basati su dati osservati, indipendentemente dalla modalità</li>
            <li>Nessuna modalità inventa eventi o dati non presenti</li>
            <li>Non è possibile riutilizzare risultati calcolati con una modalità diversa</li>
          </ul>
        </DocSection>
        <DocSection id="vre-ui" title="VRE — Interfaccia a 4 Sezioni" icon={<LayoutDashboard className="h-4 w-4" />}>
          <p>L'interfaccia del VRE è organizzata in 4 sezioni distinte che separano chiaramente il contesto globale dai dati delle singole strategie:</p>

          <h4 className="font-semibold text-foreground mt-3">A. Analisi globale gara</h4>
          <p>Contesto condiviso, comune a tutte le strategie:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Griglia riassuntiva: battaglie, meteo, neutralizzazioni, deviazione cumulativa</li>
            <li>Narrative insights contestuali (generati dal contesto integrato)</li>
            <li>Weather e neutralisation impact</li>
            <li>Traffic release analysis globale</li>
            <li>Pace Loss per stint (con contaminazione e confidenza)</li>
            <li>Confidence factors (lista esplicita dei fattori che influenzano l'affidabilità)</li>
            <li>Data gaps (moduli con dati non disponibili)</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">B. Strategia reale</h4>
          <p>Solo dati della strategia effettivamente eseguita in gara:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Sequenza stint con compound, giri, passo medio</li>
            <li>Tabella degrado per stint (slope grezza, corretta, R², status VALID/NEUTRAL/INVALID)</li>
            <li>Pit stop reali con compound in/out, durata, flag neutralizzazione</li>
            <li>Scomposizione costi reali (actual_breakdown)</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">C. Strategia raccomandata</h4>
          <p>La strategia ottimale calcolata dal simulatore, con dettaglio completo:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Sequenza compound consigliata</li>
            <li>Pit windows con giro ideale e range</li>
            <li>Guadagno stimato vs reale (con doppia convenzione delta)</li>
            <li>Pros e cons derivati dall'analisi multi-obiettivo</li>
            <li>Traffic prediction specifica per questa strategia</li>
            <li>Analisi multi-obiettivo: tempo, posizione, rischio, robustezza</li>
            <li>Dettagli avanzati: sensitivity, competitor context, stint extension, overtake difficulty</li>
            <li>Badge di robustezza (ROBUST / MEDIUM / FRAGILE)</li>
            <li>Breakdown con modifier di risk mode e scenario applicati</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">D. Strategie alternative</h4>
          <p>Una card per ogni strategia alternativa simulata, ciascuna con:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Nome, descrizione, delta vs reale</li>
            <li>Badge di robustezza e score aggiustato per risk mode</li>
            <li>Pros e cons specifici</li>
            <li>Traffic prediction, multi-obiettivo, dettagli avanzati</li>
            <li>Breakdown espandibile con modifier applicati</li>
            <li>Ordinamento per adjusted_score (risk-aware) quando il risk mode non è Balanced</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Race Context & Simulatore</h4>
          <p>Pannello di controllo per parametrizzare l'analisi. Il contenuto visibile dipende dalla modalità di analisi selezionata:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Scenario selector</strong> — scenari what-if con giro di attivazione e durata (<strong className="text-amber-400">solo in Post-Race Analysis Mode</strong>, bloccato su Real Conditions in Race Engineer Mode)</li>
            <li><strong className="text-foreground">Risk mode</strong> — Conservative / Balanced / Aggressive (sempre disponibile)</li>
            <li><strong className="text-foreground">Degrado personalizzato</strong> — override per-compound per stint INVALID (sempre disponibile)</li>
          </ul>
        </DocSection>

        <DocSection id="vre-view-modes" title="VRE — Modalità di Visualizzazione" icon={<Brain className="h-4 w-4" />}>
          <p>
            Il VRE presenta lo stesso risultato analitico in tre modalità di lettura diverse,
            selezionabili tramite il selettore <strong className="text-foreground">Engineer / Analyst / Broadcast</strong> nell'header della card.
            Nessuna modalità altera i calcoli: cambia solo la presentazione.
          </p>

          <h4 className="font-semibold text-foreground mt-4">🔧 Engineer</h4>
          <p>Massimo dettaglio tecnico. Pensata per strategist, data analyst e race engineer.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Verdict con delta e confidence</li>
            <li>Timeline comparativa reale vs ottimale</li>
            <li>Analisi globale gara: battaglie, meteo, neutralizzazioni, deviazione cumulativa, traffic release, pace loss per stint, fattori di confidenza</li>
            <li>Race Context & Simulatore: scenario what-if, risk mode, degrado personalizzato</li>
            <li>Strategia reale con stint, degrado grezzo/corretto, R², status di validazione</li>
            <li>Strategia raccomandata con breakdown, pros/cons, traffico, analisi multi-obiettivo, dettagli avanzati (sensibilità, competitor context, cliff risk)</li>
            <li>Strategie alternative con scoring risk-adjusted, breakdown e dettagli per ciascuna</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">📊 Analyst</h4>
          <p>Equilibrio tra rigore tecnico e leggibilità. Per fan avanzati, creator e giornalisti tecnici.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Sintesi</strong> — 2-4 frasi con verdetto, delta e livello di affidabilità</li>
            <li><strong className="text-foreground">Punti chiave</strong> — fino a 5 insight su degrado, traffico, neutralizzazioni, meteo e robustezza</li>
            <li><strong className="text-foreground">Perché questo risultato</strong> — spiegazione semplice dei driver principali del risultato</li>
            <li><strong className="text-foreground">Confronto strategico</strong> — card reale vs raccomandata con compound, pit lap e pro/contro</li>
            <li><strong className="text-foreground">Alternative</strong> — top 2 alternative con delta, pro e contro</li>
            <li><strong className="text-foreground">Affidabilità</strong> — fattori di confidenza e dati mancanti</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">📺 Broadcast</h4>
          <p>Narrativa chiara e immediata. Per fan generalisti, social, video e podcast.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Headline</strong> — una frase che riassume il punto centrale</li>
            <li><strong className="text-foreground">La gara</strong> — racconto strategico in 3-6 frasi: cosa è successo, perché, momento chiave</li>
            <li><strong className="text-foreground">In sintesi</strong> — massimo 3 takeaway: cosa ha aiutato, cosa ha penalizzato, cosa avrebbe potuto cambiare</li>
            <li><strong className="text-foreground">Trust Marker</strong> — indicatore di affidabilità finale (alta / media / prudente)</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Anti-allucinazione</h4>
          <p>
            Tutte e tre le modalità mostrano <strong className="text-foreground">esclusivamente</strong> dati provenienti
            dal motore di calcolo. Nessun dato viene inventato, arrotondato arbitrariamente o interpretato oltre
            quanto l'output tecnico supporta. Se un'informazione manca, viene dichiarato esplicitamente.
          </p>
          <p>
            Per ogni strategia candidata, la funzione <code className="text-primary">simulateStrategyCost()</code>
            calcola il tempo totale simulato:
          </p>
          <Formula>
            total = Σ_stints [ Σ_laps ( base + deg × lapDegMult + cliffPenalty ) + warmup + pit_loss + traffic ]
          </Formula>

          <h4 className="font-semibold text-foreground mt-3">Componenti del costo</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">base_lap</strong> — <code className="text-primary">model.intercept</code> per il compound (passo base stimato)</li>
            <li><strong className="text-foreground">degradation</strong> — <code className="text-primary">model.slope × tyre_life</code>, moltiplicato per <code className="text-primary">lapDegradationMult</code></li>
            <li><strong className="text-foreground">lapDegradationMult</strong> — combina risk mode, scenario e pace loss adjustment</li>
            <li><strong className="text-foreground">cliffPenalty</strong> — penalità quadratica per stint oltre soglia: <code className="text-primary">(excess)² × cliff_coeff × paceLossCliffMult</code></li>
            <li><strong className="text-foreground">warmup</strong> — penalità termica post-pit (compound-specific, decadimento esponenziale)</li>
            <li><strong className="text-foreground">pit_loss</strong> — tempo perso in pit lane, modulato da scenario (es. SC riduce a 62%)</li>
            <li><strong className="text-foreground">traffic</strong> — costo traffico post-pit da traffic predictor, modulato da posizione, risk mode e scenario</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Pit loss sotto neutralizzazione</h4>
          <p>
            Se il pit reale è avvenuto sotto SC/VSC, il VRE applica un <strong className="text-foreground">pit loss corretto</strong> alla strategia reale,
            evitando che una sosta neutralizzata sembri artificialmente peggiore rispetto ad alternative con pit in green.
            Le strategie alternative beneficiano del minor pit loss <strong className="text-foreground">solo se il pit simulato cade su una SC/VSC reale</strong>.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Vincolo regolamentare</h4>
          <p>
            Ogni strategia deve utilizzare <strong className="text-foreground">almeno 2 mescole diverse</strong>
            (regolamento F1 asciutto). Strategie con una sola mescola vengono scartate automaticamente.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Esplorazione dello spazio strategico</h4>
          <p>
            Il sistema esplora strategie con 1, 2 e 3 pit stop, variando il giro di pit
            in una finestra attorno al primo pit reale (±6 giri). Per scenari SC/VSC,
            vengono esplorate anche strategie N+1 (un pit aggiuntivo rispetto alla reale).
          </p>
        </DocSection>

        <DocSection id="vre-risk-mode" title="VRE — Risk Mode & Decision Layer" icon={<Shield className="h-4 w-4" />}>
          <p>
            Tre profili di rischio che influenzano il ranking finale delle strategie.
            Il Risk Mode <strong className="text-foreground">non altera i tempi simulati</strong>,
            ma modifica il modo in cui le strategie vengono valutate e scelte.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Profili di rischio</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-foreground">Parametro</th>
                  <th className="text-center py-2 px-3 text-foreground">Conservative</th>
                  <th className="text-center py-2 px-3 text-foreground">Balanced</th>
                  <th className="text-center py-2 px-3 text-foreground">Aggressive</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">degradation_w</td><td className="text-center">+15%</td><td className="text-center">0%</td><td className="text-center">−8%</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">traffic_w</td><td className="text-center">+30%</td><td className="text-center">0%</td><td className="text-center">−20%</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">warmup_w</td><td className="text-center">+20%</td><td className="text-center">0%</td><td className="text-center">−10%</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">pit_loss_w</td><td className="text-center">+10%</td><td className="text-center">0%</td><td className="text-center">0%</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">upside_base</td><td className="text-center">×0.85</td><td className="text-center">×1.00</td><td className="text-center">×1.25</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">upside_dampen_cap</td><td className="text-center">60%</td><td className="text-center">30%</td><td className="text-center">15%</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">robustness_bonus</td><td className="text-center">+0.5s</td><td className="text-center">+0.3s</td><td className="text-center">+0.1s</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">robustness_penalty</td><td className="text-center">−0.8s</td><td className="text-center">−0.5s</td><td className="text-center">−0.2s</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">cliff_w</td><td className="text-center">1.0</td><td className="text-center">0.8</td><td className="text-center">0.4</td></tr>
                <tr><td className="py-1.5 pr-3">pack_rejoin_penalty</td><td className="text-center">−0.6s</td><td className="text-center">−0.4s</td><td className="text-center">−0.15s</td></tr>
              </tbody>
            </table>
          </div>

          <h4 className="font-semibold text-foreground mt-3">Scoring multi-criterio</h4>
          <p>Il punteggio finale di ogni strategia è calcolato in 5 strati:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong className="text-foreground">Risk penalty</strong> — traffico + degrado pesati dal profilo di rischio</li>
            <li><strong className="text-foreground">Execution penalty</strong> — warmup + pit loss pesati dal profilo</li>
            <li><strong className="text-foreground">Neutralization bonus</strong> — opportunità SC/VSC</li>
            <li><strong className="text-foreground">Reward component</strong> — upside modulato dall'execution burden (costi/tempo totale)</li>
            <li><strong className="text-foreground">Context adjustment</strong> — per-strategy: robustezza, cliff risk, pack rejoin, traffic persistence, sensitivity, degradation confidence</li>
          </ol>

          <h4 className="font-semibold text-foreground mt-3">StrategyRiskContext (per-strategy)</h4>
          <p>Ogni strategia può avere un proprio profilo di rischio basato su dati reali:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><code className="text-primary">robustness_label</code> — ROBUST / MEDIUM / FRAGILE</li>
            <li><code className="text-primary">cliff_risk</code> — 0–1, rischio cliff se si estende lo stint</li>
            <li><code className="text-primary">release_classification</code> — CLEAR / TRAFFIC / PACK</li>
            <li><code className="text-primary">traffic_risk_after_pit</code> — 0–1, rischio traffico post-pit</li>
            <li><code className="text-primary">expected_laps_stuck</code> — giri previsti in traffico</li>
            <li><code className="text-primary">rejoin_in_pack</code> — rientro in un pack compresso</li>
            <li><code className="text-primary">sensitivity_to_*</code> — sensibilità a variazioni di degrado, traffico, pit loss</li>
            <li><code className="text-primary">degradation_confidence</code> — 0–1, affidabilità del dato di degrado</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Promozione della recommended strategy</h4>
          <p>
            La strategia raccomandata non è scelta solo per tempo minimo. Se un'alternativa ha
            uno score aggiustato migliore di oltre 1s rispetto alla "best raw" e non è FRAGILE,
            viene promossa a strategia raccomandata.
          </p>
        </DocSection>

        <DocSection id="vre-scenarios" title="VRE — Scenari What-If" icon={<FlaskConical className="h-4 w-4" />}>
          <p>
            Scenari simulati che modificano i pesi della funzione di costo senza alterare i dati reali.
            L'utente può selezionare uno scenario, un giro di attivazione e una durata.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Scenari disponibili</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-border rounded">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="px-3 py-1.5 text-left font-semibold text-foreground">Scenario</th>
                  <th className="px-3 py-1.5 text-left font-semibold text-foreground">Effetto principale</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-medium text-foreground">Safety Car</td><td className="px-3 py-1.5">Pit loss ×0.62, traffico ×0.85, opportunità ×1.30</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-medium text-foreground">VSC</td><td className="px-3 py-1.5">Pit loss ×0.78, traffico ×0.90, opportunità ×1.15</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-medium text-foreground">Clean Air</td><td className="px-3 py-1.5">Traffico ×0.12</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-medium text-foreground">Heavy Traffic</td><td className="px-3 py-1.5">Traffico ×1.55, rischio ×1.15</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-medium text-foreground">Light Rain</td><td className="px-3 py-1.5">Degrado ×1.10, meteo ×1.35, confidenza −1</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-medium text-foreground">Mixed Conditions</td><td className="px-3 py-1.5">Degrado ×1.15, meteo ×1.55, confidenza −2</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-medium text-foreground">Tyre Cliff Risk</td><td className="px-3 py-1.5">Degrado ×1.45, rischio ×1.25</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-medium text-foreground">Late Race Attack</td><td className="px-3 py-1.5">Degrado ×0.88, posizione ×1.35, rischio ×0.72</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-medium text-foreground">Battle Mode</td><td className="px-3 py-1.5">Posizione ×1.45, traffico ×1.15</td></tr>
                <tr className="border-b border-border/50"><td className="px-3 py-1.5 font-medium text-foreground">Undercut</td><td className="px-3 py-1.5">Traffico ×0.72, degrado ×1.18, posizione ×1.28</td></tr>
                <tr><td className="px-3 py-1.5 font-medium text-foreground">Overcut</td><td className="px-3 py-1.5">Degrado ×0.88, rischio ×0.88</td></tr>
              </tbody>
            </table>
          </div>

          <h4 className="font-semibold text-foreground mt-3">Parametri temporali</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Activation Lap</strong> — giro in cui lo scenario diventa attivo (opzionale)</li>
            <li><strong className="text-foreground">Duration</strong> — durata in giri della finestra scenario (opzionale, default: intera gara)</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Scaling contestuale</h4>
          <p>I modifier sono modulati da tre metriche:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Severity</strong> (0–1) — peso intrinseco dello scenario</li>
            <li><strong className="text-foreground">Relevance</strong> — copertura della finestra sulla gara (scaling sub-lineare √)</li>
            <li><strong className="text-foreground">Feasibility</strong> — penalizza finestre troppo brevi (&lt; 3 giri) o tardive</li>
          </ul>
          <Formula>effective_scale = raw_scale × 0.5 + (raw_scale × relevance × feasibility) × 0.5</Formula>

          <p className="text-xs italic mt-2">
            Anti-allucinazione: gli scenari NON creano eventi fittizi, NON alterano la telemetria,
            NON inventano tempi al giro. Modificano solo i moltiplicatori del modello strategico.
          </p>
        </DocSection>

        <DocSection id="vre-breakdown" title="VRE — Scomposizione del Giudizio (Breakdown)" icon={<Layers className="h-4 w-4" />}>
          <p>
            Per ogni strategia (reale, consigliata, alternativa), il sistema produce un breakdown
            che scompone il tempo stimato nelle sue componenti:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Tempo base stint</strong> — tempo stimato senza degrado gomme</li>
            <li><strong className="text-foreground">Degrado gomme</strong> — costo aggiuntivo da usura pneumatici</li>
            <li><strong className="text-foreground">Tyre warmup</strong> — penalità termica temporanea post-pit (compound-specific)</li>
            <li><strong className="text-foreground">Tempo perso ai box</strong> — pit stop × pit_loss_per_stop</li>
            <li><strong className="text-foreground">Tempo perso nel traffico</strong> — da traffic predictor</li>
            <li><strong className="text-foreground">Impatto meteo</strong> — +2.0s per giro WET/MIXED</li>
            <li><strong className="text-foreground">Effetto neutralizzazione</strong> — −10s per pit sotto SC/VSC</li>
          </ul>
          <p>
            Ogni componente è codificata con impatto: <strong className="text-foreground" style={{ color: "hsl(142, 70%, 45%)" }}>favorevole</strong>,{" "}
            <strong className="text-foreground">neutro</strong> o <strong className="text-foreground" style={{ color: "hsl(0, 62%, 50%)" }}>penalizzante</strong>.
          </p>
          <p>
            I modifier di scenario e risk mode vengono applicati ai singoli componenti nel breakdown,
            rendendo visibile quale fattore cambia e di quanto.
          </p>
        </DocSection>

        <DocSection id="vre-verdict" title="VRE — Verdetto e Confidenza" icon={<Target className="h-4 w-4" />}>
          <h4 className="font-semibold text-foreground">Verdetto</h4>
          <p>Il delta tra la strategia consigliata e la strategia reale determina il giudizio:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">delta ≤ 1s</strong> — "Strategia reale vicina all'ottimo"</li>
            <li><strong className="text-foreground">1–5s</strong> — "Strategia reale marginalmente migliorabile"</li>
            <li><strong className="text-foreground">5–15s</strong> — "Pit stop leggermente fuori finestra ideale"</li>
            <li><strong className="text-foreground">&gt; 15s</strong> — "Strategia reale significativamente penalizzata"</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Confidenza</h4>
          <p>
            Il punteggio di confidenza (<strong className="text-foreground">HIGH</strong> / <strong className="text-foreground">MEDIUM</strong> / <strong className="text-foreground">LOW</strong>)
            viene calcolato partendo da un punteggio base e sottraendo penalità per:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Mescole da practice (non validate in gara)</li>
            <li>Stime di degrado NEUTRAL o INVALID</li>
            <li>Pace loss UNRELIABLE</li>
            <li>Incoerenza tra degrado stimato e pace loss osservato</li>
            <li>Giri bagnati (&gt; 20% dei giri totali)</li>
            <li>Pochi giri validi per la regressione</li>
            <li>Penalità scenario (es. pioggia simulata riduce confidenza)</li>
            <li>Risk scoring che diverge dal ranking raw</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Confidence Factors</h4>
          <p>
            Ogni fattore che modifica la confidenza viene registrato e mostrato all'utente come lista esplicita
            di motivi, garantendo trasparenza totale sulla qualità della stima.
          </p>
        </DocSection>

        <DocSection id="vre-context" title="VRE — Contesto Integrato" icon={<Layers className="h-4 w-4" />}>
          <p>
            Il layer di orchestrazione <code className="text-primary">vreContext</code> raccoglie
            gli output di tutti i moduli analitici e li normalizza in un contesto strategico unificato:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Battle Context</strong> — episodi, giri in battaglia, tipo (attacco/difesa)</li>
            <li><strong className="text-foreground">Weather Context</strong> — giri wet/mixed/dry, primo giro non-dry</li>
            <li><strong className="text-foreground">Track Status Context</strong> — giri SC/VSC/RED/Yellow, totale neutralizzati</li>
            <li><strong className="text-foreground">Cumulative Deviation Context</strong> — delta finale, trend di perdita, max deviazione</li>
            <li><strong className="text-foreground">Diary Context</strong> — sorpassi, pit, eventi strategici vicino ai pit</li>
            <li><strong className="text-foreground">Data Gaps</strong> — elenco dei moduli non disponibili (riduce confidenza)</li>
          </ul>
          <p className="text-xs italic">
            Il contesto integrato viene usato sia per la generazione di narrative insights
            sia per la calibrazione dei confidence factors.
          </p>
        </DocSection>

        <DocSection id="vre-delta-convention" title="VRE — Convenzione Delta Tempo" icon={<Info className="h-4 w-4" />}>
          <p>Il VRE utilizza una <strong className="text-foreground">doppia convenzione</strong> per i delta temporali:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-border rounded mt-2">
              <thead><tr className="bg-muted/40 border-b border-border">
                <th className="px-3 py-1.5 text-left font-semibold text-foreground">Campo</th>
                <th className="px-3 py-1.5 text-left font-semibold text-foreground">Segno</th>
                <th className="px-3 py-1.5 text-left font-semibold text-foreground">Significato</th>
              </tr></thead>
              <tbody>
                <tr className="border-b border-border/50">
                  <td className="px-3 py-1.5 font-mono text-primary">estimated_gain_seconds</td>
                  <td className="px-3 py-1.5">Positivo = meglio</td>
                  <td className="px-3 py-1.5">Quanto si poteva guadagnare rispetto alla reale</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5 font-mono text-primary">time_delta_vs_actual</td>
                  <td className="px-3 py-1.5">Negativo = più veloce</td>
                  <td className="px-3 py-1.5">Convenzione motorsport: Δt negativo = strategia più rapida</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2">
            I due campi sono speculari: <code className="text-primary">time_delta_vs_actual = −estimated_gain_seconds</code>.
            La UI mostra entrambi dove utile per chiarezza.
          </p>
        </DocSection>

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Modelli di calcolo" />
        {/* ═══════════════════════════════════════════════════════ */}

        <DocSection id="tyre-degradation" title="Degrado Gomme — Modello Baseline" icon={<TrendingDown className="h-4 w-4" />}>
          <p>
            Il modulo di calcolo del degrado gomme baseline determina il degrado per ogni stint
            usando regressione lineare robusta con pipeline di filtraggio multi-stadio:
          </p>

          <h4 className="font-semibold text-foreground mt-3">Pipeline di filtraggio (4 stadi)</h4>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong className="text-foreground">Esclusioni strutturali</strong> — pit-out, in-lap (tranne ultimo stint), durate nulle/negative</li>
            <li><strong className="text-foreground">Filtro outlier MAD</strong> — Median Absolute Deviation con moltiplicatore compound-specific</li>
            <li><strong className="text-foreground">Esclusione warmup</strong> — primi giri esclusi se più lenti della mediana</li>
            <li><strong className="text-foreground">Cliff detection</strong> — giri finali con residui anomali esclusi dalla regressione</li>
          </ol>

          <h4 className="font-semibold text-foreground mt-3">Profili compound-specific</h4>
          <table className="w-full text-xs border border-border rounded mt-1">
            <thead><tr className="bg-muted/40"><th className="px-2 py-1 text-left">Parametro</th><th className="px-2 py-1">SOFT</th><th className="px-2 py-1">MEDIUM</th><th className="px-2 py-1">HARD</th></tr></thead>
            <tbody>
              <tr><td className="px-2 py-1">Warmup exclusion</td><td className="px-2 py-1 text-center">1 giro</td><td className="px-2 py-1 text-center">1 giro</td><td className="px-2 py-1 text-center">2 giri</td></tr>
              <tr><td className="px-2 py-1">MAD multiplier</td><td className="px-2 py-1 text-center">3.0</td><td className="px-2 py-1 text-center">3.0</td><td className="px-2 py-1 text-center">3.5</td></tr>
              <tr><td className="px-2 py-1">Cliff residual threshold</td><td className="px-2 py-1 text-center">2.0× RMSE</td><td className="px-2 py-1 text-center">2.2× RMSE</td><td className="px-2 py-1 text-center">2.5× RMSE</td></tr>
              <tr><td className="px-2 py-1">Min core laps</td><td className="px-2 py-1 text-center">3</td><td className="px-2 py-1 text-center">3</td><td className="px-2 py-1 text-center">3</td></tr>
            </tbody>
          </table>

          <h4 className="font-semibold text-foreground mt-3">Output</h4>
          <ul className="list-disc pl-5 space-y-1">
            <Param name="slope" desc="Slope di degrado (s/giro)" />
            <Param name="intercept" desc="Intercetta (passo base stimato)" />
            <Param name="r_squared" desc="Coefficiente di determinazione" />
            <Param name="rmse" desc="Root Mean Square Error" />
            <Param name="cliffDetected" desc="Presenza di cliff a fine stint" />
            <Param name="filterSummary" desc="Elenco testuale dei filtri applicati" />
          </ul>
        </DocSection>

        <DocSection id="corrected-degradation" title="Degrado Corretto — Two-Stage Model" icon={<TrendingDown className="h-4 w-4" />}>
          <p>
            Il modulo di correzione del degrado rimuove gli effetti confondenti
            (carburante e temperatura) per isolare il puro degrado gomme:
          </p>

          <h4 className="font-semibold text-foreground mt-3">Stadio A — Rimozione effetti non-gomma</h4>
          <Formula>lap_time = β₀ + β₁·fuel_proxy_centered + β₂·track_temp_centered + β₃·air_temp_centered + residuo</Formula>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">fuel_proxy</strong> — approssimazione tramite <code className="text-primary">laps_remaining = totalLaps - lapNumber</code>. NON è il carico reale</li>
            <li><strong className="text-foreground">track_temp / air_temp</strong> — temperature associate per timestamp più vicino (tolleranza 5 min)</li>
            <li>Variabili centrate per stabilità numerica</li>
            <li>Se varianza temperature &lt; 0.3°C → solo fuel proxy</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Stadio B — Degrado isolato</h4>
          <Formula>residuo = α + γ·tyre_life + errore</Formula>
          <p>
            Il coefficiente <strong className="text-foreground">γ</strong> è la slope corretta di degrado (s/giro):
            quanto il tempo al giro aumenta per ogni giro di vita della gomma,
            dopo aver rimosso l'effetto del carburante e della temperatura.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Tipi di modello</h4>
          <ul className="list-disc pl-5 space-y-1">
            <Param name="corrected_two_stage" desc="Modello completo con fuel + temperature" />
            <Param name="corrected_fuel_only" desc="Solo fuel proxy (temperature insufficienti)" />
            <Param name="simple_fallback" desc="Regressione semplice (modello corretto implausibile o dati insufficienti)" />
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Guardrail</h4>
          <p>Se la slope corretta &gt; 0.30 s/giro → si usa la regressione semplice (il modello corretto è implausibile).</p>
        </DocSection>

        <DocSection id="degradation-validation" title="Validazione del Degrado Gomme" icon={<Shield className="h-4 w-4" />}>
          <p>
            Ogni stima di degrado viene classificata con approccio multi-criterio e <strong className="text-foreground">contestuale per compound</strong>:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground" style={{ color: "hsl(142, 70%, 45%)" }}>VALID</strong> — slope positiva, fit accettabile, giri sufficienti, nessun flag critico</li>
            <li><strong className="text-foreground" style={{ color: "hsl(45, 93%, 58%)" }}>NEUTRAL</strong> — slope vicina a zero, fit debole, stint borderline, o correzione troppo ampia</li>
            <li><strong className="text-foreground" style={{ color: "hsl(0, 62%, 50%)" }}>INVALID</strong> — slope negativa, giri insufficienti, fit insufficiente, o slope fisicamente implausibile</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Soglie compound-specific</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-border rounded">
              <thead>
                <tr className="bg-muted/40">
                  <th className="px-3 py-1.5 text-left font-semibold text-foreground">Compound</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-foreground">Neg. tol.</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-foreground">Neutral tol.</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-foreground">Max slope</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-foreground">Min giri VALID</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border"><td className="px-3 py-1.5 font-mono text-red-400">SOFT</td><td className="px-3 py-1.5 text-right">−0.01</td><td className="px-3 py-1.5 text-right">0.015</td><td className="px-3 py-1.5 text-right">0.25</td><td className="px-3 py-1.5 text-right">5</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-1.5 font-mono text-yellow-400">MEDIUM</td><td className="px-3 py-1.5 text-right">−0.02</td><td className="px-3 py-1.5 text-right">0.01</td><td className="px-3 py-1.5 text-right">0.20</td><td className="px-3 py-1.5 text-right">6</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-1.5 font-mono text-white">HARD</td><td className="px-3 py-1.5 text-right">−0.025</td><td className="px-3 py-1.5 text-right">0.008</td><td className="px-3 py-1.5 text-right">0.15</td><td className="px-3 py-1.5 text-right">7</td></tr>
              </tbody>
            </table>
          </div>

          <h4 className="font-semibold text-foreground mt-3">Confidence multi-fattore</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">HIGH</strong> — VALID + fit buono + giri sufficienti + correzione contenuta</li>
            <li><strong className="text-foreground">MEDIUM</strong> — NEUTRAL o VALID borderline</li>
            <li><strong className="text-foreground">LOW</strong> — INVALID o flag multipli critici</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Fallback con ranking contestuale</h4>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Stesso pilota + stesso compound + stint simile (score max)</li>
            <li>Stesso compound + miglior fit/confidence + stint simile</li>
            <li>Qualsiasi candidato VALID/NEUTRAL ordinato per score</li>
            <li>Fallback compound-specific (SOFT: 0.05, MEDIUM: 0.035, HARD: 0.025 s/giro)</li>
          </ol>

          <h4 className="font-semibold text-foreground mt-3">Override degrado personalizzato</h4>
          <p>
            Quando uno o più stint risultano INVALID, l'utente può inserire un valore di degrado
            personalizzato <strong className="text-foreground">per ciascuna mescola</strong> (es. 0.045 s/giro per SOFT, 0.030 per MEDIUM).
            Ogni campo è indipendente e opzionale: se lasciato vuoto, il sistema usa il fallback automatico.
            L'override si applica solo agli stint INVALID della mescola corrispondente.
          </p>
        </DocSection>

        <DocSection id="tyre-warmup" title="Modello Tyre Warmup" icon={<Thermometer className="h-4 w-4" />}>
          <p>
            Modello di penalità termica per i giri immediatamente successivi a un pit stop.
            Il warmup si applica <strong className="text-foreground">solo alle strategie simulate</strong>
            (raccomandata + alternative), non alla strategia reale (che rappresenta ciò che è successo).
          </p>

          <h4 className="font-semibold text-foreground mt-3">Formula</h4>
          <Formula>warmup_lap_penalty = base_penalty × e^(−decay × (lap − 1))</Formula>

          <h4 className="font-semibold text-foreground mt-3">Parametri per compound</h4>
          <table className="w-full text-xs border border-border rounded mt-1">
            <thead><tr className="bg-muted/40"><th className="px-2 py-1 text-left">Compound</th><th className="px-2 py-1">Base penalty</th><th className="px-2 py-1">Decay</th><th className="px-2 py-1">Giri effetto</th></tr></thead>
            <tbody>
              <tr><td className="px-2 py-1">SOFT</td><td className="px-2 py-1 text-center">0.8s</td><td className="px-2 py-1 text-center">1.2</td><td className="px-2 py-1 text-center">~2</td></tr>
              <tr><td className="px-2 py-1">MEDIUM</td><td className="px-2 py-1 text-center">1.2s</td><td className="px-2 py-1 text-center">0.8</td><td className="px-2 py-1 text-center">~3</td></tr>
              <tr><td className="px-2 py-1">HARD</td><td className="px-2 py-1 text-center">1.8s</td><td className="px-2 py-1 text-center">0.5</td><td className="px-2 py-1 text-center">~4</td></tr>
              <tr><td className="px-2 py-1">INTERMEDIATE</td><td className="px-2 py-1 text-center">1.5s</td><td className="px-2 py-1 text-center">0.6</td><td className="px-2 py-1 text-center">~3</td></tr>
              <tr><td className="px-2 py-1">WET</td><td className="px-2 py-1 text-center">2.0s</td><td className="px-2 py-1 text-center">0.4</td><td className="px-2 py-1 text-center">~5</td></tr>
            </tbody>
          </table>

          <h4 className="font-semibold text-foreground mt-3">Impatto strategico</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Penalizza strategie con tanti pit stop (maggiore costo warmup cumulativo)</li>
            <li>Influenza undercut/overcut (la mescola con warmup più lungo è svantaggiata nell'undercut)</li>
            <li>Penalizza stint troppo corti (warmup pesa di più proporzionalmente)</li>
          </ul>
        </DocSection>

        <DocSection id="weather-classification" title="Classificazione Meteo" icon={<Cloud className="h-4 w-4" />}>
          <p>
            Il modulo di classificazione meteo classifica ogni giro in:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">DRY</strong> — nessuna pioggia rilevata</li>
            <li><strong className="text-foreground">WET</strong> — pioggia costante o intensa</li>
            <li><strong className="text-foreground">MIXED</strong> — condizioni variabili, pioggia intermittente o transizione</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Pipeline multi-segnale</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Analisi del campo <code className="text-primary">rainfall</code> con soglie per intensità</li>
            <li>Debounce temporale per evitare oscillazioni rapide DRY/WET</li>
            <li>Smoothing con finestra mobile per stabilizzare la classificazione</li>
            <li>Fallback conservativo in caso di dati insufficienti</li>
          </ul>
          <p className="text-xs italic">
            Utilizzata dal VRE per escludere giri bagnati dalle stime di degrado e per classificare le fasi di gara.
          </p>
        </DocSection>

        <DocSection id="track-status" title="Classificazione Track Status" icon={<Flag className="h-4 w-4" />}>
          <p>I messaggi di Race Control vengono analizzati per classificare ogni giro:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">GREEN</strong> — condizioni normali</li>
            <li><strong className="text-foreground">YELLOW / DOUBLE_YELLOW</strong> — bandiere gialle</li>
            <li><strong className="text-foreground">VSC</strong> — Virtual Safety Car</li>
            <li><strong className="text-foreground">SC</strong> — Safety Car</li>
            <li><strong className="text-foreground">RED</strong> — bandiera rossa</li>
            <li><strong className="text-foreground">MIXED</strong> — più stati nello stesso giro</li>
          </ul>
          <p>Priorità: RED &gt; SC &gt; VSC &gt; DOUBLE_YELLOW &gt; YELLOW.</p>
          <p className="mt-2">
            <strong className="text-foreground">Eccezione ultimo giro:</strong> una bandiera rossa
            all'ultimo giro viene trattata come fine gara normale, non come neutralizzazione.
            Questo evita alterazioni delle stime strategiche per un evento senza impatto sulla strategia.
          </p>
        </DocSection>

        <DocSection id="traffic-predictor" title="Traffic Predictor" icon={<Navigation className="h-4 w-4" />}>
          <p>
            Modulo di predizione del traffico post-pit, progettato per avvicinarsi
            alla logica di strategy engineering F1.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Pipeline</h4>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong className="text-foreground">Indicizzazione</strong> — posizioni e intervalli pre-indicizzati per pilota</li>
            <li><strong className="text-foreground">Time projection</strong> — stima uscita box e proiezione gap degli altri piloti</li>
            <li><strong className="text-foreground">Rejoin order</strong> — posizione di rientro stimata</li>
            <li><strong className="text-foreground">Pack detection</strong> — cluster window (2.0s), compressed train (&lt; 1.0s), density score</li>
            <li><strong className="text-foreground">Classificazione</strong> — CLEAN (≥ 3.0s), LIGHT (≥ 1.5s), HEAVY (&lt; 1.5s)</li>
            <li><strong className="text-foreground">Pace analysis</strong> — passo recente con mediana trimmed</li>
            <li><strong className="text-foreground">Traffic laps</strong> — multi-fattore: pace delta, pack size, compressed train, warmup handicap</li>
            <li><strong className="text-foreground">Time loss</strong> — <code className="text-primary">0.8s/giro × dirty_air × pack_factor × overtake_difficulty</code></li>
          </ol>

          <h4 className="font-semibold text-foreground mt-3">Release Quality & Confidence</h4>
          <p>
            Ogni predizione include qualità del rientro (EXCELLENT / GOOD / MARGINAL / POOR)
            e confidenza (HIGH / MEDIUM / LOW) basata sulla disponibilità dei dati.
          </p>
          <p className="text-xs italic mt-2">
            Il modello non usa il DRS come variabile. Le difficoltà di sorpasso dipendono da
            densità traffico, pace delta, dirty air e overtaking difficulty della pista.
          </p>
        </DocSection>

        <DocSection id="strategy-analysis" title="Strategy Analysis (Multi-Obiettivo)" icon={<Target className="h-4 w-4" />}>
          <p>
            Il modulo di analisi strategica multi-obiettivo arricchisce ogni strategia simulata
            con un'analisi completa:
          </p>

          <h4 className="font-semibold text-foreground mt-3">Obiettivi analizzati</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">race_time_objective</strong> — delta tempo vs strategia reale</li>
            <li><strong className="text-foreground">track_position_objective</strong> — posizioni guadagnate/perse stimate</li>
            <li><strong className="text-foreground">risk_objective</strong> — rischio combinato (cliff, traffico, sensibilità)</li>
            <li><strong className="text-foreground">robustness_objective</strong> — robustezza della strategia (ROBUST / MEDIUM / FRAGILE)</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Analisi di robustezza</h4>
          <p>Ogni strategia è classificata per robustezza basandosi su:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Sensitivity analysis: variazione del risultato per degrado +20%, traffico +50%, pit loss +2s</li>
            <li>Cliff risk: probabilità di cliff se si estende lo stint</li>
            <li>Variabilità dei costi stimati</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Analisi complementari</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Competitor context</strong> — posizione rientro, undercut risk/opportunity, traffic risk</li>
            <li><strong className="text-foreground">Overtake difficulty</strong> — score, giri bloccato, dirty air penalty</li>
            <li><strong className="text-foreground">Stint extension</strong> — costo/giro, penalità totale, cliff risk se si estende</li>
            <li><strong className="text-foreground">Pit window</strong> — finestra ottimale, best lap, time spread</li>
          </ul>
        </DocSection>

        <DocSection id="pace-loss" title="Pace Loss Rate" icon={<TrendingDown className="h-4 w-4" />}>
          <p>
            Misura la velocità con cui un pilota perde prestazione durante uno stint,
            indicando se la performance si sta degradando più velocemente del modello di degrado.
          </p>
          <Formula>pace_loss_rate = (media ultimi 5 giri - media primi 5 giri) / durata_stint_validi</Formula>

          <h4 className="font-semibold text-foreground mt-3">Classificazione</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">STABLE</strong> — rate ≤ 0.03s</li>
            <li><strong className="text-foreground">NORMAL_LOSS</strong> — 0.03 &lt; rate ≤ 0.10s</li>
            <li><strong className="text-foreground">HIGH_LOSS</strong> — 0.10 &lt; rate ≤ 0.20s</li>
            <li><strong className="text-foreground">CLIFF_RISK</strong> — rate &gt; 0.30s</li>
            <li><strong className="text-foreground">UNRELIABLE</strong> — dati insufficienti o &gt; 50% giri contaminati</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Contaminazione</h4>
          <p>Giri esclusi: battaglie (gap &lt; 1s), giri WET/MIXED, giri con SC/VSC/Yellow.</p>

          <h4 className="font-semibold text-foreground mt-3">Effetto nel VRE</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Moltiplicatore degrado (+2% a +18%)</li>
            <li>Moltiplicatore cliff penalty (+20% per HIGH_LOSS, +50% per CLIFF_RISK)</li>
            <li>Shift pit urgency (anticipa pit window di 1–3 giri)</li>
            <li>Validazione coerenza degrado/pace loss → riduce confidenza se incoerenti</li>
          </ul>
        </DocSection>

        <DocSection id="battle-detection" title="Battle Detection" icon={<Swords className="h-4 w-4" />}>
          <p>Rileva episodi di battaglia ravvicinata analizzando intervalli e posizioni:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">ATTACKING</strong> — intervallo &lt; 1.0s rispetto a chi precede</li>
            <li><strong className="text-foreground">DEFENDING</strong> — il pilota dietro ha intervallo &lt; 1.0s</li>
            <li><strong className="text-foreground">BOTH</strong> — attacco e difesa contemporanei</li>
          </ul>
          <p>
            Le battaglie vengono usate dal pace loss per escludere giri in aria sporca
            e dal VRE per penalizzare pit stop durante fasi di battaglia attiva.
          </p>
        </DocSection>

        <DocSection id="long-run" title="Long Run Detector (Practice)" icon={<Beaker className="h-4 w-4" />}>
          <p>Nelle prove libere, identifica le simulazioni di gara (long run) all'interno degli stint:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Lunghezza</strong> — ≥ 8 giri: +30pt, ≥ 6: +20pt</li>
            <li><strong className="text-foreground">Regolarità</strong> — std &lt; 0.5s: +25pt</li>
            <li><strong className="text-foreground">Trend degrado</strong> — slope positiva 0–0.2 s/giro: +20pt</li>
            <li><strong className="text-foreground">Push lap penalty</strong> — giri &lt; 99% mediana: −25pt</li>
          </ul>
          <p>Score ≥ 40 → long run valido. I modelli di degrado dalle FP vengono usati dal VRE come riferimento per mescole non usate in gara.</p>
        </DocSection>

        <DocSection id="scenario-engine" title="Scenario Engine — Dettaglio Tecnico" icon={<Settings className="h-4 w-4" />}>
          <p>
            Lo scenario engine utilizza un sistema di weighting contestuale e non-lineare
            per modulare l'impatto degli scenari what-if:
          </p>

          <h4 className="font-semibold text-foreground mt-3">Metriche interne</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Severity</strong> (0–1) — peso intrinseco per scenario. Es: Safety Car = 0.8, Clean Air = 0.3</li>
            <li><strong className="text-foreground">Relevance</strong> — copertura della finestra sulla gara, scaling sub-lineare (√) per evitare che scenari lunghi dominino</li>
            <li><strong className="text-foreground">Feasibility</strong> — penalizza finestre troppo brevi (&lt; 3 giri) o troppo tardive nella gara</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Blending dei modifier</h4>
          <p>
            I modifier non vengono applicati rigidamente: vengono blendati con il contesto temporale
            usando una combinazione di scale, relevance e feasibility. Questo impedisce che scenari
            estremi in finestre marginali producano effetti irrealistici.
          </p>
        </DocSection>

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Principi" />
        {/* ═══════════════════════════════════════════════════════ */}

        <DocSection id="anti-hallucination" title="Principi Anti-Allucinazione" icon={<Shield className="h-4 w-4" />} defaultOpen>
          <p className="text-foreground font-medium">
            L'intero sistema è progettato per prevenire esplicitamente risultati fuorvianti:
          </p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <strong className="text-foreground">Nessun dato inventato</strong> — ogni valore proviene
              dall'API OpenF1 o è derivato tramite formule esplicite e tracciabili.
            </li>
            <li>
              <strong className="text-foreground">Slope negativa ≠ gomma migliore</strong> — viene classificata
              INVALID e sostituita con fallback conservativo.
            </li>
            <li>
              <strong className="text-foreground">Deviazione cumulativa ≠ degrado gomme</strong> — è un indicatore
              di pace relativa, non una misura di usura. Usata come metrica ausiliaria.
            </li>
            <li>
              <strong className="text-foreground">Contaminazione esplicita</strong> — traffico, battaglie,
              meteo e neutralizzazioni vengono identificati. I giri contaminati
              vengono esclusi o la metrica declassata a UNRELIABLE.
            </li>
            <li>
              <strong className="text-foreground">Scenari ≠ previsioni</strong> — gli scenari what-if
              modificano solo i moltiplicatori, non creano eventi fittizi.
            </li>
            <li>
              <strong className="text-foreground">Confidenza dinamica</strong> — ogni fattore che riduce
              l'affidabilità viene registrato e comunicato all'utente.
            </li>
            <li>
              <strong className="text-foreground">Fuel proxy ≠ carburante reale</strong> — il sistema
              usa <code className="text-primary">laps_remaining</code> come proxy. Non ha accesso al fuel load reale.
            </li>
            <li>
              <strong className="text-foreground">Fallback conservativi</strong> — dove i dati sono insufficienti
              o inaffidabili, il sistema usa valori conservativi per compound e riduce la confidenza.
            </li>
            <li>
              <strong className="text-foreground">Warmup solo su strategie simulate</strong> — il modello di warmup
              non si applica alla strategia reale, che rappresenta ciò che è effettivamente successo.
            </li>
            <li>
              <strong className="text-foreground">Context adjustment opzionale</strong> — i fattori di rischio contestuali
              (robustezza, cliff, traffico) vengono applicati solo se realmente calcolati dai moduli.
              Campi assenti → contributo 0 (nessuna penalità fittizia).
            </li>
          </ol>
        </DocSection>

        {/* Key Decision Moments */}
        <DocSection id="key-decision-moments" title="Key Decision Moments" icon={<Target className="h-5 w-5" />}>
          <p>
            La sezione <strong className="text-foreground">Key Decision Moments</strong> identifica i momenti della gara
            in cui una scelta strategica tra <em>"pit stop"</em> e <em>"stay out"</em> era realisticamente plausibile.
            È disponibile esclusivamente per le sessioni di tipo <strong className="text-foreground">Race</strong> e <strong className="text-foreground">Sprint</strong>.
          </p>
          <p>
            La card è collassabile e mostra nel titolo il numero totale di momenti decisionali individuati.
            Ogni momento è presentato come una card compatta espandibile per consultare il dettaglio completo.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Come viene individuato un momento decisionale</h4>
          <p>
            Un decision point viene rilevato quando almeno una di queste condizioni è vera:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Il pilota si trova dentro o vicino alla finestra di pit stop ottimale</li>
            <li>Il degrado gomme entra in zona critica o ad alta perdita</li>
            <li>È presente una battaglia attiva o appena conclusa</li>
            <li>Il traffico previsto al rientro in pista è rilevante</li>
            <li>Si verifica un cambio meteo o una condizione non dry</li>
            <li>È in corso una Safety Car, Virtual Safety Car o altra neutralizzazione</li>
            <li>La perdita cumulativa inizia a peggiorare in modo consistente</li>
            <li>Un pit stop è effettivamente avvenuto in quel giro</li>
          </ul>
          <p>
            La finestra decisionale copre da 1 a 3 giri, non un singolo istante rigido.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Card compatta</h4>
          <p>Ogni card compatta mostra a colpo d'occhio:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">Giro o finestra giri</strong> — il momento esatto della decisione</li>
            <li><strong className="text-foreground">Tipo di decisione</strong> — PIT NOW, STAY OUT o MARGINALE</li>
            <li><strong className="text-foreground">Azione reale</strong> — se il pilota ha effettivamente pittato o è rimasto in pista</li>
            <li><strong className="text-foreground">Confidenza</strong> — Alta, Media o Bassa</li>
            <li><strong className="text-foreground">Fattori principali</strong> — i 2-3 driver più rilevanti del momento</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Dettaglio espanso</h4>
          <p>Espandendo un decision point si visualizzano:</p>
          <ol className="list-decimal list-inside space-y-2">
            <li>
              <strong className="text-foreground">Contesto decisionale (Decision Snapshot)</strong> — mescola, età gomme,
              posizione in pista, degrado, gap, meteo, status pista, giri rimanenti e trend di perdita cumulativa.
            </li>
            <li>
              <strong className="text-foreground">Fattori</strong> — elenco completo dei fattori che spingono verso PIT
              o STAY OUT, con peso (HIGH, MEDIUM, LOW) e dettaglio testuale.
            </li>
            <li>
              <strong className="text-foreground">Azione reale ed esito</strong> — la decisione effettivamente presa
              dal team e l'esito osservato nei giri successivi (variazione di posizione, riepilogo, evento successivo).
            </li>
            <li>
              <strong className="text-foreground">Note di affidabilità</strong> — avvertenze esplicite sui limiti dei dati
              disponibili o sulla confidenza dell'analisi.
            </li>
          </ol>

          <h4 className="font-semibold text-foreground mt-4">Anti-allucinazione</h4>
          <p>
            La sezione utilizza esclusivamente dati reali provenienti dai moduli di analisi già calcolati
            (degrado, traffico, pace loss, meteo, neutralizzazioni, deviazione cumulativa).
            Non vengono inventati eventi, battaglie, decisioni o relazioni causali.
            Se un dato non è disponibile, viene esplicitamente indicato come "N/D" o omesso.
          </p>
        </DocSection>

        {/* Soft Sensors */}
        <DocSection id="soft-sensors" title="Soft Sensors" icon={<Thermometer className="h-5 w-5" />}>
          <p>
            I <strong className="text-foreground">Soft Sensors</strong> sono un layer aggiuntivo di stima degli stati latenti,
            integrato nel Virtual Race Engineer come arricchimento opzionale. Non misurano grandezze fisiche reali
            (temperature, pressioni) ma stimano stati qualitativi utili all'interpretazione strategica,
            usando esclusivamente dati già calcolati dai moduli a monte.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Principio di funzionamento</h4>
          <p>
            Ogni soft sensor combina più segnali osservabili per produrre una classificazione qualitativa.
            La stima include sempre un'etichetta di stato, un livello di confidenza (Alta, Media, Bassa),
            le motivazioni della classificazione e, dove i dati lo supportano, un punteggio normalizzato 0–100%.
            Se un segnale è contaminato o assente, la confidenza viene ridotta e la contaminazione dichiarata esplicitamente.
          </p>

          <h4 className="font-semibold text-foreground mt-4">1. Stato termico gomme</h4>
          <p>
            Stima lo stato termico operativo della gomma durante lo stint, con attenzione particolare alla fase post-pit stop.
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">COLD</strong> — primo giro su gomme nuove, riscaldamento non iniziato</li>
            <li><strong className="text-foreground">WARMING_UP</strong> — entro la finestra di riscaldamento prevista dal modello warmup</li>
            <li><strong className="text-foreground">IN_WINDOW</strong> — gomme a regime operativo stimato</li>
            <li><strong className="text-foreground">HOT</strong> — gomme a temperatura elevata stimata (battaglia attiva, alta età)</li>
            <li><strong className="text-foreground">UNKNOWN</strong> — segnali contrastanti o insufficienti</li>
          </ul>
          <p className="text-xs mt-1">
            Segnali: compound, età gomma, modello warmup, meteo, neutralizzazioni recenti, battaglia attiva.
            La mescola Hard produce un riscaldamento più lento, coerentemente con il modello warmup esistente.
          </p>

          <h4 className="font-semibold text-foreground mt-4">2. Stress gomme</h4>
          <p>
            Stima il livello di stress operativo della gomma. Lo stress non è sinonimo di degrado:
            una gomma può avere basso degrado ma alto stress (es. battaglia prolungata su gomme giovani).
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">LOW</strong> — nessun segnale significativo di stress</li>
            <li><strong className="text-foreground">MODERATE</strong> — segnali moderati (età media, degrado non critico)</li>
            <li><strong className="text-foreground">HIGH</strong> — segnali convergenti di stress elevato</li>
            <li><strong className="text-foreground">CRITICAL</strong> — almeno 3 segnali forti convergenti (degrado, pace loss, battaglia)</li>
            <li><strong className="text-foreground">UNKNOWN</strong> — dati insufficienti o inaffidabili</li>
          </ul>
          <p className="text-xs mt-1">
            Segnali: età gomma, slope degrado, validazione degrado, pace loss, battaglia attiva, meteo misto, restart post-neutralizzazione.
            Lo stato CRITICAL richiede almeno tre fattori convergenti per evitare falsi allarmi.
          </p>

          <h4 className="font-semibold text-foreground mt-4">3. Grip pista</h4>
          <p>
            Stima l'evoluzione del grip pista utile a contestualizzare stint, degrado e timing strategico.
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">LOW_GRIP</strong> — tutti i giri recenti in condizioni bagnate</li>
            <li><strong className="text-foreground">IMPROVING</strong> — transizione bagnato→asciutto o fase iniziale gara</li>
            <li><strong className="text-foreground">STABLE</strong> — condizioni asciutte costanti oltre il primo terzo di gara</li>
            <li><strong className="text-foreground">FALLING</strong> — segnali di peggioramento grip</li>
            <li><strong className="text-foreground">MIXED</strong> — segnali contrastanti o neutralizzazioni frequenti</li>
            <li><strong className="text-foreground">UNKNOWN</strong> — dati meteo assenti</li>
          </ul>
          <p className="text-xs mt-1">
            Segnali: meteo degli ultimi 5 giri, transizioni meteo, neutralizzazioni, fase della gara.
            Non viene attribuito alla pista ciò che è chiaramente effetto gomma o traffico.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Timeline lap-by-lap</h4>
          <p>
            I soft sensors vengono calcolati per ogni singolo giro della gara, producendo una timeline completa.
            Per ciascun giro il sistema identifica lo stint attivo, la validazione del degrado e il pace loss
            corrispondente, e applica i tre sensori (termico, stress, grip) con le stesse regole del summary ma
            con il contesto specifico del giro.
          </p>
          <p>
            Dal timeline vengono estratti automaticamente:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">Giri di warmup per stint</strong> — quanti giri ogni stint ha trascorso in stato COLD o WARMING_UP</li>
            <li><strong className="text-foreground">Primo giro di stress alto/critico</strong> — quando il primo segnale di stress elevato è apparso</li>
            <li><strong className="text-foreground">Transizioni grip</strong> — cambi di stato del grip pista (es. Improving → Stable)</li>
          </ul>
          <p>
            L'interfaccia mostra le transizioni rilevanti in modo sintetico, con possibilità di espandere
            la timeline completa giro per giro in formato tabellare.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Raffinamento delle strategie (Strategy Refinement)</h4>
          <p>
            La timeline dei soft sensors viene utilizzata per applicare piccoli aggiustamenti ai costi simulati
            della strategia raccomandata e di tutte le alternative. Il refinement è separato, tracciabile e limitato:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">Thermal refinement</strong> — modula il warmup esistente nei primi giri post-pit, senza duplicare la penalità già calcolata dal modello warmup</li>
            <li><strong className="text-foreground">Stress refinement</strong> — aggiunge un costo marginale nei giri avanzati dello stint quando lo stress è HIGH o CRITICAL, senza sostituire il modello di degrado</li>
            <li><strong className="text-foreground">Grip refinement</strong> — applica un leggero modificatore basato sullo stato grip osservato (es. pista in miglioramento → lieve beneficio)</li>
          </ul>
          <p>
            Ogni aggiustamento è limitato individualmente (max ±0.15s/giro per il termico, ±0.10s per lo stress,
            ±0.08s per il grip) e globalmente (max ±3.0s totali). I giri con confidenza bassa vengono ignorati.
            Il sistema evita esplicitamente il doppio conteggio con i moduli di warmup, degrado e traffico.
          </p>
          <p>
            L'impatto dei soft sensors è visibile per ogni strategia con un badge dedicato (SS: +X.XXs)
            e un dettaglio espandibile che mostra la contribuzione di ogni componente (termico, stress, grip).
          </p>

          <h4 className="font-semibold text-foreground mt-4">Integrazione nello scoring strategico (Weak Scoring Input)</h4>
          <p>
            Oltre al refinement dei costi simulati, i soft sensors possono influenzare lo <strong className="text-foreground">scoring multi-criterio</strong> delle
            strategie come input debole e validato. Questo livello aggiuntivo opera in tre stadi distinti:
          </p>

          <p className="font-semibold text-foreground mt-2">1. Interpretation Layer</p>
          <p>
            I soft sensors interpretano la timeline per produrre insight narrativi (warmup, stress, grip) e contesto
            per la validazione del degrado e i momenti decisionali. Non modificano alcun modulo core.
          </p>

          <p className="font-semibold text-foreground mt-2">2. Refinement Layer</p>
          <p>
            Micro-aggiustamenti lap-by-lap applicati ai costi simulati (max ±0.15s/giro termico, ±0.10s stress,
            ±0.08s grip, ±3.0s totali). Separati dai moduli base, con anti-double-counting esplicito.
          </p>

          <p className="font-semibold text-foreground mt-2">3. Scoring Layer (Weak Input)</p>
          <p>
            I soft sensors alimentano lo scoring solo dopo aver superato un <strong className="text-foreground">gate di validazione</strong> obbligatorio.
            Il gate verifica quattro condizioni:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Timeline disponibile e non vuota</li>
            <li>Confidence complessiva != LOW</li>
            <li>Supporto validazione degrado != WEAK</li>
            <li>Assenza di conflitti evidenti tra i segnali dei tre sensori</li>
          </ul>
          <p>
            Se una qualsiasi condizione non è soddisfatta, l'impatto sullo scoring è zero e il motivo del blocco
            è esplicitamente indicato nell'interfaccia.
          </p>
          <p>
            Quando il gate è attivo, l'effetto sullo scoring è limitato a <strong className="text-foreground">±1.0s massimo per strategia</strong>,
            pesato per la confidence dell'adjustment (HIGH: 100%, MEDIUM: 50%, LOW: 0%). Se la distanza tra due
            strategie supera i 5.0s, i soft sensors non possono influenzare il ranking tra di esse.
          </p>
          <p>
            Per ogni strategia, l'interfaccia mostra: lo scoring senza soft sensors, lo scoring con soft sensors
            e il delta introdotto, rendendo ogni effetto completamente tracciabile e verificabile.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Anti-double-counting</h4>
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">Thermal</strong> — modula il warmup, non lo duplica (il modello base già applica la penalità)</li>
            <li><strong className="text-foreground">Stress</strong> — aggiustamento marginale sul degrado tardivo, non un secondo modello di degrado</li>
            <li><strong className="text-foreground">Grip</strong> — contesto pista leggero, non un nuovo modello meteo</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Limitazioni</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>L'effetto sullo scoring è non deterministico — dipende dalla qualità e coerenza dei segnali disponibili</li>
            <li>Non stabilisce causalità: segnala correlazioni osservate, non cause</li>
            <li>La qualità dell'output è direttamente legata alla disponibilità dei dati upstream (meteo, degrado, pace loss)</li>
            <li>Non può ribaltare da solo una strategia chiaramente migliore per i moduli core</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Integrazione nel VRE</h4>
          <p>
            I soft sensors sono calcolati prima dello scoring multi-criterio, garantendo che gli adjustment
            siano disponibili come input per il ranking. Il summary è derivato dalla timeline (non da una logica separata)
            per garantire coerenza. Sono presentati come sezione collassabile nel VRE con etichetta "STIMA".
          </p>

          <h4 className="font-semibold text-foreground mt-4">Layer di supporto</h4>
          <p>
            I soft sensors forniscono supporto contestuale a quattro aree del sistema, senza mai sostituire
            o ribaltare i moduli esistenti:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong>Interpretazione warmup</strong> — Analizza la timeline termica per identificare anomalie
              nel riscaldamento gomme (warmup più lento o più rapido del modello). Non modifica il calcolo
              della penalità warmup, ma fornisce spiegazioni e contesto (es. "warmup persistente per 5 giri vs 3 previsti").
            </li>
            <li>
              <strong>Contesto validazione degrado</strong> — Analizza la timeline per giro su tre assi indipendenti
              per ogni stint:
              <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                <li><strong>Consistenza termica</strong> — verifica se il warmup ha contaminato la parte iniziale del fit,
                  confrontando i giri COLD/WARMING_UP osservati con il modello previsto.</li>
                <li><strong>Consistenza stress</strong> — valuta se il pattern di stress è coerente con la slope stimata.
                  Stress crescente nella seconda metà con validazione VALID rafforza la fiducia; stress basso con slope alta
                  segnala possibile incoerenza.</li>
                <li><strong>Contaminazione grip</strong> — distingue il degrado gomma dalle variazioni pista.
                  Grip stabile durante lo stint supporta la lettura; grip misto o in calo aumenta il rischio di contaminazione.</li>
              </ul>
              <p className="mt-1">Per ogni stint viene calcolato un <strong>support_score</strong> (0–1, media pesata dei tre assi)
              e un <strong>contamination_score</strong> (0–1). Il livello di supporto (STRONG, PARTIAL, WEAK) richiede convergenza
              di almeno due assi e bassa contaminazione per raggiungere STRONG. Nessun singolo asse può determinare da solo
              il livello massimo. I segnali di supporto e di contraddizione sono elencati separatamente per trasparenza.</p>
            </li>
            <li>
              <strong>Narrativa arricchita</strong> — Estrae fino a 6 insight narrativi dalla timeline,
              tracciabili a giro e sensore specifico: anomalie warmup, ingresso in stress elevato,
              transizioni grip, combinazioni critiche. Ogni insight è prudente e non attribuisce cause non osservabili.
            </li>
            <li>
              <strong>Contesto decisionale (Key Decision Moments)</strong> — Per ogni momento decisionale,
              aggrega gli stati dei tre sensori sulla finestra di 1–3 giri, valuta la coerenza dei segnali
              e fornisce note contestuali (es. "stress elevato: segnale coerente con pressione verso il pit",
              "gomme non in finestra: undercut penalizzato dal warmup"). I soft sensors sono un fattore
              secondario, mai un driver principale della decisione.
            </li>
          </ul>

          <h4 className="font-semibold text-foreground mt-4">Anti-allucinazione</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>Nessun valore fisico assoluto viene prodotto (nessuna °C, kPa, ecc.)</li>
            <li>Stati estremi richiedono segnali multipli convergenti</li>
            <li>Ogni inferenza è accompagnata da motivazione e livello di confidenza</li>
            <li>I segnali contaminanti vengono dichiarati esplicitamente</li>
            <li>Se i dati sono insufficienti o contraddittori, lo stato è UNKNOWN con confidenza bassa</li>
            <li>Gli aggiustamenti strategici sono piccoli, limitati e non possono ribaltare un risultato robusto</li>
            <li>Nessun effetto forte senza evidenze convergenti</li>
            <li>Il layer di supporto non modifica i risultati dei moduli core (warmup, degrado, pace loss)</li>
            <li>Ogni insight narrativo è tracciabile a un giro e un sensore specifico</li>
          </ul>
        </DocSection>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-8 space-y-1">
          <p>Documentazione generata dal codice sorgente — versione attuale del modello analitico.</p>
          <p>Dati forniti da <strong className="text-foreground">OpenF1 API</strong> — api.openf1.org</p>
        </div>

      </main>
    </div>
  );
}
