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

async function installAndActivate(source, caches) {
  const listeners = new Map();
  const self = {
    location: { origin: ORIGIN },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const fetch = async (input) => {
    const url = new URL(normalizeRequest(input));
    const body = url.pathname === "/" ? "<!doctype html><title>Polaris</title>" : url.pathname;
    return new Response(body, { status: 200 });
  };
  vm.runInNewContext(source, {
    self,
    caches,
    fetch,
    URL,
    Response,
    Request,
    Promise,
    Set,
  });

  for (const type of ["install", "activate"]) {
    let work;
    listeners.get(type)?.({ waitUntil(promise) { work = promise; } });
    assert.ok(work, `${type} must wait for its cache transaction`);
    await work;
  }
}

test("a two-version worker upgrade atomically removes obsolete hashed chunks", async () => {
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

  await installAndActivate(first, caches);
  assert.deepEqual(await caches.keys(), ["polaris-shell-build-one"]);
  assert.ok(
    caches.stores.get("polaris-shell-build-one").entries.has(
      `${ORIGIN}/_next/static/chunks/old-build.js`,
    ),
  );

  await installAndActivate(second, caches);
  assert.deepEqual(await caches.keys(), ["polaris-shell-build-two"]);
  const liveEntries = caches.stores.get("polaris-shell-build-two").entries;
  assert.ok(liveEntries.has(`${ORIGIN}/_next/static/chunks/new-build.js`));
  assert.equal(liveEntries.has(`${ORIGIN}/_next/static/chunks/old-build.js`), false);
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
