import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CompoundStress } from "@/lib/practiceLongRunAggregator";

interface Props {
  compoundStress: CompoundStress[];
  insights: string[];
}

const COMPOUND_COLOUR: Record<string, string> = {
  SOFT: "#E60000",
  MEDIUM: "#FFCD00",
  HARD: "#DEDEDE",
};

export function CompoundStressCard({ compoundStress, insights }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Compound Stress</CardTitle>
        <CardDescription>
          Aggregazione cross-driver del comportamento di ciascuna mescola in pratica.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {compoundStress.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            Nessun compound con sample sufficiente per analisi.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {compoundStress.map((c) => {
              const colour = COMPOUND_COLOUR[c.compound.toUpperCase()] ?? "#888";
              return (
                <div
                  key={c.compound}
                  className="rounded-md border p-4 space-y-2 bg-muted/30"
                  style={{ borderLeft: `4px solid ${colour}` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold uppercase text-sm">{c.compound}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.driversCount} pilot{c.driversCount === 1 ? "a" : "i"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <span className="text-muted-foreground">Pace median</span>
                    <span className="font-mono text-right">{c.paceMedian.toFixed(3)}s</span>
                    <span className="text-muted-foreground">Slope median</span>
                    <span className="font-mono text-right">
                      {c.slopeMedian > 0 ? "+" : ""}
                      {c.slopeMedian.toFixed(3)}
                    </span>
                    <span className="text-muted-foreground">Slope IQR</span>
                    <span className="font-mono text-right">{c.slopeIQR.toFixed(3)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge
                      variant="outline"
                      className={
                        c.variability === "COERENTE"
                          ? "border-green-600/50 text-green-600 dark:text-green-400 text-[10px]"
                          : "border-amber-500/50 text-amber-600 dark:text-amber-400 text-[10px]"
                      }
                    >
                      {c.variability}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      Sample: {c.sampleConfidence}
                    </Badge>
                  </div>
                </div>
              );
            })}
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
