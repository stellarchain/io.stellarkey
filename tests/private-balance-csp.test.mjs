import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Private Balance keeps the minimal static CSP and isolated worker boundary', () => {
  const csp = read('scripts/static-document-csp.txt');
  const worker = read('src/features/private-balance/worker/private-balance.worker.ts');

  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /script-src[^;]*'wasm-unsafe-eval'/);
  assert.doesNotMatch(csp, /(?:^|\s)'unsafe-eval'(?:\s|;|$)|private-balance\.[a-z]|indexer|mirror\./i);
  assert.match(worker, /self\.onmessage/);
  assert.doesNotMatch(worker, /localStorage|indexedDB|document\./);
});
