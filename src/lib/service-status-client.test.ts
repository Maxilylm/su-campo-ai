import { describe, expect, it, vi } from "vitest";
import { fetchServiceStatus, shouldRetryServiceStatus } from "./service-status-client";

function response(payload: unknown, ok: boolean, status: number) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => payload,
  } as Response;
}

describe("service status client", () => {
  it("retries a transient timeout and returns the recovered result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ok: false, supabaseReason: "timeout", authReason: "ok" }, false, 503))
      .mockResolvedValueOnce(response({ ok: true, supabase: true, auth: true, groq: true }, true, 200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchServiceStatus({ retryDelaysMs: [0] })).resolves.toMatchObject({ payload: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("does not retry a persistent migration diagnosis", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      ok: false,
      supabase: true,
      auth: true,
      groq: true,
      supabaseReason: "ok",
      authReason: "ok",
      features: { schema: { reason: "migration_required", missingMigrations: ["supabase/030_example.sql"] } },
    }, false, 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchServiceStatus({ retryDelaysMs: [0, 0] })).resolves.toMatchObject({ payload: { ok: false } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("stops before fetching when the caller has cancelled the check", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(fetchServiceStatus({ signal: controller.signal, retryDelaysMs: [0] })).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("recognizes only transient unhealthy responses as retryable", () => {
    expect(shouldRetryServiceStatus({ ok: false, status: 503 }, { ok: false, supabaseReason: "timeout" })).toBe(true);
    expect(shouldRetryServiceStatus({ ok: false, status: 503 }, { ok: false, supabaseReason: "query_error" })).toBe(true);
    expect(shouldRetryServiceStatus({ ok: false, status: 503 }, { ok: false, supabaseReason: "ok", features: { schema: { reason: "timeout" } } })).toBe(true);
    expect(shouldRetryServiceStatus({ ok: false, status: 503 }, { ok: false, supabaseReason: "ok", features: { schema: { reason: "query_error" } } })).toBe(true);
    expect(shouldRetryServiceStatus({ ok: false, status: 503 }, { ok: false, supabaseReason: "ok", authReason: "ok" })).toBe(false);
  });
});
