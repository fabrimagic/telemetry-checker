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
              <Stat
                label="ρ baseline trap+settori (monitoring)"
                value={fmt(result.aggregate.rho_baseline_topsec_mean)}
              />
              <Stat
                label="ρ baseline solo-settori (PRODUZIONE)"
                value={fmt(result.aggregate.rho_baseline_sectors_mean)}
                highlight
              />
              <Stat
                label="Δ (modello − produzione)"
                value={fmt(result.aggregate.delta_mean)}
              />
              <Stat
                label="Δ (solo-settori − trap+settori)"
                value={fmt(result.aggregate.delta_sectors_vs_topsec)}
              />
              <Stat label="Top-3 modello" value={fmtPct(result.aggregate.top3_model_rate)} />
              <Stat
                label="Top-3 trap+settori"
                value={fmtPct(result.aggregate.top3_baseline_topsec_rate)}
              />
              <Stat
                label="Top-3 solo-settori (PRODUZIONE)"
                value={fmtPct(result.aggregate.top3_baseline_sectors_rate)}
              />
              <Stat
                label="ρ modello circuito-specifico (per-tipo, monitoring)"
                value={fmt(result.aggregate.rho_circuit_specific_mean)}
              />
              <Stat
                label="Top-3 circuito-specifico"
                value={fmtPct(result.aggregate.top3_circuit_specific_rate)}
              />
              <Stat
                label="Δ (circuito-specifico − solo-settori)"
                value={fmt(result.aggregate.delta_circuit_vs_sectors)}
                highlight
              />
              <Stat
                label="ρ candidata A: solo-settori con normalizzazione gap_ratio"
                value={fmt(result.aggregate.rho_baseline_sectors_gap_mean)}
              />
              <Stat
                label="Δ (gap_ratio − produzione)"
                value={fmt(result.aggregate.delta_sectors_gap_vs_sectors)}
              />
              <Stat
                label="Top-3 candidata A (gap_ratio)"
                value={fmtPct(result.aggregate.top3_baseline_sectors_gap_rate)}
              />
              <Stat
                label="ρ candidata B: sensibilità per team"
                value={fmt(result.aggregate.rho_team_sensitivity_mean)}
              />
              <Stat
                label="Δ (sensibilità per team − produzione)"
                value={fmt(result.aggregate.delta_team_sensitivity_vs_sectors)}
              />
            <Stat
              label="Top-3 candidata B (sensibilità per team)"
              value={fmtPct(result.aggregate.top3_team_sensitivity_rate)}
            />
            <Stat
              label="Gare con sensibilità attiva"
              value={
                result.aggregate.races_with_active_sensitivity != null
                  ? `${result.aggregate.races_with_active_sensitivity}/${result.aggregate.races_validated}`
                  : "—"
              }
            />
          </div>
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              La baseline che rappresenta la <strong>produzione</strong> è{" "}
              <strong>solo-settori</strong> (promossa dall'Opzione 1). Con poche
              gare validate (N piccolo) questi numeri sono
              <strong> indicativi</strong>, non conclusivi.
            </p>
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              <strong>Ruolo B — monitoraggio per-tipo di curva.</strong> Il
              modello circuito-specifico USA la distinzione lente/medie/veloci.
              Se <strong>Δ (circuito-specifico − solo-settori) &gt; 0</strong>{" "}
              e stabile su più gare, la distinzione per tipo di curva inizia a
              migliorare la previsione → candidarla al punteggio. Oggi atteso
              ≤ 0. È il segnale di monitoraggio per il ruolo predittivo (B);
              il punteggio di produzione resta <strong>solo-settori</strong>.
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
                    <th className="py-2 pr-3">ρ trap+sett</th>
                    <th className="py-2 pr-3">ρ solo-sett</th>
                    <th className="py-2 pr-3">ρ circ-spec</th>
                    <th className="py-2 pr-3">ρ gap_ratio</th>
                    <th className="py-2 pr-3">ρ sens. team</th>
                    <th className="py-2 pr-3">Top-3 mod</th>
                    <th className="py-2 pr-3">Top-3 t+s</th>
                    <th className="py-2 pr-3">Top-3 s</th>
                    <th className="py-2 pr-3">Top-3 c-s</th>
                    <th className="py-2 pr-3">Top-3 gap</th>
                    <th className="py-2 pr-3">Top-3 sens</th>
                    <th className="py-2 pr-3">n team</th>
                    <th className="py-2 pr-3">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {result.per_race.map((r, i) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-2 pr-3">{r.gpName}</td>
                      <td className="py-2 pr-3">{fmt(r.rho_model)}</td>
                      <td className="py-2 pr-3">{fmt(r.rho_baseline_topsec)}</td>
                      <td className="py-2 pr-3">{fmt(r.rho_baseline_sectors)}</td>
                      <td className="py-2 pr-3">{fmt(r.rho_circuit_specific)}</td>
                      <td className="py-2 pr-3">{fmt(r.rho_baseline_sectors_gap)}</td>
                      <td className="py-2 pr-3">{fmt(r.rho_team_sensitivity)}</td>
                      <td className="py-2 pr-3">{fmtBool(r.top3_model)}</td>
                      <td className="py-2 pr-3">{fmtBool(r.top3_baseline_topsec)}</td>
                      <td className="py-2 pr-3">{fmtBool(r.top3_baseline_sectors)}</td>
                      <td className="py-2 pr-3">{fmtBool(r.top3_circuit_specific)}</td>
                      <td className="py-2 pr-3">{fmtBool(r.top3_baseline_sectors_gap)}</td>
                      <td className="py-2 pr-3">{fmtBool(r.top3_team_sensitivity)}</td>
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
