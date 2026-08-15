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

/** Ask the registered service worker to cache the page shells, best effort. */
export async function warmOfflineAppRoutes(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) return false;
    registration.active.postMessage({ type: "CACHE_APP_ROUTES" });
    return true;
  } catch {
    return false;
  }
}
