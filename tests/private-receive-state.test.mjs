import assert from 'node:assert/strict';
import test from 'node:test';
import * as receive from '../src/features/private-balance/runtime/receive.ts';

const base = { configured: true, hasAddress: false, isLeader: true, phase: 'current', reusable: false, stealthSyncing: false, hasError: false, sessionCurrent: true };
const cases = [
  ['stopped runtime is not loading', { phase: 'safe-error', hasError: true }, 'stopped'],
  ['unknown runtime status is not loading', { phase: 'status-unknown', hasError: true }, 'stopped'],
  ['absent address in an idle runtime offers recovery', {}, 'missing'],
  ['genuine initialization is loading', { phase: 'loading-artifacts' }, 'loading'],
  ['genuine canonical scan is loading', { phase: 'scanning-live' }, 'loading'],
  ['follower without an address offers explicit takeover', { isLeader: false }, 'follower'],
  ['unconfigured account requires setup', { configured: false, phase: 'disabled' }, 'setup'],
  ['a locked runtime never displays retained private content', { phase: 'locked', hasAddress: true }, 'locked'],
  ['revoked session hides retained content before runtime phase updates', { sessionCurrent: false, hasAddress: true }, 'locked'],
  ['valid local address remains usable during read-only syncing', { phase: 'scanning-live', hasAddress: true }, 'ready'],
  ['reusable discovery progress is scoped to reusable receive', { reusable: true, stealthSyncing: true }, 'loading'],
  ['reusable discovery cannot mask a stopped shielded runtime', { phase: 'safe-error', stealthSyncing: true, hasError: true }, 'stopped'],
];
for (const [name, patch, expected] of cases) test(name, () => {
  assert.equal(typeof receive.privateReceiveState, 'function', 'Receive needs an explicit runtime-state selector');
  assert.equal(receive.privateReceiveState({ ...base, ...patch }), expected);
});
