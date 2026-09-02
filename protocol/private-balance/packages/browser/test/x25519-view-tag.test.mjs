import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOutputPackage,
  deriveKeysFromSeed,
  deriveX25519SharedSecret,
  openRecipientEnvelope,
  RECIPIENT_ENVELOPE_BYTES,
  OUTPUT_PACKAGE_BYTES,
} from '../dist/index.js';

const bytes = (value, length = 32) => new Uint8Array(length).fill(value);

test('X25519 native import uses the RFC 8410 PKCS#8 private-key wrapper', async () => {
  const api = await import('../dist/index.js');
  assert.equal(typeof api.encodeX25519PrivateKeyPkcs8, 'function');
  const scalar = Uint8Array.from({ length: 32 }, (_, index) => index);
  assert.equal(
    Buffer.from(api.encodeX25519PrivateKeyPkcs8(scalar)).toString('hex'),
    '302e020100300506032b656e04220420'
      + '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  );
});

test('X25519 native and portable scan paths derive the same secret', async () => {
  const sender = await deriveKeysFromSeed(
    bytes(1), 1, bytes(2), bytes(3), bytes(4), bytes(5), bytes(6), bytes(7),
  );
  const recipient = await deriveKeysFromSeed(
    bytes(8), 1, bytes(2), bytes(3), bytes(4), bytes(5), bytes(9), bytes(7),
  );

  const portable = await deriveX25519SharedSecret(
    sender.hpkePrivateKey,
    recipient.hpkePublicKey,
    'portable',
  );
  const automatic = await deriveX25519SharedSecret(
    sender.hpkePrivateKey,
    recipient.hpkePublicKey,
    'auto',
  );

  assert.deepEqual(automatic, portable);
  assert.equal(automatic.length, 32);
});

test('X25519 rejects low-order public keys before tag comparison', async () => {
  await assert.rejects(
    deriveX25519SharedSecret(bytes(1), new Uint8Array(32), 'portable'),
    /low-order|invalid X25519/i,
  );
  await assert.rejects(
    deriveX25519SharedSecret(bytes(1), new Uint8Array(32), 'native'),
    /low-order|invalid|derive/i,
  );
});

test('output packages carry a secret-derived view tag and reject non-matches early', async () => {
  const keys = await deriveKeysFromSeed(
    bytes(10), 1, bytes(11), bytes(12), bytes(13), bytes(14), bytes(15), bytes(16),
  );
  const note = bytes(17, 128);
  const contextHash = bytes(18);
  const contextField = bytes(19);
  const cm = bytes(20);
  const actionNonce = bytes(21);
  const diversifier = new Uint8Array(4);

  const created = await createOutputPackage(
    keys.hpkePublicKey,
    diversifier,
    note,
    contextHash,
    cm,
    actionNonce,
    0,
  );

  assert.equal(RECIPIENT_ENVELOPE_BYTES, 181);
  assert.equal(OUTPUT_PACKAGE_BYTES, 370);
  assert.equal(created.recipientEnvelope.length, 181);
  assert.equal(created.outputPackage.length, 370);

  const wrongTag = created.recipientEnvelope.slice();
  wrongTag[0] ^= 0xff;
  assert.equal(await openRecipientEnvelope(
    keys.hpkePrivateKey,
    wrongTag,
    contextHash,
    contextField,
    cm,
    actionNonce,
    0,
    keys.baseOwnerCommitment,
  ), null);
});
