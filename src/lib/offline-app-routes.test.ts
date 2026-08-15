import { describe, expect, it } from "vitest";
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
});
