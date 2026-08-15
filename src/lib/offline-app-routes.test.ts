import { describe, expect, it, vi } from "vitest";
import { OFFLINE_APP_ROUTES, warmOfflineAppRoutes } from "./offline-app-routes";

describe("offline app route shells", () => {
  it("includes every authenticated destination in the navigation shell", () => {
    expect(OFFLINE_APP_ROUTES).toEqual(expect.arrayContaining([
      "/",
      "/produccion/hacienda",
      "/produccion/peso",
      "/gestion/inventario",
      "/gestion/finanzas",
      "/gestion/campo",
      "/reportes",
      "/mapa",
      "/chat",
    ]));
  });

  it("does not fail when service workers are unavailable", async () => {
    await expect(warmOfflineAppRoutes()).resolves.toBe(false);
  });

  it("does not wait forever when service worker readiness is stuck", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { serviceWorker: { ready: new Promise(() => {}) } });
    try {
      const result = warmOfflineAppRoutes();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(result).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
