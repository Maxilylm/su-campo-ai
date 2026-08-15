import { describe, expect, it } from "vitest";
import { isRouterPrefetch } from "./proxy-request";

describe("isRouterPrefetch", () => {
  it("recognizes Next router prefetch requests", () => {
    expect(isRouterPrefetch(new Headers({ "next-router-prefetch": "1" }))).toBe(true);
  });

  it("recognizes the standard purpose header case-insensitively", () => {
    expect(isRouterPrefetch(new Headers({ purpose: "Prefetch" }))).toBe(true);
  });

  it("does not skip ordinary navigation", () => {
    expect(isRouterPrefetch(new Headers({ purpose: "navigate" }))).toBe(false);
    expect(isRouterPrefetch(new Headers())).toBe(false);
  });
});
