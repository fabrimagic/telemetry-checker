import { describe, it, expect } from "vitest";
import {
  computeDomainReliability,
  OUT_OF_DOMAIN_SIGMA,
} from "../circuitDomain";
import {
  CIRCUIT_PROFILES,
  CIRCUIT_KEY_TO_GP_NAME,
} from "../circuitProfiles";
import type { SessionInfo } from "../openf1";

function makeSession(circuit_key: number, session_key = circuit_key): SessionInfo {
  return {
    session_key,
    session_name: "Race",
    session_type: "Race",
    date_start: "2026-01-01T00:00:00Z",
    date_end: "2026-01-01T02:00:00Z",
    location: "x",
    country_name: "x",
    year: 2026,
    circuit_key,
    gpName: "x",
    sessionType: "Gara",
  } as unknown as SessionInfo;
}

// circuit_keys used in tests (resolved via CIRCUIT_KEY_TO_GP_NAME):
//   151 → Miami (226), 9 → COTA (214.5), 39 → Monza (264.7),
//   22 → Monaco (171.7), 7 → Spa (250.7), 19 → Austria (243.0),
//   61 → Singapore (199.5), 2 → Silverstone (249.8)

describe("computeDomainReliability", () => {
  it("(a) Monaco target with fast-circuits reference → out_of_domain with correct numbers", () => {
    const target = CIRCUIT_PROFILES["Gran Premio di Monaco"];
    // References: Miami 226, COTA 214.5, Monza 264.7, Spa 250.7
    const racesUsed = [151, 9, 39, 7].map((k) => makeSession(k));
    const d = computeDomainReliability(target, racesUsed);
    expect(d.status).toBe("out_of_domain");
    expect(d.target_speed).toBe(171.7);
    expect(d.min).toBe(214.5);
    expect(d.max).toBe(264.7);
    expect(d.gap_from_nearest).toBeLessThan(0);
    expect((d.sigma ?? 0)).toBeGreaterThanOrEqual(OUT_OF_DOMAIN_SIGMA);
    expect(d.reference_speeds).toHaveLength(4);
  });

  it("(b) target inside the reference range → in_domain, no warning", () => {
    const target = CIRCUIT_PROFILES["Gran Premio di Miami"]; // 226
    // References include both faster and slower than Miami.
    const racesUsed = [9, 39, 7, 19].map((k) => makeSession(k)); // 214.5,264.7,250.7,243
    const d = computeDomainReliability(target, racesUsed);
    expect(d.status).toBe("in_domain");
    expect(d.gap_from_nearest).toBe(0);
  });

  it("(c) self-update: adding a slow circuit pulls Monaco back into domain", () => {
    const target = CIRCUIT_PROFILES["Gran Premio di Monaco"]; // 171.7
    const before = computeDomainReliability(
      target,
      [151, 9, 39, 7].map((k) => makeSession(k)),
    );
    expect(before.status).toBe("out_of_domain");
    // Add Singapore (199.5) — closer to Monaco than the previous slowest (214.5).
    const after = computeDomainReliability(
      target,
      [151, 9, 39, 7, 61].map((k) => makeSession(k)),
    );
    // Still outside [199.5, 264.7] range, but sigma should now be lower.
    // Verify the sigma drop is what makes it less alarming, and that adding
    // a track AT Monaco's speed brings it fully in.
    expect((after.sigma ?? 0)).toBeLessThan(before.sigma ?? 0);
    // Add a Monaco-speed reference (target itself): now in_domain.
    const inside = computeDomainReliability(target, [
      makeSession(22), // Monaco itself
      ...[151, 9, 39].map((k) => makeSession(k)),
    ]);
    expect(inside.status).toBe("in_domain");
  });

  it("(d) unknown when target lacks quali_speed", () => {
    const target = CIRCUIT_PROFILES["Gran Premio di Spagna"]; // Madrid: no value
    const d = computeDomainReliability(
      target,
      [151, 9, 39].map((k) => makeSession(k)),
    );
    expect(d.status).toBe("unknown");
    expect(d.reason).toBe("no_target_speed");
  });

  it("(d) unknown when no reference circuit has quali_speed", () => {
    const target = CIRCUIT_PROFILES["Gran Premio di Monaco"];
    const d = computeDomainReliability(target, []);
    expect(d.status).toBe("unknown");
    expect(d.reason).toBe("no_reference_speeds");
    // no crash with null/undefined inputs
    expect(computeDomainReliability(null, null).status).toBe("unknown");
    expect(computeDomainReliability(undefined, undefined).status).toBe("unknown");
  });

  it("(e) every CIRCUIT_KEY_TO_GP_NAME entry except Madrid has quali_speed_kmh", () => {
    const missing: string[] = [];
    for (const gpName of Object.values(CIRCUIT_KEY_TO_GP_NAME)) {
      const p = CIRCUIT_PROFILES[gpName];
      if (!p) continue;
      if (gpName === "Gran Premio di Spagna") continue; // Madrid: intentionally undefined
      if (typeof p.quali_speed_kmh !== "number") missing.push(gpName);
    }
    expect(missing).toEqual([]);
    // Madrid (Spagna) is intentionally undefined.
    expect(
      CIRCUIT_PROFILES["Gran Premio di Spagna"].quali_speed_kmh,
    ).toBeUndefined();
  });

  it("ignores duplicate sessions on the same circuit (no double-counting)", () => {
    const target = CIRCUIT_PROFILES["Gran Premio di Monaco"];
    const d = computeDomainReliability(target, [
      makeSession(151, 1),
      makeSession(151, 2),
      makeSession(9, 3),
    ]);
    expect(d.reference_speeds).toHaveLength(2);
  });

  it("(f) top_speed_out_of_range: attivo con target > max, assente con target dentro il range", () => {
    // Reference set: Miami/COTA/Monza/Spa → raccogliamo i loro top_speed reali.
    const refs = [151, 9, 39, 7].map((k) => makeSession(k));
    // Un target dei circuiti sopra è già dentro il range: usiamo Miami stessa.
    const inside = computeDomainReliability(
      CIRCUIT_PROFILES["Gran Premio di Miami"],
      refs,
    );
    expect(inside.top_speed_out_of_range).toBeUndefined();

    // Target sintetico con top_speed=0.99: strettamente sopra il massimo dei
    // profili di riferimento (nessun circuito 2026 mappato ha 0.99).
    const syntheticHi = {
      ...CIRCUIT_PROFILES["Gran Premio di Miami"],
      top_speed: 0.99,
    };
    const hi = computeDomainReliability(syntheticHi, refs);
    expect(hi.top_speed_out_of_range).toBeDefined();
    expect(hi.top_speed_out_of_range!.target).toBe(0.99);
    expect(hi.top_speed_out_of_range!.target).toBeGreaterThan(
      hi.top_speed_out_of_range!.max,
    );

    // Target sintetico con top_speed=0.01: strettamente sotto il minimo.
    const syntheticLo = {
      ...CIRCUIT_PROFILES["Gran Premio di Miami"],
      top_speed: 0.01,
    };
    const lo = computeDomainReliability(syntheticLo, refs);
    expect(lo.top_speed_out_of_range).toBeDefined();
    expect(lo.top_speed_out_of_range!.target).toBeLessThan(
      lo.top_speed_out_of_range!.min,
    );

    // Additivo: non modifica lo status del check di velocità media.
    expect(hi.status).toBe(inside.status);
  });
});
