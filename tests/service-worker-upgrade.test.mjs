import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const ORIGIN = "https://wallet.example";

async function generatorDomain() {
  try {
    return await import("../scripts/generate-service-worker.mjs");
  } catch (error) {
    assert.fail(
      `The service-worker generator is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function normalizeRequest(input) {
  const value = typeof input === "string" ? input : input.url;
  return new URL(value, ORIGIN).href;
}

class MemoryCache {
  entries = new Map();

  async put(input, response) {
    this.entries.set(normalizeRequest(input), response.clone());
  }

  async match(input) {
    return this.entries.get(normalizeRequest(input))?.clone();
  }
}

class MemoryCacheStorage {
  stores = new Map();

  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new MemoryCache());
    return this.stores.get(name);
  }

  async keys() {
    return [...this.stores.keys()];
  }

  async delete(name) {
    return this.stores.delete(name);
  }
}

function evaluateWorker(source, caches, fetchImpl) {
  const listeners = new Map();
  let skipped = 0;
  const self = {
    location: { origin: ORIGIN },
    clients: { claim: async () => undefined },
    skipWaiting: async () => { skipped += 1; },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const defaultFetch = async (input) => {
    const url = new URL(normalizeRequest(input));
    const body = url.pathname === "/" ? "<!doctype html><title>StellarKey</title>" : url.pathname;
    return new Response(body, { status: 200 });
  };
  vm.runInNewContext(source, {
    self,
    caches,
    fetch: fetchImpl ?? defaultFetch,
    URL,
    Response,
    Request,
    Promise,
    Set,
  });

  return {
    listeners,
    skipped: () => skipped,
  };
}

async function dispatchExtendable(listener, extras = {}) {
  let work;
  listener?.({ ...extras, waitUntil(promise) { work = promise; } });
  assert.ok(work, "event must wait for its cache transaction");
  await work;
}

test("a worker update waits for consent and keeps the previous shell available", async () => {
  const { renderServiceWorker } = await generatorDomain();
  const template = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  const caches = new MemoryCacheStorage();
  const first = renderServiceWorker({
    template,
    html: '<script src="/_next/static/chunks/old-build.js"></script>',
    revision: "build-one",
  });
  const second = renderServiceWorker({
    template,
    html: '<script src="/_next/static/chunks/new-build.js"></script>',
    revision: "build-two",
  });

  const firstWorker = evaluateWorker(first, caches);
  await dispatchExtendable(firstWorker.listeners.get("install"));
  await dispatchExtendable(firstWorker.listeners.get("activate"));
  assert.deepEqual(await caches.keys(), ["stellarkey-shell-build-one"]);
  assert.ok(
    caches.stores.get("stellarkey-shell-build-one").entries.has(
      `${ORIGIN}/_next/static/chunks/old-build.js`,
    ),
  );

  const secondWorker = evaluateWorker(second, caches, async (input) => {
    const url = new URL(normalizeRequest(input));
    if (url.pathname === "/_next/static/chunks/old-build.js") {
      throw new TypeError("old chunk is no longer on the deployment origin");
    }
    return new Response(url.pathname, { status: 200 });
  });
  await dispatchExtendable(secondWorker.listeners.get("install"));
  assert.equal(secondWorker.skipped(), 0, "install must not activate over a live app");
  assert.deepEqual(await caches.keys(), [
    "stellarkey-shell-build-one",
    "stellarkey-shell-build-two",
  ]);

  await dispatchExtendable(secondWorker.listeners.get("activate"));
  assert.deepEqual(await caches.keys(), [
    "stellarkey-shell-build-one",
    "stellarkey-shell-build-two",
  ]);
  const liveEntries = caches.stores.get("stellarkey-shell-build-two").entries;
  assert.ok(liveEntries.has(`${ORIGIN}/_next/static/chunks/new-build.js`));
  assert.equal(liveEntries.has(`${ORIGIN}/_next/static/chunks/old-build.js`), false);

  let responseWork;
  secondWorker.listeners.get("fetch")?.({
    request: new Request(`${ORIGIN}/_next/static/chunks/old-build.js`),
    respondWith(promise) { responseWork = promise; },
  });
  assert.ok(responseWork, "the staged worker must handle old shell chunks");
  const oldChunk = await responseWork;
  assert.equal(await oldChunk.text(), "/_next/static/chunks/old-build.js");

  let invalidWork;
  secondWorker.listeners.get("message")?.({
    data: { type: "SKIP_WAITING" },
    source: { url: "https://attacker.example/app" },
    waitUntil(promise) { invalidWork = promise; },
  });
  assert.equal(invalidWork, undefined);
  assert.equal(secondWorker.skipped(), 0, "cross-origin messages must be ignored");
  await dispatchExtendable(secondWorker.listeners.get("message"), {
    data: { type: "SKIP_WAITING" },
    source: { url: `${ORIGIN}/` },
  });
  assert.equal(secondWorker.skipped(), 1);
});

test("the app offers an accessible update action and reloads only after controller change", () => {
  const source = readFileSync(
    new URL("../src/components/ServiceWorkerRegistration.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /registration\.waiting/);
  assert.match(source, /updatefound/);
  assert.match(source, /controllerchange/);
  assert.match(source, /postMessage\(\{\s*type:\s*"SKIP_WAITING"\s*\}\)/);
  assert.match(source, /Update ready/);
  assert.match(source, /Update and reload/);
  assert.match(source, /role="status"/);
});

test("generated workers precache only same-origin shell resources", async () => {
  const { discoverShellPaths } = await generatorDomain();
  const paths = discoverShellPaths(`
    <link href="/_next/static/chunks/app.css" rel="stylesheet">
    <script src="/_next/static/chunks/app.js"></script>
    <script src="https://horizon.stellar.org/never-cache.js"></script>
  `);

  assert.ok(paths.includes("/"));
  assert.ok(paths.includes("/_next/static/chunks/app.css"));
  assert.ok(paths.includes("/_next/static/chunks/app.js"));
  assert.equal(paths.some((path) => path.includes("horizon.stellar.org")), false);
});
