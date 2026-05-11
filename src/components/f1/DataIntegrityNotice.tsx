import { AlertTriangle } from "lucide-react";
import type { IntegrityIssue } from "@/lib/dataIntegrity";

interface Props {
  issues: IntegrityIssue[];
  driverAcronym?: string;
}

export function DataIntegrityNotice({ issues, driverAcronym }: Props) {
  if (!issues.length) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-amber-200">
            Dati parziali da OpenF1{driverAcronym ? ` per ${driverAcronym}` : ""}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Alcune informazioni non sono state restituite dalla fonte ufficiale.
            Le sezioni interessate vengono mostrate con i soli dati disponibili — nessun valore è stato inventato.
          </p>
          <ul className="mt-3 space-y-2.5">
            {issues.map((iss, i) => (
              <li key={i} className="text-xs">
                <div className="font-mono font-bold text-amber-200/90">• {iss.title}</div>
                <div className="text-muted-foreground mt-0.5">{iss.detail}</div>
                <div className="text-muted-foreground/80 mt-0.5">
                  <span className="font-semibold text-foreground/70">Impatto:</span> {iss.impact}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
