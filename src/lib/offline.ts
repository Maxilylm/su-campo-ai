import type { Alert } from "@/lib/alerts";
import type { Farm, Section } from "@/contexts/FarmContext";

export const OFFLINE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface FarmOfflineSnapshot {
  farm: Farm;
  sections: Section[];
  alerts: Alert[];
  savedAt: string;
}

export function offlineSnapshotKey(userId: string): string {
  return `campoai:offline-snapshot:${encodeURIComponent(userId)}`;
}

export function parseOfflineSnapshot(raw: string | null): FarmOfflineSnapshot | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<FarmOfflineSnapshot>;
    if (!value.farm || typeof value.farm !== "object") return null;
    if (typeof value.farm.id !== "string" || typeof value.farm.name !== "string") return null;
    if (typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) return null;

    return {
      farm: value.farm as Farm,
      sections: Array.isArray(value.sections) ? value.sections as Section[] : [],
      alerts: Array.isArray(value.alerts) ? value.alerts as Alert[] : [],
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
