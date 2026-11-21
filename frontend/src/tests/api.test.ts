import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "../api";

afterEach(() => vi.unstubAllGlobals());
describe("API transport", () => {
  it("preserves Headers instances for CSV uploads and adds authentication", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ rows: 1 }));
    vi.stubGlobal("fetch", fetch);
    await request("/api/benchmark/upload", "private-token", {
      method: "POST", body: "packet_rate,byte_rate", headers: new Headers({ "Content-Type": "text/csv" }),
    });
    const headers = fetch.mock.calls[0][1].headers as Headers;
    expect(headers.get("Content-Type")).toBe("text/csv");
    expect(headers.get("Authorization")).toBe("Bearer private-token");
  });
  it("rejects an HTML SPA fallback instead of returning an empty object", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><html></html>")));
    await expect(request("/api/snapshot")).rejects.toThrow("API URL and proxy configuration");
  });
  it("keeps server validation and outage errors actionable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: [{ msg: "Value error, Invalid email" }] }, { status: 422 })));
    await expect(request("/api/auth/register")).rejects.toEqual(new ApiError(422, "Invalid email"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(request("/api/auth/login")).rejects.toThrow("Unable to reach the API");
  });
  it("combines caller cancellation with the request deadline", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await request("/api/auth/me", null, { signal: controller.signal });
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});
