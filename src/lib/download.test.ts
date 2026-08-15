import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAuthenticatedFile } from "./download";

afterEach(() => vi.unstubAllGlobals());

describe("authenticated downloads", () => {
  it("surfaces a JSON API error instead of downloading it as a file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "El calendario supera el límite." }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(downloadAuthenticatedFile("/api/calendar", "campoai-calendario.ics"))
      .resolves.toEqual({ ok: false, error: "El calendario supera el límite." });
  });
});
