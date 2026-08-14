import { describe, it, expect, vi, afterEach } from "vitest";
import { sendJson } from "./mutate";

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

  it("returns false instead of throwing when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await sendJson("/api/x", "DELETE", { id: "1" })).toBe(false);
  });

  it("serializes the body and sets the JSON content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await sendJson("/api/x", "PUT", { id: "7" });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "7" }),
    });
  });

  it("omits the body when none is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await sendJson("/api/x", "POST");
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });
});
