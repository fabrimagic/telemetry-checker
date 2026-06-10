/**
 * SectorVsWinnerGrid — three compact cards (S1 / S2 / S3) comparing the
 * selected driver's median sector time vs the race winner's, with an honest
 * delta bar and a ±1σ consistency band.
 *
 * Pure presentation: REUSES `aggregateSector` (same MAD + neutralization
 * filters as the performance radar) and `getSessionWinner`. No new timing
 * computation is introduced — only the standard deviation on the already
 * filtered series (added inside aggregateSector, retro-compatibly).
 */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import type { Lap, PitData, RaceControlMessage } from "@/lib/openf1";
import { aggregateSector, MIN_SECTOR_CLEAN_SAMPLES } from "@/lib/performanceRadar";
import { classifyLapsTrackStatus } from "@/lib/trackStatusClassification";

const LOW_SAMPLE_THRESHOLD = 5;
/** Half-width (seconds) of the delta-bar axis floor. We always show at least
 *  ±0.5s on the X axis so a tiny delta does not visually saturate the bar. */
const DELTA_AXIS_FLOOR_S = 0.5;

export interface SectorVsWinnerGridProps {
  selectedDriverNumber: number;
  selectedAcronym: string;
  selectedLaps: Lap[];
  /** All laps for the session (used to pick the winner's laps). */
  sessionAllLaps: Lap[];
  winnerDriverNumber: number | null;
  winnerAcronym: string | null;
  /** All pit entries for the session (filtered per driver internally). */
  pitStops: PitData[];
  raceControlMessages: RaceControlMessage[];
  /** True only for Race / Sprint. The card is honest about non-race sessions. */
  isRace: boolean;
}

type SectorIdx = 1 | 2 | 3;

interface SectorStats {
  median: number | null;
  std: number | null;
  sampleSize: number;
}

function pickSector(idx: SectorIdx) {
  return (l: Lap): number | null =>
    idx === 1 ? l.duration_sector_1
    : idx === 2 ? l.duration_sector_2
    : l.duration_sector_3;
}

function variabilityLabel(median: number | null, std: number | null): string {
  if (median == null || std == null || median <= 0) return "—";
  const cv = std / median; // coefficient of variation on sector time
  if (cv < 0.003) return "molto costante";
  if (cv < 0.008) return "costante";
  return "variabile";
}

function fmtS(v: number | null, digits = 3): string {
  return v == null ? "—" : `${v.toFixed(digits)}s`;
}

