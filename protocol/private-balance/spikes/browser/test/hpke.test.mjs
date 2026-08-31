import test from 'node:test';
import assert from 'node:assert/strict';
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256, Aes128Gcm } from '@hpke/core';

test('RFC 9180 HPKE suite derives keys and seals/opens', async () => {
  const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes128Gcm(),
  });

  const ikm = new Uint8Array(32);
  ikm.fill(0x01);
  const rkp = await suite.kem.deriveKeyPair(ikm);

  const plaintext = new Uint8Array(128);
  plaintext.fill(0xaa);
  const info = new TextEncoder().encode('SKSB_HPKE_INFO_V1');
  const aad = new TextEncoder().encode('SKSB_HPKE_AAD_V1');

  const senderContext = await suite.createSenderContext({
    recipientPublicKey: rkp.publicKey,
    info,
  });

  const ct = await senderContext.seal(plaintext, aad);
  assert.equal(senderContext.enc.byteLength, 32);
  assert.equal(ct.byteLength, 128 + 16);

  const recipientContext = await suite.createRecipientContext({
    recipientKey: rkp,
    enc: senderContext.enc,
    info,
  });

  const opened = await recipientContext.open(ct, aad);
  assert.deepEqual(new Uint8Array(opened), plaintext);
});
