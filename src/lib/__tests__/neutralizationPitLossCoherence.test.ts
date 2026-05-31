/**
 * Coherence test: the SC/VSC pit_loss_multiplier in scenario definitions
 * MUST equal the shared NEUTRALIZATION_PIT_LOSS constant used by the
 * observed-data path in virtualRaceEngineer.ts.
 *
 * Guards against the bug where the same physical phenomenon (pit loss
 * reduction under neutralisation) was encoded with different values in
 * two places (0.62/0.78 observed vs 0.65/0.80 simulated).
 */
import { describe, it, expect } from "vitest";
import { SCENARIO_DEFINITIONS, NEUTRALIZATION_PIT_LOSS } from "../scenarioContext";

describe("NEUTRALIZATION_PIT_LOSS — single source of truth", () => {
  it("SAFETY_CAR scenario uses NEUTRALIZATION_PIT_LOSS.SC", () => {
    expect(SCENARIO_DEFINITIONS.SAFETY_CAR.modifiers.pit_loss_multiplier)
      .toBe(NEUTRALIZATION_PIT_LOSS.SC);
  });

  it("VSC scenario uses NEUTRALIZATION_PIT_LOSS.VSC", () => {
    expect(SCENARIO_DEFINITIONS.VSC.modifiers.pit_loss_multiplier)
      .toBe(NEUTRALIZATION_PIT_LOSS.VSC);
  });

  it("constants match the calibrated observed values", () => {
    expect(NEUTRALIZATION_PIT_LOSS.SC).toBe(0.62);
    expect(NEUTRALIZATION_PIT_LOSS.VSC).toBe(0.78);
    expect(NEUTRALIZATION_PIT_LOSS.MIXED).toBe(0.90);
  });
});
