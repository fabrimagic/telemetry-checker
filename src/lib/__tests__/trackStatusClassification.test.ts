import { describe, it, expect } from "vitest";
import {
  classifyLapsTrackStatus,
  isSafetyCarDeployment,
  isVirtualSafetyCarDeployment,
  isNeutralizationDeployment,
  isRedFlagDeployment,
  isPenaltyOrProcedureContext,
} from "../trackStatusClassification";

import type { RaceControlMessage, Lap } from "../openf1";

function rc(message: string, extra: Partial<RaceControlMessage> = {}): RaceControlMessage {
  return {
    date: extra.date ?? "2024-01-01T00:00:00Z",
    category: "Other",
    flag: null,
    scope: null,
    sector: null,
    driver_number: null,
    message,
    ...extra,
  } as RaceControlMessage;
}

function lap(n: number, dateStart: string, duration = 90): Lap {
  return {
    driver_number: 1,
    lap_number: n,
    date_start: dateStart,
    lap_duration: duration,
    duration_sector_1: 30,
    duration_sector_2: 30,
    duration_sector_3: 30,
    is_pit_out_lap: false,
    meeting_key: 0,
    session_key: 0,
  } as unknown as Lap;
}

describe("isPenaltyOrProcedureContext", () => {
  it("riconosce penalità/procedura", () => {
    expect(isPenaltyOrProcedureContext("SAFETY CAR INFRINGEMENT - CAR 4 - 5 SECOND PENALTY")).toBe(true);
    expect(isPenaltyOrProcedureContext("CAR 4 UNDER INVESTIGATION")).toBe(true);
    expect(isPenaltyOrProcedureContext("NOTED")).toBe(true);
    expect(isPenaltyOrProcedureContext("NO FURTHER ACTION")).toBe(true);
    expect(isPenaltyOrProcedureContext("REVIEWED - NO ACTION")).toBe(true);
  });

  it("non scatta su deployment puro", () => {
    expect(isPenaltyOrProcedureContext("SAFETY CAR DEPLOYED")).toBe(false);
    expect(isPenaltyOrProcedureContext("VIRTUAL SAFETY CAR DEPLOYED")).toBe(false);
    expect(isPenaltyOrProcedureContext("RED FLAG")).toBe(false);
  });
});

describe("isSafetyCarDeployment", () => {
  it("flag strutturato SAFETY CAR → true", () => {
    expect(isSafetyCarDeployment("", "SAFETY CAR")).toBe(true);
  });

  it("testo 'SAFETY CAR DEPLOYED' → true", () => {
    expect(isSafetyCarDeployment("SAFETY CAR DEPLOYED", null)).toBe(true);
    expect(isSafetyCarDeployment("SAFETY CAR (SC) DEPLOYED", null)).toBe(true);
  });

  it("penalità 'SAFETY CAR INFRINGEMENT' → false", () => {
    expect(isSafetyCarDeployment("SAFETY CAR INFRINGEMENT - CAR 4 - 5 SECOND PENALTY", null)).toBe(false);
  });

  it("non confonde VSC con SC", () => {
    expect(isSafetyCarDeployment("VIRTUAL SAFETY CAR DEPLOYED", null)).toBe(false);
  });
});

describe("isVirtualSafetyCarDeployment", () => {
  it("flag VSC o testo DEPLOYED → true", () => {
    expect(isVirtualSafetyCarDeployment("", "VSC")).toBe(true);
    expect(isVirtualSafetyCarDeployment("VIRTUAL SAFETY CAR DEPLOYED", null)).toBe(true);
    expect(isVirtualSafetyCarDeployment("VSC DEPLOYED", null)).toBe(true);
  });

  it("mera menzione di 'VSC' senza DEPLOYED → false (rimosso match largo)", () => {
    expect(isVirtualSafetyCarDeployment("DRIVERS REMINDED ABOUT VSC PROCEDURE", null)).toBe(false);
  });

  it("penalità con menzione → false", () => {
    expect(isVirtualSafetyCarDeployment("VSC INFRINGEMENT - CAR 4 - PENALTY", null)).toBe(false);
  });
});

describe("isNeutralizationDeployment", () => {
  it("RED FLAG / SC / VSC reali → true", () => {
    expect(isNeutralizationDeployment("RED FLAG", null)).toBe(true);
    expect(isNeutralizationDeployment("", "RED")).toBe(true);
    expect(isNeutralizationDeployment("SAFETY CAR DEPLOYED", null)).toBe(true);
    expect(isNeutralizationDeployment("VIRTUAL SAFETY CAR DEPLOYED", null)).toBe(true);
  });

  it("penalità non è neutralization", () => {
    expect(isNeutralizationDeployment("SAFETY CAR INFRINGEMENT - CAR 4 - 5 SECOND PENALTY", null)).toBe(false);
  });
});

describe("classifyLapsTrackStatus — penalità non esclude giri", () => {
  it("messaggio 'SAFETY CAR INFRINGEMENT' NON marca i giri come SC", () => {
    const msgs = [rc("SAFETY CAR INFRINGEMENT - CAR 4 - 5 SECOND PENALTY", { date: "2024-01-01T00:01:00Z" })];
    const laps = [lap(1, "2024-01-01T00:00:30Z"), lap(2, "2024-01-01T00:02:00Z")];
    const map = classifyLapsTrackStatus(laps, msgs);
    expect(map.get(1)).toBeUndefined();
    expect(map.get(2)).toBeUndefined();
  });

  it("'SAFETY CAR DEPLOYED' marca il giro come SC (non-regressione)", () => {
    const msgs = [
      rc("SAFETY CAR DEPLOYED", { date: "2024-01-01T00:01:00Z", flag: "SAFETY CAR" }),
      rc("TRACK CLEAR", { date: "2024-01-01T00:05:00Z", flag: "CLEAR" }),
    ];
    const laps = [lap(1, "2024-01-01T00:00:00Z"), lap(2, "2024-01-01T00:02:00Z")];
    const map = classifyLapsTrackStatus(laps, msgs);
    expect(map.get(2)).toBe("SC");
  });

  it("'VIRTUAL SAFETY CAR DEPLOYED' → VSC; 'VSC ENDING' chiude", () => {
    const msgs = [
      rc("VIRTUAL SAFETY CAR DEPLOYED", { date: "2024-01-01T00:01:00Z" }),
      rc("VSC ENDING", { date: "2024-01-01T00:03:00Z" }),
    ];
    const laps = [lap(1, "2024-01-01T00:01:30Z")];
    const map = classifyLapsTrackStatus(laps, msgs);
    expect(map.get(1)).toBe("VSC");
  });

  it("RED FLAG invariato", () => {
    const msgs = [rc("RED FLAG", { date: "2024-01-01T00:01:00Z", flag: "RED" })];
    const laps = [lap(1, "2024-01-01T00:01:30Z")];
    const map = classifyLapsTrackStatus(laps, msgs);
    expect(map.get(1)).toBe("RED");
  });

  it("'SAFETY CAR IN THIS LAP' → CLEAR (non SC)", () => {
    const msgs = [
      rc("SAFETY CAR DEPLOYED", { date: "2024-01-01T00:00:30Z", flag: "SAFETY CAR" }),
      rc("SAFETY CAR IN THIS LAP", { date: "2024-01-01T00:02:00Z" }),
    ];
    const laps = [lap(1, "2024-01-01T00:02:30Z")];
    const map = classifyLapsTrackStatus(laps, msgs);
    // dopo "IN THIS LAP" il giro 1 NON è più SC
    expect(map.get(1)).toBeUndefined();
  });
});
