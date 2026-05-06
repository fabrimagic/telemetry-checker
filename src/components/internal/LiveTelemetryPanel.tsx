import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  fetchLivedata,
  isDrsActive,
  LiveCarData,
  LiveDriver,
  LiveSession,
} from "@/lib/livedataClient";
import { useLivePolling } from "@/hooks/useLivePolling";

interface Props {
  session: LiveSession;
  drivers: LiveDriver[];
  selectedDriver: number | null;
  onSelectDriver: (n: number) => void;
}

const WINDOW_MS = 30_000;
const POLL_MS = 270;

interface Sample {
  t: number; // relative seconds (negative)
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: number;
}

export function LiveTelemetryPanel({ session, drivers, selectedDriver, onSelectDriver }: Props) {
  const [samples, setSamples] = useState<LiveCarData[]>([]);
  const lastDriverRef = useRef<number | null>(selectedDriver);

  // Reset window on driver change
  useEffect(() => {
    if (lastDriverRef.current !== selectedDriver) {
      setSamples([]);
      lastDriverRef.current = selectedDriver;
    }
  }, [selectedDriver]);

  const fetcher = useMemo(
    () => async () => {
      if (selectedDriver == null) return [] as LiveCarData[];
      const since = new Date(Date.now() - WINDOW_MS - 5000).toISOString();
      return fetchLivedata<LiveCarData>("/v1/car_data", {
        session_key: session.session_key,
        driver_number: selectedDriver,
        "date>=": since,
      });
    },
    [session.session_key, selectedDriver],
  );

  const { data, error, loading } = useLivePolling(fetcher, POLL_MS, selectedDriver != null);

  useEffect(() => {
    if (!data) return;
    setSamples((prev) => {
      const merged = [...prev];
      const seen = new Set(merged.map((p) => p.date));
      for (const r of data) {
        if (!seen.has(r.date)) merged.push(r);
      }
      const cutoff = Date.now() - WINDOW_MS;
      return merged.filter((p) => new Date(p.date).getTime() >= cutoff);
    });
  }, [data]);

  const now = Date.now();
  const series: Sample[] = samples.map((s) => ({
    t: (new Date(s.date).getTime() - now) / 1000,
    speed: s.speed,
    throttle: s.throttle,
    brake: s.brake,
    gear: s.n_gear,
    rpm: s.rpm,
    drs: s.drs,
  }));

  const current = samples[samples.length - 1];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Pilota:</label>
        <select
          className="bg-background border border-border rounded px-2 py-1 text-sm"
          value={selectedDriver ?? ""}
          onChange={(e) => onSelectDriver(Number(e.target.value))}
        >
          <option value="">— seleziona —</option>
          {drivers.map((d) => (
            <option key={d.driver_number} value={d.driver_number}>
              #{d.driver_number} {d.name_acronym} {d.team_name ? `(${d.team_name})` : ""}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="text-xs text-yellow-500">Errore: {error.message}</div>}

      {selectedDriver == null ? (
        <div className="text-sm text-muted-foreground">Seleziona un pilota.</div>
      ) : loading && samples.length === 0 ? (
        <div className="text-sm text-muted-foreground">Caricamento telemetria…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <Metric label="Velocità" value={current ? `${current.speed} km/h` : "—"} />
            <Metric label="Marcia" value={current ? `${current.n_gear}` : "—"} />
            <Metric
              label="Throttle / Brake"
              value={current ? `${current.throttle}% / ${current.brake}%` : "—"}
            />
            <Metric label="RPM" value={current ? `${current.rpm}` : "—"} />
            <Metric
              label="DRS"
              value={current ? (isDrsActive(current.drs) ? "ATTIVO" : "chiuso") : "—"}
              highlight={current ? isDrsActive(current.drs) : false}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ChartBox title="Velocità (km/h)">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="t" type="number" domain={[-30, 0]} tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 360]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="speed"
                  stroke="#60a5fa"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartBox>
            <ChartBox title="Throttle / Brake (%)">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="t" type="number" domain={[-30, 0]} tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="throttle"
                  stroke="#22c55e"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="brake"
                  stroke="#ef4444"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartBox>
            <ChartBox title="Marcia">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="t" type="number" domain={[-30, 0]} tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 8]} ticks={[0, 1, 2, 3, 4, 5, 6, 7, 8]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line
                  type="step"
                  dataKey="gear"
                  stroke="#f59e0b"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartBox>
            <ChartBox title="RPM">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="t" type="number" domain={[-30, 0]} tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 13000]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="rpm"
                  stroke="#a78bfa"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartBox>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-muted/30 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-bold font-mono ${
          highlight ? "text-green-400" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ChartBox({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-2">
      <div className="text-xs text-muted-foreground mb-1">{title}</div>
      <div style={{ width: "100%", height: 160 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  );
}
