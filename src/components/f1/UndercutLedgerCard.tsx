/**
 * Undercut Ledger Card — fase 1
 * Card informativa: mostra gli aggregati e i cicli misurati.
 * Non entra nello scoring strategico del VRE.
 */

import type { Driver } from "@/lib/openf1";
import type {
  UndercutLedgerResult,
  UndercutExclusionReason,
} from "@/lib/undercutLedger";

const EXCLUSION_LABEL: Record<UndercutExclusionReason, string> = {
  TRACK_STATUS_NON_GREEN: "Neutralizzazione nella finestra",
  WEATHER_NON_DRY: "Meteo non asciutto",
  MISSING_DATE_START: "Timestamp mancanti",
  RETIREMENT_IN_WINDOW: "Ritiro nella finestra",
  ANOMALOUS_PIT_DURATION: "Sosta anomala",
  EXTRA_PIT_IN_WINDOW: "Sosta aggiuntiva nella finestra di misura",
};

function acronym(dn: number, drivers: Driver[]): string {
  const d = drivers.find((x) => x.driver_number === dn);
  return d?.name_acronym ?? `#${dn}`;
}

function fmtGap(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${Math.abs(v).toFixed(2)}s`;
}

interface Props {
  ledger: UndercutLedgerResult;
  drivers: Driver[];
  /** Optional: highlight cycles involving this driver. */
  focusDriverNumber?: number | null;
}

export function UndercutLedgerCard({ ledger, drivers, focusDriverNumber = null }: Props) {
  const { cycles, excluded, aggregates } = ledger;

  if (aggregates.attempts_detected === 0) return null;

  const agg = aggregates;

  // Group excluded reasons for a compact summary line
  const exclusionCounts = new Map<UndercutExclusionReason, number>();
  for (const e of excluded) {
    exclusionCounts.set(e.reason, (exclusionCounts.get(e.reason) ?? 0) + 1);
  }

  return (
    <div
      data-testid="undercut-ledger"
      className="rounded border border-amber-500/30 bg-amber-500/5 p-3 space-y-2"
    >
      <p className="text-[11px] font-semibold text-amber-300 flex items-center gap-1.5">
        <span>⏱️</span> Undercut misurato
        <span className="ml-auto text-[9px] font-mono uppercase text-amber-200/70">
          confidenza {agg.confidence}
        </span>
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Tentativi</p>
          <p className="text-sm font-bold font-mono text-foreground">{agg.attempts_detected}</p>
          <p className="text-[9px] text-muted-foreground">{agg.valid_cycles} validi</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Swing mediano</p>
          <p className="text-sm font-bold font-mono text-foreground">
            {agg.median_swing_seconds != null ? fmtGap(agg.median_swing_seconds) : "—"}
          </p>
          <p className="text-[9px] text-muted-foreground">
            min {agg.min_swing_seconds != null ? fmtGap(agg.min_swing_seconds) : "—"} · max{" "}
            {agg.max_swing_seconds != null ? fmtGap(agg.max_swing_seconds) : "—"}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Swing &gt; 0</p>
          <p className="text-sm font-bold font-mono text-foreground">
            {agg.positive_swing_share != null ? `${Math.round(agg.positive_swing_share * 100)}%` : "—"}
          </p>
          <p className="text-[9px] text-muted-foreground">cicli con guadagno</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Sorpassi</p>
          <p className="text-sm font-bold font-mono text-foreground">
            {agg.overtake_share != null ? `${Math.round(agg.overtake_share * 100)}%` : "—"}
          </p>
          <p className="text-[9px] text-muted-foreground">cambio di posizione</p>
        </div>
      </div>

      {cycles.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="text-[9px] uppercase text-muted-foreground border-b border-amber-500/20">
                <th className="py-1 text-left">Attaccante → Difensore</th>
                <th className="py-1 text-right">Giri</th>
                <th className="py-1 text-right">Gap prima</th>
                <th className="py-1 text-right">Gap dopo</th>
                <th className="py-1 text-right">Swing</th>
                <th className="py-1 text-left pl-2">Mescole</th>
                <th className="py-1 text-center">Esito</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c, i) => {
                const involves = focusDriverNumber != null && (
                  c.attacker_driver_number === focusDriverNumber ||
                  c.defender_driver_number === focusDriverNumber
                );
                return (
                  <tr
                    key={i}
                    className={`border-b border-amber-500/10 ${involves ? "bg-amber-500/10" : ""}`}
                  >
                    <td className="py-1 text-left">
                      {acronym(c.attacker_driver_number, drivers)} → {acronym(c.defender_driver_number, drivers)}
                    </td>
                    <td className="py-1 text-right">L{c.attacker_pit_lap} / L{c.defender_pit_lap}</td>
                    <td className="py-1 text-right">{fmtGap(c.gap_before_seconds)}</td>
                    <td className="py-1 text-right">{fmtGap(c.gap_after_seconds)}</td>
                    <td className={`py-1 text-right ${c.swing_seconds > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {fmtGap(c.swing_seconds)}
                    </td>
                    <td className="py-1 text-left pl-2 text-muted-foreground">
                      {(c.attacker_compound_before ?? "?")}→{(c.attacker_compound_after ?? "?")} vs {(c.defender_compound_before ?? "?")}→{(c.defender_compound_after ?? "?")}
                    </td>
                    <td className="py-1 text-center">
                      {c.overtake_completed
                        ? <span className="text-emerald-400">sorpasso</span>
                        : <span className="text-muted-foreground">nessun sorpasso</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {excluded.length > 0 && (
        <p className="text-[10px] text-amber-200/80 leading-snug">
          Esclusi {excluded.length} tentativ{excluded.length === 1 ? "o" : "i"}:{" "}
          {[...exclusionCounts.entries()]
            .map(([reason, n]) => `${EXCLUSION_LABEL[reason]} (${n})`)
            .join(" · ")}
          .
        </p>
      )}

      <p className="text-[9px] text-muted-foreground italic leading-snug">
        {ledger.method_declaration} {ledger.measured_case_note}
      </p>
    </div>
  );
}
