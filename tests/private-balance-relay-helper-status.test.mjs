import assert from 'node:assert/strict';
import test from 'node:test';
import { PrivateRelayConfigurationError } from '../src/features/private-balance/relay/connection-error.ts';

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

test('a terminal connection problem is returned to the owner without retrying', async () => {
  const terminal = new Error('Synthetic terminal configuration problem');
  let attempts = 0;
  const pending = retryPrivateRelayHelperReadiness({
    signal: new AbortController().signal,
    retryDelayMs: 1,
    connect: async () => {
      attempts += 1;
      if (attempts === 1) throw terminal;
      return { connected: 1, total: 2 };
    },
    shouldRetry: cause => cause !== terminal,
    onUnavailable() {},
    onRetry() {},
  });
  await assert.rejects(pending, error => error === terminal);
  assert.equal(attempts, 1);
});

test('changing cluster diagnostics updates an otherwise unchanged helper status', () => {
  const first = new PrivateRelayConfigurationError(1, [3]).problem;
  const second = new PrivateRelayConfigurationError(0, [3]).problem;
  publishPrivateRelayHelperStatus({ phase: 'configuration-error', connectedRelays: 0, totalRelays: 2, configurationProblem: first });
  publishPrivateRelayHelperStatus({ phase: 'configuration-error', connectedRelays: 0, totalRelays: 2, configurationProblem: second });
  assert.deepEqual(getPrivateRelayHelperStatus().configurationProblem, second);
  publishPrivateRelayHelperStatus({ phase: 'off', connectedRelays: 0, totalRelays: 0 });
  assert.equal(getPrivateRelayHelperStatus().configurationProblem, undefined);
});
