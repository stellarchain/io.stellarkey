import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPrivateRelayHelperStatus,
  publishPrivateRelayHelperStatus,
  retryPrivateRelayHelperReadiness,
  subscribePrivateRelayHelperStatus,
} from '../src/features/private-balance/relay/helper-status.ts';

test('helper connection status is observable in memory and never persisted', () => {
  const snapshots = [];
  const unsubscribe = subscribePrivateRelayHelperStatus(() => {
    snapshots.push(getPrivateRelayHelperStatus());
  });

  publishPrivateRelayHelperStatus({ phase: 'connecting', connectedRelays: 0, totalRelays: 2 });
  publishPrivateRelayHelperStatus({ phase: 'connected', connectedRelays: 1, totalRelays: 2 });
  unsubscribe();
  publishPrivateRelayHelperStatus({ phase: 'off', connectedRelays: 0, totalRelays: 0 });

  assert.deepEqual(snapshots.map(snapshot => snapshot.phase), ['connecting', 'connected']);
  assert.equal(snapshots[1].connectedRelays, 1);
});

test('helper readiness retries an initial total outage and reports recovery', async () => {
  let attempts = 0;
  const transitions = [];
  const status = await retryPrivateRelayHelperReadiness({
    signal: new AbortController().signal,
    retryDelayMs: 5,
    connect: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('offline');
      return { connected: 1, total: 2 };
    },
    onUnavailable: () => transitions.push('unavailable'),
    onRetry: () => transitions.push('connecting'),
  });

  assert.equal(attempts, 3);
  assert.deepEqual(transitions, ['unavailable', 'connecting', 'unavailable', 'connecting']);
  assert.deepEqual(status, { connected: 1, total: 2 });
});

test('helper readiness cleanup cancels a pending retry', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const pending = retryPrivateRelayHelperReadiness({
    signal: controller.signal,
    retryDelayMs: 50,
    connect: async () => {
      attempts += 1;
      throw new Error('offline');
    },
    onUnavailable: () => controller.abort(),
    onRetry: () => assert.fail('aborted readiness must not retry'),
  });

  await assert.rejects(
    pending,
    error => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.equal(attempts, 1);
});
