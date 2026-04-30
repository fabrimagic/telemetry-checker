import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCurrentSeasonChampionship } from "@/lib/championshipLoader";
import { getDrivers, type Driver } from "@/lib/openf1";
import type { ChampionshipResult } from "@/lib/championship";

export function ChampionshipSummaryCard() {
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [result, setResult] = useState<ChampionshipResult | null>(null);
  const [driverNameMap, setDriverNameMap] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const out = await loadCurrentSeasonChampionship();
        if (cancelled) return;
        if (out.error || !out.result) {
          setHidden(true);
          return;
        }
        setResult(out.result);

        if (out.result.racesCompleted >= 1 && out.result.races.length > 0) {
          const latest = out.result.races[out.result.races.length - 1];
          try {
            const drivers: Driver[] = await getDrivers(latest.sessionKey);
            if (cancelled) return;
            const map = new Map<number, string>();
            for (const d of drivers) {
              map.set(d.driver_number, d.name_acronym);
            }
            setDriverNameMap(map);
          } catch {
            /* fallback: use #number */
          }
        }
      } catch {
        if (!cancelled) setHidden(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (hidden) return null;

  if (loading) {
    return (
      <Card className="max-w-md">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;

  const year = result.year;

  if (result.racesCompleted === 0) {
    return (
      <Card className="max-w-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            Mondiale F1 {year}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Mondiale {year} non ancora iniziato.
          </p>
          <Link
            to="/campionato"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Vai alla pagina Mondiale <ArrowRight className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  const drivers = result.driverTimelines;
  const teams = result.teamTimelines;
  const leaderDriver = drivers[0];
  const leaderTeam = teams[0];
  const driverDelta =
    drivers.length >= 2 ? leaderDriver.totalPoints - drivers[1].totalPoints : null;
  const teamDelta =
    teams.length >= 2 ? leaderTeam.totalPoints - teams[1].totalPoints : null;

  const driverDisplay =
    driverNameMap.get(leaderDriver.driverNumber) ?? `#${leaderDriver.driverNumber}`;

  return (
    <Card className="max-w-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            Mondiale F1 {year}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            Dopo {result.racesCompleted} {result.racesCompleted === 1 ? "gara" : "gare"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">Piloti: </span>
          <span className="font-mono uppercase">{driverDisplay}</span>{" "}
          <span className="font-bold">({leaderDriver.totalPoints} pt)</span>
          {driverDelta !== null && (
            <span className="text-muted-foreground"> +{driverDelta} sul 2°</span>
          )}
        </div>
        {leaderTeam && (
          <div>
            <span className="text-muted-foreground">Costruttori: </span>
            <span className="font-mono uppercase">{leaderTeam.teamName}</span>{" "}
            <span className="font-bold">({leaderTeam.totalPoints} pt)</span>
            {teamDelta !== null && (
              <span className="text-muted-foreground"> +{teamDelta} sul 2°</span>
            )}
          </div>
        )}
        <div className="pt-2">
          <Link
            to="/campionato"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Vai alla timeline completa <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
