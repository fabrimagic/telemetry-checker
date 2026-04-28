import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type {
  FingerprintClassification,
  QualifyingFingerprintResult,
} from "@/lib/qualifyingFingerprint";

interface Props {
  fingerprint: QualifyingFingerprintResult;
  insights: string[];
}

function classificationBadge(c: FingerprintClassification) {
  switch (c) {
    case "OVER_QUALIFIER":
      return (
        <Badge
          variant="outline"
          className="border-amber-500/50 text-amber-600 dark:text-amber-400 text-[10px]"
        >
          OVER QUALIFIER
        </Badge>
      );
    case "UNDER_QUALIFIER":
      return (
        <Badge
          variant="outline"
          className="border-blue-500/50 text-blue-600 dark:text-blue-400 text-[10px]"
        >
          UNDER QUALIFIER
        </Badge>
      );
    case "ALIGNED":
      return (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          ALIGNED
        </Badge>
      );
    case "NO_QUALI_DATA":
      return (
        <span className="text-xs italic text-muted-foreground">no quali data</span>
      );
  }
}

export function FingerprintCard({ fingerprint, insights }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Quali vs Race Fingerprint</CardTitle>
        <CardDescription>
          Confronto tra la posizione raggiunta in qualifica e il passo mostrato nei long run
          di pratica. Un "UNDER QUALIFIER" parte indietro ma in gara ha il potenziale per
          recuperare; un "OVER QUALIFIER" è l'opposto, parte avanti ma fatica a tenere il
          passo sul lungo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!fingerprint.qualifyingDataAvailable ? (
          <p className="text-sm italic text-muted-foreground">
            Dati di qualifica non disponibili (sessione non ancora disputata o non rilevata).
          </p>
        ) : fingerprint.entries.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            Nessuna entry da analizzare.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Pace Rank</TableHead>
                  <TableHead>Pilota</TableHead>
                  <TableHead className="text-right">Quali Pos</TableHead>
                  <TableHead className="text-right">Δ posizioni</TableHead>
                  <TableHead>Classificazione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fingerprint.entries.map((e) => (
                  <TableRow key={e.driverNumber}>
                    <TableCell className="font-mono text-xs">{e.paceRank}</TableCell>
                    <TableCell className="font-mono font-bold text-xs">{e.acronym}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {e.qualifyingPosition ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {e.positionDelta == null
                        ? "—"
                        : `${e.positionDelta > 0 ? "+" : ""}${e.positionDelta}`}
                    </TableCell>
                    <TableCell>{classificationBadge(e.classification)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {insights.length > 0 && (
          <ul className="space-y-1.5 pt-2 border-t border-border">
            {insights.map((s, i) => (
              <li key={i} className="text-sm text-muted-foreground flex gap-2">
                <span className="text-[hsl(var(--f1-red))]">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
