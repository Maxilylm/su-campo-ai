import { fetchWithTimeout } from "./fetch";

type DownloadResult = { ok: true } | { ok: false; error: string };

/** Download an authenticated same-origin file while surfacing JSON API errors. */
export async function downloadAuthenticatedFile(
  url: string,
  filename: string,
  timeoutMs = 15_000,
): Promise<DownloadResult> {
  const response = await fetchWithTimeout(url, {}, timeoutMs);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    return {
      ok: false,
      error: payload && typeof payload.error === "string" ? payload.error : "No se pudo descargar el archivo.",
    };
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  const headerFilename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1];
  anchor.download = headerFilename || filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  return { ok: true };
}
