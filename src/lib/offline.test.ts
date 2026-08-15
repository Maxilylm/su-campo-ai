import { describe, expect, it } from "vitest";
import { buildOfflineSyncBundle, clearOfflineSnapshotStale, isOfflineSnapshotFresh, isOfflineSnapshotStale, markOfflineSnapshotStale, offlineActivitySnapshotKey, offlineAgendaSnapshotKey, offlineEntitySnapshotKey, offlineInsightSnapshotKey, offlineMetricsSnapshotKey, offlineSnapshotKey, offlineSnapshotKeys, offlineSnapshotStaleKey, offlineWeatherSnapshotKey, parseOfflineActivitySnapshot, parseOfflineAgendaSnapshot, parseOfflineEntitySnapshot, parseOfflineInsightSnapshot, parseOfflineMetricsSnapshot, parseOfflineSnapshot, parseOfflineWeatherSnapshot, persistOfflineSyncBundle } from "./offline";

describe("offline dashboard snapshots", () => {
  it("creates a user-scoped storage key", () => {
    expect(offlineSnapshotKey("user/a@example.com")).toBe("campoai:offline-snapshot:user%2Fa%40example.com");
    expect(offlineAgendaSnapshotKey("user/a@example.com")).toBe("campoai:offline-agenda:user%2Fa%40example.com");
    expect(offlineActivitySnapshotKey("user/a@example.com")).toBe("campoai:offline-activity:user%2Fa%40example.com");
    expect(offlineEntitySnapshotKey("user/a@example.com")).toBe("campoai:offline-entities:user%2Fa%40example.com");
    expect(offlineMetricsSnapshotKey("user/a@example.com", "general", "90d")).toBe("campoai:offline-metrics:user%2Fa%40example.com:general:90d");
    expect(offlineInsightSnapshotKey("user/a@example.com")).toBe("campoai:offline-insight:user%2Fa%40example.com");
    expect(offlineWeatherSnapshotKey("user/a@example.com")).toBe("campoai:offline-weather:user%2Fa%40example.com");
    expect(offlineSnapshotKeys("user/a@example.com")).toEqual([
      "campoai:offline-snapshot:user%2Fa%40example.com",
      "campoai:offline-agenda:user%2Fa%40example.com",
      "campoai:offline-activity:user%2Fa%40example.com",
      "campoai:offline-entities:user%2Fa%40example.com",
      "campoai:offline-stale:user%2Fa%40example.com",
      "campoai:offline-metrics:user%2Fa%40example.com:general:30d",
      "campoai:offline-metrics:user%2Fa%40example.com:general:90d",
      "campoai:offline-metrics:user%2Fa%40example.com:general:year",
      "campoai:offline-metrics:user%2Fa%40example.com:livestock:30d",
      "campoai:offline-metrics:user%2Fa%40example.com:livestock:90d",
      "campoai:offline-metrics:user%2Fa%40example.com:livestock:year",
      "campoai:offline-metrics:user%2Fa%40example.com:crops:30d",
      "campoai:offline-metrics:user%2Fa%40example.com:crops:90d",
      "campoai:offline-metrics:user%2Fa%40example.com:crops:year",
      "campoai:offline-insight:user%2Fa%40example.com",
      "campoai:offline-weather:user%2Fa%40example.com",
    ]);
  });

  it("tracks mutations that happened after the last offline sync", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    markOfflineSnapshotStale(storage, "farm-user", "2026-08-15T12:00:00.000Z");
    expect(values.get(offlineSnapshotStaleKey("farm-user"))).toBe("2026-08-15T12:00:00.000Z");
    expect(isOfflineSnapshotStale(storage, "farm-user", "2026-08-15T11:59:00.000Z")).toBe(true);
    expect(isOfflineSnapshotStale(storage, "farm-user", "2026-08-15T12:00:00.000Z")).toBe(false);
    clearOfflineSnapshotStale(storage, "farm-user");
    expect(isOfflineSnapshotStale(storage, "farm-user", "2026-08-15T11:59:00.000Z")).toBe(false);
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
      activitiesTruncated: true,
      savedAt: "2026-08-14T12:00:00.000Z",
    }));
    expect(snapshot?.activities).toHaveLength(1);
    expect(snapshot?.activitiesTruncated).toBe(true);
    expect(parseOfflineActivitySnapshot(JSON.stringify({ activities: "not-an-array", savedAt: "2026-08-14T12:00:00.000Z" }))).toBeNull();
  });

  it("accepts metrics snapshots and rejects incomplete ones", () => {
    const snapshot = parseOfflineMetricsSnapshot(JSON.stringify({
      data: { snapshot: { totalHeads: 12 } },
      type: "general",
      period: "90d",
      savedAt: "2026-08-14T12:00:00.000Z",
    }));
    expect(snapshot?.type).toBe("general");
    expect(snapshot?.period).toBe("90d");
    expect(snapshot?.data).toEqual({ snapshot: { totalHeads: 12 } });
    expect(parseOfflineMetricsSnapshot(JSON.stringify({ data: {}, type: "general", period: "90d", savedAt: "bad" }))).toBeNull();
    expect(parseOfflineMetricsSnapshot(JSON.stringify({ type: "general", period: "90d", savedAt: "2026-08-14T12:00:00.000Z" }))).toBeNull();
  });

  it("accepts insight snapshots only with a valid summary and timestamps", () => {
    const snapshot = parseOfflineInsightSnapshot(JSON.stringify({
      summary: "Revisá las vacunaciones pendientes.",
      generatedAt: "2026-08-14T11:00:00.000Z",
      savedAt: "2026-08-14T12:00:00.000Z",
    }));
    expect(snapshot?.summary).toContain("vacunaciones");
    expect(snapshot?.generatedAt).toBe("2026-08-14T11:00:00.000Z");
    expect(parseOfflineInsightSnapshot(JSON.stringify({ summary: " ", savedAt: "2026-08-14T12:00:00.000Z" }))).toBeNull();
    expect(parseOfflineInsightSnapshot(JSON.stringify({ summary: "Resumen", generatedAt: "bad", savedAt: "2026-08-14T12:00:00.000Z" }))).toBeNull();
  });

  it("accepts weather snapshots only when the payload and timestamp are valid", () => {
    const snapshot = parseOfflineWeatherSnapshot(JSON.stringify({
      data: { available: true, current: { temp: 22 } },
      farmId: "farm-1",
      location: "Florida, Uruguay",
      savedAt: "2026-08-14T12:00:00.000Z",
    }));
    expect(snapshot?.data).toEqual({ available: true, current: { temp: 22 } });
    expect(snapshot?.farmId).toBe("farm-1");
    expect(snapshot?.location).toBe("Florida, Uruguay");
    expect(parseOfflineWeatherSnapshot(JSON.stringify({ data: [], farmId: "farm-1", location: null, savedAt: "2026-08-14T12:00:00.000Z" }))).toBeNull();
    expect(parseOfflineWeatherSnapshot(JSON.stringify({ data: {}, farmId: "farm-1", location: null, savedAt: "bad" }))).toBeNull();
    expect(parseOfflineWeatherSnapshot(JSON.stringify({ data: {}, location: null, savedAt: "2026-08-14T12:00:00.000Z" }))).toBeNull();
  });

  it("requires every searchable entity collection in the palette snapshot", () => {
    const snapshot = parseOfflineEntitySnapshot(JSON.stringify({
      sections: [], inventory: [], crops: [], cattle: [{ id: "cattle-1" }], tasks: [], healthEvents: [], vaccinations: [],
      savedAt: "2026-08-14T12:00:00.000Z",
      cattleTruncated: true,
      sectionsTruncated: true,
      vaccinationsTruncated: true,
      healthEventsTruncated: true,
      inventoryTruncated: true,
      cropsTruncated: true,
      syncWarnings: ["La actividad no se actualizó; conservamos la última copia disponible."],
    }));
    expect(snapshot?.cattle).toHaveLength(1);
    expect(snapshot?.cattleTruncated).toBe(true);
    expect(snapshot?.sectionsTruncated).toBe(true);
    expect(snapshot?.vaccinationsTruncated).toBe(true);
    expect(snapshot?.healthEventsTruncated).toBe(true);
    expect(snapshot?.inventoryTruncated).toBe(true);
    expect(snapshot?.cropsTruncated).toBe(true);
    expect(snapshot?.padrones).toEqual([]);
    expect(snapshot?.mapFeatures).toEqual([]);
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
      padrones: [{ id: "padron-1" }],
      mapFeatures: [{ id: "feature-1" }],
      activities: [{ id: "activity-1" }],
      migrationRequired: true,
      cattleTruncated: true,
      tasksTruncated: true,
      sectionsTruncated: true,
      vaccinationsTruncated: true,
      healthEventsTruncated: true,
      inventoryTruncated: true,
      cropsTruncated: true,
      padronesTruncated: true,
      mapFeaturesTruncated: true,
      activitiesTruncated: true,
      alertsTruncated: true,
      syncWarnings: ["La actividad no se actualizó; conservamos la última copia disponible."],
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
    expect(bundle.entities.vaccinationsTruncated).toBe(true);
    expect(bundle.entities.healthEventsTruncated).toBe(true);
    expect(bundle.entities.inventoryTruncated).toBe(true);
    expect(bundle.entities.cropsTruncated).toBe(true);
    expect(bundle.entities.inventory).toHaveLength(1);
    expect(bundle.entities.vaccinations).toHaveLength(1);
    expect(bundle.entities.padrones).toHaveLength(1);
    expect(bundle.entities.mapFeatures).toHaveLength(1);
    expect(bundle.entities.padronesTruncated).toBe(true);
    expect(bundle.entities.mapFeaturesTruncated).toBe(true);
    expect(bundle.activity.activities).toHaveLength(1);
    expect(bundle.activity.activitiesTruncated).toBe(true);
    expect(bundle.farm.syncWarnings).toEqual(["La actividad no se actualizó; conservamos la última copia disponible."]);
    expect(bundle.farm.alertsSyncedAt).toBe(savedAt);
  });

  it("restores the previous bundle when storage rejects a write", () => {
    const values = new Map<string, string>();
    let failKey: string | null = offlineEntitySnapshotKey("farm-user");
    let failedOnce = false;
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === failKey && !failedOnce) {
          failedOnce = true;
          throw new Error("quota exceeded");
        }
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    };
    for (const key of offlineSnapshotKeys("farm-user")) values.set(key, `previous:${key}`);

    const savedAt = "2026-08-15T12:00:00.000Z";
    const bundle = buildOfflineSyncBundle({
      farm: { id: "farm-1", name: "La Gloria", total_hectares: null, location: null, operation_type: "mixed" },
      sections: [], alerts: [], tasks: [], cattle: [], crops: [], inventory: [], healthEvents: [], vaccinations: [], activities: [],
    }, savedAt);

    expect(() => persistOfflineSyncBundle(storage, "farm-user", bundle)).toThrow("quota exceeded");
    for (const key of offlineSnapshotKeys("farm-user")) expect(values.get(key)).toBe(`previous:${key}`);
    failKey = null;
  });
});
