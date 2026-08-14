import { describe, expect, it } from "vitest";
import { isOfflineSnapshotFresh, offlineSnapshotKey, parseOfflineSnapshot } from "./offline";

describe("offline dashboard snapshots", () => {
  it("creates a user-scoped storage key", () => {
    expect(offlineSnapshotKey("user/a@example.com")).toBe("campoai:offline-snapshot:user%2Fa%40example.com");
  });

  it("accepts a valid snapshot and normalizes missing arrays", () => {
    const snapshot = parseOfflineSnapshot(JSON.stringify({
      farm: { id: "farm-1", name: "La Gloria" },
      savedAt: "2026-08-14T12:00:00.000Z",
    }));

    expect(snapshot?.farm.name).toBe("La Gloria");
    expect(snapshot?.sections).toEqual([]);
    expect(snapshot?.alerts).toEqual([]);
  });

  it("rejects malformed snapshots", () => {
    expect(parseOfflineSnapshot("not-json")).toBeNull();
    expect(parseOfflineSnapshot(JSON.stringify({ farm: { id: "farm-1" }, savedAt: "bad" }))).toBeNull();
  });

  it("only treats recent snapshots as usable", () => {
    const now = Date.parse("2026-08-14T12:00:00.000Z");
    expect(isOfflineSnapshotFresh("2026-08-13T12:00:00.000Z", now, 2 * 86400000)).toBe(true);
    expect(isOfflineSnapshotFresh("2026-08-10T12:00:00.000Z", now, 2 * 86400000)).toBe(false);
    expect(isOfflineSnapshotFresh("2026-08-15T12:00:00.000Z", now, 2 * 86400000)).toBe(false);
  });
});
