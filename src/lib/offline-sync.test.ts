import { describe, expect, it } from "vitest";
import { extractFarmFromSyncResponse } from "./offline-sync";

describe("offline sync response helpers", () => {
  it("extracts the farm from the raw farm endpoint payload", () => {
    const farm = { id: "farm-1", name: "La Gloria" };
    expect(extractFarmFromSyncResponse({ farm, user: { id: "user-1" } })).toEqual(farm);
  });

  it("does not mistake a wrapped endpoint result for the farm payload", () => {
    expect(extractFarmFromSyncResponse({ data: { farm: { id: "farm-1" } } })).toBeNull();
    expect(extractFarmFromSyncResponse(null)).toBeNull();
  });
});
