import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, Flag, Wrench, ShieldAlert, Activity } from "lucide-react";
import type { DiaryEvent, DiaryEventType } from "@/lib/raceDiary";

interface Props {
  events: DiaryEvent[];
  driverAcronym: string;
  driverColor: string;
  /** Optional: include BATTLE events. Default false (too noisy). */
  includeBattles?: boolean;
}

type Kind = DiaryEventType | "NEUTRALIZATION";

const KIND_CONFIG: Record<
  Kind,
  { label: string; icon: typeof ArrowUp; color: string; bg: string; ring: string }
> = {
  OVERTAKE_DONE: {
    label: "Sorpasso fatto",
    icon: ArrowUp,
    color: "text-green-400",
    bg: "bg-green-500/15",
    ring: "ring-green-500/40",
  },
  OVERTAKE_RECEIVED: {
    label: "Sorpassato",
    icon: ArrowDown,
    color: "text-destructive",
    bg: "bg-destructive/15",
    ring: "ring-destructive/40",
  },
  RACE_CONTROL: {
    label: "Race Control",
    icon: Flag,
    color: "text-yellow-400",
    bg: "bg-yellow-500/15",
    ring: "ring-yellow-500/40",
  },
  NEUTRALIZATION: {
    label: "Neutralizzazione",
    icon: ShieldAlert,
    color: "text-orange-400",
    bg: "bg-orange-500/20",
    ring: "ring-orange-500/50",
  },
  PIT_STOP: {
    label: "Pit Stop",
    icon: Wrench,
    color: "text-primary",
    bg: "bg-primary/15",
    ring: "ring-primary/40",
  },
  BATTLE: {
    label: "Battaglia",
    icon: Activity,
    color: "text-orange-300/80",
    bg: "bg-orange-500/10",
    ring: "ring-orange-500/30",
  },
};

function classifyKind(ev: DiaryEvent): Kind {
  if (ev.type === "RACE_CONTROL") {
    const tags = ev.impact_tags ?? [];
    if (tags.includes("neutralization") || tags.includes("safety")) return "NEUTRALIZATION";
  }
  return ev.type;
}

interface LapBucket {
  lap: number;
  items: Array<{ ev: DiaryEvent; kind: Kind; idx: number }>;
}

export function RaceEventTimeline({
  events,
  driverAcronym,
  driverColor,
  includeBattles = false,
}: Props) {
  const [openLap, setOpenLap] = useState<number | null>(null);

  const filtered = useMemo(
    () =>
      events.filter(
        (e) => e.lapNumber != null && (includeBattles || e.type !== "BATTLE"),
      ),
    [events, includeBattles],
  );

  const { buckets, minLap, maxLap, kindsPresent } = useMemo(() => {
    const map = new Map<number, LapBucket>();
    const kinds = new Set<Kind>();
    for (let i = 0; i < filtered.length; i++) {
      const ev = filtered[i];
      const lap = ev.lapNumber as number;
      const kind = classifyKind(ev);
      kinds.add(kind);
      if (!map.has(lap)) map.set(lap, { lap, items: [] });
      map.get(lap)!.items.push({ ev, kind, idx: i });
    }
    const lapsArr = [...map.keys()];
    return {
      buckets: [...map.values()].sort((a, b) => a.lap - b.lap),
      minLap: lapsArr.length ? Math.min(...lapsArr) : 1,
      maxLap: lapsArr.length ? Math.max(...lapsArr) : 1,
      kindsPresent: kinds,
    };
  }, [filtered]);

  return (
    <div className="bg-card rounded-lg border border-border p-4 mt-4" data-testid="race-event-timeline">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" />
        Timeline eventi —{" "}
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${driverColor}` }} />
          <span className="font-mono font-bold text-foreground">{driverAcronym}</span>
        </span>
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">
          {filtered.length} eventi
        </span>
      </h3>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessun evento per questa sessione.</p>
      ) : (
        <>
          <TimelineTrack
            buckets={buckets}
            minLap={minLap}
            maxLap={maxLap}
            openLap={openLap}
            setOpenLap={setOpenLap}
          />

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-4 text-[10px] text-muted-foreground">
            {([
              "OVERTAKE_DONE",
              "OVERTAKE_RECEIVED",
              "RACE_CONTROL",
              "NEUTRALIZATION",
              "PIT_STOP",
              "BATTLE",
            ] as Kind[])
              .filter((k) => kindsPresent.has(k))
              .map((k) => {
                const cfg = KIND_CONFIG[k];
                const Icon = cfg.icon;
                return (
                  <span key={k} className="inline-flex items-center gap-1">
                    <span
                      className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${cfg.bg} ${cfg.color} ring-1 ${cfg.ring}`}
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </span>
                    <span>{cfg.label}</span>
                  </span>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}

