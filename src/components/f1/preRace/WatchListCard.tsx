import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WatchListEntry } from "@/lib/practiceLongRunAggregator";

interface Props {
  watchList: WatchListEntry[];
  insights: string[];
}

function signalBadge(signal: WatchListEntry["signal"]) {
  switch (signal) {
    case "POSITIVE":
      return (
        <Badge
          variant="outline"
          className="border-green-600/50 text-green-600 dark:text-green-400 text-[10px]"
        >
          POSITIVE
        </Badge>
      );
    case "NEGATIVE":
      return (
        <Badge
          variant="outline"
          className="border-red-500/50 text-red-600 dark:text-red-400 text-[10px]"
        >
          NEGATIVE
        </Badge>
      );
    case "NEUTRAL":
      return (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          Neutro
        </Badge>
      );
  }
}

export function WatchListCard({ watchList, insights }: Props) {
  const isEmpty = watchList.length === 0 && insights.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Watch List</CardTitle>
        <CardDescription>
          Piloti e situazioni che meritano attenzione durante la gara, sulla base dell'analisi
          pre-race. Possibili sorprese positive (ottimo passo nei long run), vulnerabilità
          (degrado peggiore della media), o stint particolarmente lunghi che indicano una
          buona simulazione gara da parte della squadra.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEmpty ? (
          <p className="text-sm italic text-muted-foreground">
            Nessuna osservazione particolare da segnalare per questa gara.
          </p>
        ) : insights.length > 0 ? (
          <ul className="space-y-2">
            {insights.map((s, i) => (
              <li key={i} className="text-sm flex gap-2">
                <span className="text-[hsl(var(--f1-red))]">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-2">
            {watchList.map((w) => (
              <li key={w.driverNumber} className="flex items-start gap-3 text-sm">
                <span className="font-mono font-bold text-xs pt-0.5 min-w-[3rem]">
                  {w.acronym}
                </span>
                <span className="flex-1 text-muted-foreground">{w.reason}</span>
                {signalBadge(w.signal)}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
