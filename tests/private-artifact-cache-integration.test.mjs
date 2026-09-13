import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { loadCircuitArtifacts, computeSha256 } from '../src/lib/private-balance-artifacts.ts';
import { privateArtifactsFromManifest, renderServiceWorker } from '../scripts/generate-service-worker.mjs';

const origin = 'https://wallet.example';
const manifest = JSON.parse(readFileSync(new URL('../public/protocol/private-balance/v1/manifest.json', import.meta.url)));
const entries = [
  ['/protocol/private-balance/v1/circuit.wasm', manifest.artifacts.wasmSha256],
  ['/protocol/private-balance/v1/circuit.zkey.pc', manifest.artifacts.zkeyTransport.sha256],
  ['/protocol/private-balance/v1/verification-key.json', manifest.artifacts.vkJsonSha256],
];
const revision = createHash('sha256').update(String(manifest.artifactVersion)).update('\0')
  .update(JSON.stringify(entries)).digest('hex').slice(0, 20);
const cacheName = `stellarkey-private-artifacts-v2-${revision}`;
const normalize = input => new URL(typeof input === 'string' ? input : input.url, origin).href;
class MemoryCacheStorage {
  stores = new Map();
  async keys() { return [...this.stores.keys()]; }
  async delete(name) { return this.stores.delete(name); }
  async open(name) {
    if (!this.stores.has(name)) {
      const responses = new Map();
      this.stores.set(name, {
        responses,
        async match(request) { return responses.get(normalize(request))?.clone(); },
        async put(request, response) { responses.set(normalize(request), response.clone()); },
      });
    }
    return this.stores.get(name);
  }
}

test('compressed manifests expose only the three runtime downloads to the service worker', () => {
  assert.deepEqual(privateArtifactsFromManifest(manifest), entries);
  const rawManifest = structuredClone(manifest);
  delete rawManifest.artifacts.zkeyTransport;
  assert.deepEqual(privateArtifactsFromManifest(rawManifest), [entries[0],
    ['/protocol/private-balance/v1/circuit.zkey', manifest.artifacts.zkeySha256], entries[2]]);
});

test('loader and service worker share verified compressed entries and repair poisoned cached responses', async () => {
  const storage = new MemoryCacheStorage();
  const previous = 'stellarkey-private-artifacts-v2-previous';
  await storage.open('stellarkey-private-artifacts-v2-expired');
  await storage.open(previous);
  await storage.open('stellarkey-private-artifacts-legacy');
  await storage.open('stellarkey-private-balance-artifacts-v1');
  await storage.open('wallet-owned-data');
  const oldFetch = globalThis.fetch;
  const oldCaches = globalThis.caches;
  const listeners = new Map();
  let networkCalls = 0;
  const network = async input => {
    networkCalls += 1;
    const pathname = new URL(normalize(input)).pathname;
    return new Response(readFileSync(new URL(`../public${pathname}`, import.meta.url)));
  };
  const worker = renderServiceWorker({
    template: readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'),
    html: '', revision: 'test', privateArtifacts: entries, privateArtifactRevision: revision,
  });
  vm.runInNewContext(worker, {
    self: { location: { origin }, addEventListener(type, callback) { listeners.set(type, callback); } },
    caches: storage, fetch: network, URL, Response, Request,
  });
  const throughWorker = async (input, init) => {
    let result;
    const request = new Request(normalize(input), init);
    listeners.get('fetch')({ request, respondWith(promise) { result = promise; } });
    return result ?? network(request);
  };
  globalThis.caches = storage;
  globalThis.fetch = throughWorker;
  try {
    const first = await loadCircuitArtifacts(manifest);
    assert.equal(await computeSha256(first.zkeyBuffer), manifest.artifacts.zkeySha256);
    assert.equal(networkCalls, 3);
    assert.deepEqual(await storage.keys(), [previous, 'stellarkey-private-artifacts-legacy',
      'stellarkey-private-balance-artifacts-v1', 'wallet-owned-data', cacheName]);
    const persisted = storage.stores.get(cacheName).responses;
    assert.equal(persisted.size, 3, 'the service worker must not create a second copy');
    let storedBytes = 0;
    for (const [url, response] of persisted) {
      assert.equal(url.endsWith(manifest.artifacts.zkeySha256), false);
      storedBytes += (await response.clone().arrayBuffer()).byteLength;
    }
    assert.equal(storedBytes, entries.reduce((sum, [pathname]) =>
      sum + readFileSync(new URL(`../public${pathname}`, import.meta.url)).byteLength, 0));
    const warm = await loadCircuitArtifacts(manifest);
    assert.equal(networkCalls, 3);
    assert.equal(await computeSha256(warm.zkeyBuffer), manifest.artifacts.zkeySha256);

    const keyUrl = `${entries[1][0]}?sha256=${entries[1][1]}`;
    const offline = await throughWorker(keyUrl);
    assert.equal((await offline.arrayBuffer()).byteLength, manifest.artifacts.zkeyTransport.byteLength);
    assert.equal(networkCalls, 3);
    await storage.stores.get(cacheName).put(keyUrl, new Response(new Uint8Array(8)));
    const repaired = await loadCircuitArtifacts(manifest);
    assert.equal(networkCalls, 4, 'a reload must bypass the poisoned worker cache');
    assert.equal(await computeSha256(repaired.zkeyBuffer), manifest.artifacts.zkeySha256);
    assert.equal((await (await storage.stores.get(cacheName).match(keyUrl)).arrayBuffer()).byteLength,
      manifest.artifacts.zkeyTransport.byteLength);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldCaches === undefined) delete globalThis.caches;
    else globalThis.caches = oldCaches;
  }
});

