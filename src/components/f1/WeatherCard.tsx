import type { WeatherData } from "@/lib/openf1";
import { Cloud, Droplets, Thermometer, Wind, Gauge } from "lucide-react";

interface Props {
  weather: WeatherData;
}

function windDirectionLabel(deg: number) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

export function WeatherCard({ weather }: Props) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Cloud className="h-3.5 w-3.5" />
        Weather Conditions
      </h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-[hsl(var(--f1-red))]" />
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Air</div>
            <div className="font-mono font-bold tabular-nums">{weather.air_temperature}°C</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-amber-500" />
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Track</div>
            <div className="font-mono font-bold tabular-nums">{weather.track_temperature}°C</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-blue-400" />
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Humidity</div>
            <div className="font-mono font-bold tabular-nums">{weather.humidity}%</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Wind className="h-4 w-4 text-teal-400" />
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Wind</div>
            <div className="font-mono font-bold tabular-nums">
              {weather.wind_speed} m/s {windDirectionLabel(weather.wind_direction)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Pressure</div>
            <div className="font-mono font-bold tabular-nums">{weather.pressure} mbar</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-sky-400" />
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Rain</div>
            <div className="font-mono font-bold tabular-nums">{weather.rainfall ? "Yes" : "No"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
