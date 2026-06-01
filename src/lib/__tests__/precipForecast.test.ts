import { describe, it, expect } from "vitest";
import { fetchLapPrecipOutlook } from "../precipForecast";

function makeFetch(payload: any, ok = true) {
  return async (_url: any): Promise<any> => ({
    ok,
    json: async () => payload,
  });
}

describe("fetchLapPrecipOutlook", () => {
  it("returns null when circuit is not in the static map", async () => {
    const res = await fetchLapPrecipOutlook("Atlantis", "2024-09-01T13:00:00Z", makeFetch({}));
    expect(res).toBeNull();
  });

  it("returns null when lapDateStartISO is missing/invalid", async () => {
    expect(await fetchLapPrecipOutlook("monza", null, makeFetch({}))).toBeNull();
    expect(await fetchLapPrecipOutlook("monza", "not-a-date", makeFetch({}))).toBeNull();
  });

  it("returns null on http error", async () => {
    const res = await fetchLapPrecipOutlook(
      "monza",
      "2024-09-01T13:00:00Z",
      makeFetch({}, false),
    );
    expect(res).toBeNull();
  });

  it("windows the correct 15-min bins covering [start, start+15min)", async () => {
    const payload = {
      minutely_15: {
        time: [
          "2024-09-01T12:45",
          "2024-09-01T13:00",
          "2024-09-01T13:15",
          "2024-09-01T13:30",
        ],
        precipitation_probability: [10, 40, 60, 80],
        precipitation: [0.0, 0.1, 0.2, 0.5],
      },
    };
    const res = await fetchLapPrecipOutlook(
      "monza",
      "2024-09-01T13:05:00Z",
      makeFetch(payload),
    );
    // Window [13:05, 13:20) covers bins at 13:00 (still ends at 13:15) and 13:15.
    // Expected: max prob = max(40, 60) = 60; sum mm = 0.1 + 0.2 = 0.3.
    expect(res).not.toBeNull();
    expect(res!.probability_pct).toBe(60);
    expect(res!.precip_mm).toBeCloseTo(0.3, 5);
    expect(res!.data_resolution).toBe("15min_native");
    expect(res!.source).toBe("historical_forecast");
  });

  it("returns null when minutely_15 series is empty or missing", async () => {
    expect(
      await fetchLapPrecipOutlook("monza", "2024-09-01T13:05:00Z", makeFetch({})),
    ).toBeNull();
    expect(
      await fetchLapPrecipOutlook(
        "monza",
        "2024-09-01T13:05:00Z",
        makeFetch({ minutely_15: { time: [] } }),
      ),
    ).toBeNull();
  });

  it("returns null when no bin overlaps the window", async () => {
    const payload = {
      minutely_15: {
        time: ["2024-09-01T10:00", "2024-09-01T10:15"],
        precipitation_probability: [5, 5],
        precipitation: [0, 0],
      },
    };
    const res = await fetchLapPrecipOutlook(
      "monza",
      "2024-09-01T13:05:00Z",
      makeFetch(payload),
    );
    expect(res).toBeNull();
  });

  it("flags interpolated resolution for circuits outside native coverage", async () => {
    const payload = {
      minutely_15: {
        time: ["2024-03-01T13:00", "2024-03-01T13:15"],
        precipitation_probability: [20, 30],
        precipitation: [0, 0.05],
      },
    };
    const res = await fetchLapPrecipOutlook(
      "suzuka",
      "2024-03-01T13:00:00Z",
      makeFetch(payload),
    );
    expect(res).not.toBeNull();
    expect(res!.data_resolution).toBe("interpolated");
  });
});
