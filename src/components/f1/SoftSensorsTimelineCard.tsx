import { Activity, Thermometer, Gauge, Waves } from "lucide-react";
import type {
  SoftSensorsTimeline,
  SoftSensorsLapState,
  SoftSensorConfidence,
  TyreThermalLabel,
  TyreStressLabel,
  TrackGripLabel,
} from "@/lib/softSensors";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  timeline: SoftSensorsTimeline | null;
}

const THERMAL_LABEL_IT: Record<TyreThermalLabel, string> = {
  COLD: "Fredde",
  WARMING_UP: "In riscaldamento",
  IN_WINDOW: "In finestra",
  HOT: "Calde",
  OVERHEATED: "Surriscaldate",
  UNKNOWN: "Non determinato",
};

const STRESS_LABEL_IT: Record<TyreStressLabel, string> = {
  LOW: "Basso",
  MODERATE: "Moderato",
  HIGH: "Alto",
  CRITICAL: "Critico",
  UNKNOWN: "Non determinato",
};

const GRIP_LABEL_IT: Record<TrackGripLabel, string> = {
  LOW_GRIP: "Grip basso",
  IMPROVING: "In miglioramento",
  STABLE: "Stabile",
  FALLING: "In calo",
  MIXED: "Misto",
  UNKNOWN: "Non determinato",
};

const CONFIDENCE_LABEL_IT: Record<SoftSensorConfidence, string> = {
  HIGH: "Alta",
  MEDIUM: "Media",
  LOW: "Bassa",
};

const THERMAL_COLOR: Record<TyreThermalLabel, string> = {
  COLD: "#3b82f6",
  WARMING_UP: "#38bdf8",
  IN_WINDOW: "#22c55e",
  HOT: "#f59e0b",
  OVERHEATED: "#ef4444",
  UNKNOWN: "hsl(var(--muted))",
};

const STRESS_COLOR: Record<TyreStressLabel, string> = {
  LOW: "#22c55e",
  MODERATE: "#eab308",
  HIGH: "#f97316",
  CRITICAL: "#ef4444",
  UNKNOWN: "hsl(var(--muted))",
};

const GRIP_COLOR: Record<TrackGripLabel, string> = {
  LOW_GRIP: "#ef4444",
  IMPROVING: "#86efac",
  STABLE: "#22c55e",
  FALLING: "#f59e0b",
  MIXED: "#a78bfa",
  UNKNOWN: "hsl(var(--muted))",
};

function confidenceOpacity(c: SoftSensorConfidence): number {
  if (c === "HIGH") return 1;
  if (c === "MEDIUM") return 0.75;
  return 0.45;
}

interface TrackRowProps {
  icon: React.ReactNode;
  label: string;
  laps: SoftSensorsLapState[];
  pickColor: (s: SoftSensorsLapState) => string;
  pickLabel: (s: SoftSensorsLapState) => string;
  pickConfidence: (s: SoftSensorsLapState) => SoftSensorConfidence;
  cellWidth: number;
}

