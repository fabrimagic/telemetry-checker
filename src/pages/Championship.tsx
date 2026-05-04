import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { loadCurrentSeasonChampionship } from "@/lib/championshipLoader";
import { getDrivers, type Driver } from "@/lib/openf1";
import type {
  ChampionshipResult,
  DriverTimeline,
  TeamTimeline,
} from "@/lib/championship";
import { buildChampionshipNarrative } from "@/lib/championshipNarrative";

/** Inline mini-sparkline of last 5 pointsCurrent values. */
function MiniSparkline({ points }: { points: { pointsCurrent: number }[] }) {
  const last5 = points.slice(-5);
  if (last5.length < 2) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  const W = 60;
  const H = 16;
  const values = last5.map((p) => p.pointsCurrent);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = W / (values.length - 1);
  const coords = values
    .map((v, i) => {
      const x = i * step;
      const y = H - ((v - min) / range) * (H - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const trending = values[values.length - 1] >= values[0];
  const color = trending ? "hsl(142 70% 45%)" : "hsl(0 70% 55%)";
  return (
    <svg width={W} height={H} className="inline-block align-middle">
      <polyline
        points={coords}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function shortLabel(raceLabel: string, countryName: string): string {
  const src = (countryName || raceLabel || "").trim();
  return src.slice(0, 3).toUpperCase() || "—";
}

/** Lighten a #rrggbb color toward white by a 0..1 amount. */
function lightenHex(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  r = Math.round(r + (255 - r) * amount);
  g = Math.round(g + (255 - g) * amount);
  b = Math.round(b + (255 - b) * amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

interface EvolutionChartProps {
  timelines: (DriverTimeline | TeamTimeline)[];
  races: ChampionshipResult["races"];
  colorOf: (t: DriverTimeline | TeamTimeline) => string;
  labelOf: (t: DriverTimeline | TeamTimeline) => string;
  keyOf: (t: DriverTimeline | TeamTimeline) => string;
}

function EvolutionChart({ timelines, races, colorOf, labelOf, keyOf }: EvolutionChartProps) {
  const top = timelines.slice(0, 10);
  if (top.length === 0 || races.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-12">
        Dati insufficienti per il grafico
      </div>
    );
  }
  const data = races.map((_r, i) => {
    const row: Record<string, number | string> = {
      raceIndex: i + 1,
      _label: races[i].raceLabel,
      _short: shortLabel(races[i].raceLabel, races[i].countryName),
    };
    for (const t of top) {
      const p = t.points[i];
      if (p) {
        row[`points_${keyOf(t)}`] = p.pointsCurrent;
        row[`gained_${keyOf(t)}`] = p.pointsGained;
      }
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 16 }}>
        <CartesianGrid stroke="hsl(220 14% 16%)" strokeDasharray="3 3" />
        <XAxis
          dataKey="raceIndex"
          tick={{ fill: "hsl(215 12% 45%)", fontSize: 10 }}
          tickFormatter={(v: number) => {
            const r = data[v - 1];
            return (r?._short as string) ?? String(v);
          }}
        />
        <YAxis
          tick={{ fill: "hsl(215 12% 45%)", fontSize: 10 }}
          label={{ value: "Punti", angle: -90, position: "insideLeft", style: { fill: "hsl(215 12% 45%)", fontSize: 10 } }}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(220 18% 10%)",
            border: "1px solid hsl(220 14% 18%)",
            borderRadius: 6,
            fontSize: 11,
          }}
          labelFormatter={(v) => {
            const row = data[Number(v) - 1];
            return row ? `${row._label}` : `Gara ${v}`;
          }}
          formatter={(value: number, name: string, item: any) => {
            const k = name.replace(/^points_/, "");
            const t = top.find((tt) => keyOf(tt) === k);
            const display = t ? labelOf(t) : k;
            const gained = item?.payload?.[`gained_${k}`] ?? 0;
            return [`${value} pt (+${gained})`, display];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          formatter={(name: string) => {
            const k = name.replace(/^points_/, "");
            const t = top.find((tt) => keyOf(tt) === k);
            return t ? labelOf(t) : k;
          }}
        />
        {top.map((t) => (
          <Line
            key={keyOf(t)}
            type="monotone"
            dataKey={`points_${keyOf(t)}`}
            stroke={colorOf(t)}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function PositionDelta({ delta }: { delta: number }) {
  if (delta === 0)
    return (
      <span className="inline-flex items-center text-muted-foreground">
        <Minus className="h-3 w-3" />
      </span>
    );
  if (delta < 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-500">
        <TrendingUp className="h-3 w-3" />
        {Math.abs(delta)}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-red-500">
      <TrendingDown className="h-3 w-3" />
      {delta}
    </span>
  );
}

export default function Championship() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChampionshipResult | null>(null);
  const [driverNameMap, setDriverNameMap] = useState<Map<number, string>>(new Map());
  const [driverInfoMap, setDriverInfoMap] = useState<
    Map<number, { headshot: string | null; teamColour: string | null }>
  >(new Map());
  const [teamColorMap, setTeamColorMap] = useState<Map<string, string>>(new Map());
  const [driverTeamMap, setDriverTeamMap] = useState<Map<number, string>>(new Map());
  const [visibleDrivers, setVisibleDrivers] = useState<Set<number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const out = await loadCurrentSeasonChampionship();
        if (cancelled) return;
        if (out.error || !out.result) {
          setError(out.error ?? "Errore caricamento Mondiale");
          return;
        }
        setResult(out.result);

        if (out.result.racesCompleted >= 1 && out.result.races.length > 0) {
          const latest = out.result.races[out.result.races.length - 1];
          try {
            const drivers: Driver[] = await getDrivers(latest.sessionKey);
            if (cancelled) return;
            const dMap = new Map<number, string>();
            const tMap = new Map<string, string>();
            const iMap = new Map<number, { headshot: string | null; teamColour: string | null }>();
            for (const d of drivers) {
              dMap.set(d.driver_number, d.broadcast_name || d.name_acronym);
              if (d.team_name && d.team_colour) tMap.set(d.team_name, d.team_colour);
              iMap.set(d.driver_number, {
                headshot: d.headshot_url ?? null,
                teamColour: d.team_colour ?? null,
              });
            }
            setDriverNameMap(dMap);
            setTeamColorMap(tMap);
            setDriverInfoMap(iMap);
          } catch {
            /* fallback */
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Errore caricamento Mondiale");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Home
              </Button>
            </Link>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              Mondiale F1 {result?.year ?? new Date().getFullYear()}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Caricamento timeline Mondiale…
          </div>
        )}

        {!loading && error && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {!loading && !error && result && result.racesCompleted === 0 && (
          <Card>
            <CardContent className="pt-6 space-y-2">
              <p className="text-base font-medium">Mondiale {result.year} non ancora iniziato</p>
              <p className="text-sm text-muted-foreground">
                La timeline si popolerà automaticamente dopo la prima gara.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && !error && result && result.racesCompleted > 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              Dopo {result.racesCompleted}{" "}
              {result.racesCompleted === 1 ? "gara disputata" : "gare disputate"}.
            </p>

            {(() => {
              const sentences = buildChampionshipNarrative(result, driverNameMap);
              if (!sentences.length) return null;
              return (
                <div className="bg-muted/30 rounded-lg border p-4 mb-4 leading-relaxed text-sm space-y-2">
                  {sentences.map((s, i) => (
                    <p key={i}>{s}</p>
                  ))}
                </div>
              );
            })()}

            <Tabs defaultValue="drivers">
              <TabsList>
                <TabsTrigger value="drivers">Piloti</TabsTrigger>
                <TabsTrigger value="teams">Costruttori</TabsTrigger>
                <TabsTrigger value="races">Gare</TabsTrigger>
              </TabsList>

              <TabsContent value="drivers" className="mt-4">
                <div className="bg-card rounded-lg border p-4 mb-4">
                  <h3 className="text-sm font-semibold mb-3">Evoluzione punti</h3>
                  <EvolutionChart
                    timelines={result.driverTimelines}
                    races={result.races}
                    colorOf={(t) => {
                      const d = t as DriverTimeline;
                      const info = driverInfoMap.get(d.driverNumber);
                      return info?.teamColour ? `#${info.teamColour}` : "hsl(215 12% 60%)";
                    }}
                    labelOf={(t) => {
                      const d = t as DriverTimeline;
                      return driverNameMap.get(d.driverNumber) ?? `#${d.driverNumber}`;
                    }}
                    keyOf={(t) => String((t as DriverTimeline).driverNumber)}
                  />
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Classifica Piloti</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Pos</TableHead>
                          <TableHead>Pilota</TableHead>
                          <TableHead className="text-center">Trend</TableHead>
                          <TableHead className="text-right">Punti</TableHead>
                          <TableHead className="text-right">Δ ultima gara</TableHead>
                          <TableHead className="text-right">Punti ultima gara</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.driverTimelines.map((d) => {
                          const last = d.points[d.points.length - 1];
                          const display =
                            driverNameMap.get(d.driverNumber) ?? `#${d.driverNumber}`;
                          const info = driverInfoMap.get(d.driverNumber);
                          const borderColor = info?.teamColour ? `#${info.teamColour}` : "hsl(var(--border))";
                          return (
                            <TableRow key={d.driverNumber}>
                              <TableCell className="font-bold">
                                {d.currentPosition || "—"}
                              </TableCell>
                              <TableCell>
                                <span className="inline-flex items-center gap-2">
                                  {info?.headshot ? (
                                    <img
                                      src={info.headshot}
                                      alt={display}
                                      loading="lazy"
                                      className="h-8 w-8 rounded-full object-cover border-2"
                                      style={{ borderColor }}
                                    />
                                  ) : (
                                    <span
                                      className="h-8 w-8 rounded-full border-2 bg-muted inline-block"
                                      style={{ borderColor }}
                                      aria-hidden="true"
                                    />
                                  )}
                                  <span className="font-mono uppercase">{display}</span>
                                </span>
                              </TableCell>
                              <TableCell className="text-center">
                                <MiniSparkline points={d.points} />
                              </TableCell>
                              <TableCell className="text-right font-bold">
                                {d.totalPoints}
                              </TableCell>
                              <TableCell className="text-right">
                                <PositionDelta delta={d.positionDeltaVsPrevRace} />
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {last?.pointsGained ?? 0}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="teams" className="mt-4">
                <div className="bg-card rounded-lg border p-4 mb-4">
                  <h3 className="text-sm font-semibold mb-3">Evoluzione punti</h3>
                  <EvolutionChart
                    timelines={result.teamTimelines}
                    races={result.races}
                    colorOf={(t) => {
                      const tt = t as TeamTimeline;
                      const c = teamColorMap.get(tt.teamName);
                      return c ? `#${c}` : "hsl(215 12% 60%)";
                    }}
                    labelOf={(t) => (t as TeamTimeline).teamName}
                    keyOf={(t) => (t as TeamTimeline).teamName.replace(/\s+/g, "_")}
                  />
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Classifica Costruttori</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Pos</TableHead>
                          <TableHead>Team</TableHead>
                          <TableHead className="text-center">Trend</TableHead>
                          <TableHead className="text-right">Punti</TableHead>
                          <TableHead className="text-right">Δ ultima gara</TableHead>
                          <TableHead className="text-right">Punti ultima gara</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.teamTimelines.map((t) => {
                          const last = t.points[t.points.length - 1];
                          const color = teamColorMap.get(t.teamName);
                          return (
                            <TableRow key={t.teamName}>
                              <TableCell className="font-bold">
                                {t.currentPosition || "—"}
                              </TableCell>
                              <TableCell>
                                <span className="inline-flex items-center gap-2">
                                  {color && (
                                    <span
                                      className="inline-block h-2 w-2 rounded-full"
                                      style={{ backgroundColor: `#${color}` }}
                                    />
                                  )}
                                  {t.teamName}
                                </span>
                              </TableCell>
                              <TableCell className="text-center">
                                <MiniSparkline points={t.points} />
                              </TableCell>
                              <TableCell className="text-right font-bold">
                                {t.totalPoints}
                              </TableCell>
                              <TableCell className="text-right">
                                <PositionDelta delta={t.positionDeltaVsPrevRace} />
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {last?.pointsGained ?? 0}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="races" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Gare disputate</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Gara</TableHead>
                          <TableHead>Paese</TableHead>
                          <TableHead>Data</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.races.map((r, i) => (
                          <TableRow key={r.sessionKey}>
                            <TableCell>{i + 1}</TableCell>
                            <TableCell>{r.raceLabel}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {r.countryName || "—"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {r.dateStart ? new Date(r.dateStart).toLocaleDateString("it-IT") : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {result.warnings.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {result.warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-border px-6 py-4 mt-8">
        <p className="text-xs text-muted-foreground text-center">
          Questo è un progetto sviluppato da Fabrizio Monaco
        </p>
      </footer>
    </div>
  );
}
