/**
 * Italian display labels for technical enum statuses shown in the UI.
 * The enum values themselves (used as state, in tests, in serialization)
 * remain unchanged in English uppercase. ONLY the visible label changes.
 */

export const PACE_LOSS_STATUS_LABEL_IT: Record<string, string> = {
  STABLE: "Stabile",
  NORMAL_LOSS: "Perdita normale",
  HIGH_LOSS: "Perdita marcata",
  CLIFF_RISK: "Rischio cliff",
  UNRELIABLE: "Inaffidabile",
};

export const DEGRADATION_VALIDATION_LABEL_IT: Record<string, string> = {
  VALID: "Valido",
  NEUTRAL: "Neutro",
  INVALID: "Invalido",
};

export const CONFIDENCE_LABEL_IT: Record<string, string> = {
  HIGH: "Alta",
  MEDIUM: "Media",
  LOW: "Bassa",
};

export function paceLossStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PACE_LOSS_STATUS_LABEL_IT[status] ?? status;
}

export function degradationValidationLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return DEGRADATION_VALIDATION_LABEL_IT[status] ?? status;
}

export function confidenceLabel(level: string | null | undefined): string {
  if (!level) return "—";
  return CONFIDENCE_LABEL_IT[level] ?? level;
}
