import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchLivedata } from "../livedataClient";

describe("livedataClient.fetchLivedata", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the correct URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchLivedata("/v1/sessions", { session_key: 9999 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://livedata.pitwall.it/v1/sessions?session_key=9999",
      { method: "GET" },
    );
  });

  it("throws on 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );
    await expect(fetchLivedata("/v1/laps", { session_key: 1 })).rejects.toThrow(/500/);
  });

  it("omits undefined/null/empty params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    await fetchLivedata("/v1/laps", {
      session_key: 1,
      driver_number: undefined,
      foo: "",
      bar: null,
    });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("session_key=1");
    expect(calledUrl).not.toContain("driver_number");
    expect(calledUrl).not.toContain("foo");
    expect(calledUrl).not.toContain("bar");
  });
});
