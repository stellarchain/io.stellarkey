import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256, Aes128Gcm } from '@hpke/core';

export const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm(),
});

export async function deriveHpkeKeyPair(ikm: Uint8Array): Promise<CryptoKeyPair> {
  return await suite.kem.deriveKeyPair(ikm);
}

export async function serializePublicKey(key: CryptoKey): Promise<Uint8Array> {
  const exported = await suite.kem.serializePublicKey(key);
  return new Uint8Array(exported);
}

export async function deserializePublicKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return await suite.kem.deserializePublicKey(rawKey);
}

export async function sealEnvelope(
  recipientPublicKey: CryptoKey,
  plaintext: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array
): Promise<{ enc: Uint8Array; ct: Uint8Array; envelope: Uint8Array }> {
  const senderContext = await suite.createSenderContext({
    recipientPublicKey,
    info,
  });

  const enc = new Uint8Array(senderContext.enc);
  const ct = new Uint8Array(await senderContext.seal(plaintext, aad));

  const envelope = new Uint8Array(enc.length + ct.length);
  envelope.set(enc, 0);
  envelope.set(ct, enc.length);

  return { enc, ct, envelope };
}

export async function openEnvelope(
  recipientKeyPair: CryptoKeyPair,
  envelope: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  if (envelope.length < 32 + 16) {
    throw new Error('Envelope too short');
  }
  const enc = envelope.subarray(0, 32);
  const ct = envelope.subarray(32);

  const recipientContext = await suite.createRecipientContext({
    recipientKey: recipientKeyPair,
    enc,
    info,
  });

  const pt = await recipientContext.open(ct, aad);
  return new Uint8Array(pt);
}
