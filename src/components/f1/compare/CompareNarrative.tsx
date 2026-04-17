import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComparisonResult } from "@/lib/headToHeadComparison";
import type { Driver } from "@/lib/openf1";

interface Props {
  comparison: ComparisonResult;
  driverA: Driver;
  driverB: Driver;
}

const SHARED_KEYWORDS = [
  "safety car", "virtual safety car", "vsc", "sc ", "red flag",
  "rain", "pioggia", "wet", "intermediate", "drying", "asciuga",
];

function classifyShared(insight: string): boolean {
  const lc = insight.toLowerCase();
  return SHARED_KEYWORDS.some((k) => lc.includes(k));
}

export function CompareNarrative({ comparison, driverA, driverB }: Props) {
  const allA = comparison.driver_a.narrative_insights ?? [];
  const allB = comparison.driver_b.narrative_insights ?? [];

  // Shared = appears in both arrays OR matches keyword in either
  const sharedSet = new Set<string>();
  for (const a of allA) {
    if (allB.includes(a) || classifyShared(a)) sharedSet.add(a);
  }
  for (const b of allB) {
    if (classifyShared(b)) sharedSet.add(b);
  }

  const onlyA = allA.filter((i) => !sharedSet.has(i)).slice(0, 5);
  const onlyB = allB.filter((i) => !sharedSet.has(i)).slice(0, 5);
  const shared = [...sharedSet].slice(0, 4);

  const colorA = (driverA.team_colour || "888888").toLowerCase();
  const colorB = (driverB.team_colour || "888888").toLowerCase();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Narrativa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {shared.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              Contesto condiviso
            </div>
            <ul className="space-y-1 text-xs text-foreground/90">
              {shared.map((s, i) => (
                <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span>{s}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-md border-l-4 border border-border bg-background p-3" style={{ borderLeftColor: `#${colorA}` }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: `#${colorA}` }}>
              {driverA.name_acronym}
            </div>
            {onlyA.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">Nessuna nota specifica</div>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {onlyA.map((s, i) => (
                  <li key={i} className="flex gap-2 leading-relaxed"><span className="text-muted-foreground">•</span>{s}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-md border-l-4 border border-border bg-background p-3" style={{ borderLeftColor: `#${colorB}` }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: `#${colorB}` }}>
              {driverB.name_acronym}
            </div>
            {onlyB.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">Nessuna nota specifica</div>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {onlyB.map((s, i) => (
                  <li key={i} className="flex gap-2 leading-relaxed"><span className="text-muted-foreground">•</span>{s}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {comparison.head_to_head_verdict.key_factors.length > 0 && (
          <div className="rounded-md border border-[hsl(var(--f1-red))]/30 bg-[hsl(var(--f1-red))]/5 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--f1-red))] mb-1.5">
              Fattori chiave del verdetto
            </div>
            <ul className="space-y-1 text-xs">
              {comparison.head_to_head_verdict.key_factors.map((f, i) => (
                <li key={i} className="flex gap-2"><span className="text-muted-foreground">▸</span>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
