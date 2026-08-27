const CACHE_PREFIX = "polaris-shell-";
const BUILD_REVISION = "development"; // @generated-revision
const PRECACHE_PATHS = new Set(["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-icon.png", "/apple-touch-icon.png"]); // @generated-precache
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_REVISION}`;

function isShellAsset(url) {
  return url.origin === self.location.origin && (
    PRECACHE_PATHS.has(`${url.pathname}${url.search}`) ||
    url.pathname.startsWith("/_next/static/")
  );
}

/**
 * A revision gets a new cache. The worker is installable only after every
 * resource referenced by its HTML has been fetched, so the old active cache
 * remains the complete offline shell if a deployment is interrupted.
 */
async function seedShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all([...PRECACHE_PATHS].map(async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to seed offline shell asset: ${path}`);
    await cache.put(path, response.clone());
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(seedShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        // Keep the fallback bound to the assets installed with this revision.
        return await fetch(request, { cache: "no-store" });
      } catch {
        const cached = await caches.open(CACHE_NAME).then((cache) => cache.match("/"));
        return cached ?? Response.error();
      }
    })());
    return;
  }

  if (!isShellAsset(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    // Lazy, content-addressed Next chunks become available offline after use.
    if (response.ok && url.pathname.startsWith("/_next/static/")) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
