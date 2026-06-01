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

describe("computeZones — superclipping (stateful)", () => {
  it("(a) base episode: throttle>95 + speed decreasing across N samples → one episode, duration = sum of dts", () => {
    const data = [
      sample(0, { speed: 300, throttle: 100 }),
      sample(1, { speed: 298, throttle: 100 }), // start
      sample(2, { speed: 295, throttle: 100 }), // continue
      sample(3, { speed: 292, throttle: 100 }), // continue
      sample(4, { speed: 295, throttle: 100 }), // speed-up → ends here, not accumulated
    ];
    const z = computeZones(data);
    expect(z.superclipping.count).toBe(1);
    // 3 accumulated samples × 0.1s
    expect(z.superclipping.duration).toBeCloseTo(0.3, 5);
    expect(z.superclipping.dates).toHaveLength(3);
  });

  it("(b) ends by brake: terminating brake sample not included", () => {
    const data = [
      sample(0, { speed: 300, throttle: 100 }),
      sample(1, { speed: 298, throttle: 100 }), // start
      sample(2, { speed: 295, throttle: 100 }),
      sample(3, { speed: 293, throttle: 80, brake: 100 }), // brake → ends
      sample(4, { speed: 290, throttle: 0, brake: 100 }),
    ];
    const z = computeZones(data);
    expect(z.superclipping.count).toBe(1);
    expect(z.superclipping.dates).toHaveLength(2);
    expect(z.superclipping.duration).toBeCloseTo(0.2, 5);
  });

  it("(c) ends by speed rising", () => {
    const data = [
      sample(0, { speed: 300, throttle: 100 }),
      sample(1, { speed: 298, throttle: 100 }), // start
      sample(2, { speed: 296, throttle: 100 }),
      sample(3, { speed: 297, throttle: 100 }), // speed-up → ends
    ];
    const z = computeZones(data);
    expect(z.superclipping.count).toBe(1);
    expect(z.superclipping.dates).toHaveLength(2);
  });

  it("(d) boundary: throttle exactly 95 does NOT start; 96 does", () => {
    const at95 = computeZones([
      sample(0, { speed: 300, throttle: 95 }),
      sample(1, { speed: 298, throttle: 95 }),
      sample(2, { speed: 296, throttle: 95 }),
    ]);
    expect(at95.superclipping.count).toBe(0);

    const at96 = computeZones([
      sample(0, { speed: 300, throttle: 96 }),
      sample(1, { speed: 298, throttle: 96 }),
      sample(2, { speed: 300, throttle: 96 }), // ends by speed-up
    ]);
    expect(at96.superclipping.count).toBe(1);
  });

  it("(e) two distinct episodes separated by a recovery", () => {
    const data = [
      sample(0, { speed: 300, throttle: 100 }),
      sample(1, { speed: 298, throttle: 100 }), // start 1
      sample(2, { speed: 296, throttle: 100 }),
      sample(3, { speed: 300, throttle: 100 }), // speed-up → ends 1
      sample(4, { speed: 305, throttle: 100 }),
      sample(5, { speed: 303, throttle: 100 }), // start 2
      sample(6, { speed: 301, throttle: 100 }),
      sample(7, { speed: 305, throttle: 100 }), // speed-up → ends 2
    ];
    const z = computeZones(data);
    expect(z.superclipping.count).toBe(2);
  });

  it("(f) no superclipping when throttle low or speed always rising", () => {
    const lowGas = computeZones([
      sample(0, { speed: 200, throttle: 50 }),
      sample(1, { speed: 195, throttle: 50 }),
      sample(2, { speed: 190, throttle: 50 }),
    ]);
    expect(lowGas.superclipping.count).toBe(0);
    expect(lowGas.superclipping.duration).toBe(0);
    expect(lowGas.superclipping.dates).toEqual([]);

    const rising = computeZones([
      sample(0, { speed: 200, throttle: 100 }),
      sample(1, { speed: 210, throttle: 100 }),
      sample(2, { speed: 220, throttle: 100 }),
    ]);
    expect(rising.superclipping.count).toBe(0);
  });

  it("(g) lift & coast remains unaffected by the new superclip logic", () => {
    const data = [
      sample(0, { speed: 300, throttle: 100, brake: 0 }),
      sample(1, { speed: 295, throttle: 0, brake: 0 }), // lift&coast start
      sample(2, { speed: 290, throttle: 0, brake: 0 }),
      sample(3, { speed: 285, throttle: 0, brake: 0 }),
      sample(4, { speed: 282, throttle: 0, brake: 80 }), // ends
    ];
    const z = computeZones(data);
    expect(z.liftcoast.count).toBe(1);
    expect(z.liftcoast.duration).toBeGreaterThan(0);
  });

  it("during an episode a momentary throttle dip does NOT end it (only brake or speed-rising do)", () => {
    const data = [
      sample(0, { speed: 300, throttle: 100 }),
      sample(1, { speed: 298, throttle: 100 }), // start
      sample(2, { speed: 296, throttle: 80 }),  // throttle dip but speed still falling, no brake
      sample(3, { speed: 294, throttle: 100 }), // continues
      sample(4, { speed: 296, throttle: 100 }), // speed-up → ends
    ];
    const z = computeZones(data);
    expect(z.superclipping.count).toBe(1);
    expect(z.superclipping.dates).toHaveLength(3);
  });
});
