import { describe, expect, it } from "vitest";
import { isApiPath, isPublicPath } from "./public-paths";

describe("isPublicPath", () => {
  it("allows public entry points without an auth lookup", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/api/status")).toBe(true);
    expect(isPublicPath("/reset-password")).toBe(true);
    expect(isPublicPath("/robots.txt")).toBe(true);
  });

  it("does not make protected app routes public by prefix accident", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/gestion/tareas")).toBe(false);
    expect(isPublicPath("/api/tasks")).toBe(false);
    expect(isPublicPath("/robots.txt.bak")).toBe(false);
    expect(isPublicPath("/login-help")).toBe(false);
  });

  it("recognizes API routes so route handlers can own authorization", () => {
    expect(isApiPath("/api/tasks")).toBe(true);
    expect(isApiPath("/api/status")).toBe(true);
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/gestion/tareas")).toBe(false);
    expect(isApiPath("/apiary")).toBe(false);
  });
});
