import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRIVATE_RELAY_MAX_PLAINTEXT_BYTES,
  PrivateRelayReplayGuard,
  createPrivateRelayId,
  decodePrivateRelayMessage,
  encodePrivateRelayMessage,
  redactPrivateRelayError,
} from '../src/features/private-balance/relay/protocol.ts';

const NOW = 1_800_000_000;
const NETWORK_ID = '11'.repeat(32);
const POOL = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const REQUEST_ID = '22'.repeat(32);
const QUOTE_ID = '33'.repeat(32);
const NONCE = '44'.repeat(32);
const NOSTR_KEY = '55'.repeat(32);

function request(overrides = {}) {
  return {
    version: 2,
    type: 'request',
    requestId: REQUEST_ID,
    networkId: NETWORK_ID,
    poolContractId: POOL,
    replyPubkey: NOSTR_KEY,
    nonce: NONCE,
    expiresAt: NOW + 60,
    ...overrides,
  };
}

test('relay messages use canonical bounded encodings with no sender Stellar identity', () => {
  const encoded = encodePrivateRelayMessage(request(), NOW);
  assert.equal(encoded, JSON.stringify(request()));
  assert.deepEqual(decodePrivateRelayMessage(encoded, NOW), request());
  assert.doesNotMatch(encoded, /sender(?:Account|Address)|accountPublicKey|depositSource/iu);
  assert.doesNotMatch(encoded, /actionKind|assetIndex|diversifier/iu);
  assert.throws(() => encodePrivateRelayMessage(request({ actionKind: 'transfer' }), NOW), /fields/iu);
  assert.ok(new TextEncoder().encode(encoded).byteLength < PRIVATE_RELAY_MAX_PLAINTEXT_BYTES);
});

test('relay protocol rejects unknown fields, stale messages, and oversized jobs', () => {
  assert.throws(
    () => encodePrivateRelayMessage(request({ senderAccount: 'GABC' }), NOW),
    /fields/iu,
  );
  assert.throws(
    () => decodePrivateRelayMessage(JSON.stringify(request({ expiresAt: NOW - 31 })), NOW),
    /expired/iu,
  );
  assert.throws(
    () => encodePrivateRelayMessage({
      version: 2,
      type: 'sign-job',
      requestId: REQUEST_ID,
      quoteId: QUOTE_ID,
      nonce: NONCE,
      expiresAt: NOW + 60,
      transactionHash: '66'.repeat(32),
      unsignedEnvelopeXdr: 'A'.repeat(PRIVATE_RELAY_MAX_PLAINTEXT_BYTES),
    }, NOW),
    /large/iu,
  );
});

test('relay ids are unique and replay guard consumes each authenticated message once', () => {
  const ids = new Set(Array.from({ length: 64 }, () => createPrivateRelayId()));
  assert.equal(ids.size, 64);
  for (const id of ids) assert.match(id, /^[0-9a-f]{64}$/u);

  const guard = new PrivateRelayReplayGuard(4);
  guard.consume(REQUEST_ID, NOW + 60, NOW);
  assert.throws(() => guard.consume(REQUEST_ID, NOW + 60, NOW), /replay/iu);
  assert.doesNotThrow(() => guard.consume(QUOTE_ID, NOW + 60, NOW + 61));
});

test('relay errors never echo XDR, addresses, or raw peer failures', () => {
  const safe = redactPrivateRelayError(new Error(
    `bad AAAA.BBBB ${POOL} GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF`,
  ));
  assert.equal(safe, 'The privacy relay stopped safely. Try another peer or choose direct submission.');
});
