import { describe, expect, it } from "vitest";
import { loginRedirectFor, offlineNavigationHref, safeNextPath } from "./navigation";

describe("safe navigation", () => {
  it("keeps internal destinations and their query parameters", () => {
    expect(safeNextPath("/gestion/tareas?new=1&dueDate=2026-08-20")).toBe("/gestion/tareas?new=1&dueDate=2026-08-20");
    expect(loginRedirectFor("/gestion/tareas", "?new=1&dueDate=2026-08-20")).toBe("/login?next=%2Fgestion%2Ftareas%3Fnew%3D1%26dueDate%3D2026-08-20");
  });

  it("rejects external and malformed destinations", () => {
    expect(safeNextPath("https://example.com")).toBe("/");
    expect(safeNextPath("//example.com")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(loginRedirectFor("/gestion/tareas", "", "auth_unavailable")).toBe("/login?next=%2Fgestion%2Ftareas&error=auth_unavailable");
  });

  it("allows same-origin offline route reloads without forwarding API links", () => {
    const current = "https://campoai.test/gestion/campo";
    expect(offlineNavigationHref("/gestion/agenda?days=14", current)).toBe("/gestion/agenda?days=14");
    expect(offlineNavigationHref("https://other.test/gestion/agenda", current)).toBeNull();
    expect(offlineNavigationHref("/api/status", current)).toBeNull();
    expect(offlineNavigationHref(current, current)).toBeNull();
  });
});
