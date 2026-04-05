import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, BarChart3, Gauge, Brain, Cloud, Flag, Swords, TrendingDown, Timer, Shield, Beaker, Target, Layers, ChevronDown, Play, Users, Table, Map, Activity, Thermometer, Wrench, Eye, Zap, LayoutDashboard, Settings, Info, Lightbulb } from "lucide-react";
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
      className="text-primary hover:text-primary/80 hover:underline transition-colors text-sm"
      onClick={(e) => {
        e.preventDefault();
        const el = document.querySelector(href);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          // Open the section if collapsed
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
          <h1 className="text-lg font-bold tracking-tight">Documentazione</h1>
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
        </div>

        {/* ═══════════════════════════════════════════════ */}
        {/* TABLE OF CONTENTS */}
        {/* ═══════════════════════════════════════════════ */}
        <div className="bg-card rounded-lg border border-border p-5 space-y-4">
          <p className="text-foreground font-semibold flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            Indice
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
            <div className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mt-2">Per iniziare</p>
              <TocLink href="#getting-started">Come iniziare</TocLink>
              <TocLink href="#data-source">Fonte Dati — OpenF1 API</TocLink>

              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mt-3">Visualizzazione dati</p>
              <TocLink href="#lap-times-chart">Grafico Tempi al Giro</TocLink>
              <TocLink href="#telemetry">Telemetria e Track Map</TocLink>
              <TocLink href="#sectors">Settori e Mini-Settori</TocLink>

              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mt-3">Report sessione</p>
              <TocLink href="#session-report">Session Report</TocLink>

              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mt-3">Analisi pilota</p>
              <TocLink href="#weather-card">Meteo</TocLink>
              <TocLink href="#pit-stops">Pit Stop</TocLink>
              <TocLink href="#stints">Stint</TocLink>
              <TocLink href="#overtakes">Sorpassi</TocLink>
              <TocLink href="#race-diary">Diario di Gara</TocLink>
              <TocLink href="#cumulative-deviation">Deviazione Cumulativa</TocLink>
              <TocLink href="#tyre-degradation-card">Degrado Gomme (Card)</TocLink>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mt-2">Virtual Race Engineer</p>
              <TocLink href="#vre-overview">Panoramica VRE</TocLink>
              <TocLink href="#vre-cost-function">Funzione di Costo</TocLink>
              <TocLink href="#vre-race-phase">Race Phase</TocLink>
              <TocLink href="#vre-risk-mode">Risk Mode & Decision Layer</TocLink>
              <TocLink href="#vre-scenarios">Scenari What-If</TocLink>
              <TocLink href="#vre-breakdown">Scomposizione del Giudizio</TocLink>
              <TocLink href="#vre-verdict">Verdetto e Confidenza</TocLink>
              <TocLink href="#vre-context">Contesto Integrato</TocLink>

              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mt-3">Modelli di calcolo</p>
              <TocLink href="#tyre-degradation">Degrado Gomme (Modello)</TocLink>
              <TocLink href="#degradation-validation">Validazione Degrado</TocLink>
              <TocLink href="#tyre-warmup">Tyre Warmup</TocLink>
              <TocLink href="#weather-classification">Classificazione Meteo</TocLink>
              <TocLink href="#track-status">Track Status</TocLink>
              <TocLink href="#traffic-predictor">Traffic Predictor</TocLink>
              <TocLink href="#pace-loss">Pace Loss Rate</TocLink>
              <TocLink href="#battle-detection">Battle Detection</TocLink>
              <TocLink href="#long-run">Long Run Detector</TocLink>
              <TocLink href="#scenario-engine">Scenario Engine</TocLink>

              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mt-3">Principi</p>
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
            <li>Classifica finale della sessione con posizione, pilota, team e tempo</li>
            <li>Condizioni meteo aggregate (temperatura pista/aria, pioggia)</li>
            <li>Informazioni sessione (circuito, data, tipo)</li>
          </ul>
          <h4 className="font-semibold text-foreground mt-3">Race Charts</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Position Chart</strong> — evoluzione delle posizioni giro per giro</li>
            <li><strong className="text-foreground">Gap to Leader</strong> — distacco dal leader nel tempo</li>
            <li><strong className="text-foreground">Deviazione Cumulativa</strong> — perdita di performance cumulativa rispetto al vincitore</li>
          </ul>
          <h4 className="font-semibold text-foreground mt-3">Strategy</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Mappa strategica</strong> — barre colorate per stint/compound di ogni pilota</li>
            <li><strong className="text-foreground">Tabella pit stop</strong> — dettaglio timing, durata e compound per ogni sosta</li>
          </ul>
          <p className="text-xs italic">
            La deviazione cumulativa nel Session Report usa lo stesso modulo analitico del VRE per garantire coerenza.
          </p>
        </DocSection>

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Analisi pilota (singolo pilota)" />
        {/* ═══════════════════════════════════════════════════════ */}

        <DocSection id="weather-card" title="Card Meteo" icon={<Cloud className="h-4 w-4" />}>
          <p>
            Mostra le condizioni meteo durante la sessione con dettaglio per giro:
          </p>
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
            <li><strong className="text-foreground">Under neutralisation</strong> — indica se la sosta è avvenuta durante SC/VSC</li>
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
          <p>
            Ricostruisce i sorpassi effettuati e subiti analizzando i cambi di posizione giro per giro:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Sorpassi effettuati</strong> — posizioni guadagnate in pista (escluse variazioni da pit stop)</li>
            <li><strong className="text-foreground">Sorpassi subiti</strong> — posizioni perse</li>
            <li>Dettaglio per giro con indicazione del pilota coinvolto</li>
          </ul>
        </DocSection>

        <DocSection id="race-diary" title="Card Diario di Gara" icon={<BookOpen className="h-4 w-4" />}>
          <p>
            Cronologia completa degli eventi significativi per il pilota durante la gara:
          </p>
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
          <p>
            Misura la perdita cumulativa di performance rispetto al tempo medio del vincitore:
          </p>
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
              narrative insights, pros/cons, predizioni del traffico
            </li>
            <li>
              <strong className="text-foreground">Decision Layer</strong> — Scoring finale e ranking risk-aware 
              tramite il modulo <code className="text-primary">riskAppetite</code>
            </li>
          </ol>

          <h4 className="font-semibold text-foreground mt-4">Pipeline di calcolo</h4>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Ricostruzione strategia reale (stint, pit stop, tempi)</li>
            <li>Degrado corretto a due stadi + validazione per ogni stint</li>
            <li>Pace Loss Rate per ogni stint (moltiplicatori degrado, cliff, urgency)</li>
            <li>Costruzione modelli per mescola (slope + intercept per compound)</li>
            <li>Simulazione strategie candidate (1, 2, 3 pit stop)</li>
            <li>Traffic prediction per ogni strategia simulata</li>
            <li>Warmup cost per ogni strategia simulata</li>
            <li>Breakdown e analisi multi-obiettivo</li>
            <li>Ranking risk-aware finale</li>
            <li>Verdetto, confidenza e narrative insights</li>
          </ol>

          <h4 className="font-semibold text-foreground mt-4">Interfaccia</h4>
          <p>L'interfaccia segue il principio della <strong className="text-foreground">progressive disclosure</strong>:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Verdetto immediato</strong> — giudizio sintetico con delta temporale e icona</li>
            <li><strong className="text-foreground">Timeline comparativa</strong> — Reale vs Consigliata con indicazione delle soste</li>
            <li><strong className="text-foreground">Griglia di riepilogo</strong> — Battaglie, Meteo, Neutralizzazioni, Deviazione</li>
            <li><strong className="text-foreground">Strategia raccomandata</strong> — con pros/cons, traffic prediction e breakdown (espandibile)</li>
            <li><strong className="text-foreground">Strategie alternative</strong> — ciascuna con lo stesso livello di dettaglio della raccomandata</li>
            <li><strong className="text-foreground">Race Context</strong> — controlli per Risk Mode, scenario simulato, degrado personalizzato</li>
          </ul>
        </DocSection>

        <DocSection id="vre-cost-function" title="VRE — Funzione di Costo Strategia" icon={<Brain className="h-4 w-4" />}>
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

        <DocSection id="vre-race-phase" title="VRE — Race Phase" icon={<Timer className="h-4 w-4" />}>
          <p>
            La gara viene automaticamente segmentata in fasi, ciascuna con moltiplicatori dinamici 
            sui pesi della funzione di costo:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">START_PHASE</strong> (giri 1–3) — posizione prioritaria, rischio penalizzato</li>
            <li><strong className="text-foreground">EARLY_STINT</strong> (&lt; 20% gara) — pesi standard</li>
            <li><strong className="text-foreground">PRIMARY_PIT_WINDOW</strong> — degrado e traffico amplificati</li>
            <li><strong className="text-foreground">MID_RACE_MANAGEMENT</strong> — gestione equilibrata</li>
            <li><strong className="text-foreground">LATE_RACE_ATTACK</strong> (&gt; 75%) — posizione prioritaria, rischio ridotto</li>
            <li><strong className="text-foreground">FINAL_LAPS</strong> (ultimi 5) — traffico e posizione massimizzati</li>
            <li><strong className="text-foreground">NEUTRALIZATION_PHASE</strong> — pit opportunistico favorito</li>
            <li><strong className="text-foreground">WEATHER_TRANSITION_PHASE</strong> — rischio penalizzato, cautela</li>
          </ul>
          <p>
            Ogni fase applica moltiplicatori su: <code className="text-primary">degradation_weight</code>, 
            <code className="text-primary"> traffic_weight</code>, <code className="text-primary">track_position_weight</code>, 
            <code className="text-primary"> risk_penalty_weight</code>, <code className="text-primary">neutralization_opportunity_weight</code>.
          </p>
        </DocSection>

        <DocSection id="vre-risk-mode" title="VRE — Risk Mode & Decision Layer" icon={<Shield className="h-4 w-4" />}>
          <p>
            Tre profili di rischio che influenzano sia la funzione di costo (simulation layer) 
            sia il ranking finale (decision layer):
          </p>
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
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">degradation</td><td className="text-center">×1.15</td><td className="text-center">×1.00</td><td className="text-center">×0.85</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">traffic</td><td className="text-center">×1.30</td><td className="text-center">×1.00</td><td className="text-center">×0.70</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3">cliff_penalty</td><td className="text-center">0.12</td><td className="text-center">0.06</td><td className="text-center">0.02</td></tr>
                <tr><td className="py-1.5 pr-3">opportunity</td><td className="text-center">×0.80</td><td className="text-center">×1.00</td><td className="text-center">×1.30</td></tr>
              </tbody>
            </table>
          </div>

          <h4 className="font-semibold text-foreground mt-3">Decision Layer (riskAppetite)</h4>
          <p>
            Dopo la simulazione, il modulo <code className="text-primary">riskAppetite</code> applica uno scoring multi-componente 
            per il ranking finale delle strategie. Lo scoring decompone la valutazione in:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Reward</strong> — guadagno stimato dal delta, modulato dall'execution burden</li>
            <li><strong className="text-foreground">Risk Penalty</strong> — penalità da traffico e degrado, pesata per race phase e profilo</li>
            <li><strong className="text-foreground">Execution Penalty</strong> — costi warmup e pit loss, pesati per profilo</li>
            <li><strong className="text-foreground">Neutralization Bonus</strong> — vantaggio da pit sotto SC/VSC</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Execution Burden</h4>
          <p>
            L'<strong className="text-foreground">Execution Burden</strong> misura l'incidenza dei costi operativi 
            (traffico + warmup + degrado) sul tempo totale stimato. Strategie con delta positivo 
            ma costi esecutivi elevati subiscono un <strong className="text-foreground">upside dampening</strong>: 
            il bonus viene ridotto proporzionalmente, specialmente in profilo Conservative.
          </p>
          <p className="text-xs italic">
            Questo impedisce che strategie apparentemente vantaggiose ma con alto rischio esecutivo 
            vengano favorite nel ranking.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Comportamento per profilo</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Conservative</strong> — penalizza di più traffico, degrado e warmup; upside dampening forte; privilegia robustezza</li>
            <li><strong className="text-foreground">Balanced</strong> — pesi neutri su tutti i fattori; compromesso equilibrato</li>
            <li><strong className="text-foreground">Aggressive</strong> — riduce il peso di degrado e traffico; amplifica l'upside; accetta più rischio</li>
          </ul>
        </DocSection>

        <DocSection id="vre-scenarios" title="VRE — Scenari What-If" icon={<Beaker className="h-4 w-4" />}>
          <p>
            Il sistema supporta scenari simulati temporizzati. Ogni scenario modifica 
            i moltiplicatori della funzione di costo <strong className="text-foreground">senza alterare i dati osservati</strong>.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Scenari disponibili</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-foreground">Scenario</th>
                  <th className="text-left py-2 text-foreground">Effetto principale</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Safety Car</td><td>Pit loss ×0.62, traffico ×0.85, opportunità ×1.30</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">VSC</td><td>Pit loss ×0.78, traffico ×0.90, opportunità ×1.15</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Clean Air</td><td>Traffico ×0.12</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Heavy Traffic</td><td>Traffico ×1.55, rischio ×1.15</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Light Rain</td><td>Degrado ×1.10, meteo ×1.35, confidenza -1</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Mixed Conditions</td><td>Degrado ×1.15, meteo ×1.55, confidenza -2</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Tyre Cliff Risk</td><td>Degrado ×1.45, rischio ×1.25</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Late Race Attack</td><td>Degrado ×0.88, posizione ×1.35, rischio ×0.72</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Battle Mode</td><td>Posizione ×1.45, traffico ×1.15</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Undercut</td><td>Traffico ×0.72, degrado ×1.18, posizione ×1.28</td></tr>
                <tr><td className="py-1.5 pr-3 font-medium text-foreground">Overcut</td><td>Degrado ×0.88, rischio ×0.88</td></tr>
              </tbody>
            </table>
          </div>

          <h4 className="font-semibold text-foreground mt-3">Parametri temporali</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Activation Lap</strong> — giro in cui lo scenario diventa attivo</li>
            <li><strong className="text-foreground">Duration</strong> — durata in giri della finestra scenario</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Scenario Engine contestuale</h4>
          <p>
            Lo scenario engine utilizza un modello di scaling <strong className="text-foreground">non-lineare</strong> e contestuale:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Severity</strong> — peso intrinseco dello scenario (quanto è estremo il what-if)</li>
            <li><strong className="text-foreground">Relevance</strong> — copertura della finestra sulla gara totale (scaling sub-lineare √)</li>
            <li><strong className="text-foreground">Feasibility</strong> — uno scenario troppo breve o troppo tardivo ha impatto ridotto</li>
          </ul>
          <p>
            I modifier non vengono applicati in modo rigido ma vengono blendati 
            con il contesto temporale, evitando che scenari estremi producano effetti irrealistici.
          </p>

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
            <li><strong className="text-foreground">Effetto neutralizzazione</strong> — -10s per pit sotto SC/VSC</li>
          </ul>
          <p>
            Ogni componente è codificata con impatto: <strong className="text-foreground" style={{ color: "hsl(142, 70%, 45%)" }}>favorevole</strong>,{" "}
            <strong className="text-foreground">neutro</strong> o <strong className="text-foreground" style={{ color: "hsl(0, 62%, 50%)" }}>penalizzante</strong>.
            I modificatori di scenario e risk mode vengono applicati ai singoli componenti, 
            rendendo visibile quale fattore cambia e di quanto.
          </p>
        </DocSection>

        <DocSection id="vre-verdict" title="VRE — Verdetto e Confidenza" icon={<Target className="h-4 w-4" />}>
          <h4 className="font-semibold text-foreground">Verdetto</h4>
          <p>
            Il delta tra la strategia consigliata e la strategia reale determina il giudizio:
          </p>
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

        {/* ═══════════════════════════════════════════════════════ */}
        <SectionDivider title="Modelli di calcolo" />
        {/* ═══════════════════════════════════════════════════════ */}

        <DocSection id="tyre-degradation" title="Degrado Gomme — Modello a Due Stadi" icon={<TrendingDown className="h-4 w-4" />}>
          <p>
            Il sistema calcola il degrado gomme per ogni stint usando un <strong className="text-foreground">modello 
            di regressione a due stadi</strong> che corregge per effetti confondenti:
          </p>

          <h4 className="font-semibold text-foreground mt-3">Stadio A — Rimozione effetti non-gomma</h4>
          <p>Regressione multivariata dei tempi al giro su variabili centrate:</p>
          <Formula>lap_time = β₀ + β₁·fuel_proxy_centered + β₂·track_temp_centered + β₃·air_temp_centered + residuo</Formula>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">fuel_proxy</strong> — approssimazione del carico carburante tramite <code className="text-primary">laps_remaining = totalLaps - lapNumber</code>. NON è il carico reale</li>
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

          <h4 className="font-semibold text-foreground mt-3">Pipeline di filtraggio (Baseline)</h4>
          <p>Il modulo baseline applica una pipeline in 4 stadi prima della regressione:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong className="text-foreground">Esclusioni strutturali</strong> — pit-out, in-lap (tranne ultimo stint), durate nulle/negative</li>
            <li><strong className="text-foreground">Filtro outlier MAD</strong> — Median Absolute Deviation con moltiplicatore compound-specific (Soft/Medium: 3.0σ, Hard: 3.5σ)</li>
            <li><strong className="text-foreground">Esclusione warmup</strong> — primi giri esclusi se più lenti della mediana (Soft/Medium: 1, Hard: 2)</li>
            <li><strong className="text-foreground">Cliff detection</strong> — giri finali con residui anomali (&gt; 2.0–2.5× RMSE) esclusi dalla regressione</li>
          </ol>

          <h4 className="font-semibold text-foreground mt-3">Profili Compound-Specific</h4>
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
            <Param name="slope_raw" desc="Slope grezza (senza correzione)" />
            <Param name="slope_corrected" desc="Slope corretta dopo rimozione fuel/temp" />
            <Param name="model_type" desc="corrected_two_stage | corrected_fuel_only | simple_fallback" />
            <Param name="r_squared_corrected" desc="R² del modello corretto (Stadio B)" />
            <Param name="rmse" desc="Root Mean Square Error della regressione" />
            <Param name="cliffDetected" desc="Presenza di cliff a fine stint" />
            <Param name="filterSummary" desc="Elenco testuale dei filtri applicati" />
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Fallback</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Se il modello a due stadi non è applicabile → regressione semplice <code className="text-primary">lap_time ~ tyre_life</code></li>
            <li>Se la slope corretta &gt; 0.30 s/giro → si usa la regressione semplice (il modello corretto è implausibile)</li>
          </ul>
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
                <tr className="border-t border-border"><td className="px-3 py-1.5 font-mono text-red-400">SOFT</td><td className="px-3 py-1.5 text-right">-0.01</td><td className="px-3 py-1.5 text-right">0.015</td><td className="px-3 py-1.5 text-right">0.25</td><td className="px-3 py-1.5 text-right">5</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-1.5 font-mono text-yellow-400">MEDIUM</td><td className="px-3 py-1.5 text-right">-0.02</td><td className="px-3 py-1.5 text-right">0.01</td><td className="px-3 py-1.5 text-right">0.20</td><td className="px-3 py-1.5 text-right">6</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-1.5 font-mono text-white">HARD</td><td className="px-3 py-1.5 text-right">-0.025</td><td className="px-3 py-1.5 text-right">0.008</td><td className="px-3 py-1.5 text-right">0.15</td><td className="px-3 py-1.5 text-right">7</td></tr>
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
            Quando almeno uno stint ha degrado <strong style={{ color: "hsl(0, 62%, 50%)" }}>INVALID</strong>, 
            l'utente può inserire un valore personalizzato (0.001–0.300 s/giro, precisione ai millesimi).
            Viene applicato <strong className="text-foreground">solo agli stint INVALID</strong> e il ricalcolo è immediato.
          </p>
        </DocSection>

        <DocSection id="tyre-warmup" title="Modello Tyre Warmup" icon={<Thermometer className="h-4 w-4" />}>
          <p>
            Dopo ogni pit stop, le gomme nuove non sono ancora alla temperatura operativa.
            Il modello simula questa penalità temporanea:
          </p>
          <Formula>warmup_penalty(lap) = base_penalty × exp(-lap_after_pit / decay)</Formula>

          <h4 className="font-semibold text-foreground mt-3">Parametri per compound</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-border rounded">
              <thead>
                <tr className="bg-muted/40">
                  <th className="px-3 py-1.5 text-left font-semibold text-foreground">Compound</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-foreground">Base (s)</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-foreground">Decay</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-foreground">Giri</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border"><td className="px-3 py-1.5 font-mono text-red-400">SOFT</td><td className="px-3 py-1.5 text-right">0.6</td><td className="px-3 py-1.5 text-right">1.2</td><td className="px-3 py-1.5 text-right">2</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-1.5 font-mono text-yellow-400">MEDIUM</td><td className="px-3 py-1.5 text-right">0.9</td><td className="px-3 py-1.5 text-right">1.6</td><td className="px-3 py-1.5 text-right">3</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-1.5 font-mono text-white">HARD</td><td className="px-3 py-1.5 text-right">1.4</td><td className="px-3 py-1.5 text-right">2.2</td><td className="px-3 py-1.5 text-right">4</td></tr>
              </tbody>
            </table>
          </div>

          <h4 className="font-semibold text-foreground mt-3">Integrazione</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Applicato <strong className="text-foreground">solo alle strategie simulate</strong> (non alla strategia reale)</li>
            <li>Il primo stint della gara non ha warmup (gomme calde dal giro di formazione)</li>
            <li>Appare nella breakdown come voce separata "Tyre warmup"</li>
            <li>Influenza undercut/overcut: gomme Hard hanno warmup più lento → undercut meno efficace</li>
            <li>Stint molto corti penalizzati (il warmup pesa proporzionalmente di più)</li>
          </ul>
          <p className="text-xs italic mt-2">
            Il warmup NON è degrado: è una penalità termica temporanea che si esaurisce in pochi giri.
          </p>
        </DocSection>

        <DocSection id="weather-classification" title="Classificazione Meteo" icon={<Cloud className="h-4 w-4" />}>
          <p>
            Ogni giro viene classificato come <strong className="text-foreground">DRY</strong>, 
            <strong className="text-foreground"> WET</strong> o <strong className="text-foreground">MIXED</strong> 
            usando un modello di persistenza del bagnato a <strong className="text-foreground">decadimento esponenziale</strong>.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Logica</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Per ogni giro si apre una finestra temporale che include i campioni meteo</li>
            <li>Se pioggia attiva durante il giro → accumulo di <strong className="text-foreground">persistence score</strong></li>
            <li>Se pioggia cessata → il persistence score decade esponenzialmente nel tempo</li>
            <li>La velocità di asciugatura è modulata dalla <strong className="text-foreground">temperatura pista</strong>:
              <ul className="list-disc pl-5 mt-1">
                <li>Asfalto caldo (&gt; 40°C) → asciugatura accelerata (fino a 1.6×)</li>
                <li>Asfalto freddo (&lt; 25°C) → asciugatura rallentata (0.6×)</li>
              </ul>
            </li>
            <li>Persistence score alto + pioggia diretta → <strong className="text-foreground">WET</strong></li>
            <li>Persistence score medio o pioggia intermittente → <strong className="text-foreground">MIXED</strong></li>
            <li>Nessuna pioggia e persistence bassa → <strong className="text-foreground">DRY</strong></li>
          </ul>
          <p className="text-xs italic">
            Utilizzata dal VRE per escludere giri bagnati dalle stime di degrado e per classificare le fasi di gara.
          </p>
        </DocSection>

        <DocSection id="track-status" title="Classificazione Track Status" icon={<Flag className="h-4 w-4" />}>
          <p>
            I messaggi di Race Control vengono analizzati per classificare ogni giro:
          </p>
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

        <DocSection id="traffic-predictor" title="Traffic Predictor" icon={<Target className="h-4 w-4" />}>
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
          <p>
            Rileva episodi di battaglia ravvicinata analizzando intervalli e posizioni:
          </p>
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
          <p>
            Nelle prove libere, identifica le simulazioni di gara (long run) all'interno degli stint:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Lunghezza</strong> — ≥ 8 giri: +30pt, ≥ 6: +20pt</li>
            <li><strong className="text-foreground">Regolarità</strong> — std &lt; 0.5s: +25pt</li>
            <li><strong className="text-foreground">Trend degrado</strong> — slope positiva 0–0.2 s/giro: +20pt</li>
            <li><strong className="text-foreground">Push lap penalty</strong> — giri &lt; 99% mediana: -25pt</li>
          </ul>
          <p>Score ≥ 40 → long run valido. I modelli di degrado dalle FP vengono usati dal VRE come riferimento per mescole non usate in gara.</p>
        </DocSection>

        <DocSection id="scenario-engine" title="Scenario Engine — Dettaglio tecnico" icon={<Settings className="h-4 w-4" />}>
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

          <h4 className="font-semibold text-foreground mt-3">Scaling non-lineare</h4>
          <Formula>effective_scale = raw_scale × 0.5 + (raw_scale × relevance × feasibility) × 0.5</Formula>
          <p>
            Lo scaling usa curve di potenza: scenari brevi hanno impatto localizzato, 
            scenari lunghi hanno effetto più stabile ma sub-lineare, 
            scenari tardivi hanno effetto ridotto ma non nullo.
          </p>

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
          </ol>
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