function fmtDelta(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sign}${Math.abs(v).toFixed(3)}s`;
}

interface SectorCardProps {
  idx: SectorIdx;
  isRace: boolean;
  winnerAvailable: boolean;
  winnerAcronym: string | null;
  selectedAcronym: string;
  driver: SectorStats;
  winner: SectorStats;
}

function SectorCard({
  idx, isRace, winnerAvailable, winnerAcronym,
  selectedAcronym, driver, winner,
}: SectorCardProps) {
  const title = `Settore ${idx} — vs vincitore`;

  // Honest empty states.
  if (!isRace) {
    return (
      <Card className="bg-card border-border p-4 flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">
          Confronto col vincitore non disponibile: questa non è una gara.
        </p>
      </Card>
    );
  }
  if (!winnerAvailable) {
    return (
      <Card className="bg-card border-border p-4 flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">
          Confronto col vincitore non disponibile per questa sessione (vincitore
          mancante o giri puliti insufficienti nel settore).
        </p>
      </Card>
    );
  }
  if (driver.median == null) {
    return (
      <Card className="bg-card border-border p-4 flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">
          Dati insufficienti per il settore {idx} ({selectedAcronym}: {driver.sampleSize} giri puliti).
        </p>
      </Card>
    );
  }

  const delta = driver.median - (winner.median as number);
  const lowSample = driver.sampleSize < LOW_SAMPLE_THRESHOLD;

  // Build a symmetric delta axis around 0. Floor at ±DELTA_AXIS_FLOOR_S.
  const axisHalf = Math.max(Math.abs(delta), DELTA_AXIS_FLOOR_S);
  // Map delta to [0..100] with 50 = zero (winner reference).
  const deltaPct = 50 + (delta / axisHalf) * 50;
  const barLeft = delta >= 0 ? 50 : deltaPct;
  const barWidth = Math.abs(deltaPct - 50);

  // ±1σ band, rendered on the SAME axis (band width measured in same seconds scale).
  const stdSec = driver.std ?? null;
  const stdHalfPct = stdSec != null ? (stdSec / axisHalf) * 50 : 0;
  const bandLeft = Math.max(0, deltaPct - stdHalfPct);
  const bandWidth = Math.min(100, deltaPct + stdHalfPct) - bandLeft;

  const deltaTone = delta > 0 ? "text-red-400" : delta < 0 ? "text-emerald-400" : "text-muted-foreground";
  const barTone = delta > 0 ? "bg-red-500/80" : delta < 0 ? "bg-emerald-500/80" : "bg-muted";
  const opacity = lowSample ? "opacity-50" : "";
  const dashed = lowSample ? "border border-dashed border-foreground/40" : "";

  return (
    <Card className="bg-card border-border p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className={`text-sm font-mono ${deltaTone}`} aria-label="delta vs vincitore">
          {fmtDelta(delta)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">{selectedAcronym} (mediana giri puliti)</span>
        <span className="text-right font-mono text-foreground">{fmtS(driver.median)}</span>
        <span className="text-muted-foreground">{winnerAcronym ?? "Vincitore"} (mediana)</span>
        <span className="text-right font-mono text-foreground">{fmtS(winner.median)}</span>
        <span className="text-muted-foreground">Dev. standard {selectedAcronym}</span>
        <span className="text-right font-mono text-foreground">
          {stdSec != null ? `${stdSec.toFixed(3)}s` : "—"} · {variabilityLabel(driver.median, stdSec)}
        </span>
        <span className="text-muted-foreground">Giri puliti usati</span>
        <span className="text-right font-mono text-foreground">
          {driver.sampleSize}{lowSample ? " · campione ridotto" : ""}
        </span>
      </div>

      {/* Delta bar (zero = winner). Std band rendered on the same axis. */}
      <div className="space-y-1">
        <div
          className={`relative h-6 rounded-sm bg-muted/30 ${opacity}`}
          role="img"
          aria-label={`Delta ${fmtDelta(delta)} rispetto al vincitore; banda ±1σ ${stdSec != null ? stdSec.toFixed(3) + "s" : "non disponibile"}`}
        >
          {/* zero tick */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-foreground/60" />
          {/* ±1σ band centered on driver tick */}
          {stdSec != null && (
            <div
              className="absolute top-1.5 bottom-1.5 bg-sky-500/30 rounded-sm"
              style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
            />
          )}
          {/* delta bar (from zero to driver tick) */}
          <div
            className={`absolute top-2 bottom-2 ${barTone} ${dashed} rounded-sm`}
            style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
          />
          {/* driver tick */}
          <div
            className="absolute top-0 bottom-0 w-px bg-foreground"
            style={{ left: `${deltaPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
          <span>−{axisHalf.toFixed(2)}s</span>
          <span>vincitore</span>
          <span>+{axisHalf.toFixed(2)}s</span>
        </div>
      </div>

      {lowSample && (
        <p className="text-[11px] text-muted-foreground italic">
          Campione ridotto: su {driver.sampleSize} giri puliti.
        </p>
      )}
    </Card>
  );
}

