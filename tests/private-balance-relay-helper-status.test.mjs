import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPrivateRelayHelperStatus,
  publishPrivateRelayHelperStatus,
  subscribePrivateRelayHelperStatus,
} from '../src/features/private-balance/relay/helper-status.ts';

test('helper connection status is observable in memory and never persisted', () => {
  const snapshots = [];
  const unsubscribe = subscribePrivateRelayHelperStatus(() => {
    snapshots.push(getPrivateRelayHelperStatus());
  });

  publishPrivateRelayHelperStatus({ phase: 'connecting', connectedRelays: 0, totalRelays: 2 });
  publishPrivateRelayHelperStatus({ phase: 'listening', connectedRelays: 1, totalRelays: 2 });
  unsubscribe();
  publishPrivateRelayHelperStatus({ phase: 'off', connectedRelays: 0, totalRelays: 0 });

  assert.deepEqual(snapshots.map(snapshot => snapshot.phase), ['connecting', 'listening']);
  assert.equal(snapshots[1].connectedRelays, 1);
});
