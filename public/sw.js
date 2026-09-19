const SHELL_CACHE = "campoai-shell-v6";
const PUBLIC_ASSET_CACHE = "campoai-public-assets-v1";
const PUBLIC_ASSETS = [
  "/login",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/icon-192.svg",
  "/icon-512.svg",
];
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
    Promise.all([
      caches.open(SHELL_CACHE),
      caches.open(PUBLIC_ASSET_CACHE).then((cache) => cache.addAll(PUBLIC_ASSETS)),
    ])
      .then(() => self.skipWaiting()),
  );
});

const STATIC_ASSET_PATTERN = /(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g;

// _next/static/* filenames are content-hashed per build, so every deploy
// adds a new set without ever removing the previous one — the cache grows
// forever. Build a manifest of what the CURRENT build's shell pages
// actually reference and drop anything else. A wrongly-pruned entry is not
// a correctness bug: the fetch handler below re-fetches and re-caches
// whatever a page still asks for.
async function currentBuildAssetManifest() {
  const manifest = new Set();
  for (const path of ["/", "/login"]) {
    try {
      const response = await fetch(new Request(new URL(path, self.location.origin), { credentials: "include", cache: "no-store" }));
      if (!response.ok) continue;
      const html = await response.text();
      for (const match of html.matchAll(STATIC_ASSET_PATTERN)) manifest.add(match[1]);
    } catch {
      // Offline or unreachable — leave whatever this route would have
      // contributed out of the manifest rather than risk pruning live assets.
    }
  }
  return manifest;
}

async function pruneStaleStaticAssets(assetCache) {
  const manifest = await currentBuildAssetManifest();
  if (manifest.size === 0) return; // Couldn't determine the current build; don't touch the cache.
  const cached = await assetCache.keys();
  await Promise.all(cached.map((request) => {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith("/_next/static/")) return null; // PUBLIC_ASSETS icons/manifest — always keep.
    if (manifest.has(pathname)) return null;
    return assetCache.delete(request);
  }));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== SHELL_CACHE && key !== PUBLIC_ASSET_CACHE).map((key) => caches.delete(key)),
    ))
      .then(() => caches.open(PUBLIC_ASSET_CACHE))
      .then((assetCache) => pruneStaleStaticAssets(assetCache))
      .then(() => self.clients.claim()),
  );
});

async function cacheRouteAndAssets(shellCache, assetCache, path) {
  const url = new URL(path, self.location.origin);
  const response = await fetch(new Request(url, { credentials: "include" }));
  // An expired session redirects to /login; never store that page under an app route.
  if (!response.ok || response.redirected) return false;
  await shellCache.put(url, response.clone());

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
    if (await assetCache.match(assetUrl)) return true;
    try {
      const assetResponse = await fetch(new Request(assetUrl, { credentials: "include" }));
      if (!assetResponse.ok) return false;
      await assetCache.put(assetUrl, assetResponse.clone());
      return true;
    } catch {
      return false;
    }
  }));
  return assetResults.every(Boolean);
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_AUTHENTICATED_SHELL") {
    event.waitUntil(
      caches.delete(SHELL_CACHE)
        .then(() => caches.open(SHELL_CACHE))
        .then(() => event.ports?.[0]?.postMessage({ ok: true })),
    );
    return;
  }
  if (event.data?.type !== "CACHE_APP_ROUTES") return;
  const replyPort = event.ports?.[0];
  event.waitUntil(
    Promise.all([caches.open(SHELL_CACHE), caches.open(PUBLIC_ASSET_CACHE)]).then(([shellCache, assetCache]) => Promise.allSettled(
      APP_ROUTES.map((path) => cacheRouteAndAssets(shellCache, assetCache, path).catch(() => false)),
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
        if (response.ok && !response.redirected) {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => Promise.all([
        caches.open(SHELL_CACHE),
        caches.match("/login"),
      ]).then(([shellCache, login]) => shellCache.match(request, { ignoreSearch: true }).then((cached) => cached || login))),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/favicon.ico" || url.pathname.endsWith(".svg") || url.pathname.endsWith(".png")) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(PUBLIC_ASSET_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});
