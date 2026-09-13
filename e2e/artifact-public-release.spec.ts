import { expect, test } from '@playwright/test';

// Keep this empty-wallet, public-file check free of request routing: browser
// interception disables cache behavior and invalidates the offline assertion.
test.describe('public proving-artifact cache', () => {
  test.use({ serviceWorkers: 'allow' });

  test('verified artifacts share worker storage and loader cache reads remain available offline', async ({ page, context }) => {
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      });
    });
    // Public proving files only. No wallet is created, unlocked or inspected.
    const result = await page.evaluate(async () => {
      const manifest = await (await fetch('/protocol/private-balance/v1/manifest.json', { cache: 'no-store' })).json();
      const artifacts = [
        ['/protocol/private-balance/v1/circuit.wasm', manifest.artifacts.wasmSha256],
        ['/protocol/private-balance/v1/circuit.zkey.pc', manifest.artifacts.zkeyTransport.sha256],
        ['/protocol/private-balance/v1/verification-key.json', manifest.artifacts.vkJsonSha256],
      ];
      const sha256 = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(
        await crypto.subtle.digest('SHA-256', bytes),
      )).map(byte => byte.toString(16).padStart(2, '0')).join('');
      const revision = (await sha256(new TextEncoder().encode(
        `${manifest.artifactVersion}\0${JSON.stringify(artifacts)}`,
      ).buffer)).slice(0, 20);
      const url = `${artifacts[0][0]}?sha256=${artifacts[0][1]}`;
      const bytes = await (await fetch(url)).arrayBuffer();
      const verified = await sha256(bytes) === artifacts[0][1];
      let unverifiedEntryCount = 0;
      for (const name of await caches.keys()) {
        if (name.startsWith('stellarkey-private-artifacts-')) {
          unverifiedEntryCount += (await (await caches.open(name)).keys()).length;
        }
      }
      if (!verified) throw new Error('Public artifact verification failed.');
      const cacheName = `stellarkey-private-artifacts-v2-${revision}`;
      await (await caches.open(cacheName)).put(url, new Response(bytes, {
        headers: { 'x-stellarkey-public-cache-test': 'verified' },
      }));
      const shared = await fetch(url);
      return { unverifiedEntryCount, verified, url, cacheName, byteLength: bytes.byteLength,
        workerReadsSharedEntry: shared.headers.get('x-stellarkey-public-cache-test') === 'verified' };
    });
    expect(result.unverifiedEntryCount).toBe(0);
    expect(result.verified).toBe(true);
    expect(result.workerReadsSharedEntry).toBe(true);
    try {
      await context.setOffline(true);
      const offline = await page.evaluate(async ({ url, cacheName }) => {
        // Exercise the loader's actual cache-hit path. WebKit's emulated
        // offline fetch can fail before worker handling; direct cache reads
        // remain available and do not depend on an HTTP-cache fallback.
        const cached = await (await caches.open(cacheName)).match(url);
        if (!cached) throw new Error('Verified public artifact cache entry is missing.');
        const bytes = await cached.arrayBuffer();
        let reloadFailed = false;
        try { await fetch(url, { cache: 'reload' }); } catch { reloadFailed = true; }
        return { byteLength: bytes.byteLength, reloadFailed };
      }, result);
      expect(offline.byteLength).toBe(result.byteLength);
      expect(offline.reloadFailed).toBe(true);
    } finally {
      await context.setOffline(false);
    }
  });
});