function rawFixture() {
  const candidate = structuredClone(manifest);
  delete candidate.artifacts.zkeyTransport;
  const files = new Map([
    ['/protocol/private-balance/v1/circuit.wasm', Buffer.from([1, 2])],
    ['/protocol/private-balance/v1/circuit.zkey', Buffer.from([3, 4])],
    [entries[2][0], readFileSync(new URL(`../public${entries[2][0]}`, import.meta.url))],
  ]);
  for (const [pathname, field] of [['/protocol/private-balance/v1/circuit.wasm', 'wasm'],
    ['/protocol/private-balance/v1/circuit.zkey', 'zkey']]) {
    candidate.artifacts[`${field}ByteLength`] = files.get(pathname).byteLength;
    candidate.artifacts[`${field}Sha256`] = createHash('sha256').update(files.get(pathname)).digest('hex');
  }
  return { candidate, network: async input => new Response(files.get(new URL(normalize(input)).pathname)) };
}

test('unsupported artifact cache formats are neither read nor migrated', async () => {
  const { candidate, network } = rawFixture();
  const storage = new MemoryCacheStorage();
  const unsupported = await storage.open('stellarkey-private-balance-artifacts-v1');
  await unsupported.put(`/private-balance-artifact/sha256/${candidate.artifacts.wasmSha256}`,
    await network('/protocol/private-balance/v1/circuit.wasm'));
  let unsupportedReads = 0;
  const match = unsupported.match;
  unsupported.match = async request => { unsupportedReads += 1; return match(request); };
  const oldFetch = globalThis.fetch;
  const oldCaches = globalThis.caches;
  globalThis.caches = storage;
  globalThis.fetch = network;
  try {
    await loadCircuitArtifacts(candidate);
    assert.equal(unsupportedReads, 0);
    assert.equal(storage.stores.has('stellarkey-private-balance-artifacts-v1'), true);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldCaches === undefined) delete globalThis.caches;
    else globalThis.caches = oldCaches;
  }
});

test('raw-key fallback remains usable when CacheStorage is unavailable', async () => {
  const { candidate, network } = rawFixture();
  const oldFetch = globalThis.fetch;
  const oldCaches = globalThis.caches;
  globalThis.caches = { async open() { throw new Error('storage denied'); } };
  globalThis.fetch = network;
  try {
    const loaded = await loadCircuitArtifacts(candidate);
    assert.equal(await computeSha256(loaded.zkeyBuffer), candidate.artifacts.zkeySha256);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldCaches === undefined) delete globalThis.caches;
    else globalThis.caches = oldCaches;
  }
});

for (const failure of ['network', 'quota']) {
  test(`an incomplete ${failure} replacement preserves legacy offline artifacts and wallet stores`, async () => {
    const { candidate, network } = rawFixture();
    const storage = new MemoryCacheStorage();
    const legacyNames = ['stellarkey-private-artifacts-legacy',
      'stellarkey-private-balance-artifacts-v1', 'wallet-owned-data'];
    for (const name of legacyNames) await storage.open(name);
    const open = storage.open.bind(storage);
    storage.open = async name => {
      const cache = await open(name);
      if (failure === 'quota' && name.startsWith('stellarkey-private-artifacts-v2-')) {
        cache.put = async () => { throw new Error('cache quota'); };
      }
      return cache;
    };
    const oldFetch = globalThis.fetch;
    const oldCaches = globalThis.caches;
    globalThis.caches = storage;
    globalThis.fetch = failure === 'network' ? async () => { throw new Error('offline'); } : network;
    try {
      if (failure === 'network') await assert.rejects(loadCircuitArtifacts(candidate), /offline/);
      else assert.equal(await computeSha256((await loadCircuitArtifacts(candidate)).zkeyBuffer),
        candidate.artifacts.zkeySha256);
      for (const name of legacyNames) assert.equal(storage.stores.has(name), true);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldCaches === undefined) delete globalThis.caches;
      else globalThis.caches = oldCaches;
    }
  });
}

test('a retired in-flight artifact revision cannot prune newer caches on completion', async () => {
  const { candidate, network } = rawFixture();
  const storage = new MemoryCacheStorage();
  const open = storage.open.bind(storage);
  let writes = 0;
  storage.open = async name => {
    const cache = await open(name);
    if (!cache.wrapped) {
      cache.wrapped = true;
      const put = cache.put.bind(cache);
      cache.put = async (request, response) => {
        await put(request, response);
        if (++writes === 3) {
          await storage.delete(name);
          await open('stellarkey-private-artifacts-v2-newer-one');
          await open('stellarkey-private-artifacts-v2-newer-two');
        }
      };
    }
    return cache;
  };
  const oldFetch = globalThis.fetch;
  const oldCaches = globalThis.caches;
  globalThis.caches = storage;
  globalThis.fetch = network;
  try {
    await loadCircuitArtifacts(candidate);
    assert.deepEqual(await storage.keys(), ['stellarkey-private-artifacts-v2-newer-one',
      'stellarkey-private-artifacts-v2-newer-two']);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldCaches === undefined) delete globalThis.caches;
    else globalThis.caches = oldCaches;
  }
});
