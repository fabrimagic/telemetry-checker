import { describe, it, expect } from "vitest";
import { computeZones } from "../raceDrivingAverages";
import type { CarData } from "../openf1";

const t0 = new Date("2024-01-01T12:00:00.000Z").getTime();
function sample(i: number, partial: Partial<CarData>): CarData {
  return {
    date: new Date(t0 + i * 100).toISOString(),
    speed: 0,
    throttle: 0,
    brake: 0,
    n_gear: 0,
    rpm: 0,
    drs: 0,
    driver_number: 1,
    session_key: 1,
    ...partial,
  } as CarData;
}

describe("computeZones — superclipping (throttle=100% + RPM dropping)", () => {
  it("(a) base episode: throttle=100 and rpm falling across samples", () => {
    const data = [
      sample(0, { rpm: 12000, throttle: 0 }),
      sample(1, { rpm: 11800, throttle: 100 }), // start
      sample(2, { rpm: 11500, throttle: 100 }), // continue
      sample(3, { rpm: 11200, throttle: 100 }), // continue
      sample(4, { rpm: 11400, throttle: 100 }), // rpm rises → ends, not accumulated
    ];
    const z = computeZones(data);
    expect(z.superclipping.count).toBe(1);
    expect(z.superclipping.dates).toHaveLength(3);
    expect(z.superclipping.duration).toBeCloseTo(0.3, 5);
  });

  it("(b) ends when throttle drops below 100", () => {
    const data = [
      sample(0, { rpm: 12000, throttle: 0 }),
      sample(1, { rpm: 11800, throttle: 100 }), // start
      sample(2, { rpm: 11500, throttle: 100 }),
      sample(3, { rpm: 11300, throttle: 80 }),  // throttle lifted → ends
    ];
    const z = computeZones(data);
    expect(z.superclipping.count).toBe(1);
    expect(z.superclipping.dates).toHaveLength(2);
  });

  it("(c) boundary: throttle=99 does NOT start; throttle=100 does", () => {
    const at99 = computeZones([
      sample(0, { rpm: 12000, throttle: 99 }),
      sample(1, { rpm: 11500, throttle: 99 }),
      sample(2, { rpm: 11000, throttle: 99 }),
    ]);
    expect(at99.superclipping.count).toBe(0);

    const at100 = computeZones([
      sample(0, { rpm: 12000, throttle: 100 }),
      sample(1, { rpm: 11500, throttle: 100 }),
    ]);
    expect(at100.superclipping.count).toBe(1);
  });

  it("(d) two distinct episodes separated by a recovery", () => {
    const data = [
      sample(0, { rpm: 12000, throttle: 0 }),
      sample(1, { rpm: 11800, throttle: 100 }), // start 1
      sample(2, { rpm: 11500, throttle: 100 }),
      sample(3, { rpm: 11800, throttle: 100 }), // rpm rises → ends 1
      sample(4, { rpm: 12200, throttle: 50 }),
      sample(5, { rpm: 12000, throttle: 100 }), // start 2
      sample(6, { rpm: 11700, throttle: 100 }),
      sample(7, { rpm: 12000, throttle: 50 }),  // ends 2
    ];
    const z = computeZones(data);
    expect(z.superclipping.count).toBe(2);
  });

  it("(e) no superclipping when throttle is off even with falling rpm", () => {
    const z = computeZones([
      sample(0, { rpm: 12000, throttle: 0 }),
      sample(1, { rpm: 11500, throttle: 0 }),
      sample(2, { rpm: 11000, throttle: 0 }),
    ]);
    expect(z.superclipping.count).toBe(0);
    expect(z.superclipping.duration).toBe(0);
    expect(z.superclipping.dates).toEqual([]);
  });

  it("(f) no superclipping with throttle=100 but rising rpm", () => {
    const z = computeZones([
      sample(0, { rpm: 10000, throttle: 100 }),
      sample(1, { rpm: 10500, throttle: 100 }),
      sample(2, { rpm: 11000, throttle: 100 }),
    ]);
    expect(z.superclipping.count).toBe(0);
  });

  it("(g) lift & coast remains unaffected by the new superclip logic", () => {
    const data = [
      sample(0, { speed: 300, throttle: 100, brake: 0, rpm: 12000 }),
      sample(1, { speed: 295, throttle: 0, brake: 0, rpm: 11500 }), // l&c start
      sample(2, { speed: 290, throttle: 0, brake: 0, rpm: 11000 }),
      sample(3, { speed: 285, throttle: 0, brake: 0, rpm: 10500 }),
      sample(4, { speed: 282, throttle: 0, brake: 80, rpm: 10000 }), // ends
    ];
    const z = computeZones(data);
    expect(z.liftcoast.count).toBe(1);
    expect(z.liftcoast.duration).toBeGreaterThan(0);
  });

  it("(h) handles missing rpm gracefully (does not start the episode)", () => {
    const z = computeZones([
      sample(0, { throttle: 100, rpm: NaN as unknown as number }),
      sample(1, { throttle: 100, rpm: NaN as unknown as number }),
    ]);
    expect(z.superclipping.count).toBe(0);
  });
});
