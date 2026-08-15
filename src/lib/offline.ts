import type { Alert } from "@/lib/alerts";
import type { Farm, Section } from "@/contexts/FarmContext";

export const OFFLINE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const OFFLINE_WEATHER_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface OfflineAgendaSnapshot {
  tasks: unknown[];
  cattle: unknown[];
  crops: unknown[];
  savedAt: string;
  migrationRequired?: boolean;
  cattleTruncated?: boolean;
  tasksTruncated?: boolean;
  syncWarnings?: string[];
}

export interface OfflineActivitySnapshot {
  activities: unknown[];
  savedAt: string;
  activitiesTruncated?: boolean;
  syncWarnings?: string[];
}

export interface OfflineMetricsSnapshot {
  data: unknown;
  type: string;
  period: string;
  savedAt: string;
}

export interface OfflineInsightSnapshot {
  summary: string;
  generatedAt: string | null;
  savedAt: string;
}

export interface OfflineWeatherSnapshot {
  data: unknown;
  farmId: string;
  location: string | null;
  savedAt: string;
}

export interface OfflineEntitySnapshot {
  sections: unknown[];
  inventory: unknown[];
  crops: unknown[];
  cattle: unknown[];
  tasks: unknown[];
  healthEvents: unknown[];
  financialTransactions?: unknown[];
  inventoryMovements?: unknown[];
  weightRecords?: unknown[];
  vaccinations: unknown[];
  padrones: unknown[];
  mapFeatures: unknown[];
  savedAt: string;
  cattleTruncated?: boolean;
  tasksTruncated?: boolean;
  sectionsTruncated?: boolean;
  vaccinationsTruncated?: boolean;
  healthEventsTruncated?: boolean;
  financialTruncated?: boolean;
  inventoryTruncated?: boolean;
  inventoryMovementsTruncated?: boolean;
  weightTruncated?: boolean;
  cropApplicationsTruncated?: boolean;
  cropsTruncated?: boolean;
  padronesTruncated?: boolean;
  mapFeaturesTruncated?: boolean;
  syncWarnings?: string[];
}

type OfflineEntitySearchCollections = Pick<OfflineEntitySnapshot, "sections" | "inventory" | "crops" | "cattle" | "tasks" | "healthEvents" | "vaccinations"> & Pick<OfflineEntitySnapshot, "financialTransactions" | "inventoryMovements" | "weightRecords">;

/** Merge the collections fetched by the search palette without erasing datasets
 * that only the explicit offline sync knows how to populate. If a previous
 * snapshot exists, retain its timestamp because the untouched collections may
 * still be older than the newly fetched search results. */
export function mergeOfflineEntitySnapshot(
  previous: OfflineEntitySnapshot | null,
  next: OfflineEntitySearchCollections,
  savedAt: string,
): OfflineEntitySnapshot {
  return {
    ...(previous ?? {}),
    ...next,
    padrones: previous?.padrones ?? [],
    mapFeatures: previous?.mapFeatures ?? [],
    savedAt: previous?.savedAt ?? savedAt,
  };
}

export interface FarmOfflineSnapshot {
  farm: Farm;
  sections: Section[];
  alerts: Alert[];
  savedAt: string;
  /** Null means the snapshot was saved while the alerts request was failing. */
  alertsSyncedAt: string | null;
  alertsTruncated?: boolean;
  sectionsTruncated?: boolean;
  syncWarnings?: string[];
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
  financialTransactions?: unknown[];
  inventoryMovements?: unknown[];
  weightRecords?: unknown[];
  vaccinations: unknown[];
  padrones?: unknown[];
  mapFeatures?: unknown[];
  activities: unknown[];
  migrationRequired?: boolean;
  cattleTruncated?: boolean;
  tasksTruncated?: boolean;
  alertsTruncated?: boolean;
  sectionsTruncated?: boolean;
  vaccinationsTruncated?: boolean;
  healthEventsTruncated?: boolean;
  financialTruncated?: boolean;
  inventoryTruncated?: boolean;
  inventoryMovementsTruncated?: boolean;
  weightTruncated?: boolean;
  cropApplicationsTruncated?: boolean;
  cropsTruncated?: boolean;
  padronesTruncated?: boolean;
  mapFeaturesTruncated?: boolean;
  activitiesTruncated?: boolean;
  syncWarnings?: string[];
  alertsSyncedAt?: string | null;
}

