const SAMPLE_DATA_REQUEST_TTL_MS = 10 * 60 * 1000;

export interface SampleDataRequestSnapshot {
  status?: string | null;
  updated_at?: string | null;
}

export function isActiveSampleDataRequest(
  request: SampleDataRequestSnapshot | null | undefined,
  now = Date.now(),
): boolean {
  if (request?.status !== "processing" || typeof request.updated_at !== "string") return false;
  const updatedAt = Date.parse(request.updated_at);
  return Number.isFinite(updatedAt) && now - updatedAt < SAMPLE_DATA_REQUEST_TTL_MS;
}
