import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { bytesToField } from './field.js';
import { concatBytes, hmacSha256, hmacSha512, sha512Bytes, utf8 } from './hash.js';
import { p2 } from './poseidon2.js';
import { deriveX25519PublicKey, deriveX25519PublicKeyFromHandle, importX25519PrivateKey, } from './x25519.js';
export const DOMAIN_ROOT = 'SKSB_ROOT_V1';
export const DOMAIN_ASK = 'SKSB_ASK_V1';
export const DOMAIN_NK = 'SKSB_NK_V1';
export const DOMAIN_OVK = 'SKSB_OVK_V1';
export const DOMAIN_HPKE_IKM = 'SKSB_HPKE_IKM_V1';
export const DOMAIN_OWNER = 'SKSB_OWNER_V1';
export const DOMAIN_DIVERSIFIED_OWNER = 'SKSB_DIVERSIFIED_OWNER_V1';
export const DOMAIN_ADDRESS_KEY = 'SKSB_ADDRESS_KEY_V1';
export const DOMAIN_STORAGE_KEY = 'SKSB_STORAGE_KEY_V1';
const HPKE_VERSION_LABEL = utf8('HPKE-v1');
const HPKE_KEM_SUITE_ID = Uint8Array.of(0x4b, 0x45, 0x4d, 0x00, 0x20);
const HPKE_DKP_PRK_LABEL = utf8('dkp_prk');
const HPKE_SK_LABEL = utf8('sk');
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
    if (protocolVersion !== 2)
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
    try {
        for (let block = 1; block <= blocks; block += 1) {
            const next = hmacSha512(prk, previous, info, Uint8Array.of(block));
            previous.fill(0);
            previous = next;
            output.set(previous, (block - 1) * 64);
        }
        // The caller owns an independent, exact-length copy, never this scratch.
        return output.slice(0, length);
    }
    finally {
        previous.fill(0);
        output.fill(0);
    }
}
function hkdfSha256Expand(prk, info, length) {
    if (length > 255 * 32)
        throw new Error('HKDF output is too long');
    const output = new Uint8Array(length);
    let previous = new Uint8Array(0);
    let offset = 0;
    try {
        for (let counter = 1; offset < length; counter += 1) {
            const next = new Uint8Array(hmacSha256(prk, previous, info, Uint8Array.of(counter)));
            previous.fill(0);
            previous = next;
            const take = Math.min(previous.length, length - offset);
            output.set(previous.subarray(0, take), offset);
            offset += take;
        }
        return output;
    }
    finally {
        previous.fill(0);
    }
}
function deriveRfc9180X25519PrivateKey(ikm) {
    const labeledIkm = concatBytes(HPKE_VERSION_LABEL, HPKE_KEM_SUITE_ID, HPKE_DKP_PRK_LABEL, ikm);
    const dkpPrk = hmacSha256(new Uint8Array(0), labeledIkm);
    const labeledInfo = concatBytes(Uint8Array.of(0, 32), HPKE_VERSION_LABEL, HPKE_KEM_SUITE_ID, HPKE_SK_LABEL);
    try {
        // RFC 9180 DHKEM(X25519, HKDF-SHA256) DeriveKeyPair. Keeping
        // this byte-identical to @hpke is enforced by the key/address vectors.
        return hkdfSha256Expand(dkpPrk, labeledInfo, 32);
    }
    finally {
        labeledIkm.fill(0);
        dkpPrk.fill(0);
        labeledInfo.fill(0);
    }
}
export function computeDiversifiedOwnerCommitment(baseOwnerCommitment, diversifier) {
    if (baseOwnerCommitment.length !== 32)
        throw new Error('base owner commitment must be 32 bytes');
    if (diversifier.length !== 4)
        throw new Error('address diversifier must be 4 bytes');
    const diversifierField = new Uint8Array(32);
    diversifierField.set(diversifier, 28);
    return p2(DOMAIN_DIVERSIFIED_OWNER, [
        baseOwnerCommitment,
        diversifierField,
    ]);
}
export async function deriveDiversifiedEncryptionKeys(incomingViewingKey, diversifier) {
    const keys = await deriveDiversifiedScanningKeys(incomingViewingKey, diversifier);
    return {
        diversifier: keys.diversifier,
        hpkePrivateKey: keys.hpkePrivateKey,
        hpkePublicKey: keys.hpkePublicKey,
    };
}
export async function deriveDiversifiedScanningKeys(incomingViewingKey, diversifier) {
    if (incomingViewingKey.length !== 32)
        throw new Error('incoming viewing key must be 32 bytes');
    if (diversifier.length !== 4)
        throw new Error('address diversifier must be 4 bytes');
    const prk = hmacSha512(new Uint8Array(64), incomingViewingKey);
    const childIkm = hkdfExpand(prk, concatBytes(utf8(DOMAIN_ADDRESS_KEY), diversifier), 32);
    let hpkePrivateKey = null;
    try {
        hpkePrivateKey = deriveRfc9180X25519PrivateKey(childIkm);
        let nativePrivateKey;
        let hpkePublicKey;
        try {
            const candidate = await importX25519PrivateKey(hpkePrivateKey);
            hpkePublicKey = await deriveX25519PublicKeyFromHandle(candidate);
            // Publish the handle only after both native operations succeed. A browser
            // with partial X25519 support must stay entirely on the portable path.
            nativePrivateKey = candidate;
        }
        catch {
            hpkePublicKey = deriveX25519PublicKey(hpkePrivateKey);
        }
        return {
            diversifier: diversifier.slice(),
            hpkePrivateKey,
            hpkePublicKey,
            ...(nativePrivateKey ? { nativePrivateKey } : {}),
        };
    }
    finally {
        prk.fill(0);
        childIkm.fill(0);
    }
}
export async function deriveDiversifiedAddressKeys(baseOwnerCommitment, incomingViewingKey, diversifier) {
    const ownerCommitment = computeDiversifiedOwnerCommitment(baseOwnerCommitment, diversifier);
    const encryptionKeys = await deriveDiversifiedEncryptionKeys(incomingViewingKey, diversifier);
    return { ...encryptionKeys, ownerCommitment };
}
function deriveNonzeroField(prk, domain, context, startCounter = 0) {
    let counter = startCounter;
    for (;;) {
        if (counter > 255)
            throw new Error(`Unable to derive nonzero ${domain} field`);
        const suffix = counter === 0 ? new Uint8Array(0) : Uint8Array.of(counter);
        const expanded = hkdfExpand(prk, concatBytes(utf8(domain), context, suffix), 64);
        let field;
        try {
            field = bytesToField(expanded);
        }
        finally {
            expanded.fill(0);
        }
        if (!field.every((byte) => byte === 0))
            return { field, counter };
        field.fill(0);
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
    let nk = null;
    let outgoingViewingKey = null;
    let askResult = null;
    let baseOwnerCommitment = null;
    let incomingViewingKey = null;
    let defaultAddress = null;
    let transferred = false;
    try {
        nk = deriveNonzeroField(prk, DOMAIN_NK, context).field;
        outgoingViewingKey = hkdfExpand(prk, concatBytes(utf8(DOMAIN_OVK), context), 32);
        askResult = deriveNonzeroField(prk, DOMAIN_ASK, context);
        baseOwnerCommitment = p2(DOMAIN_OWNER, [contextField, askResult.field, nk]);
        while (baseOwnerCommitment.every((byte) => byte === 0)) {
            askResult.field.fill(0);
            askResult = deriveNonzeroField(prk, DOMAIN_ASK, context, askResult.counter + 1);
            baseOwnerCommitment = p2(DOMAIN_OWNER, [contextField, askResult.field, nk]);
        }
        hpkeIkm = hkdfExpand(prk, concatBytes(utf8(DOMAIN_HPKE_IKM), context), 32);
        const kem = new DhkemX25519HkdfSha256();
        const keyPair = await kem.deriveKeyPair(hpkeIkm);
        incomingViewingKey = new Uint8Array(await kem.serializePrivateKey(keyPair.privateKey));
        defaultAddress = await deriveDiversifiedAddressKeys(baseOwnerCommitment, incomingViewingKey, new Uint8Array(4));
        const expanded = {
            ask: askResult.field,
            nk,
            baseOwnerCommitment,
            ownerCommitment: defaultAddress.ownerCommitment,
            hpkePrivateKey: incomingViewingKey,
            hpkePublicKey: defaultAddress.hpkePublicKey,
            outgoingViewingKey,
        };
        transferred = true;
        return expanded;
    }
    finally {
        hpkeIkm?.fill(0);
        prk.fill(0);
        // The default child scalar is not the incoming key returned above.
        defaultAddress?.hpkePrivateKey.fill(0);
        if (!transferred) {
            askResult?.field.fill(0);
            nk?.fill(0);
            outgoingViewingKey?.fill(0);
            baseOwnerCommitment?.fill(0);
            incomingViewingKey?.fill(0);
            defaultAddress?.ownerCommitment.fill(0);
            defaultAddress?.hpkePublicKey.fill(0);
        }
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
        outgoingViewingKey: esk.outgoingViewingKey.slice(),
    };
}
