import { useState, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { type DegradationResult } from "@/lib/tyreDegradation";
import { validateAllDegradationEstimates, type DegradationValidationResult } from "@/lib/degradationValidation";
import { type LongRunResult } from "@/lib/longRunDetector";
import { Watermark } from "./Watermark";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
} from "recharts";
import { TrendingDown, Info } from "lucide-react";

const compoundColors: Record<string, string> = {
  SOFT: "hsl(0, 85%, 55%)",
  MEDIUM: "hsl(45, 95%, 55%)",
  HARD: "hsl(0, 0%, 75%)",
  INTERMEDIATE: "hsl(140, 70%, 45%)",
  WET: "hsl(210, 80%, 50%)",
};

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

interface Props {
  results: DegradationResult[];
  longRuns?: LongRunResult[];
}

export function TyreDegradationCard({ results, longRuns }: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const validations = useMemo(() => validateAllDegradationEstimates(results), [results]);

  const selected = selectedIdx != null ? results[selectedIdx] : null;

  // Build chart data with regression line
  const chartData = useMemo(() => {
    if (!selected) return [];
    const { points, slopeSecPerLap, intercept } = selected;
    return points.map((p) => ({
      tyreLife: p.tyreLife,
      lapTime: p.lapTime,
      regression: slopeSecPerLap * p.tyreLife + intercept,
    }));
  }, [selected]);

  if (!results.length) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <TrendingDown className="h-3.5 w-3.5" />
          Tyre Degradation
        </h3>
        <p className="text-sm text-muted-foreground">
          Dati stint non disponibili o numero di giri validi insufficiente per calcolare il degrado.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-4 space-y-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <TrendingDown className="h-3.5 w-3.5" />
        Tyre Degradation
      </h3>

      {/* Long-run detection info for Practice */}
      {longRuns && longRuns.length > 0 && (
        <details className="group">
          <summary className="flex items-center gap-2 text-[11px] text-muted-foreground bg-accent/30 rounded-md px-3 py-2 w-full hover:bg-accent/50 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="font-medium text-foreground/80">🔍 Long Run rilevati (Practice)</span>
            <ChevronDown className="h-3 w-3 ml-auto transition-transform group-open:rotate-180" />
          </summary>
          <div className="bg-accent/20 rounded-b-md px-3 py-2 -mt-1 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left py-1 pr-2">Pilota</th>
                  <th className="text-left py-1 pr-2">Stint</th>
                  <th className="text-left py-1 pr-2">Compound</th>
                  <th className="text-right py-1 pr-2">Giri</th>
                  <th className="text-right py-1 pr-2">Da–A</th>
                  <th className="text-right py-1 pr-2">Media</th>
                  <th className="text-right py-1 pr-2">Std</th>
                  <th className="text-right py-1 pr-2">Slope</th>
                  <th className="text-right py-1 pr-2">Score</th>
                  <th className="text-center py-1">Long Run?</th>
                </tr>
              </thead>
              <tbody>
                {longRuns.map((lr) => (
                  <tr key={`${lr.driverNumber}-${lr.stintNumber}`} className={lr.isLongRun ? "text-foreground" : "text-muted-foreground/60"}>
                    <td className="py-0.5 pr-2">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: `#${lr.color}` }} />
                        <span className="font-mono font-bold">{lr.acronym}</span>
                      </span>
                    </td>
                    <td className="py-0.5 pr-2 font-mono">{lr.stintNumber}</td>
                    <td className="py-0.5 pr-2">{lr.compound}</td>
                    <td className="py-0.5 pr-2 text-right font-mono">{lr.lapsCount}</td>
                    <td className="py-0.5 pr-2 text-right font-mono">{lr.lapStartLongRun}–{lr.lapEndLongRun}</td>
                    <td className="py-0.5 pr-2 text-right font-mono">{fmtTime(lr.avgLapTime)}</td>
                    <td className="py-0.5 pr-2 text-right font-mono">{lr.stdLapTime.toFixed(3)}</td>
                    <td className="py-0.5 pr-2 text-right font-mono">{lr.degradationSlope > 0 ? "+" : ""}{lr.degradationSlope.toFixed(3)}</td>
                    <td className="py-0.5 pr-2 text-right font-mono font-bold">{lr.score}</td>
                    <td className="py-0.5 text-center">{lr.isLongRun ? "✅" : lr.score >= 40 ? "⚠️" : "❌"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="text-[10px] text-muted-foreground mt-2 space-y-1 pl-4 list-disc">
              <li><span className="font-mono font-bold text-foreground/80">Media</span> — Tempo medio sul giro nella sequenza long run identificata.</li>
              <li><span className="font-mono font-bold text-foreground/80">Std</span> — Deviazione standard dei tempi sul giro: misura la regolarità del passo. Valori bassi (&lt; 0.5 s) indicano un passo costante.</li>
              <li><span className="font-mono font-bold text-foreground/80">Slope</span> — Pendenza della regressione lineare (sec/giro): indica il degrado. Un valore positivo significa che il tempo peggiora ad ogni giro.</li>
              <li><span className="font-mono font-bold text-foreground/80">Score</span> — Punteggio complessivo basato su lunghezza, regolarità, trend e penalità. ≥ 60: probabile long run • 40–59: possibile • &lt; 40: non long run.</li>
            </ul>
            <p className="text-[10px] text-muted-foreground mt-1.5 italic">
              Solo i long run identificati (score ≥ 40) vengono usati per il calcolo del degrado.
            </p>
          </div>
        </details>
      )}

      {/* Legend - Collapsible */}
      <details className="group">
        <summary className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/40 rounded-md px-3 py-2 w-full hover:bg-muted/60 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium text-foreground/80">Legenda</span>
          <ChevronDown className="h-3 w-3 ml-auto transition-transform group-open:rotate-180" />
        </summary>
        <div className="bg-muted/40 rounded-b-md px-3 py-2.5 space-y-2 text-[11px] text-muted-foreground -mt-1">
          <ul className="space-y-1.5 pl-5 list-disc">
            <li><span className="font-mono font-bold text-foreground/80">Degrado (sec/giro)</span> — Pendenza della regressione lineare: indica quanti secondi si perdono mediamente ad ogni giro con l'invecchiamento della gomma. Un valore positivo più alto indica un degrado più rapido.</li>
            <li><span className="font-mono font-bold text-foreground/80">R²</span> — Coefficiente di determinazione: misura quanto il modello lineare si adatta ai dati. Valori vicini a 1 indicano un degrado costante e prevedibile; valori bassi indicano alta variabilità.</li>
            <li><span className="font-mono font-bold text-foreground/80">Giri analizzati</span> — Numero di giri validi utilizzati per il calcolo, esclusi out lap, in lap e giri anomali (&gt;7% dal tempo mediano).</li>
            <li><span className="font-mono font-bold text-foreground/80">Stint</span> — Periodo di guida con lo stesso set di pneumatici, dall'uscita dai box fino al pit stop successivo.</li>
            <li><span className="font-mono font-bold text-foreground/80">Compound</span> — Mescola di pneumatico utilizzata nello stint (Soft, Medium, Hard, Intermediate, Wet).</li>
          </ul>
          <p className="pt-1 italic">Clicca su una riga della tabella per visualizzare il grafico di regressione dello stint selezionato.</p>
        </div>
      </details>

      {/* Table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Pilota</TableHead>
              <TableHead className="text-xs">Stint</TableHead>
              <TableHead className="text-xs">Compound</TableHead>
              <TableHead className="text-xs text-right">Giri analizzati</TableHead>
              <TableHead className="text-xs text-right">Degrado (sec/giro)</TableHead>
              <TableHead className="text-xs text-right">R²</TableHead>
              <TableHead className="text-xs text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r, i) => {
              const v = validations[i];
              const statusStyles: Record<string, string> = {
                VALID: "bg-emerald-500/20 text-emerald-400",
                NEUTRAL: "bg-amber-500/20 text-amber-400",
                INVALID: "bg-red-500/20 text-red-400",
              };
              return (
              <TableRow
                key={`${r.driverNumber}-${r.stint}`}
                className={`cursor-pointer ${selectedIdx === i ? "bg-muted" : ""}`}
                onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
              >
                <TableCell className="text-xs">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: `#${r.color}` }}
                    />
                    <span className="font-mono font-bold">{r.acronym}</span>
                  </span>
                </TableCell>
                <TableCell className="text-xs font-mono">{r.stint}</TableCell>
                <TableCell className="text-xs">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-border shrink-0"
                      style={{ backgroundColor: compoundColors[r.compound] ?? "hsl(0,0%,50%)" }}
                    />
                    {r.compound}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-right font-mono">{r.lapsUsed}</TableCell>
                <TableCell className="text-xs text-right font-mono font-bold">
                  {r.slopeSecPerLap > 0 ? "+" : ""}
                  {r.slopeSecPerLap.toFixed(3)}
                </TableCell>
                <TableCell className="text-xs text-right font-mono">{r.rSquared.toFixed(3)}</TableCell>
                <TableCell className="text-xs text-center">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${statusStyles[v?.status ?? "VALID"]}`} title={v?.reason ?? ""}>
                    {v?.status ?? "—"}
                  </span>
                  {v?.status === "INVALID" && (
                    <p className="text-[8px] text-red-400/70 mt-0.5">Non usato nel VRE</p>
                  )}
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Chart for selected stint */}
      {selected && chartData.length > 0 && (
        <div className="relative">
          <Watermark />
          <p className="text-[11px] text-muted-foreground mb-2">
            {selected.acronym} — Stint {selected.stint} ({selected.compound}) — Degrado:{" "}
            <span className="font-bold font-mono">
              {selected.slopeSecPerLap > 0 ? "+" : ""}
              {selected.slopeSecPerLap.toFixed(3)} sec/giro
            </span>
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="tyreLife"
                type="number"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Tyre Life (laps)", position: "insideBottom", offset: -2, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={fmtTime}
                width={55}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-background border border-border rounded px-2 py-1 text-xs shadow">
                      <p>Tyre Life: <span className="font-mono">{d.tyreLife}</span></p>
                      <p>Lap Time: <span className="font-mono">{fmtTime(d.lapTime)}</span></p>
                    </div>
                  );
                }}
              />
              <Scatter
                dataKey="lapTime"
                fill={`#${selected.color}`}
                r={4}
                name="Lap Time"
              />
              <Line
                dataKey="regression"
                stroke={`#${selected.color}`}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                name="Regression"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
