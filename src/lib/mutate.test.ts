import { describe, it, expect, vi, afterEach } from "vitest";
import { DATA_CHANGED_EVENT, FARM_CHANGED_EVENT, INSIGHTS_CHANGED_EVENT, SECTIONS_CHANGED_EVENT, notifyFarmChanged, notifyInsightsChanged, notifySectionsChanged, sendJson, sendJsonResult, subscribeToAppEvent } from "./mutate";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendJson", () => {
  it("returns true on a 2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    expect(await sendJson("/api/x", "POST", { a: 1 })).toBe(true);
  });

  it("returns false on a non-2xx response instead of reporting success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await sendJson("/api/x", "POST", { a: 1 })).toBe(false);
  });

  it("preserves a safe server error for callers that need actionable feedback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "La sección no coincide con el cultivo seleccionado." }),
    }));
    await expect(sendJsonResult("/api/x", "PUT", { id: "1" })).resolves.toEqual({
      ok: false,
      status: 400,
      error: "La sección no coincide con el cultivo seleccionado.",
    });
  });

  it("preserves a server error code for contextual recovery actions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "Aplicá la migración.", code: "purchase_migration_required" }),
    }));
    await expect(sendJsonResult("/api/inventory/movements", "POST", { type: "compra" })).resolves.toEqual({
      ok: false,
      status: 503,
      error: "Aplicá la migración.",
      code: "purchase_migration_required",
    });
  });

  it("does not turn an empty error payload into a connection error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => null,
    }));
    await expect(sendJsonResult("/api/x", "PUT", { id: "1" })).resolves.toEqual({
      ok: false,
      status: 500,
      error: undefined,
    });
  });

  it("returns a recoverable connection message when a mutation cannot reach the API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(sendJsonResult("/api/x", "PUT", { id: "1" })).resolves.toEqual({
      ok: false,
      error: "No se pudo conectar con el servidor.",
    });
  });

  it("fails fast while the browser is offline", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendJsonResult("/api/x", "POST", { id: "1" })).resolves.toEqual({
      ok: false,
      error: "Sin conexión. Recuperá internet e intentá nuevamente.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false instead of throwing when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await sendJson("/api/x", "DELETE", { id: "1" })).toBe(false);
  });

  it("serializes the body and sets the JSON content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await sendJson("/api/x", "PUT", { id: "7" });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", expect.objectContaining({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "7" }),
      signal: expect.any(AbortSignal),
    }));
  });

  it("omits the body when none is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await sendJson("/api/x", "POST");
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("notifies the app after a successful mutation", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await sendJson("/api/x", "POST");
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: DATA_CHANGED_EVENT }));
  });

  it("can notify consumers that the farm profile changed", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    notifyFarmChanged();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: FARM_CHANGED_EVENT }));
  });

  it("notifies consumers that shared sections changed", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    notifySectionsChanged();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: DATA_CHANGED_EVENT }));
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: SECTIONS_CHANGED_EVENT }));
  });

  it("notifies consumers when the cached AI insight changes", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    notifyInsightsChanged();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: INSIGHTS_CHANGED_EVENT }));
  });

  it("keeps a successful mutation successful when BroadcastChannel is blocked", async () => {
    vi.resetModules();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      dispatchEvent,
      BroadcastChannel: vi.fn(() => { throw new Error("BroadcastChannel blocked"); }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));

    const { sendJsonResult: isolatedSendJsonResult } = await import("./mutate");

    await expect(isolatedSendJsonResult("/api/x", "POST")).resolves.toEqual({ ok: true, status: 204 });
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: DATA_CHANGED_EVENT }));
  });

  it("subscribes and cleans up through the local event fallback", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", { addEventListener, removeEventListener });
    const listener = vi.fn();

    const unsubscribe = subscribeToAppEvent(DATA_CHANGED_EVENT, listener);

    expect(addEventListener).toHaveBeenCalledWith(DATA_CHANGED_EVENT, listener);
    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith(DATA_CHANGED_EVENT, listener);
  });
});
