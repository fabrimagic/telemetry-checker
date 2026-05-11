import { ReactNode, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface Props {
  toolbar: ReactNode;
  children: ReactNode;
  /** Sticky offset (in px) under the global header. Default 64. */
  headerOffset?: number;
  className?: string;
}

/**
 * Shell con toolbar verticale sticky a sinistra (lg+) e Sheet su mobile.
 * Larghezza toolbar: 300px. Contenuto centrale a larghezza piena.
 * Solo presentazione: nessuna logica di stato applicativo.
 */
export function AppShell({ toolbar, children, headerOffset = 64, className }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className={cn("w-full", className)}>
      {/* Mobile: pulsante per aprire la toolbar in Sheet */}
      <div className="lg:hidden mb-4 flex justify-end">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Settings2 className="h-3.5 w-3.5" />
              Configurazione
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[320px] overflow-y-auto p-4">
            <SheetHeader>
              <SheetTitle className="text-sm">Configurazione</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-5">{toolbar}</div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6">
        {/* Toolbar desktop */}
        <aside
          className="hidden lg:block"
          style={{ position: "sticky", top: headerOffset, alignSelf: "start" }}
        >
          <div
            className="card-premium rounded-xl p-4 space-y-5 overflow-y-auto"
            style={{ maxHeight: `calc(100vh - ${headerOffset + 24}px)` }}
          >
            {toolbar}
          </div>
        </aside>

        {/* Contenuto */}
        <div className="min-w-0 space-y-5">{children}</div>
      </div>
    </div>
  );
}