export interface OfflineSyncBundle {
  farm: FarmOfflineSnapshot;
  agenda: OfflineAgendaSnapshot;
  entities: OfflineEntitySnapshot;
  activity: OfflineActivitySnapshot;
}

export interface OfflineSnapshotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Mark that an online mutation happened after the last explicit offline sync. */
export function markOfflineSnapshotStale(
  storage: OfflineSnapshotStorage,
  userId: string,
  staleAt = new Date().toISOString(),
): void {
  storage.setItem(offlineSnapshotStaleKey(userId), staleAt);
}

export function clearOfflineSnapshotStale(storage: OfflineSnapshotStorage, userId: string): void {
  storage.removeItem(offlineSnapshotStaleKey(userId));
}

export function offlineSnapshotStaleAt(storage: OfflineSnapshotStorage, userId: string): string | null {
  const value = storage.getItem(offlineSnapshotStaleKey(userId));
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

export function isOfflineSnapshotStale(
  storage: OfflineSnapshotStorage,
  userId: string,
  savedAt: string,
): boolean {
  const staleAt = offlineSnapshotStaleAt(storage, userId);
  return staleAt !== null && Date.parse(staleAt) > Date.parse(savedAt);
}

/**
 * Persist the four related offline snapshots as one logical operation. If
 * browser storage rejects a write (usually because of quota), restore the
 * previous values so consumers never combine snapshots from different syncs.
 */
export function persistOfflineSyncBundle(
  storage: OfflineSnapshotStorage,
  userId: string,
  bundle: OfflineSyncBundle,
): void {
  const entries: Array<[string, string]> = [
    [offlineSnapshotKey(userId), JSON.stringify(bundle.farm)],
    [offlineAgendaSnapshotKey(userId), JSON.stringify(bundle.agenda)],
    [offlineEntitySnapshotKey(userId), JSON.stringify(bundle.entities)],
    [offlineActivitySnapshotKey(userId), JSON.stringify(bundle.activity)],
  ];
  const previous = entries.map(([key]) => [key, storage.getItem(key)] as const);

  try {
    for (const [key, value] of entries) storage.setItem(key, value);
  } catch (error) {
    for (const [key, value] of previous) {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch {
        // Rollback is best effort; preserve the original quota/storage error.
      }
    }
    throw error;
  }
}

/** Build every private snapshot written by the explicit offline sync action. */
export function buildOfflineSyncBundle(data: OfflineSyncData, savedAt: string): OfflineSyncBundle {
  return {
    farm: {
      farm: data.farm,
      sections: data.sections,
      alerts: data.alerts,
      savedAt,
      alertsTruncated: data.alertsTruncated === true,
      sectionsTruncated: data.sectionsTruncated === true,
      syncWarnings: data.syncWarnings,
      alertsSyncedAt: data.alertsSyncedAt === undefined ? savedAt : data.alertsSyncedAt,
    },
    agenda: {
      tasks: data.tasks,
      cattle: data.cattle,
      crops: data.crops,
      savedAt,
      migrationRequired: data.migrationRequired === true,
      cattleTruncated: data.cattleTruncated === true,
      tasksTruncated: data.tasksTruncated === true,
      syncWarnings: data.syncWarnings,
    },
    entities: {
      sections: data.sections,
      inventory: data.inventory,
      crops: data.crops,
      cattle: data.cattle,
      tasks: data.tasks,
      healthEvents: data.healthEvents,
      financialTransactions: data.financialTransactions,
      inventoryMovements: data.inventoryMovements,
      weightRecords: data.weightRecords,
      vaccinations: data.vaccinations,
      padrones: data.padrones ?? [],
      mapFeatures: data.mapFeatures ?? [],
      savedAt,
      cattleTruncated: data.cattleTruncated === true,
      tasksTruncated: data.tasksTruncated === true,
      sectionsTruncated: data.sectionsTruncated === true,
      vaccinationsTruncated: data.vaccinationsTruncated === true,
      healthEventsTruncated: data.healthEventsTruncated === true,
      financialTruncated: data.financialTruncated === true,
      inventoryTruncated: data.inventoryTruncated === true,
      inventoryMovementsTruncated: data.inventoryMovementsTruncated === true,
      weightTruncated: data.weightTruncated === true,
      cropApplicationsTruncated: data.cropApplicationsTruncated === true,
      cropsTruncated: data.cropsTruncated === true,
      padronesTruncated: data.padronesTruncated === true,
      mapFeaturesTruncated: data.mapFeaturesTruncated === true,
      syncWarnings: data.syncWarnings,
    },
    activity: { activities: data.activities, savedAt, activitiesTruncated: data.activitiesTruncated === true, syncWarnings: data.syncWarnings },
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

export function offlineMetricsSnapshotKey(userId: string, type: string, period: string): string {
  return `campoai:offline-metrics:${encodeURIComponent(userId)}:${encodeURIComponent(type)}:${encodeURIComponent(period)}`;
}

export function offlineMetricsSnapshotKeys(userId: string): string[] {
  return ["general", "livestock", "crops"].flatMap((type) =>
    ["30d", "90d", "year"].map((period) => offlineMetricsSnapshotKey(userId, type, period))
  );
}

export function offlineInsightSnapshotKey(userId: string): string {
  return `campoai:offline-insight:${encodeURIComponent(userId)}`;
}

export function offlineWeatherSnapshotKey(userId: string): string {
  return `campoai:offline-weather:${encodeURIComponent(userId)}`;
}

export function offlineSnapshotStaleKey(userId: string): string {
  return `campoai:offline-stale:${encodeURIComponent(userId)}`;
}

export function offlineSnapshotKeys(userId: string): string[] {
  return [
    offlineSnapshotKey(userId),
    offlineAgendaSnapshotKey(userId),
    offlineActivitySnapshotKey(userId),
    offlineEntitySnapshotKey(userId),
    offlineSnapshotStaleKey(userId),
    ...offlineMetricsSnapshotKeys(userId),
    offlineInsightSnapshotKey(userId),
    offlineWeatherSnapshotKey(userId),
  ];
}

export function parseOfflineSnapshot(raw: string | null): FarmOfflineSnapshot | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<FarmOfflineSnapshot>;
    if (!value.farm || typeof value.farm !== "object") return null;
    if (typeof value.farm.id !== "string" || typeof value.farm.name !== "string") return null;
    if (typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) return null;
    if (value.alertsTruncated !== undefined && typeof value.alertsTruncated !== "boolean") return null;
    if (value.sectionsTruncated !== undefined && typeof value.sectionsTruncated !== "boolean") return null;
    if (value.syncWarnings !== undefined && (!Array.isArray(value.syncWarnings) || value.syncWarnings.some((warning) => typeof warning !== "string"))) return null;
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
      alertsTruncated: value.alertsTruncated === true,
      sectionsTruncated: value.sectionsTruncated === true,
      syncWarnings: Array.isArray(value.syncWarnings) ? value.syncWarnings : [],
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
    if (value.syncWarnings !== undefined && (!Array.isArray(value.syncWarnings) || value.syncWarnings.some((warning) => typeof warning !== "string"))) return null;
    return {
      tasks: value.tasks,
      cattle: value.cattle,
      crops: value.crops,
      savedAt: value.savedAt,
      migrationRequired: value.migrationRequired === true,
      cattleTruncated: value.cattleTruncated === true,
      tasksTruncated: value.tasksTruncated === true,
      syncWarnings: Array.isArray(value.syncWarnings) ? value.syncWarnings : [],
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
    if (value.activitiesTruncated !== undefined && typeof value.activitiesTruncated !== "boolean") return null;
    if (value.syncWarnings !== undefined && (!Array.isArray(value.syncWarnings) || value.syncWarnings.some((warning) => typeof warning !== "string"))) return null;
    return {
      activities: value.activities,
      savedAt: value.savedAt,
      activitiesTruncated: value.activitiesTruncated === true,
      syncWarnings: Array.isArray(value.syncWarnings) ? value.syncWarnings : [],
    };
  } catch {
    return null;
  }
}

export function parseOfflineMetricsSnapshot(raw: string | null): OfflineMetricsSnapshot | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<OfflineMetricsSnapshot>;
    if (typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) return null;
    if (typeof value.type !== "string" || !value.type || typeof value.period !== "string" || !value.period) return null;
    if (!value.data || typeof value.data !== "object" || Array.isArray(value.data)) return null;
    return {
      data: value.data,
      type: value.type,
      period: value.period,
      savedAt: value.savedAt,
    };
  } catch {
    return null;
  }
}

