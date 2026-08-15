import { describe, expect, it } from "vitest";
import { shouldBlockCrossSiteMutation } from "./csrf";

describe("mutation origin protection", () => {
  const base = { expectedOrigin: "https://campoai.example" };

  it("allows same-origin browser writes and read requests", () => {
    expect(shouldBlockCrossSiteMutation({ ...base, method: "POST", pathname: "/api/cattle", origin: "https://campoai.example" })).toBe(false);
    expect(shouldBlockCrossSiteMutation({ ...base, method: "GET", pathname: "/api/cattle", origin: "https://evil.example" })).toBe(false);
  });

  it("blocks a different origin or explicit cross-site fetch", () => {
    expect(shouldBlockCrossSiteMutation({ ...base, method: "POST", pathname: "/api/cattle", origin: "https://evil.example" })).toBe(true);
    expect(shouldBlockCrossSiteMutation({ ...base, method: "DELETE", pathname: "/api/cattle", secFetchSite: "cross-site" })).toBe(true);
    expect(shouldBlockCrossSiteMutation({ ...base, method: "PUT", pathname: "/api/cattle", referer: "https://evil.example/form" })).toBe(true);
  });

  it("allows origin-less server clients and excludes the public webhook", () => {
    expect(shouldBlockCrossSiteMutation({ ...base, method: "POST", pathname: "/api/cattle" })).toBe(false);
    expect(shouldBlockCrossSiteMutation({ ...base, method: "POST", pathname: "/api/whatsapp", secFetchSite: "cross-site" })).toBe(false);
  });

  it("rejects malformed supplied origins instead of trusting them", () => {
    expect(shouldBlockCrossSiteMutation({ ...base, method: "POST", pathname: "/api/cattle", origin: "not-an-origin" })).toBe(true);
  });
});