interface TrackProps {
  buckets: LapBucket[];
  minLap: number;
  maxLap: number;
  openLap: number | null;
  setOpenLap: (l: number | null) => void;
}

function TimelineTrack({ buckets, minLap, maxLap, openLap, setOpenLap }: TrackProps) {
  const span = Math.max(1, maxLap - minLap);
  // X position percent for a given lap (with small inset padding so edges aren't clipped)
  const xPct = (lap: number) => {
    const ratio = (lap - minLap) / span;
    return 2 + ratio * 96; // 2% .. 98%
  };

  // Stack threshold: show up to N icons stacked; beyond → "+n" badge.
  const STACK_LIMIT = 3;

  // Ticks: show ~6 lap markers
  const tickCount = Math.min(6, Math.max(2, maxLap - minLap + 1));
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const lap = Math.round(minLap + (i * (maxLap - minLap)) / (tickCount - 1));
    return lap;
  });

  return (
    <div className="relative w-full pt-2 pb-6">
      {/* Axis line */}
      <div className="relative h-20">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
        {/* Tick marks */}
        {ticks.map((t, i) => (
          <div
            key={`tick-${i}`}
            className="absolute top-1/2 -translate-x-1/2 flex flex-col items-center"
            style={{ left: `${xPct(t)}%` }}
          >
            <div className="w-px h-2 bg-border -mt-1" />
            <span className="text-[9px] font-mono text-muted-foreground mt-4 tabular-nums">
              G{t}
            </span>
          </div>
        ))}

        {/* Event stacks */}
        {buckets.map((b) => {
          const visible = b.items.slice(0, STACK_LIMIT);
          const overflow = b.items.length - visible.length;
          const isOpen = openLap === b.lap;
          return (
            <div
              key={`bucket-${b.lap}`}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5"
              style={{ left: `${xPct(b.lap)}%` }}
            >
              {visible.map((it, i) => (
                <EventDot
                  key={`${b.lap}-${i}`}
                  ev={it.ev}
                  kind={it.kind}
                />
              ))}
              {overflow > 0 && (
                <button
                  type="button"
                  onClick={() => setOpenLap(isOpen ? null : b.lap)}
                  className="text-[9px] font-mono font-bold px-1 rounded bg-muted text-foreground/80 border border-border hover:bg-muted/80"
                  aria-label={`+${overflow} altri eventi al giro ${b.lap}`}
                >
                  +{overflow}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Expanded overflow detail (under axis) */}
      {openLap != null && (
        <div className="mt-2 bg-muted/40 border border-border rounded-md p-2 text-[11px]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono font-bold text-foreground/90">
              Giro {openLap} — tutti gli eventi
            </span>
            <button
              type="button"
              onClick={() => setOpenLap(null)}
              className="text-muted-foreground hover:text-foreground text-[10px]"
            >
              Chiudi
            </button>
          </div>
          <ul className="space-y-1">
            {buckets
              .find((b) => b.lap === openLap)
              ?.items.map((it, i) => {
                const cfg = KIND_CONFIG[it.kind];
                const Icon = cfg.icon;
                return (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className={`mt-0.5 ${cfg.color}`}>
                      <Icon className="h-3 w-3" />
                    </span>
                    <span className="text-foreground/90 break-words">{it.ev.description}</span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}

interface DotProps {
  ev: DiaryEvent;
  kind: Kind;
}

function EventDot({ ev, kind }: DotProps) {
  const cfg = KIND_CONFIG[kind];
  const Icon = cfg.icon;
  return (
    <div className="relative group">
      <button
        type="button"
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${cfg.bg} ${cfg.color} ring-1 ${cfg.ring} hover:scale-110 transition-transform`}
        aria-label={`${cfg.label} — giro ${ev.lapNumber}: ${ev.description}`}
      >
        <Icon className="h-3 w-3" />
      </button>
      {/* Tooltip */}
      <div
        role="tooltip"
        className="pointer-events-none absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 max-w-[14rem] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
      >
        <div className="bg-popover text-popover-foreground text-[11px] border border-border rounded-md shadow-lg p-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`${cfg.color}`}>
              <Icon className="h-3 w-3" />
            </span>
            <span className="font-semibold uppercase text-[10px] tracking-wider">
              {cfg.label}
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              G{ev.lapNumber}
            </span>
          </div>
          <p className="text-foreground/90 break-words leading-snug">{ev.description}</p>
          {(ev.severity || ev.confidence) && (
            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
              {ev.severity && <span>Severità: {ev.severity}</span>}
              {ev.confidence && <span>Conf.: {ev.confidence}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
