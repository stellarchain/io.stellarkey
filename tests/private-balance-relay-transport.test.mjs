import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPrivateRelayEphemeralIdentity,
  decryptPrivateRelayPayload,
  encryptPrivateRelayPayload,
  signPrivateRelayEvent,
  verifyPrivateRelayEvent,
} from '../src/features/private-balance/relay/crypto.ts';
import {
  BoundedPrivateRelayTransport,
  validatePrivateRelayUrls,
} from '../src/features/private-balance/relay/transport.ts';

const NOW = 1_800_000_000;

test('NIP-44 v2 payloads authenticate two ephemeral identities', async () => {
  const alice = await createPrivateRelayEphemeralIdentity();
  const bob = await createPrivateRelayEphemeralIdentity();
  const plaintext = '{"version":1,"type":"request"}';
  const encrypted = await encryptPrivateRelayPayload(alice.secretKey, bob.publicKey, plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.equal(await decryptPrivateRelayPayload(bob.secretKey, alice.publicKey, encrypted), plaintext);
  await assert.rejects(
    decryptPrivateRelayPayload(bob.secretKey, alice.publicKey, `${encrypted.slice(0, -2)}AA`),
    /invalid|authenticate|payload/iu,
  );

  const event = await signPrivateRelayEvent(alice.secretKey, {
    kind: 24_333,
    created_at: NOW,
    tags: [['t', 'stellarkey-private-relay-v1']],
    content: encrypted,
  });
  assert.equal(await verifyPrivateRelayEvent(event), true);
  assert.equal(event.pubkey, alice.publicKey);
  alice.secretKey.fill(0);
  bob.secretKey.fill(0);
});

test('recommended relay mode requires two distinct secure relay origins', () => {
  assert.deepEqual(
    validatePrivateRelayUrls(['wss://relay.one', 'wss://relay.two/path']),
    ['wss://relay.one/', 'wss://relay.two/path'],
  );
  assert.throws(() => validatePrivateRelayUrls(['wss://relay.one']), /two/iu);
  assert.throws(
    () => validatePrivateRelayUrls(['wss://relay.one', 'wss://relay.one/']),
    /two/iu,
  );
  assert.throws(
    () => validatePrivateRelayUrls(['https://relay.one', 'wss://relay.two']),
    /wss/iu,
  );
});

test('bounded transport closes every relay subscription on abort', async () => {
  const closed = [];
  const adapter = {
    publish: async () => new Map([
      ['wss://relay.one/', true],
      ['wss://relay.two/', true],
    ]),
    subscribe: (_urls, _filters, _onEvent) => ({
      close: () => closed.push('closed'),
    }),
    close: urls => closed.push(...urls),
  };
  const transport = new BoundedPrivateRelayTransport(
    ['wss://relay.one', 'wss://relay.two'],
    adapter,
  );
  const controller = new AbortController();
  const subscription = transport.subscribe([{}], () => {}, controller.signal);
  controller.abort();
  assert.equal(closed.length, 1);
  subscription.close();
  transport.close();
  assert.ok(closed.includes('wss://relay.one/'));
  assert.ok(closed.includes('wss://relay.two/'));
});
