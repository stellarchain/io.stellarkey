import assert from 'node:assert/strict';
import test from 'node:test';
import * as preferences from '../src/features/private-balance/relay/preferences.ts';

const current = () => ({ useRelay: false, helpRelay: true, feeAtomic: '10000',
  transport: 'waku', wakuClusterId: 3,
  wakuPeers: ['/dns4/node.example/tcp/8000/wss/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W'],
  relayUrls: ['wss://relay-one.example/', 'wss://relay-two.example/'] });

test('helper preferences retain identity when only the sender preference or object identity changes', () => {
  assert.equal(typeof preferences.retainPrivateRelayHelperPreferences, 'function');
  const before = current();
  const duplicate = { ...before, relayUrls: [...before.relayUrls], wakuPeers: [...before.wakuPeers] };
  assert.equal(preferences.retainPrivateRelayHelperPreferences(before, duplicate), before);
  assert.equal(preferences.retainPrivateRelayHelperPreferences(before, { ...duplicate, useRelay: true }), before);
});

test('real helper participation, fee and endpoint changes still invalidate the session', () => {
  assert.equal(typeof preferences.retainPrivateRelayHelperPreferences, 'function');
  const before = current();
  for (const next of [
    { ...before, helpRelay: false },
    { ...before, feeAtomic: '20000' },
    { ...before, wakuClusterId: 0 },
    { ...before, wakuClusterId: 1 },
    { ...before, wakuPeers: [] },
    { ...before, wakuPeers: [...before.wakuPeers, 'replacement-peer'] },
    { ...before, transport: 'nostr' },
    { ...before, relayUrls: ['wss://replacement.example/', before.relayUrls[1]] },
    { ...before, relayUrls: [...before.relayUrls, 'wss://third.example/'] },
  ]) assert.equal(preferences.retainPrivateRelayHelperPreferences(before, next), next);
});
