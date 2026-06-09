import { describe, it, expect } from "vitest";
import {
  messageMentionsDriver,
  getRaceControlEvents,
} from "../raceDiary";
import type { RaceControlMessage, Lap } from "../openf1";

function rc(message: string, extra: Partial<RaceControlMessage> = {}): RaceControlMessage {
  return {
    date: "2024-01-01T00:00:00Z",
    category: "Other",
    flag: null,
    scope: null,
    sector: null,
    driver_number: null,
    message,
    ...extra,
  } as RaceControlMessage;
}

const laps: Lap[] = [];

describe("messageMentionsDriver — precise matching", () => {
  it("NON matcha 'CAR 14' per driver 4", () => {
    expect(messageMentionsDriver("CAR 14 (ALO) 5 SECOND PENALTY", 4, "NOR")).toBe(false);
  });

  it("NON matcha 'TURN 4' / orari per driver 4", () => {
    expect(messageMentionsDriver("TURN 4 INCIDENT", 4, "NOR")).toBe(false);
    expect(messageMentionsDriver("TIME 14:32", 4, "NOR")).toBe(false);
    expect(messageMentionsDriver("4 SECONDS GAP", 4, "NOR")).toBe(false);
  });

  it("matcha 'CAR 4' delimitato", () => {
    expect(messageMentionsDriver("CAR 4 (NOR) UNDER INVESTIGATION", 4, "NOR")).toBe(true);
    expect(messageMentionsDriver("car 4 noted", 4)).toBe(true);
  });

  it("matcha via acronimo '(NOR)'", () => {
    expect(messageMentionsDriver("(NOR) TRACK LIMITS", 4, "NOR")).toBe(true);
  });

  it("matcha 'DRIVER 4' delimitato ma non 'DRIVER 14'", () => {
    expect(messageMentionsDriver("DRIVER 4 PENALTY", 4)).toBe(true);
    expect(messageMentionsDriver("DRIVER 14 PENALTY", 4)).toBe(false);
  });
});

describe("getRaceControlEvents — filtro pilota + track-wide", () => {
  it("esclude messaggi di altri piloti (falso positivo del bug)", () => {
    const msgs = [rc("CAR 14 (ALO) 5 SECOND PENALTY")];
    const ev = getRaceControlEvents(4, msgs, laps, "NOR");
    expect(ev).toHaveLength(0);
  });

  it("include messaggio per il pilota giusto", () => {
    const msgs = [rc("CAR 4 (NOR) UNDER INVESTIGATION")];
    const ev = getRaceControlEvents(4, msgs, laps, "NOR");
    expect(ev).toHaveLength(1);
    expect(ev[0].confidence).toBe("HIGH");
  });

  it("include eventi track-wide per tutti, con confidence MEDIUM se non menziona il pilota", () => {
    const msgs = [
      rc("VIRTUAL SAFETY CAR DEPLOYED"),
      rc("RED FLAG"),
    ];
    const ev = getRaceControlEvents(4, msgs, laps, "NOR");
    expect(ev).toHaveLength(2);
    expect(ev.every((e) => e.confidence === "MEDIUM")).toBe(true);
  });

  it("track-wide che menziona il pilota → HIGH confidence", () => {
    const msgs = [rc("SAFETY CAR DEPLOYED — CAR 4 INCIDENT")];
    const ev = getRaceControlEvents(4, msgs, laps, "NOR");
    expect(ev).toHaveLength(1);
    expect(ev[0].confidence).toBe("HIGH");
  });

  it("non-regressione: TURN 4 senza menzione del pilota non viene incluso", () => {
    const msgs = [rc("TURN 4 YELLOW FLAG")];
    const ev = getRaceControlEvents(4, msgs, laps, "NOR");
    expect(ev).toHaveLength(0);
  });
});
