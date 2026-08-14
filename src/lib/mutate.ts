// Fire a JSON mutation and report success without ever throwing.
// Form handlers must not leave `saving` stuck on a network error, and must not
// toast success on a non-2xx response — funneling every mutation through this
// helper makes both failure modes impossible to reintroduce per-handler.
export async function sendJson(url: string, method: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
