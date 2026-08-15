import type { Alert } from "@/lib/alerts";
import type { Farm, Section } from "@/contexts/FarmContext";

export const OFFLINE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfflineAgendaSnapshot {
  tasks: unknown[];
  cattle: unknown[];
  crops: unknown[];
  savedAt: string;
  migrationRequired?: boolean;
  cattleTruncated?: boolean;
  tasksTruncated?: boolean;
}

export interface OfflineActivitySnapshot {
  activities: unknown[];
  savedAt: string;
}

export interface OfflineEntitySnapshot {
  sections: unknown[];
  inventory: unknown[];
  crops: unknown[];
  cattle: unknown[];
  tasks: unknown[];
  healthEvents: unknown[];
  vaccinations: unknown[];
  savedAt: string;
  cattleTruncated?: boolean;
  tasksTruncated?: boolean;
}

export interface FarmOfflineSnapshot {
  farm: Farm;
  sections: Section[];
  alerts: Alert[];
  savedAt: string;
  /** Null means the snapshot was saved while the alerts request was failing. */
  alertsSyncedAt: string | null;
  alertsTruncated?: boolean;
}

export interface OfflineSyncData {
  farm: Farm;
  sections: Section[];
  alerts: Alert[];
  tasks: unknown[];
  cattle: unknown[];
  crops: unknown[];
  inventory: unknown[];
  healthEvents: unknown[];
  vaccinations: unknown[];
  activities: unknown[];
  migrationRequired?: boolean;
  cattleTruncated?: boolean;
  tasksTruncated?: boolean;
  alertsTruncated?: boolean;
}

export interface OfflineSyncBundle {
  farm: FarmOfflineSnapshot;
  agenda: OfflineAgendaSnapshot;
  entities: OfflineEntitySnapshot;
  activity: OfflineActivitySnapshot;
}

/** Build every private snapshot written by the explicit offline sync action. */
export function buildOfflineSyncBundle(data: OfflineSyncData, savedAt: string): OfflineSyncBundle {
  return {
    farm: {
      farm: data.farm,
      sections: data.sections,
      alerts: data.alerts,
      savedAt,
      alertsSyncedAt: savedAt,
      alertsTruncated: data.alertsTruncated === true,
    },
    agenda: {
      tasks: data.tasks,
      cattle: data.cattle,
      crops: data.crops,
      savedAt,
      migrationRequired: data.migrationRequired === true,
      cattleTruncated: data.cattleTruncated === true,
      tasksTruncated: data.tasksTruncated === true,
    },
    entities: {
      sections: data.sections,
      inventory: data.inventory,
      crops: data.crops,
      cattle: data.cattle,
      tasks: data.tasks,
      healthEvents: data.healthEvents,
      vaccinations: data.vaccinations,
      savedAt,
      cattleTruncated: data.cattleTruncated === true,
      tasksTruncated: data.tasksTruncated === true,
    },
    activity: { activities: data.activities, savedAt },
  };
}

export function offlineSnapshotKey(userId: string): string {
  return `campoai:offline-snapshot:${encodeURIComponent(userId)}`;
}

export function offlineAgendaSnapshotKey(userId: string): string {
  return `campoai:offline-agenda:${encodeURIComponent(userId)}`;
}

export function offlineActivitySnapshotKey(userId: string): string {
  return `campoai:offline-activity:${encodeURIComponent(userId)}`;
}

export function offlineEntitySnapshotKey(userId: string): string {
  return `campoai:offline-entities:${encodeURIComponent(userId)}`;
}

export function offlineSnapshotKeys(userId: string): string[] {
  return [
    offlineSnapshotKey(userId),
    offlineAgendaSnapshotKey(userId),
    offlineActivitySnapshotKey(userId),
    offlineEntitySnapshotKey(userId),
  ];
}

export function parseOfflineSnapshot(raw: string | null): FarmOfflineSnapshot | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<FarmOfflineSnapshot>;
    if (!value.farm || typeof value.farm !== "object") return null;
    if (typeof value.farm.id !== "string" || typeof value.farm.name !== "string") return null;
    if (typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) return null;
    if (value.alertsSyncedAt !== undefined && value.alertsSyncedAt !== null
      && (typeof value.alertsSyncedAt !== "string" || !Number.isFinite(Date.parse(value.alertsSyncedAt)))) return null;
    if (value.alertsTruncated !== undefined && typeof value.alertsTruncated !== "boolean") return null;

    return {
      farm: value.farm as Farm,
      sections: Array.isArray(value.sections) ? value.sections as Section[] : [],
      alerts: Array.isArray(value.alerts) ? value.alerts as Alert[] : [],
      savedAt: value.savedAt,
      // Snapshots written before this field was introduced had a successful
      // alerts load, so treating the missing marker as fresh is compatible.
      alertsSyncedAt: value.alertsSyncedAt === undefined ? value.savedAt : value.alertsSyncedAt,
      alertsTruncated: value.alertsTruncated === true,
    };
  } catch {
    return null;
  }
}

export function parseOfflineAgendaSnapshot(raw: string | null): OfflineAgendaSnapshot | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<OfflineAgendaSnapshot>;
    if (typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) return null;
    if (!Array.isArray(value.tasks) || !Array.isArray(value.cattle) || !Array.isArray(value.crops)) return null;
    if (value.migrationRequired !== undefined && typeof value.migrationRequired !== "boolean") return null;
    if (value.cattleTruncated !== undefined && typeof value.cattleTruncated !== "boolean") return null;
    if (value.tasksTruncated !== undefined && typeof value.tasksTruncated !== "boolean") return null;
    return {
      tasks: value.tasks,
      cattle: value.cattle,
      crops: value.crops,
      savedAt: value.savedAt,
      migrationRequired: value.migrationRequired === true,
      cattleTruncated: value.cattleTruncated === true,
      tasksTruncated: value.tasksTruncated === true,
    };
  } catch {
    return null;
  }
}

export function parseOfflineActivitySnapshot(raw: string | null): OfflineActivitySnapshot | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<OfflineActivitySnapshot>;
    if (typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) return null;
    if (!Array.isArray(value.activities)) return null;
    return { activities: value.activities, savedAt: value.savedAt };
  } catch {
    return null;
  }
}

export function parseOfflineEntitySnapshot(raw: string | null): OfflineEntitySnapshot | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<OfflineEntitySnapshot>;
    if (typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) return null;
    const fields = [value.sections, value.inventory, value.crops, value.cattle, value.tasks, value.healthEvents, value.vaccinations];
    if (fields.some((field) => !Array.isArray(field))) return null;
    if (value.cattleTruncated !== undefined && typeof value.cattleTruncated !== "boolean") return null;
    if (value.tasksTruncated !== undefined && typeof value.tasksTruncated !== "boolean") return null;
    return {
      sections: value.sections as unknown[],
      inventory: value.inventory as unknown[],
      crops: value.crops as unknown[],
      cattle: value.cattle as unknown[],
      tasks: value.tasks as unknown[],
      healthEvents: value.healthEvents as unknown[],
      vaccinations: value.vaccinations as unknown[],
      savedAt: value.savedAt,
      cattleTruncated: value.cattleTruncated === true,
      tasksTruncated: value.tasksTruncated === true,
    };
  } catch {
    return null;
  }
}

export function isOfflineSnapshotFresh(
  savedAt: string,
  now = Date.now(),
  maxAgeMs = OFFLINE_SNAPSHOT_MAX_AGE_MS,
): boolean {
  const timestamp = Date.parse(savedAt);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
}
