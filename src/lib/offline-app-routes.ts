/** Routes whose static page shell is useful when a synced field is offline. */
export const OFFLINE_APP_ROUTES = [
  "/",
  "/pendientes",
  "/produccion/hacienda",
  "/produccion/sanidad",
  "/produccion/peso",
  "/produccion/agricultura",
  "/gestion/inventario",
  "/gestion/finanzas",
  "/gestion/metricas",
  "/gestion/registro",
  "/gestion/agenda",
  "/gestion/tareas",
  "/gestion/campo",
  "/reportes",
  "/mapa",
  "/chat",
] as const;

const OFFLINE_ROUTE_WARMUP_TIMEOUT_MS = 20_000;

/** Ask the registered service worker to cache the page shells and wait for its result. */
export async function warmOfflineAppRoutes(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) return false;
    const activeWorker = registration.active;
    if (typeof MessageChannel === "undefined") return false;
    return await new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      let settled = false;
      const timer = setTimeout(() => finish(false), OFFLINE_ROUTE_WARMUP_TIMEOUT_MS);
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        channel.port1.close();
        resolve(ready);
      };
      channel.port1.onmessage = (event) => {
        const cachedRoutes = event.data && typeof event.data.cachedRoutes === "number" ? event.data.cachedRoutes : 0;
        finish(event.data?.ok === true && cachedRoutes === OFFLINE_APP_ROUTES.length);
      };
      try {
        activeWorker.postMessage({ type: "CACHE_APP_ROUTES" }, [channel.port2]);
      } catch {
        finish(false);
      }
    });
  } catch {
    return false;
  }
}
