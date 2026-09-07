import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComparisonResult } from "@/lib/headToHeadComparison";
import type { Driver, Lap } from "@/lib/openf1";

interface Props {
  comparison: ComparisonResult;
  driverA: Driver;
  driverB: Driver;
  lapsA: Lap[];
  lapsB: Lap[];
}

interface PitGapRow {
  key: string;
  pittingAcronym: string;
  pittingColor: string;
  lap: number;
  before: { leaderAcronym: string; gap: number } | null;
  after: { leaderAcronym: string; gap: number } | null;
}

/** Crossing timestamp (ms) at the END of lap `lapN`: date_start of lap N+1,
 *  fallback date_start(N) + lap_duration. Same technique already used elsewhere. */
function crossingEndOfLap(byLap: Map<number, Lap>, lapN: number): number | null {
  const next = byLap.get(lapN + 1);
  if (next?.date_start) {
    const t = Date.parse(next.date_start);
    if (Number.isFinite(t)) return t;
  }
  const cur = byLap.get(lapN);
  if (cur?.date_start && cur.lap_duration != null && cur.lap_duration > 0) {
    const t = Date.parse(cur.date_start);
    if (Number.isFinite(t)) return t + cur.lap_duration * 1000;
  }
  return null;
}

function fmtGap(g: number): string {
  return `${g.toFixed(3)}s`;
}

export function ComparePitGaps({ comparison, driverA, driverB, lapsA, lapsB }: Props) {
  const rows = useMemo<PitGapRow[]>(() => {
    const mapA = new Map<number, Lap>();
    for (const l of lapsA) if (l.driver_number === comparison.driver_a.driver_number) mapA.set(l.lap_number, l);
    const mapB = new Map<number, Lap>();
    for (const l of lapsB) if (l.driver_number === comparison.driver_b.driver_number) mapB.set(l.lap_number, l);

    const gapAt = (lapN: number) => {
      if (lapN < 1) return null;
      const tA = crossingEndOfLap(mapA, lapN);
      const tB = crossingEndOfLap(mapB, lapN);
      if (tA == null || tB == null) return null;
      const diff = (tA - tB) / 1000; // >0 → A crosses later → B ahead
      return diff >= 0
        ? { leaderAcronym: driverB.name_acronym, gap: diff }
        : { leaderAcronym: driverA.name_acronym, gap: -diff };
    };

    const out: PitGapRow[] = [];
    const push = (lap: number, who: "A" | "B") => {
      out.push({
        key: `${who}-${lap}`,
        pittingAcronym: who === "A" ? driverA.name_acronym : driverB.name_acronym,
        pittingColor: `#${(who === "A" ? driverA.team_colour : driverB.team_colour) || "888888"}`,
        lap,
        before: gapAt(lap - 1),
        after: gapAt(lap + 1),
      });
    };
    for (const lap of comparison.driver_a.actual_strategy.pit_laps) push(lap, "A");
    for (const lap of comparison.driver_b.actual_strategy.pit_laps) push(lap, "B");
    return out.sort((x, y) => x.lap - y.lap || x.key.localeCompare(y.key));
  }, [comparison, driverA, driverB, lapsA, lapsB]);

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Distacco ai pit stop</CardTitle>
        <p className="text-xs text-muted-foreground">
          Per ogni sosta, il distacco tra i due piloti prima (fine giro precedente) e dopo (fine giro successivo),
          con l'indicazione di chi era davanti. Distacchi derivati dai passaggi osservati sul traguardo.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[520px]">
            <thead>
              <tr className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                <th className="text-left py-1.5 pr-3">Sosta</th>
                <th className="text-left py-1.5 pr-3">Giro</th>
                <th className="text-left py-1.5 pr-3">Prima della sosta</th>
                <th className="text-left py-1.5">Dopo la sosta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border/60">
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1.5 font-mono font-bold">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: r.pittingColor }}
                      />
                      {r.pittingAcronym}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-mono">L{r.lap}</td>
                  <td className="py-2 pr-3">
                    {r.before ? (
                      <span>
                        <strong className="font-mono">{r.before.leaderAcronym}</strong> davanti di{" "}
                        <span className="font-mono">{fmtGap(r.before.gap)}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2">
                    {r.after ? (
                      <span>
                        <strong className="font-mono">{r.after.leaderAcronym}</strong> davanti di{" "}
                        <span className="font-mono">{fmtGap(r.after.gap)}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          Quando il passaggio sul traguardo non è disponibile per uno dei due piloti il valore resta non calcolabile (—).
        </p>
      </CardContent>
    </Card>
  );
}
