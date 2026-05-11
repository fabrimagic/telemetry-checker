import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  columns?: 1 | 2 | 3;
  className?: string;
  children: ReactNode;
}

const colClass: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
};

/**
 * Griglia presentazionale per organizzare card output a matrice.
 * Senza logica: gestisce solo gap e breakpoint responsive.
 */
export function ContentGrid({ columns = 2, className, children }: Props) {
  return <div className={cn("grid gap-4 items-start", colClass[columns], className)}>{children}</div>;
}
