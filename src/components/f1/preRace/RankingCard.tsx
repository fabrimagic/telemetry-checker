import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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

export function RankingCard({ ranking }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Long Run Pace Ranking</CardTitle>
        <CardDescription>
          Piloti ordinati per pace mediana del miglior long run osservato in pratica.
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
                  <TableHead className="text-right">Slope (s/giro)</TableHead>
                  <TableHead className="text-right">R²</TableHead>
                  <TableHead>Robustness</TableHead>
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
  );
}
