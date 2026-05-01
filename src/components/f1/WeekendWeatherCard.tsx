import { useEffect, useState } from "react";
import { Cloud, CloudRain, Droplets, Sun, Thermometer, Wind, Loader2, CloudSnow, CloudFog, CloudLightning } from "lucide-react";
import {
  getWeekendForecast,
  describeWeatherCode,
  type WeekendForecast,
} from "@/lib/weekendWeatherForecast";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function formatSessionLabel(dateUtc: string, timezone: string): string {
  // Local circuit time so the user sees when the session actually runs there.
  const d = new Date(dateUtc);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
}

function WeatherIcon({ code, className }: { code: number | null; className?: string }) {
  if (code == null) return <Cloud className={className} />;
  if (code === 0 || code === 1) return <Sun className={className} />;
  if (code === 2 || code === 3) return <Cloud className={className} />;
  if (code === 45 || code === 48) return <CloudFog className={className} />;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain className={className} />;
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return <CloudSnow className={className} />;
  if (code >= 95) return <CloudLightning className={className} />;
  return <Cloud className={className} />;
}

export function WeekendWeatherCard() {
  const [forecast, setForecast] = useState<WeekendForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const f = await getWeekendForecast(new Date());
        if (cancelled) return;
        if (!f) {
          setError("Previsioni non disponibili per il prossimo weekend");
          setForecast(null);
        } else {
          setError(null);
          setForecast(f);
        }
      } catch {
        if (!cancelled) setError("Errore nel caricamento meteo");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    // Auto-refresh every 6 hours. The cache TTL also matches 6h, so a refresh
    // will trigger a fresh network call.
    const id = setInterval(() => {
      // Force a refetch by clearing the in-memory state; the cache is already
      // expired by the time the interval fires.
      setLoading(true);
      load();
    }, SIX_HOURS_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (loading && !forecast) {
    return (
      <div className="card-premium rounded-xl p-5">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Caricamento meteo weekend…</span>
        </div>
      </div>
    );
  }

  if (error || !forecast) {
    return (
      <div className="card-premium rounded-xl p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Cloud className="w-4 h-4" />
          <span>{error ?? "Meteo non disponibile"}</span>
        </div>
      </div>
    );
  }

  const updated = new Date(forecast.generatedAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="card-premium rounded-xl p-5">
      <header className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Cloud className="w-4 h-4 text-[hsl(var(--f1-red-glow))] shrink-0" />
          <h3 className="text-sm font-black uppercase tracking-[0.2em] truncate">
            Meteo weekend
          </h3>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">
          Agg. {updated}
        </span>
      </header>

      <p className="text-xs text-muted-foreground mb-4 truncate" title={forecast.gpName}>
        {forecast.gpName}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
        {forecast.sessions.map((sf) => {
          const t = sf.temperatureC;
          const p = sf.precipitationProbability;
          const w = sf.windKph;
          const mm = sf.precipitationMm;
          return (
            <div
              key={`${sf.session.sessionType}-${sf.session.dateUtc}`}
              className="rounded-lg border border-border/60 bg-card/40 p-3 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-[hsl(var(--f1-red-glow))]">
                  {sf.session.sessionType}
                </span>
                <WeatherIcon code={sf.weatherCode} className="w-4 h-4 text-foreground/80" />
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                {formatSessionLabel(sf.session.dateUtc, forecast.coords.timezone)}
                <span className="block opacity-60 text-[9px]">ora locale circuito</span>
              </div>
              <div className="text-xs font-semibold text-foreground/90">
                {describeWeatherCode(sf.weatherCode)}
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1" title="Temperatura">
                  <Thermometer className="w-3 h-3" />
                  {t != null ? `${Math.round(t)}°C` : "—"}
                </span>
                <span className="inline-flex items-center gap-1" title="Prob. pioggia">
                  <Droplets className="w-3 h-3" />
                  {p != null ? `${Math.round(p)}%` : "—"}
                </span>
                <span className="inline-flex items-center gap-1" title="Vento">
                  <Wind className="w-3 h-3" />
                  {w != null ? `${Math.round(w)} km/h` : "—"}
                </span>
                <span className="inline-flex items-center gap-1" title="Precipitazioni">
                  <CloudRain className="w-3 h-3" />
                  {mm != null ? `${mm.toFixed(1)} mm` : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground/70">
        Fonte: Open-Meteo · aggiornamento automatico ogni 6h
      </p>
    </div>
  );
}
