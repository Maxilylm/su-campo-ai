import type { Alert } from "@/lib/alerts";
import type { Farm, Section } from "@/contexts/FarmContext";

export const OFFLINE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfflineAgendaSnapshot {
  tasks: unknown[];
  cattle: unknown[];
  crops: unknown[];
  savedAt: string;
  migrationRequired?: boolean;
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
}

export interface FarmOfflineSnapshot {
  farm: Farm;
  sections: Section[];
  alerts: Alert[];
  savedAt: string;
  /** Null means the snapshot was saved while the alerts request was failing. */
  alertsSyncedAt: string | null;
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

    return {
      farm: value.farm as Farm,
      sections: Array.isArray(value.sections) ? value.sections as Section[] : [],
      alerts: Array.isArray(value.alerts) ? value.alerts as Alert[] : [],
      savedAt: value.savedAt,
      // Snapshots written before this field was introduced had a successful
      // alerts load, so treating the missing marker as fresh is compatible.
      alertsSyncedAt: value.alertsSyncedAt === undefined ? value.savedAt : value.alertsSyncedAt,
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
    return {
      tasks: value.tasks,
      cattle: value.cattle,
      crops: value.crops,
      savedAt: value.savedAt,
      migrationRequired: value.migrationRequired === true,
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
    return {
      sections: value.sections as unknown[],
      inventory: value.inventory as unknown[],
      crops: value.crops as unknown[],
      cattle: value.cattle as unknown[],
      tasks: value.tasks as unknown[],
      healthEvents: value.healthEvents as unknown[],
      vaccinations: value.vaccinations as unknown[],
      savedAt: value.savedAt,
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
