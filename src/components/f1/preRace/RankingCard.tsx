import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TermTooltip } from "./TermTooltip";
import type { RankingEntry } from "@/lib/practiceLongRunAggregator";

interface Props {
  ranking: RankingEntry[];
}

const COMPOUND_COLOUR: Record<string, string> = {
  SOFT: "#E60000",
  MEDIUM: "#FFCD00",
  HARD: "#DEDEDE",
  INTERMEDIATE: "#43B02A",
  WET: "#0067AD",
};

const SLOPE_EXPLANATION =
  "Quanto tempo perde il pilota a ogni giro a causa dell'usura gomma. Un valore positivo basso (es. +0.05 s/giro) indica un long run molto consistente; valori alti indicano degrado pesante.";
const RSQUARED_EXPLANATION =
  "Indicatore statistico (0-1) di quanto i tempi misurati seguono un andamento lineare. Valori alti (>0.7) significano degrado prevedibile e regolare; valori bassi indicano dati rumorosi.";
const ROBUSTNESS_EXPLANATION =
  "Affidabilità statistica del long run: HIGH = molti giri puliti, MEDIUM = moderato, LOW = pochi dati o dati rumorosi.";

export function RankingCard({ ranking }: Props) {
  return (
    <TooltipProvider delayDuration={200}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Long Run Pace Ranking</CardTitle>
          <CardDescription>
            Piloti ordinati dal più veloce al più lento sul passo gara osservato nelle pratiche.
            La "pace media" è il tempo medio sul giro mantenuto durante il long run più recente di
            ciascun pilota. Una{" "}
            <TermTooltip term="slope" explanation={SLOPE_EXPLANATION} /> positiva indica che il
            pilota perde tempo a ogni giro per usura gomma; una slope vicina a zero significa
            passo molto costante.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ranking.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              Nessun long run statisticamente significativo rilevato in questa gara.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Pos</TableHead>
                    <TableHead>Pilota</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Compound</TableHead>
                    <TableHead>Sessione</TableHead>
                    <TableHead className="text-right">Pace media (s)</TableHead>
                    <TableHead className="text-right">
                      <TermTooltip term="Slope (s/giro)" explanation={SLOPE_EXPLANATION} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TermTooltip term="R²" explanation={RSQUARED_EXPLANATION} />
                    </TableHead>
                    <TableHead>
                      <TermTooltip term="Robustness" explanation={ROBUSTNESS_EXPLANATION} />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranking.map((r) => {
                    const colour = COMPOUND_COLOUR[r.longRun.compound.toUpperCase()] ?? "#888";
                    const slope = r.longRun.degradationSlope;
                    return (
                      <TableRow key={r.driverNumber}>
                        <TableCell className="font-mono text-xs">{r.paceRank}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: `#${r.teamColour || "ffffff"}` }}
                            />
                            <span className="font-mono font-bold text-xs">{r.acronym}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.teamName}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ backgroundColor: colour }}
                            />
                            <span className="text-xs uppercase">{r.longRun.compound}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">{r.sessionName}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {r.longRun.avgLapTime.toFixed(3)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {slope > 0 ? "+" : ""}
                          {slope.toFixed(3)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {r.longRun.rSquared.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {r.longRun.fitRobustness ? (
                            <Badge variant="outline" className="text-[10px]">
                              {r.longRun.fitRobustness}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
