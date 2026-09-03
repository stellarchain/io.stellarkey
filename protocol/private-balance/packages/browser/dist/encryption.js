import { CipherSuite, Aes128Gcm, HkdfSha256 } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { deriveHpkeInfo, deriveHpkeAad } from './encoding.js';
import { computeCommitment, decodeNotePlaintext } from './note.js';
import { concatBytes, equalBytes, hmacSha256, sha256Bytes, utf8 } from './hash.js';
import { deriveX25519SharedSecret, deriveX25519SharedSecretFromHandle, } from './x25519.js';
import { computeDiversifiedOwnerCommitment, deriveDiversifiedScanningKeys, } from './keys.js';
const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes128Gcm(),
});
export const RECIPIENT_ENVELOPE_BYTES = 181;
export const OUTPUT_PACKAGE_BYTES = 370;
export const OUTGOING_ENVELOPE_BYTES = 157;
export const OUTGOING_NONCE_BYTES = 12;
const OUTGOING_KEY_DOMAIN = utf8('SKSB_OUTGOING_KEY_V1');
const OUTGOING_VIEW_TAG_DOMAIN = utf8('SKSB_OUTGOING_VIEW_TAG_V1');
const VIEW_TAG_DOMAIN = utf8('StellarKey private view tag v1');
function deriveViewTag(sharedSecret, contextHash, encPk, recipientPublicKey) {
    return sha256Bytes(VIEW_TAG_DOMAIN, sharedSecret, contextHash, encPk, recipientPublicKey)[0];
}
function deriveOutgoingMaterial(outgoingViewingKey, domain, ephemeralPublicKey, aad, length) {
    if (outgoingViewingKey.length !== 32)
        throw new Error('Outgoing viewing key must be 32 bytes');
    if (ephemeralPublicKey.length !== 32)
        throw new Error('Ephemeral public key must be 32 bytes');
    const prk = hmacSha256(new Uint8Array(32), outgoingViewingKey);
    const info = concatBytes(domain, ephemeralPublicKey, aad);
    const output = new Uint8Array(length);
    let previous = new Uint8Array(0);
    let offset = 0;
    try {
        for (let counter = 1; offset < length; counter += 1) {
            previous = hmacSha256(prk, previous, info, Uint8Array.of(counter));
            const take = Math.min(previous.length, length - offset);
            output.set(previous.subarray(0, take), offset);
            offset += take;
        }
        return output;
    }
    finally {
        prk.fill(0);
        previous.fill(0);
    }
}
function webCryptoBytes(bytes) {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy;
}
export async function sealOutgoingEnvelope(outgoingViewingKey, ephemeralPublicKey, plaintext, aad, nonce) {
    if (plaintext.length !== 128)
        throw new Error('Outgoing plaintext must be 128 bytes');
    if (nonce.length !== OUTGOING_NONCE_BYTES)
        throw new Error('Outgoing nonce must be 12 bytes');
    const keyBytes = deriveOutgoingMaterial(outgoingViewingKey, OUTGOING_KEY_DOMAIN, ephemeralPublicKey, aad, 16);
    const viewTag = deriveOutgoingMaterial(outgoingViewingKey, OUTGOING_VIEW_TAG_DOMAIN, ephemeralPublicKey, aad, 1);
    const keyInput = webCryptoBytes(keyBytes);
    const nonceInput = webCryptoBytes(nonce);
    const aadInput = webCryptoBytes(aad);
    const plaintextInput = webCryptoBytes(plaintext);
    try {
        const key = await globalThis.crypto.subtle.importKey('raw', keyInput, 'AES-GCM', false, ['encrypt']);
        const ciphertext = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceInput, additionalData: aadInput, tagLength: 128 }, key, plaintextInput));
        const envelope = new Uint8Array(OUTGOING_ENVELOPE_BYTES);
        envelope[0] = viewTag[0];
        envelope.set(nonce, 1);
        envelope.set(ciphertext, 13);
        return envelope;
    }
    finally {
        keyBytes.fill(0);
        keyInput.fill(0);
        plaintextInput.fill(0);
        viewTag.fill(0);
    }
}
export async function openOutgoingEnvelope(outgoingViewingKey, ephemeralPublicKey, envelope, aad) {
    if (envelope.length !== OUTGOING_ENVELOPE_BYTES)
        return null;
    let expectedViewTag = null;
    let keyBytes = null;
    let keyInput = null;
    try {
        expectedViewTag = deriveOutgoingMaterial(outgoingViewingKey, OUTGOING_VIEW_TAG_DOMAIN, ephemeralPublicKey, aad, 1);
        if (envelope[0] !== expectedViewTag[0])
            return null;
        keyBytes = deriveOutgoingMaterial(outgoingViewingKey, OUTGOING_KEY_DOMAIN, ephemeralPublicKey, aad, 16);
        keyInput = webCryptoBytes(keyBytes);
        const nonceInput = webCryptoBytes(envelope.subarray(1, 13));
        const aadInput = webCryptoBytes(aad);
        const ciphertextInput = webCryptoBytes(envelope.subarray(13));
        const key = await globalThis.crypto.subtle.importKey('raw', keyInput, 'AES-GCM', false, ['decrypt']);
        keyInput.fill(0);
        const plaintext = new Uint8Array(await globalThis.crypto.subtle.decrypt({
            name: 'AES-GCM',
            iv: nonceInput,
            additionalData: aadInput,
            tagLength: 128,
        }, key, ciphertextInput));
        return plaintext.length === 128 ? plaintext : null;
    }
    catch {
        return null;
    }
    finally {
        expectedViewTag?.fill(0);
        keyBytes?.fill(0);
        keyInput?.fill(0);
    }
}
export async function createOutputPackage(recipientHpkePk, diversifier, noteBytes, contextHash, cm, actionNonce, outputIndex) {
    if (recipientHpkePk.length !== 32)
        throw new Error('Recipient HPKE key must be 32 bytes');
    if (diversifier.length !== 4)
        throw new Error('Recipient diversifier must be 4 bytes');
    if (noteBytes.length !== 128)
        throw new Error('Note plaintext must be 128 bytes');
    if (contextHash.length !== 32 || cm.length !== 32 || actionNonce.length !== 32) {
        throw new Error('Invalid output package context');
    }
    if (outputIndex !== 0 && outputIndex !== 1 && outputIndex !== 2) {
        throw new Error('Invalid output index');
    }
    const info = deriveHpkeInfo(2, contextHash);
    const aad = deriveHpkeAad(contextHash, cm, actionNonce, outputIndex);
    let ephemeralPrivateKey = null;
    let sharedSecret = null;
    try {
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
        ephemeralPrivateKey = new Uint8Array(await suite.kem.serializePrivateKey(ephemeralKeyPair.privateKey));
        sharedSecret = await deriveX25519SharedSecret(ephemeralPrivateKey, recipientHpkePk);
        const recipientEnvelope = new Uint8Array(RECIPIENT_ENVELOPE_BYTES);
        recipientEnvelope[0] = deriveViewTag(sharedSecret, contextHash, encPk, recipientHpkePk);
        recipientEnvelope.set(diversifier, 1);
        recipientEnvelope.set(encPk, 5);
        recipientEnvelope.set(ctBytes, 37);
        const outputPackage = new Uint8Array(OUTPUT_PACKAGE_BYTES);
        outputPackage.set(cm, 0);
        outputPackage.set(recipientEnvelope, 32);
        return { recipientEnvelope, outputPackage };
    }
    finally {
        ephemeralPrivateKey?.fill(0);
        sharedSecret?.fill(0);
    }
}
export async function openRecipientEnvelope(recipientHpkeSk, recipientEnvelope, contextHash, contextField, assetField, cm, actionNonce, outputIndex, baseOwnerCommitment) {
    if (recipientEnvelope.length !== RECIPIENT_ENVELOPE_BYTES) {
        return null;
    }
    let diversified = null;
    let sharedSecret = null;
    let plaintextBytes = null;
    try {
        const viewTag = recipientEnvelope[0];
        const diversifier = recipientEnvelope.subarray(1, 5);
        const encPk = recipientEnvelope.subarray(5, 37);
        const ct = recipientEnvelope.subarray(37, 181);
        diversified = await deriveDiversifiedScanningKeys(recipientHpkeSk, diversifier);
        const recipientPublicKey = diversified.hpkePublicKey;
        if (diversified.nativePrivateKey) {
            try {
                sharedSecret = await deriveX25519SharedSecretFromHandle(diversified.nativePrivateKey, encPk);
            }
            catch {
                // Native X25519 can be present but incomplete or fail transiently. The
                // still-owned scalar keeps scanning lossless through the reviewed path.
                sharedSecret = await deriveX25519SharedSecret(diversified.hpkePrivateKey, encPk, 'portable');
            }
        }
        else {
            sharedSecret = await deriveX25519SharedSecret(diversified.hpkePrivateKey, encPk, 'portable');
        }
        if (viewTag !== deriveViewTag(sharedSecret, contextHash, encPk, recipientPublicKey))
            return null;
        const ownerCommitment = computeDiversifiedOwnerCommitment(baseOwnerCommitment, diversifier);
        const info = deriveHpkeInfo(2, contextHash);
        const aad = deriveHpkeAad(contextHash, cm, actionNonce, outputIndex);
        const skR = await suite.kem.deserializePrivateKey(diversified.hpkePrivateKey);
        const recipientContext = await suite.createRecipientContext({
            recipientKey: skR,
            enc: encPk,
            info,
        });
        const pt = await recipientContext.open(ct, aad);
        plaintextBytes = new Uint8Array(pt);
        const note = decodeNotePlaintext(plaintextBytes);
        if (!equalBytes(note.diversifier, diversifier))
            return null;
        if (!equalBytes(note.ownerCommitment, ownerCommitment))
            return null;
        const expectedCommitment = computeCommitment(contextField, assetField, note.ownerCommitment, note.value, note.rho);
        return equalBytes(expectedCommitment, cm) ? note : null;
    }
    catch {
        return null;
    }
    finally {
        diversified?.hpkePrivateKey.fill(0);
        sharedSecret?.fill(0);
        plaintextBytes?.fill(0);
    }
}
