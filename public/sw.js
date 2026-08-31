const CACHE_PREFIX = "stellarkey-shell-";
const BUILD_REVISION = "development"; // @generated-revision
const PRECACHE_PATHS = new Set(["/", "/about", "/privacy", "/terms", "/security", "/support", "/changelog", "/favicon.ico", "/manifest.webmanifest", "/icon.svg", "/icon-192.png?v=2", "/icon-512.png?v=2", "/icon-maskable-192.png?v=2", "/icon-maskable-512.png?v=2", "/icon-maskable-1024.png?v=2", "/apple-icon.png", "/apple-icon1.png", "/apple-icon2.png", "/apple-touch-icon.png"]); // @generated-precache
const PRIVATE_ARTIFACT_CACHE_PREFIX = "stellarkey-private-artifacts-";
const PRIVATE_ARTIFACT_REVISION = "development"; // @generated-private-artifact-revision
const PRIVATE_ARTIFACT_HASHES = new Map([]); // @generated-private-artifacts
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_REVISION}`;
const PRIVATE_ARTIFACT_CACHE_NAME = `${PRIVATE_ARTIFACT_CACHE_PREFIX}${PRIVATE_ARTIFACT_REVISION}`;

function isShellAsset(url) {
  return url.origin === self.location.origin && (
    PRECACHE_PATHS.has(`${url.pathname}${url.search}`) ||
    url.pathname.startsWith("/_next/static/")
  );
}

function isPrivateArtifact(url) {
  if (url.origin !== self.location.origin) return false;
  const expectedHash = PRIVATE_ARTIFACT_HASHES.get(url.pathname);
  if (!expectedHash) return false;
  const parameters = [...url.searchParams.keys()];
  return parameters.length === 1 &&
    parameters[0] === "sha256" &&
    url.searchParams.get("sha256") === expectedHash;
}

function cacheSearchOrder(names, prefix, current) {
  return [
    current,
    ...names.filter((name) => name.startsWith(prefix) && name !== current).reverse(),
  ];
}

async function deleteExpiredCaches(names, prefix, current) {
  const previous = names
    .filter((name) => name.startsWith(prefix) && name !== current)
    .at(-1);
  await Promise.all(
    names
      .filter((name) => name.startsWith(prefix) && name !== current && name !== previous)
      .map((name) => caches.delete(name)),
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
    await Promise.all([
      deleteExpiredCaches(names, CACHE_PREFIX, CACHE_NAME),
      deleteExpiredCaches(
        names,
        PRIVATE_ARTIFACT_CACHE_PREFIX,
        PRIVATE_ARTIFACT_CACHE_NAME,
      ),
    ]);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isPrivateArtifact(url)) {
    event.respondWith((async () => {
      const names = await caches.keys();
      for (const name of cacheSearchOrder(
        names,
        PRIVATE_ARTIFACT_CACHE_PREFIX,
        PRIVATE_ARTIFACT_CACHE_NAME,
      )) {
        const cached = await caches.open(name).then((cache) => cache.match(request));
        if (cached) return cached;
      }
      const response = await fetch(request, { cache: "no-store" });
      if (response.ok) {
        const cache = await caches.open(PRIVATE_ARTIFACT_CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

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
    const shellNames = cacheSearchOrder(names, CACHE_PREFIX, CACHE_NAME);
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
