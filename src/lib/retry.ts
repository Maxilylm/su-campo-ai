// One quiet retry for responses that mean "the server is waking up", not
// "the request is wrong": a cold serverless start right after a deploy
// answered /api/farm with 504 then 503 and was healthy 5 s later, but the
// single failure had already flipped the whole app into read-only recovery.

export const TRANSIENT_STATUSES = new Set([502, 503, 504]);

export async function retryTransientResponse(
  request: () => Promise<Response>,
  options: { retries?: number; delayMs?: number; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
  const retries = options.retries ?? 1;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let response = await request();
  for (let attempt = 0; attempt < retries && TRANSIENT_STATUSES.has(response.status); attempt += 1) {
    if (options.signal?.aborted) break;
    await sleep((options.delayMs ?? 1200) * (attempt + 1));
    if (options.signal?.aborted) break;
    response = await request();
  }
  return response;
}
