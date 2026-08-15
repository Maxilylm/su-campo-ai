import { createHash, randomBytes } from "node:crypto";

export const FARM_INVITE_DAYS = 7;

export function normalizeInviteEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function isInviteRole(value: unknown): value is "editor" | "viewer" {
  return value === "editor" || value === "viewer";
}

export function createFarmInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashFarmInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
