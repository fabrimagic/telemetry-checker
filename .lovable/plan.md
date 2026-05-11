# Riorganizzazione UI di PitWall AI

Obiettivo: spostare tutti i controlli (sessione, pilota, VRE setup, scenari, risk mode, view mode, custom degradation) in una **toolbar verticale sticky a sinistra**, e riorganizzare l'output centrale in **griglie a matrice multi-colonna** per ridurre lo scrolling. Nessuna modifica alle logiche di calcolo, ai loader, agli hook di stato o ai motori (VRE, KDM, degradazione, head-to-head).

## Scope

Modifiche limitate a:
- `src/pages/Index.tsx` — modalità Analisi Singolo Pilota
- `src/pages/Compare.tsx` — modalità Head-to-Head
- Nuovi componenti di **layout puro** (no logica) in `src/components/layout/`

NON modificati: tutti i file `src/lib/*`, i componenti `src/components/f1/*` esistenti (solo riposizionati), gli hook, i loader, i test.

## Nuova struttura layout

### Analisi Singolo Pilota (`/`)

```text
┌─────────────────────────────────────────────────────────────┐
│ Header (logo, nav, reset)                                   │
├──────────────┬──────────────────────────────────────────────┤
│              │  Tab bar: [Panoramica] [Strategia]           │
│  TOOLBAR     │           [Gomme] [Tecnica] [Report]         │
│  (sticky,    ├──────────────────────────────────────────────┤
│  280px,      │  ┌─────────── Dashboard Summary ──────────┐  │
│  scroll      │  └────────────────────────────────────────┘  │
│  interno)    │                                              │
│              │  ┌─ Matrice 2×2 (Panoramica) ─────────────┐  │
│  • Sessione  │  │ Stints     │ Pit Stops                 │  │
│  • Pilota    │  │ Overtakes  │ Weather                   │  │
│  • Vista     │  └────────────┴───────────────────────────┘  │
│    (tab)     │                                              │
│  ─────────── │  ┌─ LapTimesChart (full width) ───────────┐  │
│  VRE Setup   │  └────────────────────────────────────────┘  │
│  • Modalità  │                                              │
│  • Vista     │  ┌─ Race Diary (full width) ──────────────┐  │
│  • Rischio   │  └────────────────────────────────────────┘  │
│  • Scenario  │                                              │
│  • Custom    │                                              │
│    deg       │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

Comportamento toolbar:
- Sticky, `h-[calc(100vh-headerH)]`, overflow-y-auto interno.
- Sezioni collassabili con `<Collapsible>` di shadcn: **Sessione**, **Pilota**, **VRE Setup** (visibile solo in Race/Sprint single-driver dopo che VRE è calcolato).
- Su viewport `<lg`: la toolbar diventa un `Sheet` laterale apribile da un pulsante "⚙ Configurazione" in alto.

Layout per ciascun tab del contenuto centrale:

- **Panoramica**: griglia 2×2 per Stints / PitStops / Overtakes / Weather (compatta, ogni cella già esistente), poi `LapTimesChart` full-width, poi `RaceDiaryCard` full-width.
- **Strategia**: `VirtualRaceEngineerCard` + `KeyDecisionMomentsCard` in colonna singola (componenti già densi).
- **Gomme & Performance**: `TyreDegradationCard` full-width.
- **Analisi Tecnica**: griglia `[1fr_360px]` con `TelemetryCharts` a sinistra, `TrackMap` + `DrivingAnalysis` + `SectorMiniSectors` + `WeatherCard` a destra in stack. `LapTable` sopra in collapsible per non occupare verticalità di default.
- **Report Sessione**: invariato.

### Head-to-Head (`/compare`)

```text
┌─────────────────────────────────────────────────────────────┐
│ Header                                                      │
├──────────────┬──────────────────────────────────────────────┤
│  TOOLBAR     │  CompareHeader (riassunto verdetto)          │
│              │  ┌─ Matrice 2 col ───────────────────────┐   │
│  • Sessione  │  │ DriverContext A │ DriverContext B     │   │
│  • Pilota A  │  └─────────────────┴─────────────────────┘   │
│  • Pilota B  │  CompareTimeline (full width)                │
│  • Swap      │  CompareMetricsGrid (già a griglia)          │
│              │  CompareNarrative                            │
│              │  ─── Alternativa ───                         │
│              │  CompareAlternativeStrategies                │
└──────────────┴──────────────────────────────────────────────┘
```

## Nuovi componenti (solo presentazione)

1. **`src/components/layout/AppShell.tsx`**
   - Props: `toolbar: ReactNode`, `children: ReactNode`, `header?: ReactNode`.
   - Renderizza grid `[280px_1fr]` su `lg+`, stacked + Sheet trigger su mobile.
   - Toolbar sticky con scroll interno e larghezza fissa.

2. **`src/components/layout/ToolbarSection.tsx`**
   - Wrapper `<Collapsible>` con header tipografico coerente (label rosso F1 + line).
   - Props: `title`, `defaultOpen`, `children`.

3. **`src/components/layout/ContentGrid.tsx`**
   - Helper presentazionale per le matrici 2×2 / `auto-fit`: gestisce gap, ordinamento responsive.
   - Props: `columns?: 1 | 2 | 3`, `children`.

Questi 3 file sono ~150 righe totali, zero logica di business.

## Strategia di refactor

### `Index.tsx`
- Mantenuti **invariati**: tutti gli `useState`, `useMemo`, `useCallback`, `useRef`, le funzioni `handleSessionSubmit`, `handleAddDriver`, `handleRemoveDriver`, `handleSelectLap`, `handleFastest`, `handleLoadTelemetry`, `handleReset`, `recomputeVre`, `driverColorMap`, ecc.
- Cambia solo il **JSX di return**:
  - Hero + mode chooser restano come "stato iniziale" (no toolbar finché non c'è sessione+modalità).
  - Una volta entrati in flusso `analysisMode === "single"`: si attiva `<AppShell toolbar={…}>`.
  - La toolbar contiene `SessionPicker`, `DriverPicker` (max 1), il pannello `VRESetupCard` (stesso componente, stessi handler già esistenti — solo spostato).
  - Il main racchiude `DashboardSummary` + i quattro tab esistenti, con le `TabsContent` riorganizzate in griglie come da diagramma.
- `ChampionshipSummaryCard`, `WeekendWeatherCard`, `NextCircuitCard`, `FullGasFeedSection`: restano in landing pre-sessione, rimossi dalla viewport "lavoro" per ridurre rumore.

### `Compare.tsx`
- Mantenuti invariati: tutti i `useState`/`useEffect`/`useMemo` e i caricamenti.
- Estratta la sezione "controlli" (`SessionPicker` + i due `Select` driver A/B + swap/reset) dentro la toolbar.
- Il main contiene i risultati `comparison` riorganizzati: `CompareHeader` → riga 2 colonne con i due `CompareDriverContext` affiancati → `CompareTimeline` → `CompareMetricsGrid` → `CompareNarrative` → separator → `CompareAlternativeStrategies`.

## Accessibilità & leggibilità

- Toolbar: larghezza fissa 280px, padding `p-4`, gap `space-y-4`, titoli `text-[10px] font-black uppercase tracking-[0.25em]` coerenti con design token attuali.
- Tipografia contenuti: invariata (i componenti `f1/*` non vengono toccati).
- Contrasto: già garantito dai token HSL esistenti.
- Mobile (`<lg`): toolbar dentro `Sheet`, FAB/pulsante fisso in basso a destra per riaprirla.

## Verifica

- `tsc` verde, build Vite verde.
- Tutti i test esistenti devono restare verdi (nessuna modifica a `src/lib/*`).
- Smoke manuale: caricare una Race, selezionare un pilota, cambiare risk mode / scenario / view mode dalla toolbar e verificare che `recomputeVre` reagisca esattamente come prima.

## Dettagli tecnici

- Nessuna nuova dipendenza npm; uso `Collapsible`, `Sheet`, `Tabs` di shadcn già presenti.
- Nessun cambio a `App.tsx`, `livedataClient.ts`, `liveVRE.ts`, dashboard `/internal-*` o pagine `/docs`, `/pre-race`, `/campionato`.
- I componenti `VRESetupCard`, `DriverPicker`, `SessionPicker` vengono **riusati identici**: cambia solo il contenitore.

## Cosa NON è incluso

- Nessun ridisegno di singoli widget (`LapTimesChart`, `TelemetryCharts`, `TrackMap`, ecc.): vengono solo riposizionati.
- Nessuna modifica a colori, palette, font, semantica dei design token.
- Nessuna modifica a Documentazione, Pre-Race, Campionato, Internal Live Dashboard.
- Nessuna modifica alle logiche di calcolo, ai modelli, agli engine, ai test.
