import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

test('an opaque X25519 handle imports one private key for repeated derivations', async () => {
  const api = await import('../dist/index.js');
  assert.equal(typeof api.importX25519PrivateKey, 'function');
  assert.equal(typeof api.deriveX25519PublicKeyFromHandle, 'function');
  assert.equal(typeof api.deriveX25519SharedSecretFromHandle, 'function');

  const subtle = globalThis.crypto.subtle;
  const originalImportKey = subtle.importKey.bind(subtle);
  let privateImports = 0;
  subtle.importKey = async (format, ...args) => {
    if (format === 'pkcs8') privateImports += 1;
    return originalImportKey(format, ...args);
  };

  try {
    const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const peerPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => 0x80 + index);
    const peer = await api.importX25519PrivateKey(peerPrivateKey);
    const peerPublicKey = await api.deriveX25519PublicKeyFromHandle(peer);
    privateImports = 0;

    const handle = await api.importX25519PrivateKey(privateKey);
    const publicKey = await api.deriveX25519PublicKeyFromHandle(handle);
    assert.deepEqual(publicKey, api.deriveX25519PublicKey(privateKey));

    const expected = await api.deriveX25519SharedSecret(
      privateKey,
      peerPublicKey,
      'portable',
    );
    for (let index = 0; index < 5; index += 1) {
      assert.deepEqual(
        await api.deriveX25519SharedSecretFromHandle(handle, peerPublicKey),
        expected,
      );
    }
    assert.equal(privateImports, 1, 'the private scalar must be imported once');
    await assert.rejects(
      api.deriveX25519SharedSecretFromHandle(handle, new Uint8Array(32)),
      /low-order|invalid|derive/i,
    );
  } finally {
    subtle.importKey = originalImportKey;
  }
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

test('recipient misses reject on the view tag before hashing the owner commitment', () => {
  const source = readFileSync(
    join(import.meta.dirname, '../src/encryption.ts'),
    'utf8',
  );
  const opener = source.slice(source.indexOf('export async function openRecipientEnvelope'));
  const viewTagGate = opener.indexOf('if (viewTag !== deriveViewTag(');
  const ownerCommitment = opener.indexOf('computeDiversifiedOwnerCommitment(');

  assert.ok(viewTagGate >= 0, 'expected a view-tag rejection gate');
  assert.ok(ownerCommitment >= 0, 'expected the diversified owner commitment hash');
  assert.ok(
    viewTagGate < ownerCommitment,
    'foreign envelopes must reject before the Poseidon2 owner commitment hash',
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
