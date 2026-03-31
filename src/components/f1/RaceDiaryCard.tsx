import { BookOpen, ArrowUp, ArrowDown, Flag, Wrench, ChevronDown, Info } from "lucide-react";
import type { DiaryEvent } from "@/lib/raceDiary";

interface Props {
  events: DiaryEvent[];
  driverAcronym: string;
  driverColor: string;
}

const typeConfig: Record<string, { icon: React.ReactNode; label: string; accent: string }> = {
  OVERTAKE_DONE: {
    icon: <ArrowUp className="h-3 w-3" />,
    label: "Sorpasso",
    accent: "text-green-500",
  },
  OVERTAKE_RECEIVED: {
    icon: <ArrowDown className="h-3 w-3" />,
    label: "Sorpassato",
    accent: "text-destructive",
  },
  RACE_CONTROL: {
    icon: <Flag className="h-3 w-3" />,
    label: "Race Control",
    accent: "text-yellow-500",
  },
  PIT_STOP: {
    icon: <Wrench className="h-3 w-3" />,
    label: "Pit Stop",
    accent: "text-primary",
  },
};

export function RaceDiaryCard({ events, driverAcronym, driverColor }: Props) {
  const chronoEvents = events.filter((e) => e.type !== "BATTLE");

  return (
    <div className="bg-card rounded-lg border border-border p-4 mt-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <BookOpen className="h-3.5 w-3.5" />
        Diario di gara —{" "}
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${driverColor}` }} />
          <span className="font-mono font-bold text-foreground">{driverAcronym}</span>
        </span>
      </h3>

      {chronoEvents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nessun evento registrato per il pilota selezionato.
        </p>
      ) : (
        <>
          {/* Timeline */}
          <div className="relative border-l-2 border-border ml-3 pl-4 space-y-3 max-h-[400px] overflow-y-auto mb-4">
            {chronoEvents.map((ev, i) => {
              const cfg = typeConfig[ev.type] || typeConfig.RACE_CONTROL;
              return (
                <div key={i} className="relative">
                  <span
                    className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-background ${cfg.accent}`}
                    style={{ backgroundColor: "currentColor" }}
                  />
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 ${cfg.accent}`}>{cfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-semibold uppercase ${cfg.accent}`}>{cfg.label}</span>
                        {ev.lapNumber != null && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            Giro {ev.lapNumber}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto tabular-nums font-mono">
                          {new Date(ev.date).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/90 mt-0.5 break-words">{ev.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Collapsible legend */}
          <details className="group mt-3">
            <summary className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/40 rounded-md px-3 py-2 w-full hover:bg-muted/60 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium text-foreground/80">Legenda Diario di gara</span>
              <ChevronDown className="h-3 w-3 ml-auto transition-transform group-open:rotate-180" />
            </summary>
            <div className="bg-muted/40 rounded-b-md px-3 py-2.5 space-y-1.5 text-[11px] text-muted-foreground -mt-1">
              <div className="flex items-center gap-2">
                <ArrowUp className="h-3 w-3 text-green-500" />
                <span><span className="font-bold text-foreground/80">Sorpasso</span> — Il pilota ha sorpassato un avversario</span>
              </div>
              <div className="flex items-center gap-2">
                <ArrowDown className="h-3 w-3 text-destructive" />
                <span><span className="font-bold text-foreground/80">Sorpassato</span> — Il pilota è stato sorpassato da un avversario</span>
              </div>
              <div className="flex items-center gap-2">
                <Flag className="h-3 w-3 text-yellow-500" />
                <span><span className="font-bold text-foreground/80">Race Control</span> — Messaggio della direzione gara che coinvolge il pilota o la pista</span>
              </div>
              <div className="flex items-center gap-2">
                <Wrench className="h-3 w-3 text-primary" />
                <span><span className="font-bold text-foreground/80">Pit Stop</span> — Sosta ai box con cambio gomme</span>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
