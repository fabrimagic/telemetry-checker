import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  term: ReactNode;
  explanation: string;
  side?: "top" | "bottom" | "left" | "right";
}

/**
 * Hoverable technical term: shows a tooltip with a plain-language explanation.
 * Must be wrapped in a TooltipProvider somewhere up the tree (one per card).
 */
export function TermTooltip({ term, explanation, side = "top" }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help border-b border-dotted border-muted-foreground/50">
          {term}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs">
        <p className="text-xs leading-relaxed">{explanation}</p>
      </TooltipContent>
    </Tooltip>
  );
}
