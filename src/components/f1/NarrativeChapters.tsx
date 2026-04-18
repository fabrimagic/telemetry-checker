import { useState } from "react";
import { ChevronRight, Dot, CircleDot, ArrowRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { NarrativeChapter, NarrativePhase } from "@/lib/narrative/types";

interface NarrativeChaptersProps {
  chapters: NarrativeChapter[];
  insightsFallback: string[];
  className?: string;
}

const PHASE_LABEL: Record<NarrativePhase, string> = {
  OPENING: "Apertura",
  DEVELOPMENT: "Sviluppo",
  CRITICAL: "Critico",
  CLOSING: "Finale",
};

const PHASE_PILL: Record<NarrativePhase, string> = {
  OPENING: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  DEVELOPMENT: "bg-muted text-muted-foreground border-border",
  CRITICAL: "bg-red-500/10 text-red-400 border-red-500/20",
  CLOSING: "bg-green-500/10 text-green-400 border-green-500/20",
};

function defaultOpenFor(chapter: NarrativeChapter): boolean {
  if (chapter.id === "setup_analysis") return false;
  return chapter.phase === "OPENING" || chapter.phase === "CRITICAL";
}

function ChapterBlock({ chapter }: { chapter: NarrativeChapter }) {
  const [open, setOpen] = useState<boolean>(defaultOpenFor(chapter));
  const isCritical = chapter.priority_max === "critical";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "rounded-md border bg-muted/20 overflow-hidden",
        isCritical ? "border-l-4 border-l-red-500 border-y border-r border-y-border border-r-border" : "border-l-2 border-l-muted border-y border-r border-y-border border-r-border",
      )}
      data-phase={chapter.phase}
      data-priority-max={chapter.priority_max}
    >
      <CollapsibleTrigger
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/40 transition-colors"
        data-testid={`chapter-trigger-${chapter.id}`}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider shrink-0",
            PHASE_PILL[chapter.phase],
          )}
        >
          {PHASE_LABEL[chapter.phase]}
        </span>
        <div className="flex flex-col md:flex-row md:items-center md:gap-2 md:flex-1 min-w-0">
          <span className="text-xs font-semibold text-foreground truncate">{chapter.title}</span>
          {chapter.lap_range && (
            <span className="text-[10px] text-muted-foreground md:ml-auto shrink-0">
              giri {chapter.lap_range[0]}-{chapter.lap_range[1]}
            </span>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-2.5 pt-0.5 space-y-2 border-t border-border/40">
          <p className="text-[11px] font-medium text-foreground/90 mt-2">{chapter.headline}</p>
          {chapter.events.length > 0 && (
            <ul className="space-y-1">
              {chapter.events.map((ev) => (
                <li
                  key={ev.id}
                  className="text-[11px] text-muted-foreground flex items-start gap-1.5"
                >
                  {ev.priority === "critical" ? (
                    <CircleDot className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />
                  ) : (
                    <Dot className="h-3.5 w-3.5 text-foreground/50 -mt-0.5 shrink-0" />
                  )}
                  <span>{ev.prerendered_text ?? ""}</span>
                </li>
              ))}
            </ul>
          )}
          {chapter.outcome && (
            <>
              <div className="border-t border-border/30 pt-1.5">
                <p className="text-[11px] italic text-muted-foreground flex items-start gap-1.5">
                  <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-foreground/50" />
                  <span>{chapter.outcome}</span>
                </p>
              </div>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function NarrativeChapters({ chapters, insightsFallback, className }: NarrativeChaptersProps) {
  // Fallback to legacy flat list when no chapters available
  if (!chapters || chapters.length === 0) {
    if (!insightsFallback || insightsFallback.length === 0) return null;
    return (
      <div className={className} data-testid="narrative-chapters-fallback">
        <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
          💡 Insight contestuali
        </h4>
        <ul className="space-y-1.5">
          {insightsFallback.map((insight, i) => (
            <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <span className="text-foreground/60 mt-0.5 shrink-0">•</span>
              <span>{insight}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={className} data-testid="narrative-chapters-structured">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          📖 Narrativa della gara
        </h4>
        <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-border text-muted-foreground">
          {chapters.length} {chapters.length === 1 ? "capitolo" : "capitoli"}
        </Badge>
      </div>
      <div className="space-y-1.5">
        {chapters.map((ch) => (
          <ChapterBlock key={ch.id} chapter={ch} />
        ))}
      </div>
    </div>
  );
}
