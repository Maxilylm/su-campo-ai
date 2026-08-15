import { describe, expect, it } from "vitest";
import { isOfflineStorageEventForUser } from "./use-offline-snapshot-refresh";
import { offlineAgendaSnapshotKey, offlineSnapshotKey } from "./offline";

describe("isOfflineStorageEventForUser", () => {
  it("accepts the farm and agenda snapshots for the matching user", () => {
    const userId = "user-1";
    expect(isOfflineStorageEventForUser(userId, offlineSnapshotKey(userId))).toBe(true);
    expect(isOfflineStorageEventForUser(userId, offlineAgendaSnapshotKey(userId))).toBe(true);
  });

  it("ignores another user's snapshot", () => {
    expect(isOfflineStorageEventForUser("user-1", offlineSnapshotKey("user-2"))).toBe(false);
  });

  it("treats localStorage.clear as relevant", () => {
    expect(isOfflineStorageEventForUser("user-1", null)).toBe(true);
  });
});
