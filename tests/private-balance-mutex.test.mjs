import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPrivateRuntimeMutex } from '../src/features/private-balance/runtime/mutex.ts';

test('the runtime mutex serializes tasks in FIFO order and survives failures', async () => {
  const mutex = createPrivateRuntimeMutex();
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });

  assert.equal(mutex.locked, false);
  const first = mutex.runExclusive(async () => {
    order.push('sync-start');
    assert.equal(mutex.locked, true);
    await gate;
    order.push('sync-end');
    return 'synced';
  });
  const second = mutex.runExclusive(async () => {
    order.push('prepare');
    throw new Error('preparation failed');
  });
  const third = mutex.runExclusive(async () => {
    order.push('submit');
    return 'submitted';
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mutex.locked, true);
  assert.deepEqual(order, ['sync-start']);
  release();
  assert.equal(await first, 'synced');
  await assert.rejects(second, /preparation failed/);
  // A failed task never wedges the queue; later tasks still run in order.
  assert.equal(await third, 'submitted');
  assert.deepEqual(order, ['sync-start', 'sync-end', 'prepare', 'submit']);
  assert.equal(mutex.locked, false);
});

test('the provider serializes sync with action flows instead of failing on phase', () => {
  const provider = readFileSync(
    new URL('../src/features/private-balance/runtime/provider.tsx', import.meta.url),
    'utf8',
  );
  assert.match(provider, /createPrivateRuntimeMutex\(\)/);
  assert.match(provider, /mutex\.runExclusive\(\(\) => performSyncExclusive/);
  assert.match(provider, /mutexRef\.current\.runExclusive/);
  // prepare/submit await the mutex (and any in-flight sync) rather than
  // throwing on a transient non-current phase.
  assert.doesNotMatch(provider, /snapshot\.phase !== 'current'/);
  // Post-broadcast polling stays a read-only trigger outside the mutex.
  assert.match(provider, /pollBroadcastPrivateBalanceTransaction/);
});
