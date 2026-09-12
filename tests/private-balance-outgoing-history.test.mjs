import assert from 'node:assert/strict';
import test from 'node:test';
import { openOutgoingEnvelope, OUTGOING_ENVELOPE_BYTES } from '@stellarkey/private-balance';
import { privateOutgoingHistoryMode } from '../src/features/private-balance/runtime/outgoing-history.ts';
import { createPrivateOutgoingEnvelope } from '../src/features/private-balance/worker/outgoing-envelope.ts';

const key = new Uint8Array(32).fill(7);
const ephemeral = new Uint8Array(32).fill(8);
const aad = new Uint8Array(32).fill(9);
const base = { outgoingViewingKey: key, ephemeralPublicKey: ephemeral, aad };

test('legacy outgoing history stays recoverable and invalid policies fail closed', () => {
  assert.equal(privateOutgoingHistoryMode(undefined), 'recoverable');
  assert.equal(privateOutgoingHistoryMode('recoverable'), 'recoverable');
  assert.equal(privateOutgoingHistoryMode('minimized'), 'minimized');
  for (const value of [null, false, true, 0, '', 'off', {}, []]) {
    assert.throws(() => privateOutgoingHistoryMode(value), /policy|invalid/i);
  }
});

test('recoverable outgoing envelopes retain the existing encoding and clear plaintext buffers', async () => {
  const plaintext = new Uint8Array(128).fill(4);
  const expected = plaintext.slice();
  const envelope = await createPrivateOutgoingEnvelope({ ...base, mode: 'recoverable', plaintext: () => plaintext });
  assert.equal(envelope.length, OUTGOING_ENVELOPE_BYTES);
  assert.deepEqual(await openOutgoingEnvelope(key, ephemeral, envelope, aad), expected);
  assert.ok(plaintext.every(byte => byte === 0));
  assert.ok(key.every(byte => byte === 7), 'borrowed long-lived key remains usable for old history');
});

test('minimized outgoing lanes have the normal size but never construct recovery plaintext', async () => {
  const envelopes = [];
  for (let lane = 0; lane < 3; lane += 1) {
    const envelope = await createPrivateOutgoingEnvelope({ ...base, mode: 'minimized',
      plaintext: () => assert.fail('minimized mode must not construct outgoing metadata') });
    assert.equal(envelope.length, OUTGOING_ENVELOPE_BYTES);
    assert.ok(envelope.some(byte => byte !== 0));
    assert.equal(await openOutgoingEnvelope(key, ephemeral, envelope, aad), null);
    envelopes.push(envelope);
  }
  assert.equal(new Set(envelopes.map(value => Buffer.from(value).toString('hex'))).size, 3);
});

test('minimized randomness failure is bounded and cannot become an all-zero wire marker', async t => {
  let calls = 0;
  t.mock.method(globalThis.crypto, 'getRandomValues', bytes => { calls += 1; bytes.fill(0); return bytes; });
  await assert.rejects(createPrivateOutgoingEnvelope({ ...base, mode: 'minimized',
    plaintext: () => assert.fail('must not construct metadata') }), /random/i);
  assert.ok(calls > 0 && calls <= 8);
});
