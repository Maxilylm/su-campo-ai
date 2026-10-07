"use client";

import { fetchWithTimeout } from "@/lib/fetch";
import { notifyDataChanged } from "@/lib/mutate";
import { normalizeWaterPoint, type WaterPoint } from "@/lib/water-points";

export type JsonWriteResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code?: string };

/** A JSON write that also returns the response body (e.g. a created row's id). */
export async function sendJsonWithBody(url: string, method: string, body: unknown, idempotencyKey?: string): Promise<JsonWriteResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, error: "Sin conexión. Recuperá internet e intentá nuevamente." };
  }
  try {
    const res = await fetchWithTimeout(url, {
      method,
      headers: { "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      body: JSON.stringify(body),
    }, 10000);
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        error: typeof payload?.error === "string" ? payload.error : "No se pudo guardar.",
        ...(typeof payload?.code === "string" ? { code: payload.code } : {}),
      };
    }
    notifyDataChanged();
    return { ok: true, data: payload };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "La operación tardó demasiado. Verificá el resultado antes de volver a intentarlo." };
    }
    return { ok: false, error: "No se pudo conectar con el servidor." };
  }
}

export type WaterPointResult =
  | { ok: true; point: WaterPoint | null }
  | { ok: false; error: string; code?: string };

/** Write to /api/water-points and get the saved row back (sendJsonResult
 * only reports success, and a new aguada's sheet needs its id). */
export async function sendWaterPoint(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, idempotencyKey?: string): Promise<WaterPointResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, error: "Sin conexión. Recuperá internet e intentá nuevamente." };
  }
  try {
    const res = await fetchWithTimeout("/api/water-points", {
      method,
      headers: { "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      body: JSON.stringify(body),
    }, 10000);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: typeof payload?.error === "string" ? payload.error : "No se pudo guardar la aguada.",
        ...(typeof payload?.code === "string" ? { code: payload.code } : {}),
      };
    }
    notifyDataChanged();
    return { ok: true, point: normalizeWaterPoint(payload) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "La operación tardó demasiado. Verificá el resultado antes de volver a intentarlo." };
    }
    return { ok: false, error: "No se pudo conectar con el servidor." };
  }
}