export function parseOfflineInsightSnapshot(raw: string | null): OfflineInsightSnapshot | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<OfflineInsightSnapshot>;
    if (typeof value.summary !== "string" || !value.summary.trim()) return null;
    if (typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) return null;
    if (value.generatedAt !== null && value.generatedAt !== undefined
      && (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt)))) return null;
    return {
      summary: value.summary,
      generatedAt: value.generatedAt ?? null,
      savedAt: value.savedAt,
    };
  } catch {
    return null;
  }
}

export function parseOfflineWeatherSnapshot(raw: string | null): OfflineWeatherSnapshot | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<OfflineWeatherSnapshot>;
    if (!value.data || typeof value.data !== "object" || Array.isArray(value.data)) return null;
    if (typeof value.farmId !== "string" || !value.farmId) return null;
    if (value.location !== null && typeof value.location !== "string") return null;
    if (typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) return null;
    return { data: value.data, farmId: value.farmId, location: value.location ?? null, savedAt: value.savedAt };
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
    if (value.sectionsTruncated !== undefined && typeof value.sectionsTruncated !== "boolean") return null;
    if (value.vaccinationsTruncated !== undefined && typeof value.vaccinationsTruncated !== "boolean") return null;
    if (value.healthEventsTruncated !== undefined && typeof value.healthEventsTruncated !== "boolean") return null;
    if (value.financialTruncated !== undefined && typeof value.financialTruncated !== "boolean") return null;
    if (value.inventoryTruncated !== undefined && typeof value.inventoryTruncated !== "boolean") return null;
    if (value.inventoryMovementsTruncated !== undefined && typeof value.inventoryMovementsTruncated !== "boolean") return null;
    if (value.weightTruncated !== undefined && typeof value.weightTruncated !== "boolean") return null;
    if (value.cropApplicationsTruncated !== undefined && typeof value.cropApplicationsTruncated !== "boolean") return null;
    if (value.cropsTruncated !== undefined && typeof value.cropsTruncated !== "boolean") return null;
    if (value.padrones !== undefined && !Array.isArray(value.padrones)) return null;
    if (value.mapFeatures !== undefined && !Array.isArray(value.mapFeatures)) return null;
    if (value.padronesTruncated !== undefined && typeof value.padronesTruncated !== "boolean") return null;
    if (value.mapFeaturesTruncated !== undefined && typeof value.mapFeaturesTruncated !== "boolean") return null;
    if (value.syncWarnings !== undefined && (!Array.isArray(value.syncWarnings) || value.syncWarnings.some((warning) => typeof warning !== "string"))) return null;
    return {
      sections: value.sections as unknown[],
      inventory: value.inventory as unknown[],
      crops: value.crops as unknown[],
      cattle: value.cattle as unknown[],
      tasks: value.tasks as unknown[],
      healthEvents: value.healthEvents as unknown[],
      financialTransactions: Array.isArray(value.financialTransactions) ? value.financialTransactions : undefined,
      inventoryMovements: Array.isArray(value.inventoryMovements) ? value.inventoryMovements : undefined,
      weightRecords: Array.isArray(value.weightRecords) ? value.weightRecords : undefined,
      vaccinations: value.vaccinations as unknown[],
      // Older entity snapshots predate offline map support; an absent map is
      // a valid empty cache and will be populated by the next sync.
      padrones: Array.isArray(value.padrones) ? value.padrones : [],
      mapFeatures: Array.isArray(value.mapFeatures) ? value.mapFeatures : [],
      savedAt: value.savedAt,
      cattleTruncated: value.cattleTruncated === true,
      tasksTruncated: value.tasksTruncated === true,
      sectionsTruncated: value.sectionsTruncated === true,
      vaccinationsTruncated: value.vaccinationsTruncated === true,
      healthEventsTruncated: value.healthEventsTruncated === true,
      financialTruncated: value.financialTruncated === true,
      inventoryTruncated: value.inventoryTruncated === true,
      inventoryMovementsTruncated: value.inventoryMovementsTruncated === true,
      weightTruncated: value.weightTruncated === true,
      cropApplicationsTruncated: value.cropApplicationsTruncated === true,
      cropsTruncated: value.cropsTruncated === true,
      padronesTruncated: value.padronesTruncated === true,
      mapFeaturesTruncated: value.mapFeaturesTruncated === true,
      syncWarnings: Array.isArray(value.syncWarnings) ? value.syncWarnings : [],
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
