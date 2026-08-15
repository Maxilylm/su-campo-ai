import { describe, expect, it } from "vitest";
import { isOfflineSnapshotFresh, offlineActivitySnapshotKey, offlineAgendaSnapshotKey, offlineEntitySnapshotKey, offlineSnapshotKey, offlineSnapshotKeys, parseOfflineActivitySnapshot, parseOfflineAgendaSnapshot, parseOfflineEntitySnapshot, parseOfflineSnapshot } from "./offline";

describe("offline dashboard snapshots", () => {
  it("creates a user-scoped storage key", () => {
    expect(offlineSnapshotKey("user/a@example.com")).toBe("campoai:offline-snapshot:user%2Fa%40example.com");
    expect(offlineAgendaSnapshotKey("user/a@example.com")).toBe("campoai:offline-agenda:user%2Fa%40example.com");
    expect(offlineActivitySnapshotKey("user/a@example.com")).toBe("campoai:offline-activity:user%2Fa%40example.com");
    expect(offlineEntitySnapshotKey("user/a@example.com")).toBe("campoai:offline-entities:user%2Fa%40example.com");
    expect(offlineSnapshotKeys("user/a@example.com")).toEqual([
      "campoai:offline-snapshot:user%2Fa%40example.com",
      "campoai:offline-agenda:user%2Fa%40example.com",
      "campoai:offline-activity:user%2Fa%40example.com",
      "campoai:offline-entities:user%2Fa%40example.com",
    ]);
  });

  it("accepts a valid snapshot and normalizes missing arrays", () => {
    const snapshot = parseOfflineSnapshot(JSON.stringify({
      farm: { id: "farm-1", name: "La Gloria" },
      savedAt: "2026-08-14T12:00:00.000Z",
    }));

    expect(snapshot?.farm.name).toBe("La Gloria");
    expect(snapshot?.sections).toEqual([]);
    expect(snapshot?.alerts).toEqual([]);
    expect(snapshot?.alertsSyncedAt).toBe("2026-08-14T12:00:00.000Z");
  });

  it("preserves a partial-sync marker when alerts were unavailable", () => {
    const snapshot = parseOfflineSnapshot(JSON.stringify({
      farm: { id: "farm-1", name: "La Gloria" },
      sections: [{ id: "section-1" }],
      alerts: [],
      savedAt: "2026-08-14T12:00:00.000Z",
      alertsSyncedAt: null,
    }));

    expect(snapshot?.alertsSyncedAt).toBeNull();
    expect(snapshot?.sections).toHaveLength(1);
  });

  it("rejects an invalid partial-sync timestamp", () => {
    expect(parseOfflineSnapshot(JSON.stringify({
      farm: { id: "farm-1", name: "La Gloria" },
      savedAt: "2026-08-14T12:00:00.000Z",
      alertsSyncedAt: "not-a-date",
    }))).toBeNull();
  });

  it("rejects malformed snapshots", () => {
    expect(parseOfflineSnapshot("not-json")).toBeNull();
    expect(parseOfflineSnapshot(JSON.stringify({ farm: { id: "farm-1" }, savedAt: "bad" }))).toBeNull();
  });

  it("accepts an agenda snapshot only when all read-only datasets are present", () => {
    const snapshot = parseOfflineAgendaSnapshot(JSON.stringify({
      tasks: [{ id: "task-1" }],
      cattle: [{ id: "cattle-1" }],
      crops: [],
      savedAt: "2026-08-14T12:00:00.000Z",
      migrationRequired: true,
    }));

    expect(snapshot?.tasks).toHaveLength(1);
    expect(snapshot?.cattle).toHaveLength(1);
    expect(snapshot?.migrationRequired).toBe(true);
    expect(parseOfflineAgendaSnapshot(JSON.stringify({ tasks: [], crops: [], savedAt: "2026-08-14T12:00:00.000Z" }))).toBeNull();
  });

  it("rejects an agenda snapshot with an invalid timestamp", () => {
    expect(parseOfflineAgendaSnapshot(JSON.stringify({ tasks: [], cattle: [], crops: [], savedAt: "bad" }))).toBeNull();
  });

  it("accepts and rejects activity snapshots by shape", () => {
    const snapshot = parseOfflineActivitySnapshot(JSON.stringify({
      activities: [{ id: "activity-1" }],
      savedAt: "2026-08-14T12:00:00.000Z",
    }));
    expect(snapshot?.activities).toHaveLength(1);
    expect(parseOfflineActivitySnapshot(JSON.stringify({ activities: "not-an-array", savedAt: "2026-08-14T12:00:00.000Z" }))).toBeNull();
  });

  it("requires every searchable entity collection in the palette snapshot", () => {
    const snapshot = parseOfflineEntitySnapshot(JSON.stringify({
      sections: [], inventory: [], crops: [], cattle: [{ id: "cattle-1" }], tasks: [], healthEvents: [], vaccinations: [],
      savedAt: "2026-08-14T12:00:00.000Z",
    }));
    expect(snapshot?.cattle).toHaveLength(1);
    expect(parseOfflineEntitySnapshot(JSON.stringify({ sections: [], savedAt: "2026-08-14T12:00:00.000Z" }))).toBeNull();
  });

  it("only treats recent snapshots as usable", () => {
    const now = Date.parse("2026-08-14T12:00:00.000Z");
    expect(isOfflineSnapshotFresh("2026-08-13T12:00:00.000Z", now, 2 * 86400000)).toBe(true);
    expect(isOfflineSnapshotFresh("2026-08-10T12:00:00.000Z", now, 2 * 86400000)).toBe(false);
    expect(isOfflineSnapshotFresh("2026-08-15T12:00:00.000Z", now, 2 * 86400000)).toBe(false);
  });
});
