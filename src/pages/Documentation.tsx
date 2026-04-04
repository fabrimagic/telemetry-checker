import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, BarChart3, Gauge, Brain, Cloud, Flag, Swords, TrendingDown, Timer, Shield, Beaker, Target, Layers, ChevronDown } from "lucide-react";
import { useState } from "react";

/* ── Collapsible Section ── */

function DocSection({ title, icon, children, defaultOpen = false }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
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

        {/* Intro */}
        <div className="bg-card rounded-lg border border-border p-5 space-y-2">
          <p className="text-foreground font-medium">F1 Telemetry Checker</p>
          <p className="text-sm text-muted-foreground">
            Applicazione web per l'analisi strategica e telemetrica delle sessioni di Formula 1, 
            basata interamente su dati pubblici provenienti dall'API <strong className="text-foreground">OpenF1</strong>. 
            Ogni modulo analitico è progettato per essere trasparente, tracciabile e anti-allucinatorio: 
            nessun dato viene inventato, nessuna stima viene presentata come certezza.
          </p>
        </div>

        {/* ════════════════════════════════════════════ */}
        {/* DATA SOURCE */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Fonte Dati — OpenF1 API" icon={<Layers className="h-4 w-4" />} defaultOpen>
          <p>
            Tutti i dati provengono dall'API pubblica <strong className="text-foreground">api.openf1.org</strong>. 
            Gli endpoint utilizzati includono:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">drivers</strong> — elenco piloti, team, colori</li>
            <li><strong className="text-foreground">laps</strong> — tempi al giro, settori, pit out lap</li>
            <li><strong className="text-foreground">stints</strong> — stint, mescola, età gomma</li>
            <li><strong className="text-foreground">pit</strong> — pit stop, lane duration, stop duration</li>
            <li><strong className="text-foreground">car_data</strong> — RPM, velocità, marcia, DRS, freni</li>
            <li><strong className="text-foreground">location</strong> — coordinate X/Y/Z per track map</li>
            <li><strong className="text-foreground">weather</strong> — temperatura pista/aria, pioggia, umidità, pressione, vento</li>
            <li><strong className="text-foreground">race_control</strong> — messaggi bandiere, Safety Car, VSC, Red Flag</li>
            <li><strong className="text-foreground">intervals</strong> — gap to leader e interval al pilota davanti</li>
            <li><strong className="text-foreground">position</strong> — posizione in gara in tempo reale</li>
            <li><strong className="text-foreground">session</strong> — informazioni sessione, tipo, meeting key</li>
          </ul>
          <p className="text-xs italic">
            Limitazione: OpenF1 non espone carico carburante reale, setup vettura, pressioni gomme 
            o dati GPS di alta precisione. Ogni modulo tiene conto di questi limiti.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* LAP TIMES CHART */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Grafico Tempi al Giro" icon={<BarChart3 className="h-4 w-4" />}>
          <p>
            Mostra l'andamento dei tempi al giro per ogni pilota selezionato. 
            I giri con <code className="text-primary">lap_duration == null</code> o con flag 
            <code className="text-primary">is_pit_out_lap</code> vengono comunque visualizzati 
            ma segnalati visivamente.
          </p>
          <p>
            Il confronto multi-pilota permette di sovrapporre le curve di passo per individuare 
            cross-over points, stint differenziali e perdite di performance relative.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* TELEMETRY */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Telemetria — Car Data & Track Map" icon={<Gauge className="h-4 w-4" />}>
          <p>
            Per un singolo giro selezionato, il sistema carica i dati telemetrici ad alta frequenza:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Velocità</strong> — km/h nel tempo</li>
            <li><strong className="text-foreground">RPM</strong> — regime motore</li>
            <li><strong className="text-foreground">Marcia</strong> — rapporto inserito</li>
            <li><strong className="text-foreground">Throttle</strong> — percentuale acceleratore (0–100%)</li>
            <li><strong className="text-foreground">Brake</strong> — stato freni (attivo/inattivo)</li>
            <li><strong className="text-foreground">DRS</strong> — stato DRS (aperto/chiuso)</li>
          </ul>
          <p>
            La <strong className="text-foreground">Track Map</strong> ricostruisce la traiettoria usando 
            le coordinate X/Y dal endpoint <code className="text-primary">location</code>. 
            Il cursore sincronizzato evidenzia la posizione sulla mappa durante lo scrubbing della telemetria.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* SECTORS & MINI-SECTORS */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Settori e Mini-Settori" icon={<Timer className="h-4 w-4" />}>
          <p>
            Visualizza i tempi parziali per i tre settori di ogni giro. 
            I colori indicano la performance relativa:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground" style={{ color: "hsl(270, 70%, 60%)" }}>Viola</strong> — miglior tempo assoluto della sessione (overall best)</li>
            <li><strong className="text-foreground" style={{ color: "hsl(142, 70%, 45%)" }}>Verde</strong> — miglior tempo personale del pilota</li>
            <li><strong className="text-foreground" style={{ color: "hsl(45, 93%, 58%)" }}>Giallo</strong> — tempo nella norma</li>
          </ul>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* WEATHER */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Classificazione Meteo" icon={<Cloud className="h-4 w-4" />}>
          <p>
            Ogni giro viene classificato come <strong className="text-foreground">DRY</strong>, 
            <strong className="text-foreground"> WET</strong> o <strong className="text-foreground">MIXED</strong> 
            in base ai dati di pioggia (rainfall) del sensore meteo OpenF1.
          </p>
          <p><strong className="text-foreground">Logica:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Per ogni giro si apre una finestra temporale: <code className="text-primary">[lap_start - 60s, lap_end + 60s]</code></li>
            <li>Si contano i campioni meteo con <code className="text-primary">rainfall &gt; 0</code></li>
            <li>Se pioggia dentro il giro e anche asciutto → <strong className="text-foreground">MIXED</strong></li>
            <li>Se pioggia solo nel buffer ±60s → <strong className="text-foreground">MIXED</strong></li>
            <li>Se pioggia in tutto il giro → <strong className="text-foreground">WET</strong></li>
            <li>Altrimenti → <strong className="text-foreground">DRY</strong></li>
          </ul>
          <p className="text-xs italic">
            Utilizzata dal VRE per escludere giri bagnati dalle stime di degrado e per classificare le fasi di gara.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* TRACK STATUS */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Classificazione Track Status" icon={<Flag className="h-4 w-4" />}>
          <p>
            I messaggi di Race Control vengono analizzati per classificare ogni giro:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">GREEN</strong> — condizioni normali</li>
            <li><strong className="text-foreground">YELLOW / DOUBLE_YELLOW</strong> — bandiere gialle</li>
            <li><strong className="text-foreground">VSC</strong> — Virtual Safety Car</li>
            <li><strong className="text-foreground">SC</strong> — Safety Car</li>
            <li><strong className="text-foreground">RED</strong> — bandiera rossa</li>
            <li><strong className="text-foreground">MIXED</strong> — più stati diversi nello stesso giro</li>
          </ul>
          <p>
            Il sistema costruisce intervalli temporali per ciascuno stato e li interseca 
            con la finestra di ogni giro. Se più stati si sovrappongono → MIXED. 
            La priorità è: RED &gt; SC &gt; VSC &gt; DOUBLE_YELLOW &gt; YELLOW.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* TYRE DEGRADATION */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Degrado Gomme — Modello a Due Stadi" icon={<TrendingDown className="h-4 w-4" />}>
          <p>
            Il sistema calcola il degrado gomme per ogni stint usando un <strong className="text-foreground">modello 
            di regressione a due stadi</strong> che corregge per effetti confondenti:
          </p>

          <h4 className="font-semibold text-foreground mt-3">Stadio A — Rimozione effetti non-gomma</h4>
          <p>
            Regressione multivariata dei tempi al giro su variabili centrate:
          </p>
          <Formula>lap_time = β₀ + β₁·fuel_proxy_centered + β₂·track_temp_centered + β₃·air_temp_centered + residuo</Formula>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">fuel_proxy</strong> — approssimazione del carico carburante tramite <code className="text-primary">laps_remaining = totalLaps - lapNumber</code>. NON è il carico reale (OpenF1 non lo espone)</li>
            <li><strong className="text-foreground">track_temp / air_temp</strong> — temperature associate per timestamp più vicino (tolleranza 5 min)</li>
            <li>Le variabili vengono centrate per stabilità numerica</li>
            <li>Se la varianza delle temperature è troppo bassa (&lt; 0.3°C), si usa solo fuel proxy</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Stadio B — Degrado isolato</h4>
          <Formula>residuo = α + γ·tyre_life + errore</Formula>
          <p>
            Il coefficiente <strong className="text-foreground">γ</strong> è la slope corretta di degrado (s/giro). 
            Rappresenta quanto il tempo al giro aumenta per ogni giro di vita della gomma, 
            dopo aver rimosso l'effetto del carburante e della temperatura.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Filtri pre-regressione</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Esclusi: out lap, in lap (ultimo giro di stint non finale), giri senza durata</li>
            <li>Esclusi: giri WET/MIXED, giri con neutralizzazione (non GREEN)</li>
            <li>Outlier: giri con tempo &gt; mediana × 1.07 rimossi</li>
            <li>Minimo 4 giri per modello semplice, 8 per modello corretto completo</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Fallback</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Se il modello a due stadi non è applicabile → regressione semplice <code className="text-primary">lap_time ~ tyre_life</code></li>
            <li>Se la slope corretta &gt; 0.30 s/giro → si usa la regressione semplice (il modello corretto è implausibile)</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Output</h4>
          <ul className="list-disc pl-5 space-y-1">
            <Param name="slope_raw" desc="Slope grezza (senza correzione)" />
            <Param name="slope_corrected" desc="Slope corretta dopo rimozione fuel/temp" />
            <Param name="model_type" desc="corrected_two_stage | corrected_fuel_only | simple_fallback" />
            <Param name="r_squared_corrected" desc="R² del modello corretto (Stadio B)" />
            <Param name="coefficients" desc="Tutti i coefficienti per trasparenza" />
          </ul>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* DEGRADATION VALIDATION */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Validazione del Degrado Gomme" icon={<Shield className="h-4 w-4" />}>
          <p>
            Ogni stima di degrado viene classificata prima di essere usata dal VRE:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground" style={{ color: "hsl(142, 70%, 45%)" }}>VALID</strong> — slope positiva, fit accettabile, giri sufficienti</li>
            <li><strong className="text-foreground" style={{ color: "hsl(45, 93%, 58%)" }}>NEUTRAL</strong> — slope vicina a zero o fit di bassa qualità</li>
            <li><strong className="text-foreground" style={{ color: "hsl(0, 62%, 50%)" }}>INVALID</strong> — slope negativa oltre tolleranza, giri insufficienti, o fit insufficiente</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Regole di classificazione</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Giri validi &lt; 4 → INVALID</li>
            <li>R² &lt; 0.1 → INVALID (fit insufficiente)</li>
            <li>Slope &lt; -0.02 → INVALID (slope negativa = dato contaminato)</li>
            <li>Slope &gt; 0.30 → INVALID (fisicamente implausibile)</li>
            <li>|slope| ≤ 0.01 → NEUTRAL</li>
            <li>Slope positiva con R² &lt; 0.3 → NEUTRAL (fit di bassa qualità)</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Fallback per stime INVALID</h4>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Stesso pilota, stesso compound, stint VALID → usa quella slope</li>
            <li>Qualsiasi pilota, stesso compound, VALID → usa quella slope</li>
            <li>Nessun riferimento → fallback conservativo neutro a <strong className="text-foreground">0.03 s/giro</strong></li>
          </ol>

          <h4 className="font-semibold text-foreground mt-3">Override degrado personalizzato</h4>
          <p>
            Quando almeno uno stint ha degrado classificato come <strong style={{ color: "hsl(0, 62%, 50%)" }}>INVALID</strong>, 
            l'utente può inserire un valore di degrado personalizzato (in secondi al giro, con precisione ai millesimi).
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Range ammesso: <strong className="text-foreground">0.001 — 0.300 s/giro</strong></li>
            <li>Il valore viene applicato <strong className="text-foreground">solo agli stint INVALID</strong>, senza modificare stint VALID o NEUTRAL</li>
            <li>Sostituisce il fallback automatico (stesso compound o 0.03 s/giro neutro)</li>
            <li>Il ricalcolo è immediato: strategie, ranking, pit consigliato, confidence e breakdown si aggiornano</li>
            <li>L'override è opzionale e può essere rimosso in qualsiasi momento, ripristinando il fallback automatico</li>
            <li>È segnalato nell'interfaccia con un badge dedicato per distinguere il dato personalizzato dal calcolo automatico</li>
          </ul>
          <p className="text-xs italic">
            Anti-allucinazione: una slope negativa NON significa che la gomma migliora. 
            Indica contaminazione da fuel effect, warm-up, traffico, evoluzione pista o rumore statistico.
            L'override consente all'utente esperto di inserire un valore basato sulla propria conoscenza del degrado atteso, 
            senza che il sistema inventi o interpreti dati non attendibili.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* CUMULATIVE DEVIATION */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Deviazione Cumulativa" icon={<TrendingDown className="h-4 w-4" />}>
          <p>
            Misura la perdita cumulativa di performance di ogni pilota rispetto al tempo medio 
            del vincitore della sessione (benchmark).
          </p>
          <Formula>delta_lap_i = lap_time_driver_i - reference_avg_winner</Formula>
          <Formula>cumulative_delta_i = Σ(delta_lap_1 ... delta_lap_i)</Formula>

          <h4 className="font-semibold text-foreground mt-3">Identificazione vincitore</h4>
          <p>
            Il vincitore è identificato dall'endpoint <code className="text-primary">session_result</code> 
            (posizione 1, escludendo DNF/DNS/DSQ).
          </p>

          <h4 className="font-semibold text-foreground mt-3">Filtri giri</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Escluso giro 1 (formazione/partenza)</li>
            <li>Esclusi pit out lap</li>
            <li>Esclusi giri con durata null/zero</li>
            <li>Outlier &gt; 1.5× mediana rimossi</li>
          </ul>
          <p className="text-xs italic">
            I filtri sono identici per vincitore e per tutti i piloti, garantendo che 
            la deviazione finale del vincitore sia esattamente zero.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* PACE LOSS */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Pace Loss per Stint (da Deviazione Cumulativa)" icon={<TrendingDown className="h-4 w-4" />}>
          <p>
            Metrica <strong className="text-foreground">ausiliaria</strong> derivata dalla deviazione cumulativa. 
            Misura la perdita di passo intra-stint confrontando i delta dei primi N giri con gli ultimi N giri.
          </p>
          <Formula>pace_loss_rate = mean(delta_lap_last_N) - mean(delta_lap_first_N)</Formula>
          <ul className="list-disc pl-5 space-y-1">
            <Param name="start_window" desc="Primi 3 giri dello stint (default)" />
            <Param name="end_window" desc="Ultimi 3 giri dello stint (default)" />
            <Param name="min_stint_laps" desc="Almeno 6 giri puliti per calcolare" />
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Classificazione</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">STABLE</strong> — rate ≤ 0.03s o negativo</li>
            <li><strong className="text-foreground">NORMAL_LOSS</strong> — 0.03 &lt; rate ≤ 0.10s</li>
            <li><strong className="text-foreground">HIGH_LOSS</strong> — 0.10 &lt; rate ≤ 0.20s</li>
            <li><strong className="text-foreground">CLIFF_RISK</strong> — rate &gt; 0.30s</li>
            <li><strong className="text-foreground">UNRELIABLE</strong> — dati insufficienti o contaminati (&gt; 50% giri)</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Contaminazione</h4>
          <p>Giri contaminati vengono esclusi dal calcolo. Fonti di contaminazione:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Battaglie</strong> — giri con distacco &lt; 1s (aria sporca, DRS train)</li>
            <li><strong className="text-foreground">Meteo</strong> — giri WET o MIXED</li>
            <li><strong className="text-foreground">Neutralizzazioni</strong> — giri con SC, VSC, Yellow</li>
            <li><strong className="text-foreground">Traffico</strong> — implicito dalle battaglie</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Uso nel VRE</h4>
          <p>NON è una misura diretta di degrado gomme. Viene usata come:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Moltiplicatore di degrado (+2% a +18% in base al rate)</li>
            <li>Moltiplicatore cliff penalty (+20% per HIGH_LOSS, +50% per CLIFF_RISK)</li>
            <li>Shift pit urgency (anticipa la pit window di 1–3 giri)</li>
            <li>Validazione coerenza: se il degrado è basso ma il pace loss è alto, la confidenza viene ridotta</li>
          </ul>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* LONG RUN DETECTOR */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Long Run Detector (Practice)" icon={<Beaker className="h-4 w-4" />}>
          <p>
            Nelle sessioni di prove libere, identifica le simulazioni di gara (long run) 
            all'interno degli stint per estrarre modelli di degrado per mescola.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Algoritmo di scoring</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Lunghezza</strong> — ≥ 8 giri: +30pt, ≥ 6: +20pt, altrimenti +10pt</li>
            <li><strong className="text-foreground">Regolarità</strong> — std &lt; 0.5s: +25pt, ≤ 0.8s: +15pt</li>
            <li><strong className="text-foreground">Trend degrado</strong> — slope positiva 0–0.2 s/giro: +20pt</li>
            <li><strong className="text-foreground">Push lap penalty</strong> — giri &lt; 99% mediana: -25pt</li>
            <li><strong className="text-foreground">Variabilità</strong> — range &gt; 2s: -15pt</li>
          </ul>
          <p>Score ≥ 40 → classificato come long run valido.</p>
          <p className="text-xs italic">
            I modelli di degrado dalle prove libere vengono usati dal VRE come riferimento 
            per le mescole non utilizzate in gara.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* RACE DIARY */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Diario di Gara" icon={<BookOpen className="h-4 w-4" />}>
          <p>
            Ricostruisce la cronologia degli eventi significativi per un pilota:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">OVERTAKE_DONE</strong> — sorpassi effettuati</li>
            <li><strong className="text-foreground">OVERTAKE_RECEIVED</strong> — sorpassi subiti</li>
            <li><strong className="text-foreground">PIT_STOP</strong> — soste ai box con dettagli compound e durata</li>
            <li><strong className="text-foreground">RACE_CONTROL</strong> — messaggi bandiere, penalità, Safety Car</li>
            <li><strong className="text-foreground">BATTLE</strong> — episodi di battaglia rilevati</li>
          </ul>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* BATTLE DETECTION */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Battle Detection" icon={<Swords className="h-4 w-4" />}>
          <p>
            Rileva episodi di battaglia ravvicinata analizzando gli interval e le posizioni:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">ATTACKING</strong> — il pilota ha un intervallo &lt; 1.0s rispetto a chi precede</li>
            <li><strong className="text-foreground">DEFENDING</strong> — il pilota dietro ha un intervallo &lt; 1.0s</li>
            <li><strong className="text-foreground">BOTH</strong> — attacco e difesa contemporanei</li>
          </ul>
          <p>
            Ogni episodio deve durare almeno 5 secondi per essere registrato. 
            Le informazioni di battaglia vengono usate dal pace loss per scontare 
            i giri in aria sporca.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* TRAFFIC PREDICTOR */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Traffic Predictor" icon={<Target className="h-4 w-4" />}>
          <p>
            Stima il traffico post-pit per diversi giri candidati:
          </p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Recupera le posizioni e i gap al leader al giro di pit</li>
            <li>Calcola il gap stimato dopo il pit: <code className="text-primary">gap_after = gap_attuale + pit_loss</code></li>
            <li>Determina la posizione di rientro confrontando con i gap degli altri piloti</li>
            <li>Classifica il traffico in base al gap con chi precede e chi segue:
              <ul className="list-disc pl-5 mt-1">
                <li><strong className="text-foreground">CLEAN</strong> — gap ≥ 3.0s</li>
                <li><strong className="text-foreground">LIGHT</strong> — gap ≥ 1.5s</li>
                <li><strong className="text-foreground">HEAVY</strong> — gap &lt; 1.5s</li>
              </ul>
            </li>
            <li>Stima i giri in traffico in base al differenziale di passo</li>
            <li>Calcola il tempo totale perso: <code className="text-primary">HEAVY = 1.0s/giro, LIGHT = 0.4s/giro</code></li>
          </ol>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* SESSION REPORT */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Session Report" icon={<BarChart3 className="h-4 w-4" />}>
          <p>
            Vista aggregata della sessione con tre schede:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Overview</strong> — classifica finale, condizioni meteo</li>
            <li><strong className="text-foreground">Race Charts</strong> — grafico posizioni, grafico gap al leader, 
              deviazione cumulativa</li>
            <li><strong className="text-foreground">Strategy</strong> — mappa strategica a barre (mescole per stint), 
              tabella pit stop</li>
          </ul>
          <p className="text-xs italic">
            La deviazione cumulativa nel Session Report usa lo stesso modulo 
            del VRE per garantire coerenza.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* VIRTUAL RACE ENGINEER */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Virtual Race Engineer — Architettura" icon={<Brain className="h-4 w-4" />} defaultOpen>
          <p>
            Il cuore analitico dell'applicazione. Disponibile solo per sessioni 
            <strong className="text-foreground"> Race</strong> e <strong className="text-foreground">Sprint</strong> 
            con un singolo pilota selezionato.
          </p>

          <h4 className="font-semibold text-foreground mt-4">Pipeline di calcolo</h4>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <strong className="text-foreground">Analisi strategia reale</strong> — ricostruzione stint, 
              analisi pit stop (timing, compound, sotto neutralizzazione), calcolo tempo totale gara
            </li>
            <li>
              <strong className="text-foreground">Degrado corretto + validazione</strong> — modello a due stadi 
              per ogni stint → validazione VALID/NEUTRAL/INVALID → risoluzione fallback
            </li>
            <li>
              <strong className="text-foreground">Pace Loss</strong> — analisi deviazione cumulativa per stint → 
              moltiplicatori di degrado, cliff, pit urgency
            </li>
            <li>
              <strong className="text-foreground">Costruzione modelli per mescola</strong> — un modello 
              <code className="text-primary">(slope, intercept)</code> per ogni compound presente in gara, 
              arricchito con modelli dalle prove libere (long run)
            </li>
            <li>
              <strong className="text-foreground">Simulazione strategie</strong> — funzione di costo che simula 
              il tempo totale di gara per diverse combinazioni di pit stop e compound
            </li>
            <li>
              <strong className="text-foreground">Ranking e verdetto</strong> — confronto strategia reale vs 
              consigliata vs alternative → delta, confidenza, breakdown
            </li>
          </ol>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* VRE COST FUNCTION */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="VRE — Funzione di Costo Strategia" icon={<Brain className="h-4 w-4" />}>
          <p>
            Per ogni strategia candidata, la funzione di costo <code className="text-primary">simulateStrategyCost()</code> 
            calcola il tempo totale simulato:
          </p>
          <Formula>
            total_cost = Σ_stints [ Σ_laps ( base_lap + degradation × lapDegMult(lap) + cliffPenalty(stint_length) ) + pit_loss + traffic_cost ]
          </Formula>

          <h4 className="font-semibold text-foreground mt-3">Componenti</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">base_lap</strong> — <code className="text-primary">model.intercept</code> per il compound</li>
            <li><strong className="text-foreground">degradation</strong> — <code className="text-primary">model.slope × tyre_life</code>, moltiplicato per <code className="text-primary">lapDegradationMult(lap)</code></li>
            <li><strong className="text-foreground">lapDegradationMult</strong> — combina risk mode, scenario e pace loss adjustment</li>
            <li><strong className="text-foreground">cliffPenalty</strong> — penalità quadratica per stint oltre 18 giri: <code className="text-primary">(excess)² × cliff_coefficient × paceLossCliffMult</code></li>
            <li><strong className="text-foreground">effectivePitLoss</strong> — pit loss modulato da scenario (es. SC riduce a 62%)</li>
            <li><strong className="text-foreground">estimateTrafficCost</strong> — basato su traffic predictor, modulato da posizione, risk mode e scenario</li>
          </ul>

          <h4 className="font-semibold text-foreground mt-3">Vincolo regolamentare</h4>
          <p>
            Ogni strategia deve utilizzare <strong className="text-foreground">almeno 2 mescole diverse</strong> 
            (regolamento F1 per gare in asciutto). Strategie con una sola mescola vengono scartate.
          </p>

          <h4 className="font-semibold text-foreground mt-3">Esplorazione dello spazio strategico</h4>
          <p>
            Il sistema esplora strategie con 1, 2 e 3 pit stop, variando il giro di pit 
            in una finestra attorno al primo pit reale (±6 giri). Per scenari SC/VSC, 
            vengono anche esplorate strategie N+1 (un pit aggiuntivo).
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* RACE PHASE */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="VRE — Race Phase" icon={<Timer className="h-4 w-4" />}>
          <p>
            La fase di gara modifica i pesi della funzione di costo:
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

        {/* ════════════════════════════════════════════ */}
        {/* RISK MODE */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="VRE — Risk Mode" icon={<Shield className="h-4 w-4" />}>
          <p>
            Tre profili di rischio che modificano i pesi della funzione di costo:
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
          <p className="mt-2">
            <strong className="text-foreground">Conservative</strong>: penalizza di più il degrado e il traffico, 
            favorendo strategie robuste e pit preventivi.<br />
            <strong className="text-foreground">Aggressive</strong>: riduce il peso di degrado e traffico, 
            amplifica le opportunità, accettando più rischio.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* SCENARIOS */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="VRE — Scenari What-If" icon={<Beaker className="h-4 w-4" />}>
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
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Clean Air</td><td>Traffico ×0.1</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Heavy Traffic</td><td>Traffico ×1.6, rischio ×1.2</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Light Rain</td><td>Degrado ×1.1, meteo ×1.4, confidenza -1</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Mixed Conditions</td><td>Degrado ×1.15, meteo ×1.6, confidenza -2</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Tyre Cliff Risk</td><td>Degrado ×1.5, rischio ×1.3</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Late Race Attack</td><td>Degrado ×0.85, posizione ×1.4, rischio ×0.7</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Battle Mode</td><td>Posizione ×1.5, traffico ×1.2</td></tr>
                <tr className="border-b border-border/50"><td className="py-1.5 pr-3 font-medium text-foreground">Undercut</td><td>Traffico ×0.7, degrado ×1.2, posizione ×1.3</td></tr>
                <tr><td className="py-1.5 pr-3 font-medium text-foreground">Overcut</td><td>Degrado ×0.85, rischio ×0.9</td></tr>
              </tbody>
            </table>
          </div>

          <h4 className="font-semibold text-foreground mt-3">Parametri temporali</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Activation Lap</strong> — giro in cui lo scenario diventa attivo</li>
            <li><strong className="text-foreground">Duration</strong> — durata in giri della finestra scenario</li>
          </ul>
          <p>
            I modificatori vengono scalati in base alla finestra temporale rispetto alla durata totale gara 
            (<code className="text-primary">scale = effectiveDuration / totalLaps</code>). 
            I giri fuori dalla finestra usano i pesi standard.
          </p>
          <p className="text-xs italic">
            Anti-allucinazione: gli scenari NON creano eventi fittizi, NON alterano la telemetria, 
            NON inventano tempi al giro. Modificano solo i moltiplicatori del modello strategico.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* STRATEGY BREAKDOWN */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="VRE — Scomposizione del Giudizio (Breakdown)" icon={<Layers className="h-4 w-4" />}>
          <p>
            Per ogni strategia (reale, consigliata, alternativa), il sistema produce un breakdown 
            che scompone il tempo stimato in componenti:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Tempo base stint</strong> — tempo stimato senza degrado</li>
            <li><strong className="text-foreground">Degrado gomme</strong> — costo aggiuntivo da usura pneumatici</li>
            <li><strong className="text-foreground">Tempo perso ai box</strong> — pit stop × pit_loss_per_stop</li>
            <li><strong className="text-foreground">Tempo perso nel traffico</strong> — da traffic predictor</li>
            <li><strong className="text-foreground">Impatto meteo</strong> — +2.0s per giro WET/MIXED</li>
            <li><strong className="text-foreground">Effetto neutralizzazione</strong> — -10s per pit sotto SC/VSC</li>
          </ul>
          <p>
            I modificatori di scenario e risk mode vengono applicati ai singoli componenti 
            del breakdown, rendendo visibile all'utente quale fattore cambia e di quanto.
          </p>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* VERDICT & CONFIDENCE */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="VRE — Verdetto e Confidenza" icon={<Target className="h-4 w-4" />}>
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
            Il punteggio di confidenza (HIGH / MEDIUM / LOW) viene calcolato partendo da un base 
            e sottraendo penalità per:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Mescole da practice (non validate in gara)</li>
            <li>Stime di degrado NEUTRAL o INVALID</li>
            <li>Pace loss UNRELIABLE</li>
            <li>Incoerenza tra degrado stimato e pace loss osservato</li>
            <li>Giri bagnati (&gt; 20% dei giri)</li>
            <li>Pochi giri validi</li>
            <li>Penalità scenario (es. pioggia simulata riduce confidenza)</li>
          </ul>
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* INTEGRATED CONTEXT */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="VRE — Contesto Integrato" icon={<Layers className="h-4 w-4" />}>
          <p>
            Il layer di orchestrazione <code className="text-primary">vreContext.ts</code> raccoglie 
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
        </DocSection>

        {/* ════════════════════════════════════════════ */}
        {/* ANTI-HALLUCINATION */}
        {/* ════════════════════════════════════════════ */}
        <DocSection title="Principi Anti-Allucinazione" icon={<Shield className="h-4 w-4" />} defaultOpen>
          <p className="text-foreground font-medium">
            L'intero sistema è progettato per prevenire esplicitamente risultati fuorvianti:
          </p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <strong className="text-foreground">Nessun dato inventato</strong> — ogni valore mostrato 
              proviene dall'API OpenF1 o è derivato tramite formule esplicite e tracciabili.
            </li>
            <li>
              <strong className="text-foreground">Slope negativa ≠ gomma migliore</strong> — una slope 
              negativa viene classificata INVALID e sostituita con fallback conservativo, 
              mai interpretata come "la gomma guadagna performance".
            </li>
            <li>
              <strong className="text-foreground">Deviazione cumulativa ≠ degrado gomme</strong> — 
              la deviazione cumulativa è un indicatore di pace relativa, non una misura di usura. 
              Viene usata come metrica ausiliaria, mai come sostituto diretto.
            </li>
            <li>
              <strong className="text-foreground">Contaminazione esplicita</strong> — traffico, battaglie, 
              meteo e neutralizzazioni vengono identificati e gestiti. I giri contaminati 
              vengono esclusi o la metrica viene declassata a UNRELIABLE.
            </li>
            <li>
              <strong className="text-foreground">Scenari ≠ previsioni</strong> — gli scenari what-if 
              modificano solo i moltiplicatori del modello, non creano eventi fittizi. 
              Il sistema segnala sempre che si tratta di una simulazione.
            </li>
            <li>
              <strong className="text-foreground">Confidenza dinamica</strong> — ogni fattore che riduce 
              l'affidabilità viene registrato e comunicato all'utente tramite il punteggio 
              di confidenza e i fattori espliciti.
            </li>
            <li>
              <strong className="text-foreground">Fuel proxy ≠ carburante reale</strong> — il sistema 
              usa <code className="text-primary">laps_remaining</code> come proxy per il carico carburante. 
              Non ha accesso al dato reale di fuel load.
            </li>
          </ol>
        </DocSection>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-8">
          Documentazione generata automaticamente dal codice sorgente. Versione attuale del modello analitico.
        </div>

      </main>
    </div>
  );
}
