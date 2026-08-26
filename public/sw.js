const CACHE_PREFIX = "polaris-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_PATHS = new Set([
  "/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
]);

function isShellAsset(url) {
  return url.origin === self.location.origin && (
    SHELL_PATHS.has(url.pathname) || url.pathname.startsWith("/_next/static/")
  );
}

async function seedShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch("/", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to seed the offline shell");
  await cache.put("/", response.clone());

  const html = await response.text();
  const discovered = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .map((path) => new URL(path, self.location.origin))
    .filter(isShellAsset)
    .map((url) => url.href);
  await Promise.allSettled(
    [...SHELL_PATHS].filter((path) => path !== "/").concat(discovered).map(async (path) => {
      const asset = await fetch(path, { cache: "no-store" });
      if (asset.ok) await cache.put(path, asset);
    }),
  );
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
        const response = await fetch(request);
        if (response.ok && url.pathname === "/") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/", response.clone());
        }
        return response;
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
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
