import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/check-bundle-budget.mjs', import.meta.url), 'utf8');

test('release budgets cover private feature, worker, artifacts, and two-version cache peak', () => {
  for (const name of [
    'PRIVATE_FEATURE_JS_RAW_BUDGET',
    'PRIVATE_FEATURE_JS_GZIP_BUDGET',
    'PRIVATE_WORKER_JS_RAW_BUDGET',
    'PRIVATE_ARTIFACT_GZIP_BUDGET',
    'PRIVATE_PEAK_CACHE_BUDGET',
    'measurePrivateBalanceAssets',
    'assertPrivateBalanceBudgets',
  ]) assert.match(source, new RegExp(name));
  assert.match(source, /PrivateBalanceProvider/);
  assert.match(source, /turbopack-worker/);
  assert.match(source, /circuit\.wasm/);
  assert.match(source, /circuit\.zkey/);
});
