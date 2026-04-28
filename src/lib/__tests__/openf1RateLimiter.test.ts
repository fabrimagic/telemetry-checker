import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { __resetRateLimiterForTests, getDrivers } from "../openf1";

beforeEach(() => {
  __resetRateLimiterForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-28T10:00:00.000Z"));
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OpenF1 dual-window rate limiter", () => {
  it("1. burst di 3 richieste entro 1 secondo: tutte fired", async () => {
    const promises = [getDrivers(1), getDrivers(2), getDrivers(3)];
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(promises);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("2. la 4ª richiesta in 1 secondo aspetta circa 1 secondo", async () => {
    const promises = [getDrivers(1), getDrivers(2), getDrivers(3), getDrivers(4)];
    await vi.advanceTimersByTimeAsync(500);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(700);
    await Promise.all(promises);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("3. 30 richieste in burst: tutte fired entro 15s (limite per-secondo)", async () => {
    const promises = Array.from({ length: 30 }, (_, i) => getDrivers(i + 1));
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.all(promises);
    expect(global.fetch).toHaveBeenCalledTimes(30);
  });

  it("4. 31ª richiesta aspetta il minute window: schedulata > 60s dopo la prima", async () => {
    const promises = Array.from({ length: 31 }, (_, i) => getDrivers(i + 1));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(global.fetch).toHaveBeenCalledTimes(30);
    await vi.advanceTimersByTimeAsync(35_000);
    await Promise.all(promises);
    expect(global.fetch).toHaveBeenCalledTimes(31);
  });

  it("5. dopo idle prolungato il window è pruned: nuova richiesta firing immediato", async () => {
    const initial = Array.from({ length: 30 }, (_, i) => getDrivers(i + 1));
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.all(initial);
    expect(global.fetch).toHaveBeenCalledTimes(30);

    await vi.advanceTimersByTimeAsync(70_000);

    const newPromise = getDrivers(99);
    await vi.advanceTimersByTimeAsync(100);
    await newPromise;
    expect(global.fetch).toHaveBeenCalledTimes(31);
  });
});