function TrackRow({ icon, label, laps, pickColor, pickLabel, pickConfidence, cellWidth }: TrackRowProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 w-32 shrink-0 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex gap-px">
        {laps.map((s, i) => {
          const prev = laps[i - 1];
          const stintChange = prev && prev.stint_number !== s.stint_number;
          const conf = pickConfidence(s);
          const isLow = conf === "LOW";
          return (
            <Tooltip key={`${s.lap_number}-${i}`}>
              <TooltipTrigger asChild>
                <div
                  className="h-7 rounded-[2px] cursor-help relative"
                  style={{
                    width: cellWidth,
                    backgroundColor: pickColor(s),
                    opacity: confidenceOpacity(conf),
                    backgroundImage: isLow
                      ? "repeating-linear-gradient(45deg, transparent 0 2px, rgba(0,0,0,0.35) 2px 4px)"
                      : undefined,
                    marginLeft: stintChange ? 2 : 0,
                    boxShadow: stintChange ? "inset 2px 0 0 hsl(var(--foreground))" : undefined,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <div className="text-xs space-y-1">
                  <div className="font-semibold">
                    Giro {s.lap_number} · Stint {s.stint_number}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Termica:</span>{" "}
                    {THERMAL_LABEL_IT[s.tyre_thermal.label]}{" "}
                    <span className="text-muted-foreground">({CONFIDENCE_LABEL_IT[s.tyre_thermal.confidence]})</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Stress:</span>{" "}
                    {STRESS_LABEL_IT[s.tyre_stress.label]}{" "}
                    <span className="text-muted-foreground">({CONFIDENCE_LABEL_IT[s.tyre_stress.confidence]})</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Grip:</span>{" "}
                    {GRIP_LABEL_IT[s.track_grip.label]}{" "}
                    <span className="text-muted-foreground">({CONFIDENCE_LABEL_IT[s.track_grip.confidence]})</span>
                  </div>
                  {s.reliability_notes.length > 0 && (
                    <ul className="pt-1 border-t border-border/50 space-y-0.5">
                      {s.reliability_notes.map((n, idx) => (
                        <li key={idx} className="text-[10px] text-muted-foreground">• {n}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

interface LegendItem {
  color: string;
  label: string;
}

function LegendBlock({ title, items }: { title: string; items: LegendItem[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{title}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: it.color }} />
            <span className="text-[10px] text-muted-foreground">{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SoftSensorsTimelineCard({ timeline }: Props) {
  if (!timeline || timeline.by_lap.length === 0) return null;

  const laps = [...timeline.by_lap].sort((a, b) => a.lap_number - b.lap_number);
  const cellWidth = laps.length > 60 ? 8 : laps.length > 30 ? 12 : 16;

  // tick labels every 5 laps
  const tickStep = 5;
  const stintChanges: { idx: number; stint: number; lap: number }[] = [];
  laps.forEach((s, i) => {
    if (i === 0 || laps[i - 1].stint_number !== s.stint_number) {
      stintChanges.push({ idx: i, stint: s.stint_number, lap: s.lap_number });
    }
  });

  return (
    <TooltipProvider delayDuration={100}>
      <div className="bg-card rounded-lg border border-border p-4" data-testid="soft-sensors-timeline-card">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          Timeline Soft Sensor
        </h3>
        <p className="text-[10px] text-muted-foreground/80 mb-4 italic">
          Stato latente stimato giro per giro · termica, stress gomma e grip pista
        </p>

        <div className="overflow-x-auto">
          <div className="inline-block min-w-full space-y-2">
            <TrackRow
              icon={<Thermometer className="h-3.5 w-3.5" />}
              label="Termica gomma"
              laps={laps}
              pickColor={(s) => THERMAL_COLOR[s.tyre_thermal.label]}
              pickLabel={(s) => THERMAL_LABEL_IT[s.tyre_thermal.label]}
              pickConfidence={(s) => s.tyre_thermal.confidence}
              cellWidth={cellWidth}
            />
            <TrackRow
              icon={<Gauge className="h-3.5 w-3.5" />}
              label="Stress gomma"
              laps={laps}
              pickColor={(s) => STRESS_COLOR[s.tyre_stress.label]}
              pickLabel={(s) => STRESS_LABEL_IT[s.tyre_stress.label]}
              pickConfidence={(s) => s.tyre_stress.confidence}
              cellWidth={cellWidth}
            />
            <TrackRow
              icon={<Waves className="h-3.5 w-3.5" />}
              label="Grip pista"
              laps={laps}
              pickColor={(s) => GRIP_COLOR[s.track_grip.label]}
              pickLabel={(s) => GRIP_LABEL_IT[s.track_grip.label]}
              pickConfidence={(s) => s.track_grip.confidence}
              cellWidth={cellWidth}
            />

            {/* Lap axis */}
            <div className="flex items-center gap-3 pt-1">
              <div className="w-32 shrink-0" />
              <div className="flex gap-px relative">
                {laps.map((s, i) => {
                  const prev = laps[i - 1];
                  const stintChange = prev && prev.stint_number !== s.stint_number;
                  const showTick = s.lap_number % tickStep === 0 || i === 0 || i === laps.length - 1;
                  return (
                    <div
                      key={`tick-${s.lap_number}-${i}`}
                      style={{ width: cellWidth, marginLeft: stintChange ? 2 : 0 }}
                      className="text-[9px] font-mono text-muted-foreground text-center"
                    >
                      {showTick ? s.lap_number : ""}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Stint labels */}
            {stintChanges.length > 0 && (
              <div className="flex items-center gap-3 pt-1">
                <div className="w-32 shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground">
                  Stint
                </div>
                <div className="flex gap-px">
                  {laps.map((s, i) => {
                    const prev = laps[i - 1];
                    const stintChange = !prev || prev.stint_number !== s.stint_number;
                    return (
                      <div
                        key={`stint-${s.lap_number}-${i}`}
                        style={{ width: cellWidth, marginLeft: prev && stintChange ? 2 : 0 }}
                        className="text-[9px] font-mono text-foreground/70 text-left"
                      >
                        {stintChange ? `S${s.stint_number}` : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 pt-3 border-t border-border grid grid-cols-1 md:grid-cols-3 gap-3">
          <LegendBlock
            title="Termica gomma"
            items={[
              { color: THERMAL_COLOR.COLD, label: "Fredde" },
              { color: THERMAL_COLOR.WARMING_UP, label: "In riscaldamento" },
              { color: THERMAL_COLOR.IN_WINDOW, label: "In finestra" },
              { color: THERMAL_COLOR.HOT, label: "Calde" },
              { color: THERMAL_COLOR.OVERHEATED, label: "Surriscaldate" },
            ]}
          />
          <LegendBlock
            title="Stress gomma"
            items={[
              { color: STRESS_COLOR.LOW, label: "Basso" },
              { color: STRESS_COLOR.MODERATE, label: "Moderato" },
              { color: STRESS_COLOR.HIGH, label: "Alto" },
              { color: STRESS_COLOR.CRITICAL, label: "Critico" },
            ]}
          />
          <LegendBlock
            title="Grip pista"
            items={[
              { color: GRIP_COLOR.LOW_GRIP, label: "Grip basso" },
              { color: GRIP_COLOR.IMPROVING, label: "In miglioramento" },
              { color: GRIP_COLOR.STABLE, label: "Stabile" },
              { color: GRIP_COLOR.FALLING, label: "In calo" },
              { color: GRIP_COLOR.MIXED, label: "Misto" },
            ]}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-4 rounded-[2px] bg-muted-foreground/60" />
            <span>Non determinato</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-4 rounded-[2px]"
              style={{
                backgroundColor: "#22c55e",
                opacity: 0.45,
                backgroundImage:
                  "repeating-linear-gradient(45deg, transparent 0 2px, rgba(0,0,0,0.35) 2px 4px)",
              }}
            />
            <span>Affidabilità bassa (tratteggio + trasparenza)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-0.5 bg-foreground" />
            <span>Cambio stint</span>
          </div>
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground/80 italic leading-snug">
          I soft sensor sono stime di stato latente derivate da segnali indiretti (passo, degrado, meteo, stato pista) e non sono misure dirette di telemetria. I giri marcati come "Non determinato" o a bassa affidabilità non dispongono di segnali sufficienti per una stima robusta.
        </p>
      </div>
    </TooltipProvider>
  );
}
