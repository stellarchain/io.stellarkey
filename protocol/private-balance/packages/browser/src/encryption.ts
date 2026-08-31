import { CipherSuite, Aes128Gcm, HkdfSha256 } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { deriveHpkeInfo, deriveHpkeAad } from './encoding.js';
import { computeCommitment, decodeNotePlaintext, NotePlaintext } from './note.js';
import { equalBytes, sha256Bytes, utf8 } from './hash.js';
import { deriveX25519SharedSecret } from './x25519.js';
import { deriveDiversifiedAddressKeys } from './keys.js';

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm(),
});

export const RECIPIENT_ENVELOPE_BYTES = 181;
export const OUTPUT_PACKAGE_BYTES = 213;

const VIEW_TAG_DOMAIN = utf8('StellarKey private view tag v2');

function deriveViewTag(
  sharedSecret: Uint8Array,
  contextHash: Uint8Array,
  encPk: Uint8Array,
  recipientPublicKey: Uint8Array,
): number {
  return sha256Bytes(
    VIEW_TAG_DOMAIN,
    sharedSecret,
    contextHash,
    encPk,
    recipientPublicKey,
  )[0];
}

export async function createOutputPackage(
  recipientHpkePk: Uint8Array,
  diversifier: Uint8Array,
  noteBytes: Uint8Array,
  contextHash: Uint8Array,
  cm: Uint8Array,
  actionNonce: Uint8Array,
  outputIndex: number
): Promise<{ recipientEnvelope: Uint8Array; outputPackage: Uint8Array }> {
  if (recipientHpkePk.length !== 32) throw new Error('Recipient HPKE key must be 32 bytes');
  if (diversifier.length !== 4) throw new Error('Recipient diversifier must be 4 bytes');
  if (noteBytes.length !== 128) throw new Error('Note plaintext must be 128 bytes');
  if (contextHash.length !== 32 || cm.length !== 32 || actionNonce.length !== 32) {
    throw new Error('Invalid output package context');
  }
  if (outputIndex !== 0 && outputIndex !== 1) throw new Error('Invalid output index');
  const info = deriveHpkeInfo(2, contextHash);
  const aad = deriveHpkeAad(contextHash, cm, actionNonce, outputIndex);

  const pkR = await suite.kem.deserializePublicKey(recipientHpkePk);
  const ephemeralKeyPair = await suite.kem.generateKeyPair();
  const senderContext = await suite.createSenderContext({
    recipientPublicKey: pkR,
    info,
    ekm: ephemeralKeyPair,
  });

  const ct = await senderContext.seal(noteBytes, aad);
  const encPk = new Uint8Array(senderContext.enc);
  const ctBytes = new Uint8Array(ct);
  const ephemeralPrivateKey = new Uint8Array(
    await suite.kem.serializePrivateKey(ephemeralKeyPair.privateKey),
  );
  const sharedSecret = await deriveX25519SharedSecret(
    ephemeralPrivateKey,
    recipientHpkePk,
  );

  const recipientEnvelope = new Uint8Array(RECIPIENT_ENVELOPE_BYTES);
  recipientEnvelope[0] = deriveViewTag(
    sharedSecret,
    contextHash,
    encPk,
    recipientHpkePk,
  );
  recipientEnvelope.set(diversifier, 1);
  recipientEnvelope.set(encPk, 5);
  recipientEnvelope.set(ctBytes, 37);

  const outputPackage = new Uint8Array(OUTPUT_PACKAGE_BYTES);
  outputPackage.set(cm, 0);
  outputPackage.set(recipientEnvelope, 32);

  return {
    recipientEnvelope,
    outputPackage,
  };
}

export async function openRecipientEnvelope(
  recipientHpkeSk: Uint8Array,
  recipientEnvelope: Uint8Array,
  contextHash: Uint8Array,
  contextField: Uint8Array,
  assetField: Uint8Array,
  cm: Uint8Array,
  actionNonce: Uint8Array,
  outputIndex: number,
  baseOwnerCommitment: Uint8Array,
): Promise<NotePlaintext | null> {
  if (recipientEnvelope.length !== RECIPIENT_ENVELOPE_BYTES) {
    return null;
  }

  try {
    const viewTag = recipientEnvelope[0];
    const diversifier = recipientEnvelope.subarray(1, 5);
    const encPk = recipientEnvelope.subarray(5, 37);
    const ct = recipientEnvelope.subarray(37, 181);
    const diversified = await deriveDiversifiedAddressKeys(
      baseOwnerCommitment,
      recipientHpkeSk,
      diversifier,
    );
    const recipientPublicKey = diversified.hpkePublicKey;
    const sharedSecret = await deriveX25519SharedSecret(diversified.hpkePrivateKey, encPk);
    if (viewTag !== deriveViewTag(
      sharedSecret,
      contextHash,
      encPk,
      recipientPublicKey,
    )) return null;

    const info = deriveHpkeInfo(2, contextHash);
    const aad = deriveHpkeAad(contextHash, cm, actionNonce, outputIndex);

    const skR = await suite.kem.deserializePrivateKey(diversified.hpkePrivateKey);
    const recipientContext = await suite.createRecipientContext({
      recipientKey: skR,
      enc: encPk,
      info,
    });

    const pt = await recipientContext.open(ct, aad);
    const note = decodeNotePlaintext(new Uint8Array(pt));
    if (!equalBytes(note.diversifier, diversifier)) return null;
    if (!equalBytes(note.ownerCommitment, diversified.ownerCommitment)) return null;
    const expectedCommitment = computeCommitment(
      contextField,
      assetField,
      note.ownerCommitment,
      note.value,
      note.rho,
    );
    return equalBytes(expectedCommitment, cm) ? note : null;
  } catch {
    return null;
  }
}
