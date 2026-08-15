/** Extract the farm record from the raw /api/farm response. */
export function extractFarmFromSyncResponse(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  return payload.farm && typeof payload.farm === "object" && !Array.isArray(payload.farm)
    ? payload.farm
    : null;
}
