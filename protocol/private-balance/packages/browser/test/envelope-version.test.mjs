import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CipherSuite, Aes128Gcm, HkdfSha256 } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import {
  computeCommitment, computeContextField, computeContextHash, createOutputPackage,
  deriveDiversifiedScanningKeys, deriveHpkeAad, deriveHpkeInfo, deriveKeysFromSeed,
  deriveX25519SharedSecret, encodeNotePlaintext, openRecipientEnvelope,
} from '../dist/index.js';

const bytes = value => new Uint8Array(32).fill(value);
const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });

async function fixture() {
  const contextHash = computeContextHash(3, bytes(1), bytes(2), bytes(3));
  const contextField = computeContextField(contextHash);
  const keys = await deriveKeysFromSeed(bytes(4), 3, bytes(1), bytes(2), bytes(3), bytes(5), contextField);
  const diversifier = new Uint8Array(4);
  const scanning = await deriveDiversifiedScanningKeys(keys.hpkePrivateKey, diversifier);
  const assetField = bytes(6), actionNonce = bytes(7), rho = bytes(8);
  const noteBytes = encodeNotePlaintext({ protocolVersion: 3, flags: 0, value: 25n,
    diversifier, ownerCommitment: keys.ownerCommitment, rho, memoLength: 0,
    memo: new Uint8Array(32), assetIndex: 0, reserved: new Uint8Array(11) });
  const cm = computeCommitment(contextField, assetField, keys.ownerCommitment, 25n, rho);
  const aad = deriveHpkeAad(contextHash, cm, actionNonce, 0);
  const open = envelope => openRecipientEnvelope(keys.hpkePrivateKey, envelope,
    contextHash, contextField, assetField, cm, actionNonce, 0, keys.baseOwnerCommitment);
  return { keys, diversifier, scanning, contextHash, cm, actionNonce, noteBytes, aad, open };
}

test('new V2.1 envelopes interoperate with an independent V2.1 HPKE recipient', async () => {
  const f = await fixture();
  const { recipientEnvelope } = await createOutputPackage(f.keys.hpkePublicKey,
    f.diversifier, f.noteBytes, f.contextHash, f.cm, f.actionNonce, 0);
  const recipient = await suite.createRecipientContext({
    recipientKey: await suite.kem.deserializePrivateKey(f.scanning.hpkePrivateKey),
    enc: recipientEnvelope.slice(5, 37), info: deriveHpkeInfo(3, f.contextHash),
  });
  assert.deepEqual(new Uint8Array(await recipient.open(recipientEnvelope.slice(37), f.aad)), f.noteBytes);
});

for (const version of [2, 3]) {
  test(`V2.1 recovery reads HPKE context ${version}, authenticates ciphertext and rejects V2 notes`, async () => {
    const f = await fixture();
    async function seal(noteBytes) {
      const sender = await suite.createSenderContext({
        recipientPublicKey: await suite.kem.deserializePublicKey(f.keys.hpkePublicKey),
        info: deriveHpkeInfo(version, f.contextHash),
      });
      const enc = new Uint8Array(sender.enc);
      const shared = await deriveX25519SharedSecret(f.scanning.hpkePrivateKey, enc);
      const tag = createHash('sha256').update('StellarKey private view tag v1').update(shared)
        .update(f.contextHash).update(enc).update(f.keys.hpkePublicKey).digest()[0];
      shared.fill(0);
      const envelope = new Uint8Array(181);
      envelope[0] = tag;
      envelope.set(f.diversifier, 1);
      envelope.set(enc, 5);
      envelope.set(new Uint8Array(await sender.seal(noteBytes, f.aad)), 37);
      return envelope;
    }
    const envelope = await seal(f.noteBytes);
    assert.equal((await f.open(envelope))?.value, 25n);
    const corrupted = envelope.slice();
    corrupted[50] ^= 1;
    assert.equal(await f.open(corrupted), null);
    const obsolete = f.noteBytes.slice();
    obsolete[1] = 2;
    assert.equal(await f.open(await seal(obsolete)), null);
  });
}
