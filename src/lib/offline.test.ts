import { describe, expect, it } from "vitest";
import { buildOfflineSyncBundle, isOfflineSnapshotFresh, offlineActivitySnapshotKey, offlineAgendaSnapshotKey, offlineEntitySnapshotKey, offlineSnapshotKey, offlineSnapshotKeys, parseOfflineActivitySnapshot, parseOfflineAgendaSnapshot, parseOfflineEntitySnapshot, parseOfflineSnapshot } from "./offline";

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
      alertsTruncated: true,
      sectionsTruncated: true,
    }));

    expect(snapshot?.farm.name).toBe("La Gloria");
    expect(snapshot?.sections).toEqual([]);
    expect(snapshot?.alerts).toEqual([]);
    expect(snapshot?.alertsSyncedAt).toBe("2026-08-14T12:00:00.000Z");
    expect(snapshot?.alertsTruncated).toBe(true);
    expect(snapshot?.sectionsTruncated).toBe(true);
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
      cattleTruncated: true,
      tasksTruncated: true,
    }));

    expect(snapshot?.tasks).toHaveLength(1);
    expect(snapshot?.cattle).toHaveLength(1);
    expect(snapshot?.migrationRequired).toBe(true);
    expect(snapshot?.cattleTruncated).toBe(true);
    expect(snapshot?.tasksTruncated).toBe(true);
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
      cattleTruncated: true,
      sectionsTruncated: true,
    }));
    expect(snapshot?.cattle).toHaveLength(1);
    expect(snapshot?.cattleTruncated).toBe(true);
    expect(snapshot?.sectionsTruncated).toBe(true);
    expect(parseOfflineEntitySnapshot(JSON.stringify({ sections: [], savedAt: "2026-08-14T12:00:00.000Z" }))).toBeNull();
  });

  it("only treats recent snapshots as usable", () => {
    const now = Date.parse("2026-08-14T12:00:00.000Z");
    expect(isOfflineSnapshotFresh("2026-08-13T12:00:00.000Z", now, 2 * 86400000)).toBe(true);
    expect(isOfflineSnapshotFresh("2026-08-10T12:00:00.000Z", now, 2 * 86400000)).toBe(false);
    expect(isOfflineSnapshotFresh("2026-08-15T12:00:00.000Z", now, 2 * 86400000)).toBe(false);
  });

  it("builds consistent snapshots for an explicit offline sync", () => {
    const savedAt = "2026-08-15T12:00:00.000Z";
    const sections = [{ id: "section-1", name: "Norte" }] as never[];
    const bundle = buildOfflineSyncBundle({
      farm: { id: "farm-1", name: "La Gloria", total_hectares: null, location: null, operation_type: "mixed" },
      sections,
      alerts: [{ id: "task-1", kind: "task", severity: "high", title: "Revisar", detail: "Hoy", href: "/gestion/tareas" }],
      tasks: [{ id: "task-1", status: "pending" }],
      cattle: [{ id: "cattle-1" }],
      crops: [{ id: "crop-1" }],
      inventory: [{ id: "item-1" }],
      healthEvents: [{ id: "health-1" }],
      vaccinations: [{ id: "vax-1" }],
      activities: [{ id: "activity-1" }],
      migrationRequired: true,
      cattleTruncated: true,
      tasksTruncated: true,
      sectionsTruncated: true,
      alertsTruncated: true,
    }, savedAt);

    expect(bundle.farm.savedAt).toBe(savedAt);
    expect(bundle.farm.alertsTruncated).toBe(true);
    expect(bundle.farm.sections).toEqual(sections);
    expect(bundle.agenda.tasks).toHaveLength(1);
    expect(bundle.agenda.migrationRequired).toBe(true);
    expect(bundle.agenda.cattleTruncated).toBe(true);
    expect(bundle.agenda.tasksTruncated).toBe(true);
    expect(bundle.entities.cattleTruncated).toBe(true);
    expect(bundle.entities.tasksTruncated).toBe(true);
    expect(bundle.entities.sectionsTruncated).toBe(true);
    expect(bundle.entities.inventory).toHaveLength(1);
    expect(bundle.entities.vaccinations).toHaveLength(1);
    expect(bundle.activity.activities).toHaveLength(1);
  });
});
