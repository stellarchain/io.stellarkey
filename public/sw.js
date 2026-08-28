const CACHE_PREFIX = "stellarkey-shell-";
const BUILD_REVISION = "development"; // @generated-revision
const PRECACHE_PATHS = new Set(["/", "/about", "/privacy", "/terms", "/security", "/support", "/manifest.webmanifest", "/icon.svg", "/icon-192.png?v=2", "/icon-512.png?v=2", "/icon-maskable-192.png?v=2", "/icon-maskable-512.png?v=2", "/icon-maskable-1024.png?v=2", "/apple-icon.png", "/apple-icon1.png", "/apple-icon2.png", "/apple-touch-icon.png"]); // @generated-precache
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
  event.waitUntil(seedShell());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "SKIP_WAITING") return;
  if (!event.source || typeof event.source.url !== "string") return;
  let sourceOrigin;
  try {
    sourceOrigin = new URL(event.source.url).origin;
  } catch {
    return;
  }
  if (sourceOrigin !== self.location.origin) return;
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const previousName = names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .at(-1);
    await Promise.all(
      names
        .filter(
          (name) =>
            name.startsWith(CACHE_PREFIX) &&
            name !== CACHE_NAME &&
            name !== previousName,
        )
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
        const normalizedNavigationPath = url.pathname === "/"
          ? "/"
          : url.pathname.replace(/\/$/, "");
        const cached = await caches.open(CACHE_NAME).then(async (cache) =>
          (await cache.match(normalizedNavigationPath)) ?? cache.match("/"),
        );
        return cached ?? Response.error();
      }
    })());
    return;
  }

  if (!isShellAsset(url)) return;
  event.respondWith((async () => {
    const names = await caches.keys();
    const shellNames = [
      CACHE_NAME,
      ...names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .reverse(),
    ];
    for (const name of shellNames) {
      const cached = await caches.open(name).then((cache) => cache.match(request));
      if (cached) return cached;
    }
    const response = await fetch(request);
    // Lazy, content-addressed Next chunks become available offline after use.
    if (response.ok && url.pathname.startsWith("/_next/static/")) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