function SectorLegend() {
  return (
    <div className="mt-3 rounded-md border border-border bg-card/60 p-4 text-sm text-muted-foreground">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/80">
        Cosa mostra il grafico
      </h4>
      <ul className="space-y-2 text-xs leading-relaxed">
        <li>
          <span className="font-medium text-foreground">Barra centrale</span> — indica quanto il pilota è più veloce o più lento del vincitore della gara in quel settore. Lo zero è il vincitore; a destra = più lento, a sinistra = più veloce.
        </li>
        <li>
          <span className="font-medium text-foreground">Fascia azzurra</span> — mostra la costanza: una fascia stretta significa giri molto simili tra loro, una fascia larga significa prestazioni più variabili.
        </li>
        <li>
          I tempi mostrati sono la <strong className="text-foreground">mediana</strong>, non la media. La <strong className="text-foreground">mediana</strong> è il valore centrale dei giri (metà più veloci, metà più lenti) e, a differenza della media, non viene falsata da un singolo giro anomalo — per esempio un giro rallentato dal traffico o da un errore. Per questo descrive meglio il passo abituale del pilota.
        </li>
        <li>
          Il confronto esclude i giri sotto Safety Car / neutralizzazione e i giri anomali. Se i giri validi sono pochi, il grafico è mostrato più sbiadito: significa che il dato è meno affidabile.
        </li>
      </ul>
    </div>
  );
}

export function SectorVsWinnerGrid(props: SectorVsWinnerGridProps) {
  const {
    selectedDriverNumber, selectedAcronym, selectedLaps,
    sessionAllLaps, winnerDriverNumber, winnerAcronym,
    pitStops, raceControlMessages, isRace,
  } = props;

  const winnerLaps = useMemo(
    () => winnerDriverNumber != null
      ? sessionAllLaps.filter((l) => l.driver_number === winnerDriverNumber)
      : [],
    [sessionAllLaps, winnerDriverNumber],
  );

  const selectedPitInSet = useMemo(
    () => new Set(pitStops.filter((p) => p.driver_number === selectedDriverNumber).map((p) => p.lap_number)),
    [pitStops, selectedDriverNumber],
  );
  const winnerPitInSet = useMemo(
    () => new Set(winnerDriverNumber != null
      ? pitStops.filter((p) => p.driver_number === winnerDriverNumber).map((p) => p.lap_number)
      : []),
    [pitStops, winnerDriverNumber],
  );

  const driverTrackStatusMap = useMemo(
    () => classifyLapsTrackStatus(selectedLaps, raceControlMessages),
    [selectedLaps, raceControlMessages],
  );
  const winnerTrackStatusMap = useMemo(
    () => classifyLapsTrackStatus(winnerLaps, raceControlMessages),
    [winnerLaps, raceControlMessages],
  );

  const perSector = useMemo(() => {
    return ([1, 2, 3] as SectorIdx[]).map((idx) => {
      const driver = aggregateSector(selectedLaps, selectedPitInSet, driverTrackStatusMap, pickSector(idx));
      const winner = aggregateSector(winnerLaps, winnerPitInSet, winnerTrackStatusMap, pickSector(idx));
      return {
        idx,
        driver: { median: driver.raw, std: driver.std, sampleSize: driver.sampleSize },
        winner: { median: winner.raw, std: winner.std, sampleSize: winner.sampleSize },
      };
    });
  }, [selectedLaps, winnerLaps, selectedPitInSet, winnerPitInSet, driverTrackStatusMap, winnerTrackStatusMap]);

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {perSector.map(({ idx, driver, winner }) => {
          const winnerAvailable =
            isRace &&
            winnerDriverNumber != null &&
            winner.median != null &&
            winner.sampleSize >= MIN_SECTOR_CLEAN_SAMPLES;
          return (
            <SectorCard
              key={idx}
              idx={idx}
              isRace={isRace}
              winnerAvailable={winnerAvailable}
              winnerAcronym={winnerAcronym}
              selectedAcronym={selectedAcronym}
              driver={driver}
              winner={winner}
            />
          );
        })}
      </div>
      <SectorLegend />
    </div>
  );
}
