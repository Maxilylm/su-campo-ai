const SHELL_CACHE = "campoai-shell-v2";
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

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_APP_ROUTES") return;
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => Promise.allSettled(
      APP_ROUTES.map(async (path) => {
        try {
          const url = new URL(path, self.location.origin).toString();
          const response = await fetch(new Request(url, { credentials: "include" }));
          if (response.ok) await cache.put(url, response.clone());
        } catch {
          // A single route must not prevent the rest of the offline shell
          // from being prepared.
        }
      }),
    )),
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
