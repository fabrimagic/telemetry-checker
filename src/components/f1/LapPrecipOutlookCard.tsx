import type { LapPrecipOutlook } from "@/lib/precipForecast";
import { CloudRain, Droplets } from "lucide-react";

interface Props {
  outlook: LapPrecipOutlook | null;
}

/**
 * Per-lap precipitation outlook card. Purely informative. The data shown here
 * NEVER feeds any strategic computation — it is a presentational reconstruction
 * of historical-forecast conditions in the ~15 minutes following the selected
 * lap. See src/lib/precipForecast.ts for the data source and licensing notes.
 */
export function LapPrecipOutlookCard({ outlook }: Props) {
  if (!outlook) return null;

  const native = outlook.data_resolution === "15min_native";
  const badgeClass = native
    ? "bg-emerald-500/15 text-emerald-400"
    : "bg-amber-500/15 text-amber-400";
  const badgeLabel = native
    ? "Risoluzione 15min nativa"
    : "Risoluzione oraria interpolata · indicativo";

  const probLabel = outlook.probability_pct == null ? "—" : `${Math.round(outlook.probability_pct)}%`;
  const mmLabel = outlook.precip_mm == null ? "—" : `${outlook.precip_mm.toFixed(2)} mm`;
  const noData = outlook.probability_pct == null && outlook.precip_mm == null;

  return (
    <div className="bg-card rounded-lg border border-border p-4" data-testid="lap-precip-outlook-card">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
        <CloudRain className="h-3.5 w-3.5" />
        Outlook precipitazioni — ~15 min successivi (ricostruito)
      </h3>
      <p className="text-[10px] text-muted-foreground/80 mb-3 italic">
        Ricostruzione storica delle condizioni attese, non il forecast ex-ante visto dal muretto in diretta.
      </p>

      {noData ? (
        <div className="text-sm text-muted-foreground">Dati non disponibili per questa finestra.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <CloudRain className="h-4 w-4 text-sky-400" />
            <div>
              <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Probabilità</div>
              <div className="font-mono font-bold tabular-nums">{probLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Droplets className="h-4 w-4 text-blue-400" />
            <div>
              <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Attesi</div>
              <div className="font-mono font-bold tabular-nums">{mmLabel}</div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Confidenza dato</span>
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>

      <p className="text-[10px] text-muted-foreground/70 leading-snug mt-2">
        Dato Open-Meteo Historical Forecast (CC BY 4.0) — ricostruzione storica, non previsione ex-ante.
      </p>
    </div>
  );
}
