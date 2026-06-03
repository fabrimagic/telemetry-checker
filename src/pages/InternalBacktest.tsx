import { useCallback, useRef, useState } from "react";
import { runBacktest, type BacktestResult } from "@/lib/gpBacktest";

export default function InternalBacktest() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; gp?: string }>(
    { done: 0, total: 0 },
  );
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onRun = useCallback(async () => {
    if (running) return;
    setError(null);
    setResult(null);
    setRunning(true);
    setProgress({ done: 0, total: 0 });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const out = await runBacktest({
        signal: ac.signal,
        onProgress: (done, total, gp) => setProgress({ done, total, gp }),
      });
      setResult(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore inatteso");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [running]);

  const onAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const fmt = (x: number | null | undefined, digits = 3) =>
    x == null || !Number.isFinite(x) ? "—" : x.toFixed(digits);
  const fmtPct = (x: number | null | undefined) =>
    x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(0)}%`;
  const fmtBool = (x: boolean | null | undefined) =>
    x == null ? "—" : x ? "✓" : "✗";

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Backtest Anteprima GP (internal)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Strumento diagnostico: ricostruisce la previsione "come sarebbe stata prima
          del weekend" di ogni gara passata del 2026 (dalla 2ª in poi) e la confronta
          con la qualifica reale. Confronta anche con una baseline di pura persistenza.
          NON modifica il calcolo di produzione.
        </p>
      </header>

      <div className="flex gap-3 items-center">
        <button
          onClick={onRun}
          disabled={running}
          className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          {running ? "In corso…" : "Esegui backtest"}
        </button>
        {running && (
          <button
            onClick={onAbort}
            className="px-3 py-2 rounded border border-border text-sm"
          >
            Annulla
          </button>
        )}
        {running && (
          <div className="text-sm text-muted-foreground">
            {progress.done}/{progress.total} {progress.gp ? `— ${progress.gp}` : ""}
          </div>
        )}
      </div>

      {running && progress.total > 0 && (
        <div className="w-full h-2 bg-muted rounded overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 text-destructive p-3 rounded text-sm">
          {error}
        </div>
      )}

      {result && (
        <>
          <section className="border border-border rounded p-4 space-y-2">
            <h2 className="text-lg font-semibold">Aggregati</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <Stat label="Gare validate" value={String(result.aggregate.races_validated)} />
              <Stat label="ρ modello (media)" value={fmt(result.aggregate.rho_model_mean)} />
              <Stat label="ρ baseline (media)" value={fmt(result.aggregate.rho_baseline_mean)} />
              <Stat
                label="Δ (modello − baseline)"
                value={fmt(result.aggregate.delta_mean)}
                highlight
              />
              <Stat label="Top-3 hit modello" value={fmtPct(result.aggregate.top3_model_rate)} />
              <Stat label="Top-3 hit baseline" value={fmtPct(result.aggregate.top3_baseline_rate)} />
            </div>
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              Lettura: se ρ modello &gt; ρ baseline (Δ &gt; 0), l'analisi circuito-specifica
              aggiunge potere predittivo. Se Δ ≈ 0 o &lt; 0, con i dati attuali il
              modello non batte la semplice persistenza ("chi era forte resta forte").
              Con poche gare validate (N piccolo) questi numeri sono <strong>indicativi</strong>,
              non conclusivi.
            </p>
          </section>

          <section className="border border-border rounded p-4">
            <h2 className="text-lg font-semibold mb-3">Per gara</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-2 pr-3">GP</th>
                    <th className="py-2 pr-3">ρ modello</th>
                    <th className="py-2 pr-3">ρ baseline</th>
                    <th className="py-2 pr-3">Top-3 mod</th>
                    <th className="py-2 pr-3">Top-3 base</th>
                    <th className="py-2 pr-3">n team</th>
                    <th className="py-2 pr-3">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {result.per_race.map((r, i) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-2 pr-3">{r.gpName}</td>
                      <td className="py-2 pr-3">{fmt(r.rho_model)}</td>
                      <td className="py-2 pr-3">{fmt(r.rho_baseline)}</td>
                      <td className="py-2 pr-3">{fmtBool(r.top3_model)}</td>
                      <td className="py-2 pr-3">{fmtBool(r.top3_baseline)}</td>
                      <td className="py-2 pr-3">{r.n_teams || "—"}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {r.skipped_reason ?? "validata"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.notes.length > 0 && (
              <ul className="mt-3 text-xs text-muted-foreground list-disc pl-5">
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`p-3 rounded border ${
        highlight ? "border-primary/40 bg-primary/5" : "border-border"
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-mono mt-1">{value}</div>
    </div>
  );
}
