import { describe, it, expect } from "vitest";
import {
  paceLossStatusLabel,
  degradationValidationLabel,
  confidenceLabel,
} from "@/lib/statusLabels";

describe("statusLabels", () => {
  it("paceLossStatusLabel traduce i 5 valori canonici", () => {
    expect(paceLossStatusLabel("STABLE")).toBe("Stabile");
    expect(paceLossStatusLabel("NORMAL_LOSS")).toBe("Perdita normale");
    expect(paceLossStatusLabel("HIGH_LOSS")).toBe("Perdita marcata");
    expect(paceLossStatusLabel("CLIFF_RISK")).toBe("Rischio cliff");
    expect(paceLossStatusLabel("UNRELIABLE")).toBe("Inaffidabile");
  });

  it("degradationValidationLabel + confidenceLabel traducono", () => {
    expect(degradationValidationLabel("VALID")).toBe("Valido");
    expect(degradationValidationLabel("NEUTRAL")).toBe("Neutro");
    expect(degradationValidationLabel("INVALID")).toBe("Invalido");
    expect(confidenceLabel("HIGH")).toBe("Alta");
    expect(confidenceLabel("MEDIUM")).toBe("Media");
    expect(confidenceLabel("LOW")).toBe("Bassa");
  });

  it("fallback: input null/undefined/sconosciuto", () => {
    expect(paceLossStatusLabel(null)).toBe("—");
    expect(paceLossStatusLabel(undefined)).toBe("—");
    expect(degradationValidationLabel("UNKNOWN_STATE")).toBe("UNKNOWN_STATE");
    expect(confidenceLabel(null)).toBe("—");
  });
});
