import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, supabaseOrigins } from "./csp";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const [name, ...sources] = part.split(/\s+/);
      return [name, sources] as [string, string[]];
    }),
  );
}

describe("supabaseOrigins", () => {
  it("derives the https origin and its wss twin, dropping path and query", () => {
    expect(supabaseOrigins("https://abc.supabase.co/rest/v1?x=1")).toEqual([
      "https://abc.supabase.co",
      "wss://abc.supabase.co",
    ]);
  });

  it("keeps a local http project on ws with its port", () => {
    expect(supabaseOrigins("http://127.0.0.1:54321")).toEqual(["http://127.0.0.1:54321", "ws://127.0.0.1:54321"]);
  });

  it("returns nothing for a missing, malformed or non-http URL", () => {
    expect(supabaseOrigins(undefined)).toEqual([]);
    expect(supabaseOrigins(null)).toEqual([]);
    expect(supabaseOrigins("   ")).toEqual([]);
    expect(supabaseOrigins("your-project.supabase.co")).toEqual([]);
    expect(supabaseOrigins("javascript:alert(1)")).toEqual([]);
  });
});

describe("buildContentSecurityPolicy", () => {
  const prod = directives(buildContentSecurityPolicy({ supabaseUrl: "https://abc.supabase.co" }));

  it("keeps the anti-framing, plugin and base/form hardening", () => {
    expect(prod.get("frame-ancestors")).toEqual(["'none'"]);
    expect(prod.get("object-src")).toEqual(["'none'"]);
    expect(prod.get("base-uri")).toEqual(["'self'"]);
    expect(prod.get("form-action")).toEqual(["'self'"]);
    expect(prod.get("default-src")).toEqual(["'self'"]);
    expect(prod.has("upgrade-insecure-requests")).toBe(true);
  });

  it("only loads scripts from the app itself and never evals in production", () => {
    expect(prod.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("lets the browser reach only the app and its Supabase project", () => {
    expect(prod.get("connect-src")).toEqual(["'self'", "https://abc.supabase.co", "wss://abc.supabase.co"]);
  });

  it("allows the Leaflet tile host and generated images, self-hosted fonts and the service worker", () => {
    expect(prod.get("img-src")).toEqual(["'self'", "data:", "blob:", "https://server.arcgisonline.com"]);
    expect(prod.get("font-src")).toEqual(["'self'"]);
    expect(prod.get("worker-src")).toEqual(["'self'"]);
  });

  it("falls back to same-origin connections when Supabase is not configured", () => {
    expect(directives(buildContentSecurityPolicy({ supabaseUrl: "not a url" })).get("connect-src")).toEqual(["'self'"]);
    expect(directives(buildContentSecurityPolicy()).get("connect-src")).toEqual(["'self'"]);
  });

  it("adds eval and the HMR socket only in development, without forcing https", () => {
    const dev = directives(buildContentSecurityPolicy({ supabaseUrl: "https://abc.supabase.co", isDev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws:");
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
    expect(prod.get("connect-src")).not.toContain("ws:");
  });

  it("is a single header line", () => {
    expect(buildContentSecurityPolicy({ supabaseUrl: "https://abc.supabase.co" })).not.toMatch(/[\r\n]/);
  });
});
