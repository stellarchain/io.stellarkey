import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { bytesToField } from './field.js';
import { concatBytes, hmacSha512, sha512Bytes, utf8 } from './hash.js';
import { p2 } from './poseidon2.js';
export const DOMAIN_ROOT = 'SKSB_ROOT_V1';
export const DOMAIN_ASK = 'SKSB_ASK_V1';
export const DOMAIN_NK = 'SKSB_NK_V1';
export const DOMAIN_HPKE_IKM = 'SKSB_HPKE_IKM_V1';
export const DOMAIN_OWNER = 'SKSB_OWNER_V1';
export const DOMAIN_DIVERSIFIED_OWNER = 'SKSB_DIVERSIFIED_OWNER_V2';
export const DOMAIN_ADDRESS_KEY = 'SKSB_ADDRESS_KEY_V2';
export const DOMAIN_STORAGE_KEY = 'SKSB_STORAGE_KEY_V1';
function keyContext(protocolVersion, networkId, realmId, poolId, accountPublicKeyBytes) {
    for (const [name, value] of [
        ['network ID', networkId],
        ['realm ID', realmId],
        ['pool ID', poolId],
        ['account public key', accountPublicKeyBytes],
    ]) {
        if (value.length !== 32)
            throw new Error(`${name} must be 32 bytes`);
    }
    if (protocolVersion !== 1)
        throw new Error('Unsupported protocol version');
    const version = Uint8Array.of((protocolVersion >>> 8) & 0xff, protocolVersion & 0xff);
    return concatBytes(version, networkId, realmId, poolId, accountPublicKeyBytes);
}
function hkdfExpand(prk, info, length) {
    if (length > 255 * 64)
        throw new Error('HKDF output is too long');
    const blocks = Math.ceil(length / 64);
    const output = new Uint8Array(blocks * 64);
    let previous = new Uint8Array(0);
    for (let block = 1; block <= blocks; block += 1) {
        previous = new Uint8Array(hmacSha512(prk, previous, info, Uint8Array.of(block)));
        output.set(previous, (block - 1) * 64);
    }
    return output.slice(0, length);
}
export async function deriveDiversifiedAddressKeys(baseOwnerCommitment, incomingViewingKey, diversifier) {
    if (baseOwnerCommitment.length !== 32)
        throw new Error('base owner commitment must be 32 bytes');
    if (incomingViewingKey.length !== 32)
        throw new Error('incoming viewing key must be 32 bytes');
    if (diversifier.length !== 4)
        throw new Error('address diversifier must be 4 bytes');
    const diversifierField = new Uint8Array(32);
    diversifierField.set(diversifier, 28);
    const ownerCommitment = p2(DOMAIN_DIVERSIFIED_OWNER, [
        baseOwnerCommitment,
        diversifierField,
    ]);
    const prk = hmacSha512(new Uint8Array(64), incomingViewingKey);
    const childIkm = hkdfExpand(prk, concatBytes(utf8(DOMAIN_ADDRESS_KEY), diversifier), 32);
    try {
        const kem = new DhkemX25519HkdfSha256();
        const keyPair = await kem.deriveKeyPair(childIkm);
        return {
            diversifier: diversifier.slice(),
            ownerCommitment,
            hpkePrivateKey: new Uint8Array(await kem.serializePrivateKey(keyPair.privateKey)),
            hpkePublicKey: new Uint8Array(await kem.serializePublicKey(keyPair.publicKey)),
        };
    }
    finally {
        prk.fill(0);
        childIkm.fill(0);
    }
}
function deriveNonzeroField(prk, domain, context, startCounter = 0) {
    let counter = startCounter;
    for (;;) {
        if (counter > 255)
            throw new Error(`Unable to derive nonzero ${domain} field`);
        const suffix = counter === 0 ? new Uint8Array(0) : Uint8Array.of(counter);
        const field = bytesToField(hkdfExpand(prk, concatBytes(utf8(domain), context, suffix), 64));
        if (!field.every((byte) => byte === 0))
            return { field, counter };
        counter += 1;
    }
}
export function derivePrivacySessionRoot(rawStellarSeed, protocolVersion, networkId, realmId, poolId, accountPublicKeyBytes) {
    if (rawStellarSeed.length !== 32)
        throw new Error('raw Stellar seed must be 32 bytes');
    const context = keyContext(protocolVersion, networkId, realmId, poolId, accountPublicKeyBytes);
    const salt = sha512Bytes(utf8(DOMAIN_ROOT), context);
    return hmacSha512(salt, rawStellarSeed);
}
export function derivePrivateStorageKey(privacySessionRoot, deploymentBindingHash) {
    if (privacySessionRoot.length !== 64)
        throw new Error('privacy session root must be 64 bytes');
    if (deploymentBindingHash.length !== 32)
        throw new Error('deployment binding hash must be 32 bytes');
    const expanded = hmacSha512(privacySessionRoot, utf8(DOMAIN_STORAGE_KEY), deploymentBindingHash);
    try {
        return expanded.slice(0, 32);
    }
    finally {
        expanded.fill(0);
    }
}
export async function deriveExpandedSpendingKey(privacySessionRoot, protocolVersion, networkId, realmId, poolId, accountPublicKeyBytes, contextField) {
    if (privacySessionRoot.length !== 64)
        throw new Error('privacy session root must be 64 bytes');
    if (contextField.length !== 32)
        throw new Error('context field must be 32 bytes');
    const context = keyContext(protocolVersion, networkId, realmId, poolId, accountPublicKeyBytes);
    const prk = privacySessionRoot.slice();
    let hpkeIkm = null;
    try {
        const nk = deriveNonzeroField(prk, DOMAIN_NK, context).field;
        let askResult = deriveNonzeroField(prk, DOMAIN_ASK, context);
        let baseOwnerCommitment = p2(DOMAIN_OWNER, [contextField, askResult.field, nk]);
        while (baseOwnerCommitment.every((byte) => byte === 0)) {
            askResult = deriveNonzeroField(prk, DOMAIN_ASK, context, askResult.counter + 1);
            baseOwnerCommitment = p2(DOMAIN_OWNER, [contextField, askResult.field, nk]);
        }
        hpkeIkm = hkdfExpand(prk, concatBytes(utf8(DOMAIN_HPKE_IKM), context), 32);
        const kem = new DhkemX25519HkdfSha256();
        const keyPair = await kem.deriveKeyPair(hpkeIkm);
        const incomingViewingKey = new Uint8Array(await kem.serializePrivateKey(keyPair.privateKey));
        const defaultAddress = await deriveDiversifiedAddressKeys(baseOwnerCommitment, incomingViewingKey, new Uint8Array(4));
        return {
            ask: askResult.field,
            nk,
            baseOwnerCommitment,
            ownerCommitment: defaultAddress.ownerCommitment,
            hpkePrivateKey: incomingViewingKey,
            hpkePublicKey: defaultAddress.hpkePublicKey,
        };
    }
    finally {
        hpkeIkm?.fill(0);
        prk.fill(0);
    }
}
export async function deriveKeysFromSeed(rawStellarSeed, protocolVersion, networkId, realmId, poolId, accountPublicKeyBytes, contextField) {
    const sessionRoot = derivePrivacySessionRoot(rawStellarSeed, protocolVersion, networkId, realmId, poolId, accountPublicKeyBytes);
    try {
        return await deriveExpandedSpendingKey(sessionRoot, protocolVersion, networkId, realmId, poolId, accountPublicKeyBytes, contextField);
    }
    finally {
        sessionRoot.fill(0);
    }
}
export function toViewingKey(esk) {
    return {
        baseOwnerCommitment: esk.baseOwnerCommitment.slice(),
        ownerCommitment: esk.ownerCommitment.slice(),
        nk: esk.nk.slice(),
        hpkePrivateKey: esk.hpkePrivateKey.slice(),
        hpkePublicKey: esk.hpkePublicKey.slice(),
    };
}
