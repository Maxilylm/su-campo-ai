import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(), getSupabaseServer: vi.fn() }));
vi.mock("./supabase-server", () => ({ getSupabaseServer: vi.fn() }));

const { classifyClaimsResult, classifyClaimsThrow } = await import("./auth");

describe("classifyClaimsResult", () => {
  it("returns the user id from verified claims", () => {
    expect(classifyClaimsResult({ data: { claims: { sub: "user-1" } }, error: null })).toEqual({ userId: "user-1", unavailable: false });
  });

  it("treats a missing or invalid session as signed out (401), not an outage", () => {
    expect(classifyClaimsResult({ data: null, error: null })).toEqual({ userId: null, unavailable: false });
    expect(classifyClaimsResult({ data: null, error: { name: "AuthInvalidJwtError" } })).toEqual({ userId: null, unavailable: false });
    expect(classifyClaimsResult({ data: null, error: { name: "AuthSessionMissingError" } })).toEqual({ userId: null, unavailable: false });
    expect(classifyClaimsResult({ data: null, error: { name: "AuthApiError", status: 401 } })).toEqual({ userId: null, unavailable: false });
  });

  it("reports an outage when keys or Auth cannot be reached (503)", () => {
    expect(classifyClaimsResult({ data: null, error: { name: "AuthRetryableFetchError", status: 0 } })).toEqual({ userId: null, unavailable: true });
    expect(classifyClaimsResult({ data: null, error: { name: "AuthApiError", status: 500 } })).toEqual({ userId: null, unavailable: true });
  });

  it("ignores claims without a subject", () => {
    expect(classifyClaimsResult({ data: { claims: { sub: "" } }, error: null })).toEqual({ userId: null, unavailable: false });
  });
});

describe("classifyClaimsThrow", () => {
  it("treats the library's plain expiry errors as signed out, anything else as an outage", () => {
    expect(classifyClaimsThrow(new Error("JWT has expired"))).toEqual({ userId: null, unavailable: false });
    expect(classifyClaimsThrow(new Error("Missing exp claim"))).toEqual({ userId: null, unavailable: false });
    expect(classifyClaimsThrow(new TypeError("fetch failed"))).toEqual({ userId: null, unavailable: true });
    expect(classifyClaimsThrow("weird")).toEqual({ userId: null, unavailable: true });
  });
});
