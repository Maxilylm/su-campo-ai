import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./fetch";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("aborts a request that exceeds its deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchWithTimeout("/api/status", {}, 500);
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(500);

    await rejected;
    expect(fetchMock).toHaveBeenCalledWith("/api/status", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("propagates a caller cancellation and removes the listener after completion", async () => {
    const parent = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchWithTimeout("/api/sections", { signal: parent.signal }, 5000);
    parent.abort("route changed");

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledWith("/api/sections", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("honors an already-aborted caller signal before starting the request", async () => {
    const parent = new AbortController();
    parent.abort("already cancelled");
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      return Promise.resolve(new Response());
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithTimeout("/api/sections", { signal: parent.signal }, 5000)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
