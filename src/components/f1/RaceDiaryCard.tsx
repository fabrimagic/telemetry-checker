import { BookOpen, ArrowUp, ArrowDown, Flag, Wrench, ChevronDown, Info, Swords, Link2, ShieldAlert, Target, Eye } from "lucide-react";
import type { DiaryEvent, SeverityLevel, StrategicRelevance, ConfidenceLevel } from "@/lib/raceDiary";

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
  BATTLE: {
    icon: <Swords className="h-3 w-3" />,
    label: "Battaglia",
    accent: "text-orange-400",
  },
};

const severityColors: Record<SeverityLevel, string> = {
  HIGH: "bg-destructive/15 text-destructive border-destructive/30",
  MEDIUM: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
  LOW: "bg-muted text-muted-foreground border-border",
};

const relevanceColors: Record<StrategicRelevance, string> = {
  HIGH: "bg-primary/15 text-primary border-primary/30",
  MEDIUM: "bg-accent text-accent-foreground border-border",
  LOW: "bg-muted text-muted-foreground border-border",
};

const confidenceColors: Record<ConfidenceLevel, string> = {
  HIGH: "bg-primary/15 text-primary border-primary/30",
  MEDIUM: "bg-accent text-accent-foreground border-border",
  LOW: "bg-muted text-muted-foreground border-border",
};


const severityLabels: Record<SeverityLevel, string> = { HIGH: "Alta", MEDIUM: "Media", LOW: "Bassa" };
const relevanceLabels: Record<StrategicRelevance, string> = { HIGH: "Alta", MEDIUM: "Media", LOW: "Bassa" };
const confidenceLabels: Record<ConfidenceLevel, string> = { HIGH: "Alta", MEDIUM: "Media", LOW: "Bassa" };

const impactTagLabels: Record<string, string> = {
  track_position: "Posizione",
  pit_cycle: "Ciclo pit",
  traffic: "Traffico",
  neutralization: "Neutralizzazione",
  tyre_management: "Gestione gomme",
  race_control: "Direzione gara",
  safety: "Sicurezza",
};

export function RaceDiaryCard({ events, driverAcronym, driverColor }: Props) {
  const chronoEvents = events.filter((e) => e.type !== "BATTLE");
  const battleEvents = events.filter((e) => e.type === "BATTLE");
  const allEvents = [...chronoEvents, ...battleEvents].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="bg-card rounded-lg border border-border p-4 mt-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <BookOpen className="h-3.5 w-3.5" />
        Diario di gara —{" "}
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${driverColor}` }} />
          <span className="font-mono font-bold text-foreground">{driverAcronym}</span>
        </span>
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">{allEvents.length} eventi</span>
      </h3>

      {allEvents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nessun evento registrato per il pilota selezionato.
        </p>
      ) : (
        <>
          {/* Timeline */}
          <div className="relative border-l-2 border-border ml-3 pl-4 space-y-3 max-h-[500px] overflow-y-auto mb-4 pr-1">
            {allEvents.map((ev, i) => {
              const cfg = typeConfig[ev.type] || typeConfig.RACE_CONTROL;
              const hasEpisode = !!ev.episode_id;

              return (
                <div key={ev._id || i} className={`relative ${hasEpisode ? "bg-muted/30 rounded-md p-1.5 -ml-1" : ""}`}>
                  <span
                    className={`absolute ${hasEpisode ? "left-[-17px]" : "-left-[21px]"} top-1 w-2.5 h-2.5 rounded-full border-2 border-background ${cfg.accent}`}
                    style={{ backgroundColor: "currentColor" }}
                  />
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 ${cfg.accent}`}>{cfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-semibold uppercase ${cfg.accent}`}>{cfg.label}</span>
                        {ev.lapNumber != null && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            Giro {ev.lapNumber}
                          </span>
                        )}
                        {hasEpisode && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
                            <Link2 className="h-2.5 w-2.5" />
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

                      {/* Metadata badges */}
                      {(ev.severity || ev.strategic_relevance || ev.confidence) && (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {ev.severity && (
                            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded border ${severityColors[ev.severity]}`}>
                              <ShieldAlert className="h-2.5 w-2.5" />
                              Severità: {severityLabels[ev.severity]}
                            </span>
                          )}
                          {ev.strategic_relevance && (
                            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded border ${relevanceColors[ev.strategic_relevance]}`}>
                              <Target className="h-2.5 w-2.5" />
                              Rilevanza: {relevanceLabels[ev.strategic_relevance]}
                            </span>
                          )}
                          {ev.confidence && (
                            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded border ${confidenceColors[ev.confidence]}`}>
                              <Eye className="h-2.5 w-2.5" />
                              Confidenza: {confidenceLabels[ev.confidence]}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Impact tags */}
                      {ev.impact_tags && ev.impact_tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {ev.impact_tags.map((tag) => (
                            <span key={tag} className="text-[10px] font-mono text-muted-foreground bg-muted/60 border border-border px-1.5 py-0.5 rounded">
                              {impactTagLabels[tag] || tag}
                            </span>
                          ))}
                        </div>
                      )}
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
                <span><span className="font-bold text-foreground/80">Race Control</span> — Messaggio della direzione gara</span>
              </div>
              <div className="flex items-center gap-2">
                <Wrench className="h-3 w-3 text-primary" />
                <span><span className="font-bold text-foreground/80">Pit Stop</span> — Sosta ai box con cambio gomme</span>
              </div>
              <div className="flex items-center gap-2">
                <Swords className="h-3 w-3 text-orange-400" />
                <span><span className="font-bold text-foreground/80">Battaglia</span> — Duello ravvicinato con un avversario (&lt;1s)</span>
              </div>
              <div className="border-t border-border pt-1.5 mt-1.5 space-y-1">
                <p className="font-semibold text-foreground/80">Badge</p>
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-3 w-3" />
                  <span><span className="font-bold">Severità</span> — Impatto operativo: LOW / MEDIUM / HIGH</span>
                </div>
                <div className="flex items-center gap-2">
                  <Target className="h-3 w-3" />
                  <span><span className="font-bold">Rilevanza</span> — Importanza strategica (mostrata solo se MEDIUM+)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Eye className="h-3 w-3" />
                  <span><span className="font-bold">Confidenza</span> — Affidabilità del dato (mostrata solo se &lt; HIGH)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Link2 className="h-3 w-3" />
                  <span><span className="font-bold">Episodio</span> — Eventi raggruppati per prossimità temporale</span>
                </div>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
