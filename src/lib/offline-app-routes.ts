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
const OFFLINE_SERVICE_WORKER_READY_TIMEOUT_MS = 5_000;

function waitForServiceWorkerReady(): Promise<ServiceWorkerRegistration | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (registration: ServiceWorkerRegistration | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(registration);
    };
    const timer = setTimeout(() => finish(null), OFFLINE_SERVICE_WORKER_READY_TIMEOUT_MS);
    navigator.serviceWorker.ready.then(finish).catch(() => finish(null));
  });
}

/** Ask the registered service worker to cache the page shells and wait for its result. */
export async function warmOfflineAppRoutes(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const registration = await waitForServiceWorkerReady();
    if (!registration || !registration.active) return false;
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
