const SHELL_CACHE = "campoai-shell-v3";
const APP_ROUTES = [
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
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(["/login", "/manifest.webmanifest", "/icon-192.svg", "/icon-512.svg"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

const STATIC_ASSET_PATTERN = /(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g;

async function cacheRouteAndAssets(cache, path) {
  const url = new URL(path, self.location.origin);
  const response = await fetch(new Request(url, { credentials: "include" }));
  if (!response.ok) return false;
  await cache.put(url, response.clone());

  let html = "";
  try {
    html = await response.text();
  } catch {
    return false;
  }

  const assetPaths = new Set();
  for (const match of html.matchAll(STATIC_ASSET_PATTERN)) assetPaths.add(match[1]);
  const assetResults = await Promise.all([...assetPaths].map(async (assetPath) => {
    const assetUrl = new URL(assetPath, self.location.origin);
    if (await cache.match(assetUrl)) return true;
    try {
      const assetResponse = await fetch(new Request(assetUrl, { credentials: "include" }));
      if (!assetResponse.ok) return false;
      await cache.put(assetUrl, assetResponse.clone());
      return true;
    } catch {
      return false;
    }
  }));
  return assetResults.every(Boolean);
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_APP_ROUTES") return;
  const replyPort = event.ports?.[0];
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => Promise.allSettled(
      APP_ROUTES.map((path) => cacheRouteAndAssets(cache, path).catch(() => false)),
    )).then((results) => {
      const cachedRoutes = results.filter((result) => result.status === "fulfilled" && result.value === true).length;
      replyPort?.postMessage({ ok: cachedRoutes === APP_ROUTES.length, cachedRoutes });
    }).catch(() => {
      replyPort?.postMessage({ ok: false, cachedRoutes: 0 });
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache API responses: farm data is private and must not cross sessions.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match("/login"))),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/favicon.ico" || url.pathname.endsWith(".svg")) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});
