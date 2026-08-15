import { describe, expect, it } from "vitest";
import { canManageFarmMembers, canWriteFarm, isFarmRole } from "./farm-access";

describe("farm access roles", () => {
  it("accepts only the supported roles", () => {
    expect(isFarmRole("owner")).toBe(true);
    expect(isFarmRole("editor")).toBe(true);
    expect(isFarmRole("viewer")).toBe(true);
    expect(isFarmRole("admin")).toBe(false);
    expect(isFarmRole(null)).toBe(false);
  });

  it("keeps viewers read-only and membership management owner-only", () => {
    expect(canWriteFarm("owner")).toBe(true);
    expect(canWriteFarm("editor")).toBe(true);
    expect(canWriteFarm("viewer")).toBe(false);
    expect(canManageFarmMembers("owner")).toBe(true);
    expect(canManageFarmMembers("editor")).toBe(false);
    expect(canManageFarmMembers("viewer")).toBe(false);
  });
});
