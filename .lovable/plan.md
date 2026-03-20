
# F1 Telemetry Analysis Tool

## Overview
Tool interattivo per analizzare i dati telemetrici di Formula 1 usando le API pubbliche di OpenF1. L'utente inserisce una session key, seleziona un pilota, sceglie un giro e visualizza telemetria dettagliata sincronizzata con la posizione sul circuito.

## Flusso Utente

### Step 1 — Input Sessione e Pilota
- Campo input per la **Session Key** (es. 9161)
- Alla conferma, chiamata a `/v1/drivers?session_key=X` per ottenere l'elenco piloti
- Dropdown di selezione pilota con nome, acronimo e colore team

### Step 2 — Selezione Giro
- Tabella dei giri del pilota (da `/v1/laps?session_key=X&driver_number=Y`) con: numero giro, tempo totale, settori, velocità speed trap, pit out lap
- Pulsante **"Fastest Lap"** che seleziona automaticamente il giro con `lap_duration` minore
- Click su una riga per selezionare manualmente un giro

### Step 3 — Grafici Telemetrici (sezione principale)
Usando il `date_start` del giro e la `lap_duration`, si recuperano i dati da `/v1/car_data` nel range temporale corrispondente. 5 grafici allineati verticalmente con asse X condiviso (tempo relativo dall'inizio giro), costruiti con Recharts:
1. **Velocità** (km/h) — grafico a linea
2. **Acceleratore** (%) — grafico area
3. **Freno** (0/100) — grafico a barre/step
4. **RPM** — grafico a linea
5. **Marcia** (1-8) — grafico a step

Un **cursore verticale sincronizzato** si muove su tutti i grafici quando l'utente passa il mouse o clicca.

### Step 4 — Mappa Circuito
- Dati posizione da `/v1/location?session_key=X&driver_number=Y&date>=START&date<=END`
- Tracciato del circuito disegnato con SVG/Canvas collegando tutti i punti (x, y) del giro
- Un **punto evidenziato** mostra la posizione del pilota corrispondente al timestamp selezionato nei grafici telemetrici
- Cliccando su un punto della telemetria, il marcatore sulla mappa si aggiorna in tempo reale

## Design
- Layout dark theme in stile F1 (sfondo scuro, accenti in rosso F1)
- Colore del pilota selezionato usato per le linee dei grafici (dal campo `team_colour`)
- Responsive: grafici e mappa si impilano su mobile
- Loading states e gestione errori per ogni chiamata API
