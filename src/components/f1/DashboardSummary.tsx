import type { VirtualRaceEngineerResult } from "@/lib/virtualRaceEngineer";
import type { DiaryEvent } from "@/lib/raceDiary";
import type { KeyDecisionMomentsResult } from "@/lib/keyDecisionMoments";
import { CheckCircle, AlertTriangle, Gauge, TrendingDown, Navigation, Thermometer, Target, Activity } from "lucide-react";

interface Props {
  vreResult: VirtualRaceEngineerResult | null;
  kdmResult: KeyDecisionMomentsResult | null;
  diaryEvents: DiaryEvent[];
  driverHeadshotUrl?: string | null;
  driverAcronym: string;
  driverColor: string;
  sessionType: string;
}

const confLabels: Record<string, string> = { HIGH: "Alta", MEDIUM: "Media", LOW: "Bassa" };
const confColors: Record<string, string> = {
  HIGH: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  MEDIUM: "text-amber-400 bg-amber-500/15 border-amber-500/30",
  LOW: "text-red-400 bg-red-500/15 border-red-500/30",
};

export function DashboardSummary({ vreResult, kdmResult, diaryEvents, driverHeadshotUrl, driverAcronym, driverColor, sessionType }: Props) {
  const isRace = sessionType === "Race" || sessionType === "Sprint";

  if (!isRace || !vreResult) {
    return null;
  }

  const { verdict, confidence, recommended_strategy, actual_strategy, integrated_context, degradation_validations, pace_loss_results, soft_sensors, narrative_insights } = vreResult;

  // Build quick stats
  const totalStints = actual_strategy.stints.length;
  const totalPits = actual_strategy.pit_stops.length;
  const validDeg = degradation_validations?.filter(d => d.status === "VALID").length ?? 0;
  const totalDeg = degradation_validations?.length ?? 0;
  const neutralLaps = integrated_context?.track_status_context?.total_neutralized_laps ?? 0;
  const battles = integrated_context?.battle_context?.total_episodes ?? 0;
  const kdmCount = kdmResult?.decision_points.length ?? 0;

  // Top 3 insights
  const topInsights = (narrative_insights ?? []).slice(0, 3);

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Hero: Verdict */}
      <div className="px-4 py-4 flex items-start gap-4">
        {/* Driver photo */}
        {driverHeadshotUrl && (
          <img
            src={driverHeadshotUrl}
            alt={driverAcronym}
            className="w-14 h-14 rounded-full object-cover border-2 shrink-0"
            style={{ borderColor: `#${driverColor}` }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {verdict.delta_seconds != null && verdict.delta_seconds > 2
              ? <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              : <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />}
            <h2 className="text-sm font-bold text-foreground truncate">{verdict.label}</h2>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold ${confColors[confidence]}`}>
              <Gauge className="h-3 w-3" />
              Affidabilità {confLabels[confidence] ?? confidence}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{verdict.summary}</p>
          {verdict.delta_seconds != null && verdict.delta_seconds > 0.1 && (
            <p className="text-xs text-muted-foreground mt-1">
              Tempo recuperabile: <span className="font-mono font-bold text-emerald-400">{verdict.delta_seconds.toFixed(1)}s</span>
            </p>
          )}
        </div>
      </div>

      {/* Quick stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/50">
        <QuickStat icon={<TrendingDown className="h-3.5 w-3.5" />} label="Stint" value={`${totalStints} stint, ${totalPits} pit`} />
        <QuickStat
          icon={<Target className="h-3.5 w-3.5" />}
          label="Degrado"
          value={totalDeg > 0 ? `${validDeg}/${totalDeg} validi` : "N/D"}
          status={validDeg === totalDeg ? "positive" : validDeg > 0 ? "warning" : "negative"}
        />
        <QuickStat
          icon={<Navigation className="h-3.5 w-3.5" />}
          label="Contesto"
          value={[neutralLaps > 0 && `${neutralLaps} neutraliz.`, battles > 0 && `${battles} battaglie`].filter(Boolean).join(", ") || "Nessuno"}
        />
        <QuickStat
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Decisioni"
          value={kdmCount > 0 ? `${kdmCount} momenti chiave` : "Nessuno"}
          status={kdmCount > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* Top insights */}
      {topInsights.length > 0 && (
        <div className="px-4 py-3 border-t border-border/50">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Punti chiave</p>
          <ul className="space-y-1">
            {topInsights.map((insight, i) => (
              <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <span className="text-foreground/50 shrink-0 mt-0.5">•</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function QuickStat({ icon, label, value, status = "neutral" }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status?: "positive" | "warning" | "negative" | "neutral";
}) {
  const statusColor = status === "positive" ? "text-emerald-400" : status === "warning" ? "text-amber-400" : status === "negative" ? "text-red-400" : "text-foreground";
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className={`text-xs font-semibold ${statusColor}`}>{value}</p>
    </div>
  );
}
