import assert from 'node:assert/strict';
import test from 'node:test';
import { PrivateRelayMessenger } from '../src/features/private-balance/relay/session.ts';
import { createPrivateRelayEphemeralIdentity, decryptPrivateRelayPayload } from '../src/features/private-balance/relay/crypto.ts';
import { decodePrivateRelayMessage, PRIVATE_RELAY_PROTOCOL_VERSION, PRIVATE_RELAY_MAX_PLAINTEXT_BYTES, PRIVATE_RELAY_MAX_ENCRYPTED_BYTES } from '../src/features/private-balance/relay/protocol.ts';

test('all encrypted relay message classes have the same bounded wire size', async () => {
  const events = [];
  const messenger = await PrivateRelayMessenger.create([], {
    async publish(event) { events.push(event); }, close() {},
  });
  const peer = await createPrivateRelayEphemeralIdentity();
  const common = {
    version: PRIVATE_RELAY_PROTOCOL_VERSION, requestId: '11'.repeat(32), quoteId: '22'.repeat(32),
    nonce: '33'.repeat(32), expiresAt: Math.floor(Date.now() / 1_000) + 60,
  };
  const messages = [
    { ...common, type: 'rejected', reason: 'busy' },
    { ...common, type: 'selection', assetIndex: 0, actionDiversifier: '01020304' },
    { ...common, type: 'submitted', transactionHash: '44'.repeat(32), rpcStatus: 'PENDING' },
    { ...common, type: 'sign-job', transactionHash: '44'.repeat(32), unsignedEnvelopeXdr: 'AAAA'.repeat(4_000) },
  ];
  try {
    for (const message of messages) await messenger.publish(message, peer.publicKey);
    assert.equal(new Set(events.map(event => event.content.length)).size, 1);
    for (const [index, event] of events.entries()) {
      assert.ok(event.content.length <= PRIVATE_RELAY_MAX_ENCRYPTED_BYTES);
      const plaintext = await decryptPrivateRelayPayload(peer.secretKey, messenger.publicKey, event.content);
      assert.equal(new TextEncoder().encode(plaintext).byteLength, PRIVATE_RELAY_MAX_PLAINTEXT_BYTES);
      assert.deepEqual(decodePrivateRelayMessage(plaintext), messages[index]);
    }
  } finally {
    messenger.close();
    peer.secretKey.fill(0);
  }
});
