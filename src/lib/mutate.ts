// Fire a JSON mutation and report success without ever throwing.
// Form handlers must not leave `saving` stuck on a network error, and must not
// toast success on a non-2xx response — funneling every mutation through this
// helper makes both failure modes impossible to reintroduce per-handler.
import { fetchWithTimeout } from "./fetch";

export const DATA_CHANGED_EVENT = "campoai:data-changed";
export const FARM_CHANGED_EVENT = "campoai:farm-changed";
export const SECTIONS_CHANGED_EVENT = "campoai:sections-changed";
export const INSIGHTS_CHANGED_EVENT = "campoai:insights-changed";
export const OFFLINE_SYNC_EVENT = "campoai:offline-sync";
const SYNC_CHANNEL_NAME = "campoai:sync";

type AppEventName = typeof DATA_CHANGED_EVENT | typeof FARM_CHANGED_EVENT | typeof SECTIONS_CHANGED_EVENT | typeof INSIGHTS_CHANGED_EVENT | typeof OFFLINE_SYNC_EVENT;

let syncChannel: BroadcastChannel | null | undefined;

function getSyncChannel(): BroadcastChannel | null {
  if (syncChannel !== undefined) return syncChannel;
  if (typeof window === "undefined" || typeof window.BroadcastChannel !== "function") {
    syncChannel = null;
    return syncChannel;
  }
  try {
    syncChannel = new window.BroadcastChannel(SYNC_CHANNEL_NAME);
  } catch {
    // Some browsers expose BroadcastChannel but disable it in private or
    // restricted contexts. Local-tab events must still work in that case.
    syncChannel = null;
  }
  return syncChannel;
}

function emitAppEvent(name: AppEventName) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(name));
  try {
    getSyncChannel()?.postMessage({ name });
  } catch {
    // A channel can be closed by the browser between lookup and publish.
    // Cross-tab sync is best effort and must never invalidate a successful
    // server mutation or break the local event notification.
    syncChannel = null;
  }
}

/** Listen in this tab and, when supported, in other CampoAI tabs too. */
export function subscribeToAppEvent(name: AppEventName, listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(name, listener);
  const channel = getSyncChannel();
  const onMessage = (event: MessageEvent<{ name?: string }>) => {
    if (event.data?.name === name) listener();
  };
  try {
    channel?.addEventListener("message", onMessage);
  } catch {
    // Local window events remain a complete fallback when the channel is
    // unavailable or has already been closed.
  }
  return () => {
    window.removeEventListener(name, listener);
    try {
      channel?.removeEventListener("message", onMessage);
    } catch {
      // Nothing to clean up when the channel was invalidated by the browser.
    }
  };
}

export function notifyDataChanged() {
  emitAppEvent(DATA_CHANGED_EVENT);
}

export function notifyFarmChanged() {
  notifyDataChanged();
  emitAppEvent(FARM_CHANGED_EVENT);
}

export function notifySectionsChanged() {
  notifyDataChanged();
  emitAppEvent(SECTIONS_CHANGED_EVENT);
}

export function notifyInsightsChanged() {
  emitAppEvent(INSIGHTS_CHANGED_EVENT);
}

export function notifyOfflineSync() {
  emitAppEvent(OFFLINE_SYNC_EVENT);
}

export interface MutationResult {
  ok: boolean;
  status?: number;
  error?: string;
  code?: string;
}

export interface MutationOptions {
  idempotencyKey?: string;
  /** Longer-running bulk operations can opt into a larger client wait window. */
  timeoutMs?: number;
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `campoai-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function sendJsonResult(url: string, method: string, body?: unknown, options?: MutationOptions): Promise<MutationResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, error: "Sin conexión. Recuperá internet e intentá nuevamente." };
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options?.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    const res = await fetchWithTimeout(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }, options?.timeoutMs ?? 10000);
    if (res.ok) {
      notifyDataChanged();
      return { ok: true, status: res.status };
    }
    const payload = typeof res.json === "function" ? await res.json().catch(() => ({})) : {};
    const error = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : undefined;
    const code = payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string"
      ? payload.code
      : undefined;
    return {
      ok: false,
      status: res.status,
      error,
      ...(code ? { code } : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "La operación tardó demasiado. Verificá el resultado antes de volver a intentarlo." };
    }
    return { ok: false, error: "No se pudo conectar con el servidor." };
  }
}

export async function sendJson(url: string, method: string, body?: unknown, options?: MutationOptions): Promise<boolean> {
  return (await sendJsonResult(url, method, body, options)).ok;
}
