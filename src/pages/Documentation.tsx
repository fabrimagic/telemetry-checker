import { Link } from "react-router-dom";
import {
  ArrowLeft, BookOpen, BarChart3, Gauge, Brain, Cloud, Flag, Swords,
  TrendingDown, Timer, Shield, Target, Layers, ChevronDown, Play, Users,
  Map, Activity, Thermometer, Wrench, Eye, LayoutDashboard, Settings,
  Info, Lightbulb, Navigation, FlaskConical, ArrowRight, Trophy,
  CalendarClock, Beaker, Route,
} from "lucide-react";
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

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground/90 flex gap-2">
      <Lightbulb className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
      <span>{children}</span>
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
          <h1 className="text-lg font-bold tracking-tight">Guida all'uso di PitWall AI</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-4">

        {/* INTRO */}
        <div className="bg-card rounded-lg border border-border p-5 space-y-3">
          <p className="text-foreground font-semibold text-lg">Benvenuto in PitWall AI</p>
          <p className="text-sm text-muted-foreground">
            PitWall AI è uno strumento di analisi e simulazione strategica per la Formula 1.
            Permette di rivedere ogni gara con gli occhi di un ingegnere di pista: tempi al giro,
            telemetria, gomme, strategia, sorpassi, meteo, decisioni chiave e confronto diretto
            tra due piloti.
          </p>
          <p className="text-sm text-muted-foreground">
            Questa guida ti mostra a cosa serve ogni schermata e ogni card, così puoi orientarti
            rapidamente. Non è un manuale tecnico: per i dettagli sui modelli di calcolo trovi
            riferimenti puntuali alla fine.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="text-[10px] px-2 py-1 rounded bg-muted border border-border text-muted-foreground">Dati ufficiali</span>
            <span className="text-[10px] px-2 py-1 rounded bg-muted border border-border text-muted-foreground">Analisi gara</span>
            <span className="text-[10px] px-2 py-1 rounded bg-muted border border-border text-muted-foreground">Confronto piloti</span>
            <span className="text-[10px] px-2 py-1 rounded bg-muted border border-border text-muted-foreground">Strategia</span>
          </div>
        </div>

        {/* TABLE OF CONTENTS */}
        <div className="bg-card rounded-lg border border-border p-5 space-y-4">
          <p className="text-foreground font-semibold flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            Indice
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-2 mb-2 pb-1.5 border-b border-border/60">Per iniziare</p>
              <TocLink href="#getting-started">Come iniziare</TocLink>
              <TocLink href="#navigation">Navigazione tra le sezioni</TocLink>
              <TocLink href="#countdown">Conto alla rovescia prossima gara</TocLink>
              <TocLink href="#championship-summary">Mini classifica Mondiale</TocLink>
              <TocLink href="#weekend-weather">Meteo del weekend</TocLink>
              <TocLink href="#fullgas-feed">Dal Full Gas Blog</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Analisi singolo pilota</p>
              <TocLink href="#single-driver-flow">Flusso analisi singolo pilota</TocLink>
              <TocLink href="#driver-cockpit">Cockpit pilota</TocLink>
              <TocLink href="#session-report">Report Sessione</TocLink>
              <TocLink href="#lap-times-chart">Grafico Tempi al Giro</TocLink>
              <TocLink href="#lap-table">Tabella Giri</TocLink>
              <TocLink href="#telemetry">Telemetria & Track Map</TocLink>
              <TocLink href="#telemetry-compare">Confronto telemetria miglior giro</TocLink>
              <TocLink href="#sectors">Settori e Mini-Settori</TocLink>
              <TocLink href="#driving-analysis">Analisi di Guida</TocLink>
              <TocLink href="#weather-card">Meteo</TocLink>
              <TocLink href="#lap-precip-outlook">Outlook pioggia per giro</TocLink>
              <TocLink href="#stints">Stint</TocLink>
              <TocLink href="#pit-stops">Pit Stop</TocLink>
              <TocLink href="#pit-stops-chart">Pit Stop: grafico comparativo</TocLink>
              <TocLink href="#overtakes">Sorpassi</TocLink>
              <TocLink href="#race-diary">Diario di Gara</TocLink>
              <TocLink href="#cumulative-deviation">Deviazione Cumulativa</TocLink>
              <TocLink href="#sector-vs-winner">Confronto Settori vs Vincitore</TocLink>
              <TocLink href="#performance-radar">Radar prestazioni</TocLink>
              <TocLink href="#mini-charts">Mini-grafici (Posizione, Gap, Intervallo)</TocLink>
              <TocLink href="#event-timeline">Timeline Eventi del Pilota</TocLink>
              <TocLink href="#tyre-degradation-card">Degrado Gomme</TocLink>
              <TocLink href="#key-decision-moments">Key Decision Moments</TocLink>
              <TocLink href="#soft-sensors">Soft Sensors (Termico / Stress / Grip)</TocLink>
              <TocLink href="#soft-sensors-timeline">Soft Sensors: timeline gara</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Dashboard sessione</p>
              <TocLink href="#practice-overview">Dashboard Prove Libere</TocLink>
              <TocLink href="#qualifying-overview">Dashboard Qualifica / Sprint Qualifica</TocLink>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-2 mb-2 pb-1.5 border-b border-border/60">Virtual Race Engineer</p>
              <TocLink href="#vre-overview">Cos'è il Virtual Race Engineer</TocLink>
              <TocLink href="#vre-setup">Pannello di Setup</TocLink>
              <TocLink href="#vre-analysis-modes">Race Engineer vs Post-Race</TocLink>
              <TocLink href="#vre-view-modes">Modalità di lettura (Engineer / Strategist / Storyteller / Skeptic)</TocLink>
              <TocLink href="#vre-risk-mode">Profilo di rischio</TocLink>
              <TocLink href="#vre-scenarios">Scenari What-If</TocLink>
              <TocLink href="#vre-intent">Intent della strategia</TocLink>
              <TocLink href="#vre-traffic">Traffico in pit-out</TocLink>
              <TocLink href="#vre-verdict">Verdetto e confidenza</TocLink>
              <TocLink href="#vre-narrative">Capitoli narrativi</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Head-to-Head</p>
              <TocLink href="#h2h-overview">Cos'è il confronto Head-to-Head</TocLink>
              <TocLink href="#h2h-flow">Come avviare un confronto</TocLink>
              <TocLink href="#h2h-cards">Le card del confronto</TocLink>
              <TocLink href="#h2h-duel-insight">Tradeoff passo vs posizione</TocLink>
              <TocLink href="#h2h-alternative">Strategie alternative & controfattuali</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Altre sezioni</p>
              <TocLink href="#championship-page">Mondiale Piloti & Costruttori</TocLink>
              <TocLink href="#pre-race">Analisi Pre-Gara</TocLink>
              <TocLink href="#gp-preview">Anteprima GP (affinità circuito)</TocLink>

              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-5 mb-2 pb-1.5 border-b border-border/60">Buono a sapersi</p>
              <TocLink href="#data-source">Fonte dei dati</TocLink>
              <TocLink href="#caching">Caching & limiti delle richieste</TocLink>
              <TocLink href="#anti-hallucination">Trasparenza e anti-allucinazione</TocLink>
              <TocLink href="#faq">FAQ rapide</TocLink>
            </div>
          </div>
        </div>

        {/* ───────────── PER INIZIARE ───────────── */}
        <SectionDivider title="Per iniziare" />

        <DocSection id="getting-started" title="Come iniziare" icon={<Play className="h-4 w-4" />} defaultOpen>
          <p>L'app si usa in pochi passi:</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <strong className="text-foreground">Scegli la modalità</strong> dalla home: <em>Analisi Singolo Pilota</em>
              per studiare in dettaglio un pilota, oppure <em>Head-to-Head</em> per confrontare due piloti
              della stessa gara.
            </li>
            <li>
              <strong className="text-foreground">Seleziona la sessione</strong> tramite anno, gran premio e tipo
              (Prove Libere, Qualifica, Sprint, Gara). Le sessioni vengono caricate automaticamente.
            </li>
            <li>
              <strong className="text-foreground">Seleziona il pilota</strong> (o i due piloti, in modalità Head-to-Head)
              dall'elenco con nome, sigla e colore del team.
            </li>
            <li>
              <strong className="text-foreground">Esplora i dati</strong>: le card di analisi si popolano automaticamente.
              Per le gare vengono attivati anche il Virtual Race Engineer, il diario di gara e i Key Decision Moments.
            </li>
          </ol>
          <Tip>
            Vuoi cambiare gara o ricominciare? Usa il pulsante <strong>Reset</strong> in alto a destra.
            Per cambiare modalità senza reset, usa <em>Cambia modalità</em> sotto il selettore di sessione.
          </Tip>
        </DocSection>

        <DocSection id="navigation" title="Navigazione tra le sezioni" icon={<Route className="h-4 w-4" />}>
          <p>L'header in alto contiene scorciatoie verso le sezioni principali:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">⚔︎ H2H</strong> — apre la modalità Head-to-Head per confrontare due piloti.</li>
            <li><strong className="text-foreground">🏆 Mondiale</strong> — apre la pagina con le classifiche Piloti e Costruttori e l'elenco delle gare disputate.</li>
            <li><strong className="text-foreground">📖 Docs</strong> — apre questa guida.</li>
            <li><strong className="text-foreground">Reset</strong> — appare quando una sessione è caricata: svuota la selezione e torna alla home.</li>
          </ul>
          <p>
            Sono disponibili anche due pagine dedicate al weekend di gara:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong className="text-foreground">Analisi Pre-Gara</strong> (<code className="text-primary">/pre-race</code>) — usa i long run delle libere
              e la qualifica per stimare chi avrà il passo migliore in gara.
            </li>
            <li>
              <strong className="text-foreground">Anteprima GP</strong> (<code className="text-primary">/anteprima-gp</code>) — stima l'<em>affinità</em>
              di ogni team con il circuito del prossimo Gran Premio incrociando il profilo del tracciato con il profilo della vettura.
            </li>
          </ul>
        </DocSection>

        <DocSection id="countdown" title="Conto alla rovescia prossima gara" icon={<CalendarClock className="h-4 w-4" />}>
          <p>
            In cima alla home, quando rilevante, compare un banner con il <strong className="text-foreground">conto alla rovescia</strong>
            verso la prossima gara del calendario. Serve a orientarti rapidamente: gran premio, data e tempo
            mancante all'inizio della sessione di gara.
          </p>
        </DocSection>

        <DocSection id="championship-summary" title="Mini classifica Mondiale" icon={<Trophy className="h-4 w-4" />}>
          <p>
            Sulla home, accanto al selettore di sessione, è presente una <strong className="text-foreground">card riassuntiva</strong>
            con le prime posizioni del Mondiale Piloti e Costruttori della stagione in corso. È una vista
            rapida: per la classifica completa apri la pagina <strong className="text-foreground">Mondiale</strong>.
          </p>
          <Tip>I dati vengono cachati lato browser per non sovraccaricare i server e per caricare la home più velocemente nelle visite successive.</Tip>
        </DocSection>

        <DocSection id="weekend-weather" title="Meteo del weekend" icon={<Cloud className="h-4 w-4" />}>
          <p>
            Una card sulla home mostra le <strong className="text-foreground">previsioni meteo</strong> per le sessioni del prossimo weekend di gara:
            temperatura, probabilità di pioggia e condizioni generali per ciascuna sessione (Prove Libere, Qualifica, Sprint, Gara).
            Serve a inquadrare in anticipo possibili scenari bagnato/asciutto.
          </p>
        </DocSection>

        <DocSection id="fullgas-feed" title="Dal Full Gas Blog" icon={<BookOpen className="h-4 w-4" />}>
          <p>
            In fondo alla home trovi gli <strong className="text-foreground">ultimi tre articoli di Formula 1</strong> pubblicati sul blog
            <em> Full Gas</em>, con titolo, data e breve estratto. Cliccando sul titolo apri l'articolo originale in una nuova scheda.
            La sezione si aggiorna automaticamente e usa una cache locale per evitare richieste eccessive.
          </p>
        </DocSection>

        {/* ───────────── ANALISI SINGOLO PILOTA ───────────── */}
        <SectionDivider title="Analisi singolo pilota" />

        <DocSection id="single-driver-flow" title="Flusso analisi singolo pilota" icon={<Users className="h-4 w-4" />} defaultOpen>
          <p>
            Una volta selezionata la sessione e il pilota, hai due viste affiancate da una linguetta:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong className="text-foreground">Analisi Pilota</strong> — focus sul pilota selezionato:
              tempi al giro, telemetria, gomme, stint, pit stop, sorpassi, diario di gara, decisioni chiave,
              soft sensors e Virtual Race Engineer.
            </li>
            <li>
              <strong className="text-foreground">Report Sessione</strong> — vista d'insieme dell'intera sessione,
              non legata a un pilota specifico.
            </li>
          </ul>
          <p>Per le sessioni di Prove Libere alcune card (es. Pit stop, Sorpassi, VRE) non sono disponibili: in quei casi l'app mostra solo ciò che ha senso analizzare.</p>
        </DocSection>

        <DocSection id="driver-cockpit" title="Cockpit pilota" icon={<Gauge className="h-4 w-4" />}>
          <p>
            In cima all'analisi singolo pilota, il <strong className="text-foreground">Cockpit</strong> riassume in un colpo d'occhio
            chi stai analizzando: foto del pilota con bordo nel colore del team, sigla, numero, scuderia, posizione finale
            (o di partenza per qualifica/sprint), miglior giro della sessione e i suoi tre settori, mescola del miglior giro
            e numero di giri completati. È pensato come "intestazione" della dashboard del pilota.
          </p>
        </DocSection>

        <DocSection id="session-report" title="Report Sessione" icon={<LayoutDashboard className="h-4 w-4" />}>
          <p>
            Il <strong className="text-foreground">Report Sessione</strong> è una panoramica di tutto ciò che è successo
            durante la sessione: timeline meteo, finestre di Safety Car / VSC / bandiere, ordine d'arrivo o classifica,
            stint principali. È pensato per orientarti prima di entrare nel dettaglio di un singolo pilota.
          </p>
        </DocSection>

        <DocSection id="lap-times-chart" title="Grafico Tempi al Giro" icon={<BarChart3 className="h-4 w-4" />}>
          <p>
            Mostra l'andamento dei tempi al giro del pilota lungo l'intera sessione, con colori per mescola
            e bande di sfondo per le condizioni meteo e per le neutralizzazioni (Safety Car, VSC, bandiera rossa).
          </p>
          <p>I giri molto lenti rispetto al passo di riferimento (outlier) vengono filtrati graficamente per non distorcere la lettura, ma restano accessibili nella tabella giri sottostante.</p>
          <Tip>Clicca un giro nel grafico per caricare la <strong>telemetria di quel giro</strong> (velocità, freni, acceleratore, marcia, RPM).</Tip>
        </DocSection>

        <DocSection id="lap-table" title="Tabella Giri" icon={<Timer className="h-4 w-4" />}>
          <p>
            Sotto al grafico trovi la tabella con tutti i giri: numero, tempo, settori, mescola e flag (giro
            in uscita pit, giro fuori dal limite di tempo, ecc.). Ti permette di scegliere manualmente un giro
            su cui caricare la telemetria.
          </p>
        </DocSection>

        <DocSection id="telemetry" title="Telemetria & Track Map" icon={<Gauge className="h-4 w-4" />}>
          <p>
            Per il giro selezionato, l'app carica i dati telemetrici ad alta frequenza:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Velocità</strong> — andamento lungo il giro</li>
            <li><strong className="text-foreground">Acceleratore e Freno</strong> — input pilota</li>
            <li><strong className="text-foreground">Marcia inserita</strong></li>
            <li><strong className="text-foreground">RPM motore</strong></li>
          </ul>
          <p>
            La <strong className="text-foreground">Track Map</strong> visualizza il tracciato come ricostruito dai dati GPS,
            con un cursore mobile sincronizzato con i grafici telemetrici: spostando il cursore nei grafici, il punto
            sulla mappa si muove di conseguenza, e viceversa.
          </p>
        </DocSection>

        <DocSection id="sectors" title="Settori e Mini-Settori" icon={<Map className="h-4 w-4" />}>
          <p>
            Visualizza il tempo dei tre settori del giro e un'analisi a <strong className="text-foreground">mini-settori</strong>
            che mostra dove il pilota guadagna o perde rispetto al riferimento (best del pilota o best della sessione).
            I codici colore rispettano lo standard F1: viola = miglior tempo, verde = personal best, giallo = più lento.
          </p>
        </DocSection>

        <DocSection id="driving-analysis" title="Analisi di Guida" icon={<Activity className="h-4 w-4" />}>
          <p>
            Identifica e quantifica due comportamenti di guida significativi, calcolati dalla telemetria del giro selezionato:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong className="text-foreground">Superclipping</strong> — un <em>episodio</em> inizia quando la velocità
              della vettura diminuisce nonostante l'acceleratore sia oltre il 95%, e dura fino a quando il pilota tocca
              il freno oppure la velocità torna a salire. Durante un episodio l'acceleratore può anche scendere
              temporaneamente sotto la soglia senza interromperlo: a chiudere l'episodio sono solo la frenata o la
              ripresa di velocità. Nel <strong className="text-foreground">regolamento F1 2026</strong>, con la maggiore
              componente elettrica della power unit e una gestione più complessa del dispiegamento dell'ERS, il
              <em> clipping</em> — l'esaurimento dell'erogazione elettrica a fine rettilineo — diventa un fenomeno più
              frequente e rilevante da osservare giro per giro.
            </li>
            <li>
              <strong className="text-foreground">Lift &amp; Coast</strong> — si verifica quando il pilota passa da
              acceleratore superiore al 90% e freno a 0% ad acceleratore a 0% e freno a 0%; termina non appena uno dei
              due pedali viene premuto, anche solo leggermente. È una tecnica di <em>gestione</em>: risparmio
              carburante, raffreddamento freni, controllo della temperatura gomme. Nel <strong className="text-foreground">2026</strong>{" "}
              la rilevanza cresce ulteriormente perché la gestione dell'energia (recupero e dispiegamento elettrico)
              rende il lift &amp; coast uno strumento abituale di pianificazione del giro.
            </li>
          </ul>
          <p>Per ogni zona vengono mostrati il numero di episodi e la durata totale nel giro selezionato.</p>
          <p className="mt-2">
            Nelle sessioni di Gara e Sprint, con la vista pilota-singolo, il pulsante{" "}
            <strong className="text-foreground">Confronta con media gara</strong> scarica la telemetria di tutti i giri
            comparabili (verdi, esclusi pit-out e pit-in) e mostra due grafici timeline allineati sull'asse dei giri:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong className="text-foreground">Superclipping &amp; Lift &amp; Coast per giro</strong> — barre con la
              durata (in secondi) dei due fenomeni per ciascun giro comparabile.
            </li>
            <li>
              <strong className="text-foreground">Deviazione cumulativa</strong> — il distacco cumulato del pilota
              rispetto al ritmo del vincitore, giro per giro.
            </li>
          </ul>
          <p className="mt-2">
            I due grafici condividono lo stesso asse dei giri proprio per facilitare la lettura di{" "}
            <em>coincidenze</em> temporali. Tuttavia <strong className="text-foreground">correlazione non implica
            causalità</strong>: un picco di lift &amp; coast o superclipping in concomitanza con un aumento del distacco
            può dipendere da traffico, neutralizzazioni, scelte di gestione o strategia. Il confronto è uno spunto di
            esplorazione, non una prova.
          </p>
        </DocSection>

        <DocSection id="weather-card" title="Meteo" icon={<Cloud className="h-4 w-4" />}>
          <p>
            Riassume le condizioni meteo della sessione: temperatura aria e pista, umidità, pressione, vento,
            indicazione di pioggia. La timeline mostra come queste grandezze sono cambiate nel corso della sessione.
          </p>
        </DocSection>

        <DocSection id="stints" title="Stint" icon={<Activity className="h-4 w-4" />}>
          <p>
            Elenca tutti gli stint del pilota con mescola (Soft / Medium / Hard / Intermediate / Wet),
            età iniziale della gomma, giri coperti e durata. È la base per leggere strategia e degrado.
          </p>
        </DocSection>

        <DocSection id="pit-stops" title="Pit Stop" icon={<Wrench className="h-4 w-4" />}>
          <p>
            Mostra tutti i pit stop del pilota con il giro, la durata della sosta vera e propria e il tempo totale
            in pit lane. È disponibile solo nelle sessioni di Gara e Sprint.
          </p>
        </DocSection>

        <DocSection id="overtakes" title="Sorpassi" icon={<Swords className="h-4 w-4" />}>
          <p>
            Elenco dei sorpassi <strong className="text-foreground">effettuati</strong> e <strong className="text-foreground">subiti</strong> dal pilota,
            con giro, posizione e avversario coinvolto. Permette di capire come il pilota ha guadagnato o perso terreno
            in pista (al netto delle variazioni dovute a pit stop e neutralizzazioni).
          </p>
        </DocSection>

        <DocSection id="race-diary" title="Diario di Gara" icon={<BookOpen className="h-4 w-4" />}>
          <p>
            Il <strong className="text-foreground">Diario di Gara</strong> è un riassunto cronologico degli eventi del pilota
            in stile commento radio: pit stop, sorpassi, problemi, neutralizzazioni, finestre strategiche.
            Eventi ravvicinati nel tempo vengono raggruppati in <strong className="text-foreground">episodi</strong> per leggibilità.
          </p>
        </DocSection>

        <DocSection id="cumulative-deviation" title="Deviazione Cumulativa" icon={<TrendingDown className="h-4 w-4" />}>
          <p>
            Mostra il <strong className="text-foreground">passo del pilota rispetto al vincitore</strong> della gara, accumulato giro dopo giro.
            È un modo intuitivo per vedere dove il pilota ha guadagnato o perso tempo rispetto al riferimento di gara.
            Per definizione il vincitore ha sempre deviazione zero.
          </p>
        </DocSection>

        <DocSection id="sector-vs-winner" title="Confronto Settori vs Vincitore" icon={<Map className="h-4 w-4" />}>
          <p>
            Tre riquadri compatti (S1 / S2 / S3) confrontano il tempo <strong className="text-foreground">mediano</strong>{" "}
            del pilota selezionato in ciascun settore con quello del <strong className="text-foreground">vincitore</strong> della gara.
            Per ogni settore vedi una <strong className="text-foreground">barra del delta</strong> (verde se più veloce, rossa se più lento)
            e una <strong className="text-foreground">fascia di consistenza</strong> (±1σ) che indica quanto i giri del pilota sono regolari tra loro.
          </p>
          <p>
            Sotto i tre riquadri trovi una <strong className="text-foreground">legenda espandibile</strong>
            (&laquo;Cosa mostra il grafico&raquo;) che spiega in linguaggio semplice il significato di barra, fascia e mediana.
          </p>
          <p className="text-xs italic">
            È disponibile solo per Gara e Sprint. Il confronto esclude giri sotto Safety Car / VSC / bandiera rossa e gli outlier;
            se i giri puliti sono pochi (&lt; 5), il riquadro viene mostrato sbiadito per segnalare la minore affidabilità del dato.
          </p>
        </DocSection>

        <DocSection id="mini-charts" title="Mini-grafici (Posizione, Gap, Intervallo)" icon={<BarChart3 className="h-4 w-4" />}>
          <p>
            Una griglia di mini-grafici sotto la sezione cockpit riassume la dinamica di gara del pilota giro per giro:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Posizione in pista</strong> — andamento della posizione classifica.</li>
            <li><strong className="text-foreground">Gap dal leader</strong> — distacco progressivo dal leader della gara.</li>
            <li>
              <strong className="text-foreground">Intervallo dal pilota davanti</strong> — distacco dal pilota immediatamente
              davanti in quel momento. Passando il mouse su un punto, il tooltip mostra anche{" "}
              <strong className="text-foreground">chi era quel pilota</strong> (acronimo). Se il pilota davanti cambia tra un giro
              e l'altro (es. dopo un sorpasso), il tooltip riflette il pilota corretto in ciascun punto. Se il pilota è leader,
              non viene mostrato alcun nome.
            </li>
          </ul>
          <p className="text-xs italic">È disponibile solo per Gara e Sprint.</p>
        </DocSection>

        <DocSection id="event-timeline" title="Timeline Eventi del Pilota" icon={<Activity className="h-4 w-4" />}>
          <p>
            Una <strong className="text-foreground">timeline orizzontale</strong> mostra gli eventi del pilota selezionato
            distribuiti lungo i giri della gara: pit stop, sorpassi (effettuati e subiti), neutralizzazioni
            (Safety Car / VSC / bandiera rossa), penalità e altri messaggi di Race Control che riguardano direttamente il pilota.
          </p>
          <p>
            Ogni tipo di evento ha un'icona e un colore dedicati; eventi vicini nello stesso giro sono raggruppati per evitare sovrapposizioni.
            Passando il mouse su un'icona compare un tooltip con la descrizione e il giro. Una legenda riporta le categorie mostrate.
          </p>
          <p className="text-xs italic">
            La timeline riusa gli stessi eventi del <em>Diario di Gara</em>: nessun dato viene inventato, è una vista alternativa sintetica.
            È disponibile solo per Gara e Sprint.
          </p>
        </DocSection>



        <DocSection id="tyre-degradation-card" title="Degrado Gomme" icon={<TrendingDown className="h-4 w-4" />}>
          <p>
            Per ogni stint, la card mostra:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Il <strong className="text-foreground">degrado stimato</strong> (quanto la gomma rallenta giro dopo giro).</li>
            <li>La <strong className="text-foreground">qualità del fit</strong> (quanto il modello è affidabile per quello stint).</li>
            <li>Eventuali <strong className="text-foreground">avvertenze</strong> quando i segnali non sono coerenti (es. stint troppo corto, troppi outlier, neutralizzazioni).</li>
          </ul>
          <p>Nelle gare il modello tiene conto anche del <em>carburante che diminuisce</em>, in modo da non confondere "macchina che si alleggerisce" con "gomma che migliora".</p>
          <p className="text-xs italic border-l-2 border-primary/40 pl-3">
            Per gli stint con gomme da bagnato (<strong className="text-foreground">Intermediate</strong> o <strong className="text-foreground">Wet</strong>) le metriche
            di degrado non vengono mostrate: il modello è calibrato sulle mescole da asciutto e una stima su gomme da bagnato sarebbe poco affidabile.
            In quei casi, al posto del numero, compare un avviso esplicito.
          </p>
        </DocSection>

        <DocSection id="key-decision-moments" title="Key Decision Moments" icon={<Target className="h-4 w-4" />}>
          <p>
            Identifica i <strong className="text-foreground">momenti decisionali</strong> della gara per il pilota: brevi finestre
            (1–3 giri) in cui una scelta strategica cambia in modo significativo l'esito (es. rispondere a un undercut,
            sfruttare una Safety Car, allungare lo stint per un'opportunità di traffico).
          </p>
          <p>Ogni momento mostra il contesto, le opzioni disponibili e cosa è effettivamente successo.</p>
        </DocSection>

        <DocSection id="soft-sensors" title="Soft Sensors (Termico / Stress / Grip)" icon={<Thermometer className="h-4 w-4" />}>
          <p>
            I <strong className="text-foreground">Soft Sensors</strong> stimano in modo prudente lo stato latente di tre fattori
            non misurati direttamente:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Termico</strong> — quanto la gomma è in finestra di temperatura.</li>
            <li><strong className="text-foreground">Stress</strong> — quanto la gomma è sollecitata in quello stint.</li>
            <li><strong className="text-foreground">Grip</strong> — qualità della pista (gommatura, evoluzione, contaminazione).</li>
          </ul>
          <p>Sono indicatori qualitativi (basso / medio / alto / sconosciuto), non valori fisici assoluti, e supportano la lettura strategica senza mai sostituirla.</p>
        </DocSection>

        {/* ───────────── VIRTUAL RACE ENGINEER ───────────── */}
        <SectionDivider title="Virtual Race Engineer (VRE)" />

        <DocSection id="vre-overview" title="Cos'è il Virtual Race Engineer" icon={<Brain className="h-4 w-4" />} defaultOpen>
          <p>
            Il <strong className="text-foreground">Virtual Race Engineer</strong> è il modulo strategico di PitWall AI.
            Prende tutti i dati della gara (passo, gomme, meteo, traffico, neutralizzazioni, posizioni) e
            risponde a una domanda concreta: <em>la strategia eseguita è stata quella giusta?</em>
          </p>
          <p>Restituisce un verdetto, una stima della strategia alternativa migliore e una narrativa che spiega il "perché". È disponibile solo per sessioni di Gara e Sprint.</p>
        </DocSection>

        <DocSection id="vre-setup" title="Pannello di Setup" icon={<Settings className="h-4 w-4" />}>
          <p>
            La <strong className="text-foreground">VRE Setup card</strong>, sempre visibile a fianco delle analisi, ti permette
            di configurare in tempo reale come il VRE deve ragionare:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Modalità di analisi</strong> (Race Engineer ex-ante / Post-Race ex-post)</li>
            <li><strong>Modalità di lettura</strong> (Engineer / Strategist / Storyteller / Skeptic)</li>
            <li><strong>Profilo di rischio</strong> (Conservative / Balanced / Aggressive)</li>
            <li><strong>Scenari What-If</strong> (Safety Car virtuale, pioggia, problemi tecnici…)</li>
            <li>Eventuali <strong>override del degrado</strong> per testare ipotesi alternative</li>
          </ul>
          <p>Ogni cambio ricalcola subito verdetto e narrativa, senza bisogno di ricaricare la pagina.</p>
        </DocSection>

        <DocSection id="vre-analysis-modes" title="Race Engineer (ex-ante) vs Post-Race (ex-post)" icon={<Eye className="h-4 w-4" />}>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong className="text-foreground">Race Engineer (ex-ante)</strong> — Ragiona come se fossi sul muretto durante la gara,
              con le sole informazioni disponibili al momento di ogni decisione. Risponde alla domanda
              <em> "data l'incertezza del momento, era una buona scelta?"</em>.
            </li>
            <li>
              <strong className="text-foreground">Post-Race (ex-post)</strong> — Ragiona col senno di poi, sapendo come è andata davvero
              la gara. Risponde alla domanda <em>"con quello che sappiamo adesso, qual era l'opzione migliore?"</em>.
            </li>
          </ul>
        </DocSection>

        <DocSection id="vre-view-modes" title="Modalità di lettura" icon={<Brain className="h-4 w-4" />}>
          <p>Il VRE può raccontare lo stesso risultato con tagli diversi:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Engineer</strong> — sintetico, tecnico, focalizzato sui numeri.</li>
            <li><strong className="text-foreground">Strategist</strong> — focalizzato su scelte, alternative e trade-off.</li>
            <li><strong className="text-foreground">Storyteller</strong> — racconto narrativo, in prosa, adatto alla lettura.</li>
            <li><strong className="text-foreground">Skeptic</strong> — mette in evidenza i limiti del modello e le incertezze.</li>
          </ul>
        </DocSection>

        <DocSection id="vre-risk-mode" title="Profilo di rischio" icon={<Shield className="h-4 w-4" />}>
          <p>Tre profili che cambiano la "personalità" del VRE quando valuta una scelta strategica:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Conservative</strong> — preferisce la sicurezza, evita scommesse.</li>
            <li><strong className="text-foreground">Balanced</strong> (default) — bilancia rischio e rendimento atteso.</li>
            <li><strong className="text-foreground">Aggressive</strong> — accetta più rischio per inseguire un upside maggiore.</li>
          </ul>
        </DocSection>

        <DocSection id="vre-scenarios" title="Scenari What-If" icon={<FlaskConical className="h-4 w-4" />}>
          <p>
            Permettono di rispondere a domande del tipo <em>"e se fosse uscita una Safety Car al giro 28?"</em> o
            <em> "e se avesse iniziato a piovere a metà gara?"</em>. Selezioni lo scenario, il giro di innesco e la durata,
            e il VRE ricalcola verdetto e strategia alternativa nel mondo simulato.
          </p>
        </DocSection>

        <DocSection id="vre-intent" title="Intent della strategia" icon={<Target className="h-4 w-4" />}>
          <p>
            Accanto alla strategia attuale, a quella consigliata e alle alternative simulate, può comparire un piccolo badge
            che ne descrive l'<strong className="text-foreground">intento</strong>:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Attack</strong> — orientata a guadagnare posizioni (es. provare l'undercut su chi sta davanti).</li>
            <li><strong className="text-foreground">Defense</strong> — orientata a difendersi da un avversario dietro che minaccia il sorpasso o un overcut.</li>
            <li><strong className="text-foreground">Optimal</strong> — la scelta più efficiente in assoluto sul piano del tempo, indipendentemente dai vicini.</li>
            <li><strong className="text-foreground">Neutral</strong> — nessuna pressione competitiva chiara nei dintorni.</li>
          </ul>
          <p>L'intento è una <em>lettura interpretativa</em>, non una certezza: serve a capire "perché" una strategia ha quella forma.</p>
        </DocSection>

        <DocSection id="vre-traffic" title="Traffico in pit-out" icon={<Navigation className="h-4 w-4" />}>
          <p>
            Quando il VRE valuta una sosta, prova anche a stimare cosa il pilota avrebbe trovato uscendo dai box:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Clean</strong> — pista libera davanti, niente da superare nei primi giri.</li>
            <li><strong className="text-foreground">Traffic</strong> — uno o due piloti più lenti davanti, da gestire.</li>
            <li><strong className="text-foreground">Pack</strong> — gruppetto serrato davanti, con probabile perdita di tempo.</li>
          </ul>
          <p>È una stima qualitativa basata sulle posizioni e sui distacchi al momento dell'eventuale rientro.</p>
        </DocSection>

        <DocSection id="vre-verdict" title="Verdetto e confidenza" icon={<Target className="h-4 w-4" />}>
          <p>
            Il VRE chiude con un <strong className="text-foreground">verdetto</strong>: la strategia eseguita è stata
            <em> ottima, accettabile, sub-ottimale</em> o <em>peggiore di un'alternativa chiara</em>. Affianca un
            <strong className="text-foreground"> livello di confidenza</strong> (basso / medio / alto) che riflette
            quanto i dati supportano davvero il giudizio.
          </p>
          <p>Quando la confidenza è bassa, il verdetto viene presentato con cautela e non viene mai presentato come una certezza.</p>
        </DocSection>

        <DocSection id="vre-narrative" title="Capitoli narrativi" icon={<BookOpen className="h-4 w-4" />}>
          <p>
            Il VRE produce una narrativa strutturata in capitoli (apertura, gestione gomme, decisioni chiave,
            chiusura), con varianti linguistiche per evitare ripetizioni. La narrativa non inventa eventi:
            ogni passaggio è ancorato a dati osservati o a inferenze esplicite.
          </p>
        </DocSection>

        {/* ───────────── HEAD-TO-HEAD ───────────── */}
        <SectionDivider title="Head-to-Head" />

        <DocSection id="h2h-overview" title="Cos'è il confronto Head-to-Head" icon={<Users className="h-4 w-4" />} defaultOpen>
          <p>
            La modalità <strong className="text-foreground">Head-to-Head</strong> mette due piloti della stessa gara
            (Race o Sprint) uno di fianco all'altro e li confronta su passo, gomme, strategia, contesto e narrativa.
            È pensata per rispondere a domande come <em>"perché A è arrivato davanti a B?"</em> o
            <em>"chi ha gestito meglio la sua gara?"</em>.
          </p>
        </DocSection>

        <DocSection id="h2h-flow" title="Come avviare un confronto" icon={<Play className="h-4 w-4" />}>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Apri la modalità Head-to-Head dalla home o dal pulsante <strong>⚔︎ H2H</strong> nell'header.</li>
            <li>Seleziona la sessione (sono filtrate solo Race e Sprint).</li>
            <li>Scegli i due piloti dai due selettori <strong>Pilota A</strong> e <strong>Pilota B</strong>.</li>
            <li>L'analisi parte automaticamente: la prima volta può richiedere 20–40 secondi.</li>
          </ol>
          <Tip>Il confronto è memorizzato nell'URL: puoi salvare o condividere il link e ritrovare la stessa coppia di piloti.</Tip>
        </DocSection>

        <DocSection id="h2h-cards" title="Le card del confronto" icon={<LayoutDashboard className="h-4 w-4" />}>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Header</strong> — i due piloti con esito finale e risultato del duello.</li>
            <li><strong className="text-foreground">Timeline</strong> — andamento posizione e gap giro per giro.</li>
            <li><strong className="text-foreground">Contesto per pilota</strong> — eventi rilevanti che hanno toccato uno solo dei due (penalità, problemi, traffico, neutralizzazioni asimmetriche).</li>
            <li><strong className="text-foreground">Griglia metriche</strong> — confronto numerico su pace, gestione gomme, pit stop, sorpassi.</li>
            <li><strong className="text-foreground">Narrativa</strong> — racconto del duello con le cause più probabili dell'esito.</li>
          </ul>
        </DocSection>

        <DocSection id="h2h-duel-insight" title="Tradeoff passo vs posizione" icon={<Lightbulb className="h-4 w-4" />}>
          <p>
            Nella card di intestazione del confronto può apparire un riquadro informativo che segnala un
            <strong className="text-foreground"> trade-off non sfruttato</strong> o un <strong className="text-foreground">rischio non coperto</strong>:
            ad esempio quando uno dei due piloti aveva un'opportunità realistica di attaccare l'altro
            (passo migliore ma non capitalizzato), oppure quando era esposto a un possibile attacco non difeso adeguatamente.
            È un'osservazione narrativa, separata dal verdetto principale, e non modifica le simulazioni.
          </p>
        </DocSection>

        <DocSection id="h2h-alternative" title="Strategie alternative & controfattuali" icon={<Lightbulb className="h-4 w-4" />}>
          <p>
            La sezione <strong className="text-foreground">Strategia alternativa</strong> mostra cosa sarebbe successo
            se i piloti avessero scelto una strategia diversa. Puoi scegliere tra tre scenari controfattuali:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Solo A adotta l'alternativa</strong> — B resta sulla strategia reale.</li>
            <li><strong className="text-foreground">Solo B adotta l'alternativa</strong> — A resta sulla strategia reale.</li>
            <li><strong className="text-foreground">Entrambi adottano l'alternativa</strong> — confronto su un piano comune.</li>
          </ul>
          <p>
            Per ogni scenario vedi la stima del guadagno o della perdita di tempo e se l'esito del duello
            sarebbe cambiato. Se per uno dei piloti non esiste un'alternativa significativa, lo scenario corrispondente
            risulta non disponibile.
          </p>
        </DocSection>

        {/* ───────────── ALTRE SEZIONI ───────────── */}
        <SectionDivider title="Altre sezioni" />

        <DocSection id="championship-page" title="Mondiale Piloti & Costruttori" icon={<Trophy className="h-4 w-4" />}>
          <p>
            La pagina <strong className="text-foreground">Mondiale</strong> raccoglie:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Classifica Piloti</strong> — punti totali, punti dell'ultima gara, variazione di posizione rispetto alla gara precedente.</li>
            <li><strong className="text-foreground">Classifica Costruttori</strong> — equivalente per i team.</li>
            <li><strong className="text-foreground">Gare disputate</strong> — elenco cronologico delle gare già concluse.</li>
          </ul>
          <p>I piloti sono mostrati con foto e bordo nel colore del team per riconoscerli a colpo d'occhio.</p>
        </DocSection>

        <DocSection id="pre-race" title="Analisi Pre-Gara" icon={<Beaker className="h-4 w-4" />}>
          <p>
            La pagina <strong className="text-foreground">Pre-Race</strong> (raggiungibile da
            <code className="text-primary"> /pre-race</code>) usa i long run delle Prove Libere e la qualifica
            per stimare chi avrà il passo migliore <strong className="text-foreground">in gara</strong>,
            indipendentemente dalla posizione di partenza. Include quattro card:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Ranking</strong> — chi è veloce sul lungo.</li>
            <li><strong className="text-foreground">Compound Stress</strong> — come reagiscono le diverse mescole.</li>
            <li><strong className="text-foreground">Qualifying Fingerprint</strong> — chi ha qualificato meglio o peggio del proprio passo gara.</li>
            <li><strong className="text-foreground">Watch List</strong> — piloti da tenere d'occhio in gara.</li>
          </ul>
          <Tip>L'analisi pre-gara può richiedere fino a qualche minuto la prima volta perché aggrega tutte le sessioni del weekend.</Tip>
        </DocSection>

        {/* ───────────── BUONO A SAPERSI ───────────── */}
        <SectionDivider title="Buono a sapersi" />

        <DocSection id="data-source" title="Fonte dei dati" icon={<Layers className="h-4 w-4" />}>
          <p>
            Tutti i dati provengono dall'API pubblica <strong className="text-foreground">OpenF1</strong>:
            sessioni, piloti, tempi al giro, settori, telemetria, posizioni GPS, meteo, messaggi di Race Control,
            stint, pit stop, intervalli e classifica finale.
          </p>
          <p className="text-xs italic">
            Non sono disponibili pubblicamente: carico carburante reale, setup vettura, pressioni gomme, dati GPS
            di alta precisione. Quando un'analisi tocca questi temi, PitWall AI usa proxy ragionevoli e dichiara
            sempre il livello di confidenza.
          </p>
        </DocSection>

        <DocSection id="caching" title="Caching & limiti delle richieste" icon={<Navigation className="h-4 w-4" />}>
          <p>
            PitWall AI memorizza i dati già scaricati nella memoria del tuo browser per due motivi:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Caricare le sessioni più velocemente nelle visite successive.</li>
            <li>Evitare di superare i limiti dell'API pubblica (errori del tipo "troppe richieste").</li>
          </ul>
          <p>
            I dati di gara già conclusi vengono mantenuti più a lungo (sono immutabili), mentre informazioni
            che possono cambiare (classifiche, calendario, dati live) hanno una scadenza più breve. Se vedi
            dati che ti sembrano vecchi, ricaricare la pagina forza un nuovo recupero.
          </p>
        </DocSection>

        <DocSection id="anti-hallucination" title="Trasparenza e anti-allucinazione" icon={<Shield className="h-4 w-4" />} defaultOpen>
          <p>PitWall AI è progettato per essere onesto sui propri limiti. In particolare:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Nessun dato viene <strong className="text-foreground">inventato</strong>: se OpenF1 non lo espone, l'app non lo mostra.</li>
            <li>Le stime hanno sempre un <strong className="text-foreground">livello di confidenza</strong> dichiarato.</li>
            <li>Quando i segnali sono contraddittori o insufficienti, lo stato viene marcato come <em>sconosciuto</em>.</li>
            <li>Le narrative non attribuiscono cause non osservabili (es. "il pilota era stanco").</li>
            <li>Gli scenari What-If sono dichiaratamente ipotetici e non sostituiscono i dati reali.</li>
          </ul>
        </DocSection>

        <DocSection id="faq" title="FAQ rapide" icon={<Info className="h-4 w-4" />}>
          <div className="space-y-3">
            <div>
              <p className="text-foreground font-medium">Perché alcune card non compaiono?</p>
              <p>Alcune card hanno senso solo per certi tipi di sessione. Pit stop, sorpassi e VRE, ad esempio, vengono mostrati solo per Gara e Sprint.</p>
            </div>
            <div>
              <p className="text-foreground font-medium">Perché vedo "—" o "non disponibile"?</p>
              <p>Significa che il dato non è esposto da OpenF1 per quella sessione, oppure che il modello non ha trovato segnali sufficienti per produrre una stima affidabile.</p>
            </div>
            <div>
              <p className="text-foreground font-medium">Perché il caricamento è lento la prima volta?</p>
              <p>L'analisi di una gara comporta molte richieste all'API. Una volta scaricati, i dati restano in cache nel tuo browser e le visite successive sono molto più veloci.</p>
            </div>
            <div>
              <p className="text-foreground font-medium">Posso confrontare più di due piloti?</p>
              <p>Al momento il confronto Head-to-Head è limitato a due piloti per garantire chiarezza visiva e narrativa.</p>
            </div>
            <div>
              <p className="text-foreground font-medium">Posso analizzare gare delle stagioni passate?</p>
              <p>Sì, finché OpenF1 espone i dati di quella sessione. Il selettore di sessione ti permette di scegliere l'anno.</p>
            </div>
          </div>
        </DocSection>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-8 space-y-1">
          <p>Guida utente di PitWall AI — riflette le funzionalità attualmente disponibili.</p>
          <p>Dati forniti da <strong className="text-foreground">OpenF1 API</strong> — api.openf1.org</p>
          <p>Questo è un progetto sviluppato da Fabrizio Monaco</p>
        </div>

      </main>
    </div>
  );
}
