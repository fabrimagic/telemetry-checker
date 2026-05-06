import { useEffect, useState } from "react";
import { detectLiveSession, fetchLivedata, LiveDriver, LiveSession } from "@/lib/livedataClient";
import { LiveTimingTable } from "@/components/internal/LiveTimingTable";
import { LiveTelemetryPanel } from "@/components/internal/LiveTelemetryPanel";
import { LiveStrategyMonitor } from "@/components/internal/LiveStrategyMonitor";

export default function InternalLiveDashboard() {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectLiveSession()
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setLoading(false);
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchLivedata<LiveDriver>("/v1/drivers", { session_key: session.session_key })
      .then((d) => {
        if (cancelled) return;
        setDrivers(d);
        if (d.length > 0 && selectedDriver == null) {
          setSelectedDriver(d[0].driver_number);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.session_key]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Rilevamento sessione live…</div>;
  }

  if (!session) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Pitwall — Live Timing (Internal)</h1>
        <div className="text-sm text-muted-foreground border border-border rounded p-4">
          Nessuna sessione F1 live in corso. Forzare una sessione via{" "}
          <code className="text-xs bg-muted px-1 rounded">?test_session_key=NNN</code> per testare.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 min-h-screen bg-background">
      <header className="mb-4 flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">Pitwall — Live Timing (Internal)</h1>
        <div className="text-xs text-muted-foreground">
          {session.country_name ?? session.location ?? session.circuit_short_name} ·{" "}
          {session.session_name} · session_key {session.session_key}
        </div>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-[60%_40%] gap-4">
        <section className="rounded border border-border bg-card p-2">
          <LiveTimingTable
            session={session}
            selectedDriver={selectedDriver}
            onSelectDriver={setSelectedDriver}
          />
        </section>
        <div className="space-y-4 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
          <section className="rounded border border-border bg-card p-3">
            <LiveTelemetryPanel
              session={session}
              drivers={drivers}
              selectedDriver={selectedDriver}
              onSelectDriver={setSelectedDriver}
            />
          </section>
          <section className="rounded border border-border bg-card p-3">
            <LiveStrategyMonitor
              session={session}
              drivers={drivers}
              selectedDriver={selectedDriver}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
