import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('proving artifacts are hash-keyed and isolated from network RPC caching', () => {
  const loader = read('src/lib/private-balance-artifacts.ts');
  const worker = read('public/sw.js');
  const generator = read('scripts/generate-service-worker.mjs');

  assert.match(loader, /sha256/);
  assert.match(loader, /URLSearchParams|searchParams/);
  assert.match(worker, /PRIVATE_ARTIFACT_CACHE_PREFIX/);
  assert.match(worker, /PRIVATE_ARTIFACT_HASHES/);
  assert.match(worker, /url\.searchParams\.get\("sha256"\)/);
  assert.doesNotMatch(worker, /horizon|soroban|rpc|localStorage|indexedDB/i);
  assert.match(generator, /manifest\.json/);
  assert.match(generator, /generated-private-artifacts/);
  assert.match(generator, /circuit\.zkey\.pc/);
});
