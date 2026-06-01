import type { SoftSensorsLapState, SoftSensorConfidence, TyreThermalLabel, TyreStressLabel, TrackGripLabel } from "@/lib/softSensors";
import { Activity, Thermometer, Gauge, Waves } from "lucide-react";

interface Props {
  state: SoftSensorsLapState | null;
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

function confidenceClasses(conf: SoftSensorConfidence, isUnknown: boolean): string {
  if (isUnknown) return "text-muted-foreground/60";
  if (conf === "HIGH") return "text-foreground";
  if (conf === "MEDIUM") return "text-foreground/80";
  return "text-muted-foreground";
}

function ConfidenceBadge({ conf }: { conf: SoftSensorConfidence }) {
  const bg = conf === "HIGH" ? "bg-emerald-500/15 text-emerald-400" : conf === "MEDIUM" ? "bg-amber-500/15 text-amber-400" : "bg-muted text-muted-foreground";
  return (
    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider ${bg}`}>
      {CONFIDENCE_LABEL_IT[conf]}
    </span>
  );
}

function SensorRow({
  icon,
  label,
  valueLabel,
  isUnknown,
  confidence,
}: {
  icon: React.ReactNode;
  label: string;
  valueLabel: string;
  isUnknown: boolean;
  confidence: SoftSensorConfidence;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</div>
        <div className={`font-mono text-sm font-semibold ${confidenceClasses(confidence, isUnknown)}`}>
          {isUnknown ? "—" : valueLabel}
        </div>
      </div>
      <ConfidenceBadge conf={confidence} />
    </div>
  );
}

export function SoftSensorsLapCard({ state }: Props) {
  if (!state) return null;

  const thermalUnknown = state.tyre_thermal.label === "UNKNOWN";
  const stressUnknown = state.tyre_stress.label === "UNKNOWN";
  const gripUnknown = state.track_grip.label === "UNKNOWN";

  return (
    <div className="bg-card rounded-lg border border-border p-4" data-testid="soft-sensors-lap-card">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" />
        Soft Sensor (giro {state.lap_number})
      </h3>
      <p className="text-[10px] text-muted-foreground/80 mb-3 italic">
        Stato latente stimato per-giro · stint {state.stint_number}
      </p>

      <div className="space-y-2.5">
        <SensorRow
          icon={<Thermometer className="h-4 w-4" />}
          label="Termica gomma"
          valueLabel={THERMAL_LABEL_IT[state.tyre_thermal.label]}
          isUnknown={thermalUnknown}
          confidence={state.tyre_thermal.confidence}
        />
        <SensorRow
          icon={<Gauge className="h-4 w-4" />}
          label="Stress gomma"
          valueLabel={STRESS_LABEL_IT[state.tyre_stress.label]}
          isUnknown={stressUnknown}
          confidence={state.tyre_stress.confidence}
        />
        <SensorRow
          icon={<Waves className="h-4 w-4" />}
          label="Grip pista"
          valueLabel={GRIP_LABEL_IT[state.track_grip.label]}
          isUnknown={gripUnknown}
          confidence={state.track_grip.confidence}
        />
      </div>

      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Affidabilità complessiva</span>
        <ConfidenceBadge conf={state.overall_confidence} />
      </div>

      {state.reliability_notes.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {state.reliability_notes.map((n, i) => (
            <li key={i} className="text-[10px] text-muted-foreground/80 leading-snug">• {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
