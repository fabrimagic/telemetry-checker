import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCurrentSeasonChampionship } from "@/lib/championshipLoader";
import { getDrivers, type Driver } from "@/lib/openf1";
import type { ChampionshipResult } from "@/lib/championship";
import { readCache, writeCache, CACHE_KEYS, CACHE_TTL } from "@/lib/clientCache";

export function ChampionshipSummaryCard() {
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [result, setResult] = useState<ChampionshipResult | null>(null);
  const [driverNameMap, setDriverNameMap] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const year = new Date().getFullYear();
    const champKey = CACHE_KEYS.championshipByYear(year);

    const applyResult = async (res: ChampionshipResult) => {
      setResult(res);
      if (res.racesCompleted >= 1 && res.races.length > 0) {
        const latest = res.races[res.races.length - 1];
        const driversKey = CACHE_KEYS.driversBySession(latest.sessionKey);
        const cachedDrivers = readCache<Array<[number, string]>>(driversKey, CACHE_TTL.DRIVERS);
        if (cachedDrivers) {
          if (!cancelled) setDriverNameMap(new Map(cachedDrivers));
        } else {
          try {
            const drivers: Driver[] = await getDrivers(latest.sessionKey);
            if (cancelled) return;
            const entries: Array<[number, string]> = drivers.map((d) => [d.driver_number, d.name_acronym]);
            writeCache(driversKey, entries);
            setDriverNameMap(new Map(entries));
          } catch {
            /* fallback: use #number */
          }
        }
      }
    };

    (async () => {
      // Cache hit: render immediately, skip network entirely.
      const cached = readCache<ChampionshipResult>(champKey, CACHE_TTL.CHAMPIONSHIP);
      if (cached) {
        await applyResult(cached);
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const out = await loadCurrentSeasonChampionship();
        if (cancelled) return;
        if (out.error || !out.result) {
          setHidden(true);
          return;
        }
        writeCache(champKey, out.result);
        await applyResult(out.result);
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
    <Card className="max-w-md card-premium border-[hsl(var(--f1-red))]/20 hover:border-[hsl(var(--f1-red))]/50 transition-colors">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between gap-2 uppercase tracking-wider">
          <span className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-[hsl(var(--f1-red-glow))]" />
            <span className="font-black">Mondiale F1 {year}</span>
          </span>
          <span className="text-[10px] font-bold normal-case tracking-normal text-muted-foreground px-2 py-0.5 rounded-full bg-muted/60 border border-border">
            R{result.racesCompleted}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground w-16">Piloti</span>
          <span className="font-mono uppercase font-bold text-foreground">{driverDisplay}</span>
          <span className="font-black text-[hsl(var(--f1-red-glow))]">{leaderDriver.totalPoints}</span>
          <span className="text-[10px] text-muted-foreground">pt</span>
          {driverDelta !== null && (
            <span className="ml-auto text-[10px] font-bold text-emerald-400">+{driverDelta}</span>
          )}
        </div>
        {leaderTeam && (
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground w-16">Team</span>
            <span className="font-mono uppercase font-bold text-foreground truncate">{leaderTeam.teamName}</span>
            <span className="font-black text-[hsl(var(--f1-red-glow))]">{leaderTeam.totalPoints}</span>
            <span className="text-[10px] text-muted-foreground">pt</span>
            {teamDelta !== null && (
              <span className="ml-auto text-[10px] font-bold text-emerald-400">+{teamDelta}</span>
            )}
          </div>
        )}
        <div className="pt-2 border-t border-border/60">
          <Link
            to="/campionato"
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[hsl(var(--f1-red-glow))] hover:text-[hsl(var(--f1-red))] transition-colors"
          >
            Timeline completa <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
