export const FARM_ROLES = ["owner", "editor", "viewer"] as const;

export type FarmRole = (typeof FARM_ROLES)[number];

export function isFarmRole(value: unknown): value is FarmRole {
  return typeof value === "string" && FARM_ROLES.includes(value as FarmRole);
}

export function canWriteFarm(role: FarmRole): boolean {
  return role === "owner" || role === "editor";
}

export function canManageFarmMembers(role: FarmRole): boolean {
  return role === "owner";
}
