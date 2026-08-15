import { describe, expect, it } from "vitest";
import { createFarmInviteToken, hashFarmInviteToken, isInviteRole, normalizeInviteEmail } from "./farm-invites";

describe("farm invites", () => {
  it("normalizes and validates invitation emails", () => {
    expect(normalizeInviteEmail("  Worker@Example.COM ")).toBe("worker@example.com");
    expect(normalizeInviteEmail("not-an-email")).toBeNull();
    expect(normalizeInviteEmail(" ")).toBeNull();
  });

  it("supports only editor and viewer invitations", () => {
    expect(isInviteRole("editor")).toBe(true);
    expect(isInviteRole("viewer")).toBe(true);
    expect(isInviteRole("owner")).toBe(false);
  });

  it("creates opaque, one-way invite tokens", () => {
    const token = createFarmInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hashFarmInviteToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashFarmInviteToken(token)).not.toBe(token);
  });
});
