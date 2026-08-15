import { fetchWithTimeout } from "@/lib/fetch";
import { HEALTH_CHECK_TIMEOUT_MS, readHealthCheckedAt, type ServiceStatusPayload } from "@/lib/service-status";

const DEFAULT_RETRY_DELAYS_MS = [600, 1400];

export interface ServiceStatusFetchOptions {
  timeoutMs?: number;
  retryDelaysMs?: number[];
}

export interface ServiceStatusResult {
  payload: ServiceStatusPayload;
  checkedAt: string;
}

function isTransientReason(reason: string | undefined): boolean {
  return reason === "timeout" || reason === "query_error";
}

/** Only retry an unhealthy response when the server identified a transient failure. */
export function shouldRetryServiceStatus(response: Pick<Response, "ok" | "status">, payload: ServiceStatusPayload): boolean {
  if (response.ok || payload.ok) return false;
  return isTransientReason(payload.supabaseReason) || isTransientReason(payload.authReason);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Fetch the public health probe and absorb short cold-start/recovery blips. */
export async function fetchServiceStatus(options: ServiceStatusFetchOptions = {}): Promise<ServiceStatusResult> {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const timeoutMs = options.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) await wait(retryDelaysMs[attempt - 1]);
    try {
      const response = await fetchWithTimeout("/api/status", { cache: "no-store" }, timeoutMs);
      const payload = await response.json().catch(() => null) as ServiceStatusPayload | null;
      if (!payload) throw new Error("invalid status response");
      if (shouldRetryServiceStatus(response, payload) && attempt < retryDelaysMs.length) continue;
      return { payload, checkedAt: readHealthCheckedAt(response) };
    } catch (error) {
      lastError = error;
      if (attempt >= retryDelaysMs.length) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("status request failed");
}
