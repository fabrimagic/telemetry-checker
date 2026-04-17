/**
 * Per-driver context block for the head-to-head view.
 *
 * Reuses the SAME `SoftSensorsSection` and `GlobalAnalysisSection` already
 * rendered in single-driver mode (`VirtualRaceEngineerCard`). No business
 * logic is duplicated: both components are imported from
 * `VirtualRaceEngineerCard` and consume the same `VirtualRaceEngineerResult`.
 *
 * The wrapper exists ONLY to:
 *   1. Label which driver each block belongs to (header with team color +
 *      acronym), so the user is never in doubt about ownership.
 *   2. Make clear that these sections describe the REAL race execution —
 *      the alternative-strategy view lives in `CompareAlternativeStrategies`.
 *
 * Anti-hallucination: if the per-driver `vreResult` is null we render a
 * neutral placeholder instead of fabricating any value.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import {
  SoftSensorsSection,
  GlobalAnalysisSection,
} from "@/components/f1/VirtualRaceEngineerCard";
import type { VirtualRaceEngineerResult } from "@/lib/virtualRaceEngineer";
import type { Driver } from "@/lib/openf1";

interface DriverContextProps {
  driver: Driver;
  result: VirtualRaceEngineerResult | null;
}

function DriverContextPanel({ driver, result }: DriverContextProps) {
  const teamColor = `#${driver.team_colour || "888888"}`;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div
        className="px-4 py-3 border-b border-border flex items-center gap-3"
        style={{ borderLeftWidth: 4, borderLeftColor: teamColor }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ backgroundColor: teamColor, color: "#000" }}
        >
          {driver.name_acronym}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{driver.full_name}</div>
          <div className="text-[10px] text-muted-foreground font-mono uppercase">
            #{driver.driver_number} · contesto strategia reale
          </div>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {!result ? (
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Contesto non disponibile per {driver.name_acronym}.</span>
          </div>
        ) : (
          <>
            <GlobalAnalysisSection result={result} />
            {result.soft_sensors && (
              <SoftSensorsSection
                sensors={result.soft_sensors}
                timeline={result.soft_sensors_timeline}
                warmupInterpretation={result.warmup_interpretation}
                validationContext={result.degradation_validation_context}
                scoringGate={result.soft_sensor_scoring_gate}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface Props {
  driverA: Driver;
  driverB: Driver;
  resultA: VirtualRaceEngineerResult | null;
  resultB: VirtualRaceEngineerResult | null;
}

/**
 * Two-column layout (1-column on mobile) showing each driver's race-context
 * blocks side-by-side. Wraps the panels in a single Card so the section is
 * visually grouped and clearly distinct from the alternative-strategy card.
 */
export function CompareDriverContext({ driverA, driverB, resultA, resultB }: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">Contesto gara per pilota</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Analisi globale e Soft Sensors di ciascun pilota — dati riferiti alla
              <strong className="text-foreground"> strategia reale eseguita</strong>.
            </p>
          </div>
          <Badge variant="outline" className="text-[9px] font-mono uppercase shrink-0">
            reale
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DriverContextPanel driver={driverA} result={resultA} />
          <DriverContextPanel driver={driverB} result={resultB} />
        </div>
      </CardContent>
    </Card>
  );
}
