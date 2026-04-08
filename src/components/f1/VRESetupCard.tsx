/**
 * VRE Setup Card — Always-visible sidebar card with VRE controls.
 * Contains: Analysis Mode toggle, View Mode selector, Scenario selector, Risk Mode.
 * No calculation logic — purely UI controls.
 */

import type { AnalysisMode } from "@/lib/virtualRaceEngineer";
import type { ViewMode } from "./VREViewModes";
import type { RiskMode } from "@/lib/riskAppetite";
import { RISK_MODES } from "@/lib/riskAppetite";
import { ALL_SCENARIO_IDS, SCENARIO_DEFINITIONS, isSimulatedScenario, type ScenarioId } from "@/lib/scenarioContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Shield, Scale, Zap, FlaskConical, AlertTriangle, Settings2 } from "lucide-react";
import React from "react";

interface Props {
  analysisMode: AnalysisMode;
  onAnalysisModeChange: (mode: AnalysisMode) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  riskMode: RiskMode;
  onRiskModeChange: (mode: RiskMode) => void;
  scenarioId: ScenarioId;
  onScenarioChange: (scenario: ScenarioId) => void;
  scenarioActivationLap: number | null;
  onScenarioActivationLapChange: (lap: number | null) => void;
  scenarioDurationLaps: number | null;
  onScenarioDurationChange: (duration: number | null) => void;
  scenarioDescription?: string;
  scenarioIsSimulated?: boolean;
  scenarioWindow?: { start: number; end: number } | null;
  scenarioActivationWarning?: string | null;
  maxLap?: number;
}

export function VRESetupCard({
  analysisMode, onAnalysisModeChange,
  viewMode, onViewModeChange,
  riskMode, onRiskModeChange,
  scenarioId, onScenarioChange,
  scenarioActivationLap, onScenarioActivationLapChange,
  scenarioDurationLaps, onScenarioDurationChange,
  scenarioDescription, scenarioIsSimulated, scenarioWindow,
  scenarioActivationWarning, maxLap = 99,
}: Props) {
  const isRaceEngineerMode = analysisMode === "RACE_ENGINEER";

  return (
    <Card className="border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <Settings2 className="h-3.5 w-3.5" />
          Virtual Race Engineer Setup
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 px-4 pb-4 pt-0">

        {/* ── Analysis Mode Toggle ── */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Modalità</label>
          <div className="flex rounded-md border border-border overflow-hidden w-full">
            {(["RACE_ENGINEER", "POST_RACE"] as AnalysisMode[]).map((mode) => {
              const labels: Record<AnalysisMode, string> = { RACE_ENGINEER: "Race Engineer", POST_RACE: "Post-Race Analysis" };
              const icons: Record<AnalysisMode, string> = { RACE_ENGINEER: "🔴", POST_RACE: "📊" };
              const isActive = analysisMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => onAnalysisModeChange(mode)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] font-semibold transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span>{icons[mode]}</span>
                  {labels[mode]}
                </button>
              );
            })}
          </div>
          <p className="text-[9px] text-muted-foreground leading-relaxed">
            {isRaceEngineerMode
              ? "Decisione basata sulle info disponibili in quel momento."
              : "Analisi a posteriori con conoscenza completa della gara."
            }
          </p>
        </div>

        {/* ── View Mode Selector ── */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Visualizzazione</label>
          <div className="flex rounded-md border border-border overflow-hidden w-full">
            {(["ENGINEER", "ANALYST", "BROADCAST"] as ViewMode[]).map((mode) => {
              const labels: Record<ViewMode, string> = { ENGINEER: "Engineer", ANALYST: "Analyst", BROADCAST: "Broadcast" };
              const isActive = viewMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => onViewModeChange(mode)}
                  className={`flex-1 px-2 py-2 text-[10px] font-semibold transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {labels[mode]}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Scenario Selector ── */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Scenario</label>
          {isRaceEngineerMode ? (
            <div className="rounded-md bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-[10px] text-blue-400 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              <span>Real Conditions (bloccato)</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Select
                value={scenarioId}
                onValueChange={(val) => onScenarioChange(val as ScenarioId)}
              >
                <SelectTrigger className="h-8 text-[11px] w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_SCENARIO_IDS.map((sid) => {
                    const def = SCENARIO_DEFINITIONS[sid];
                    return (
                      <SelectItem key={sid} value={sid} className="text-[11px]">
                        <span className="flex items-center gap-1.5">
                          {isSimulatedScenario(sid) && <FlaskConical className="h-3 w-3 text-amber-400" />}
                          {def.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {scenarioDescription && (
                <p className="text-[9px] text-muted-foreground">{scenarioDescription}</p>
              )}
              {scenarioIsSimulated && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-muted-foreground">Giro attivazione</label>
                      <Input
                        type="number"
                        min={1}
                        max={maxLap}
                        value={scenarioActivationLap ?? ""}
                        placeholder="Tutti"
                        onChange={(e) => {
                          const val = e.target.value;
                          onScenarioActivationLapChange(val === "" ? null : parseInt(val, 10));
                        }}
                        className="h-7 text-[11px] font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-muted-foreground">Durata (giri)</label>
                      <Input
                        type="number"
                        min={1}
                        max={maxLap}
                        value={scenarioDurationLaps ?? ""}
                        placeholder="∞"
                        onChange={(e) => {
                          const val = e.target.value;
                          onScenarioDurationChange(val === "" ? null : parseInt(val, 10));
                        }}
                        className="h-7 text-[11px] font-mono"
                      />
                    </div>
                  </div>
                  {scenarioWindow && (
                    <p className="text-[9px] text-foreground/70 font-mono">
                      📌 Finestra: giro {scenarioWindow.start} → {scenarioWindow.end}
                    </p>
                  )}
                  {scenarioActivationWarning && (
                    <p className="text-[9px] text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {scenarioActivationWarning}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Risk Mode ── */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Risk Mode</label>
          <div className="flex rounded-md border border-border overflow-hidden w-full">
            {(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"] as RiskMode[]).map((mode) => {
              const info = RISK_MODES[mode];
              const isActive = riskMode === mode;
              const icons: Record<RiskMode, React.ReactNode> = {
                CONSERVATIVE: <Shield className="h-3 w-3" />,
                BALANCED: <Scale className="h-3 w-3" />,
                AGGRESSIVE: <Zap className="h-3 w-3" />,
              };
              return (
                <button
                  key={mode}
                  onClick={() => onRiskModeChange(mode)}
                  className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-2 text-[10px] font-semibold transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                  title={info.description}
                >
                  {icons[mode]}
                  {info.label}
                </button>
              );
            })}
          </div>
          <p className="text-[9px] text-muted-foreground">
            {riskMode === "CONSERVATIVE" && "Priorità a robustezza e track position."}
            {riskMode === "BALANCED" && "Compromesso equilibrato."}
            {riskMode === "AGGRESSIVE" && "Massimizza guadagno, accetta più rischio."}
          </p>
        </div>

      </CardContent>
    </Card>
  );
}
