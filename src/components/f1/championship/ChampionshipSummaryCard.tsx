import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, ArrowRight, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCurrentSeasonChampionship } from "@/lib/championshipLoader";
import { getDrivers, type Driver } from "@/lib/openf1";
import type { ChampionshipResult } from "@/lib/championship";


interface CachedDriverInfo {
  acronym: string;
  fullName: string;
  teamName: string;
  teamColour: string;
  headshotUrl: string | null;
}

export function ChampionshipSummaryCard() {
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [result, setResult] = useState<ChampionshipResult | null>(null);
  const [driverInfoMap, setDriverInfoMap] = useState<Map<number, CachedDriverInfo>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const applyResult = async (res: ChampionshipResult) => {
      setResult(res);
      if (res.racesCompleted >= 1 && res.races.length > 0) {
        const latest = res.races[res.races.length - 1];
        try {
          const drivers: Driver[] = await getDrivers(latest.sessionKey);
          if (cancelled) return;
          const entries: Array<[number, CachedDriverInfo]> = drivers.map((d) => [
            d.driver_number,
            {
              acronym: d.name_acronym,
              fullName: d.full_name,
              teamName: d.team_name,
              teamColour: d.team_colour,
              headshotUrl: d.headshot_url,
            },
          ]);
          setDriverInfoMap(new Map(entries));
        } catch {
          /* fallback: degrade gracefully */
        }
      }
    };

    (async () => {
      // No cache: always fetch fresh standings on every mount.
      try {
        const out = await loadCurrentSeasonChampionship();
        if (cancelled) return;
        if (out.error || !out.result) {
          setHidden(true);
          return;
        }
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
          <Skeleton className="h-14 w-full" />
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

  const leaderInfo = driverInfoMap.get(leaderDriver.driverNumber);
  const driverDisplayName =
    leaderInfo?.fullName ?? leaderInfo?.acronym ?? `#${leaderDriver.driverNumber}`;
  const driverTeamName = leaderInfo?.teamName ?? "";
  const teamColourHex = leaderInfo?.teamColour ? `#${leaderInfo.teamColour}` : "hsl(var(--f1-red))";
  const headshot = leaderInfo?.headshotUrl ?? null;

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
      <CardContent className="space-y-3 text-sm">
        {/* Leader piloti — headshot, nome completo, team */}
        <div className="flex items-center gap-3">
          <div
            className="relative shrink-0 w-14 h-14 rounded-full overflow-hidden bg-muted/60 ring-2 ring-offset-2 ring-offset-background"
            style={{ ['--tw-ring-color' as any]: teamColourHex, boxShadow: `0 0 0 2px ${teamColourHex}` }}
          >
            {headshot ? (
              <img
                src={headshot}
                alt={driverDisplayName}
                className="w-full h-full object-cover object-top"
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <User className="w-6 h-6" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
                Leader Piloti
              </span>
              {driverDelta !== null && (
                <span className="text-[10px] font-black text-emerald-400">+{driverDelta}</span>
              )}
            </div>
            <div className="font-black text-foreground truncate" title={driverDisplayName}>
              {driverDisplayName}
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: teamColourHex }}
              />
              <span className="text-[11px] text-muted-foreground truncate" title={driverTeamName}>
                {driverTeamName || "—"}
              </span>
              <span className="ml-auto font-black text-[hsl(var(--f1-red-glow))] shrink-0">
                {leaderDriver.totalPoints}
                <span className="text-[10px] text-muted-foreground font-normal ml-0.5">pt</span>
              </span>
            </div>
          </div>
        </div>

        {/* Leader costruttori */}
        {leaderTeam && (
          <div className="flex items-baseline gap-2 pt-1 border-t border-border/40">
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
