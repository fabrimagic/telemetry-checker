import { ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  /** When false, the section is rendered as a static block (non-collapsible). */
  collapsible?: boolean;
}

/**
 * Sezione collassabile della toolbar laterale, con header tipografico
 * coerente con il design system PitWall (label rossa, uppercase, tracking).
 * Solo presentazione: nessuna logica.
 */
export function ToolbarSection({ title, defaultOpen = true, children, collapsible = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[hsl(var(--f1-red-glow))]">
            ▸ {title}
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-[hsl(var(--f1-red))]/40 to-transparent" />
        </div>
        <div>{children}</div>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2.5">
      <CollapsibleTrigger className="w-full flex items-center gap-2 px-1 group">
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[hsl(var(--f1-red-glow))]">
          ▸ {title}
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-[hsl(var(--f1-red))]/40 to-transparent" />
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
