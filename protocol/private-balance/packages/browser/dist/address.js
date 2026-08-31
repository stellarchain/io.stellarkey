import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { decodeBech32m, encodeBech32m, groupBech32m } from './bech32m.js';
import { isCanonicalField } from './field.js';
import { equalBytes } from './hash.js';
export const PRIVATE_ADDRESS_PAYLOAD_BYTES = 68;
export const ADDRESS_DIVERSIFIER_BYTES = 4;
export const PRIVATE_ADDRESS_ASCII_BYTES = 119;
function validatePrefix(prefix) {
    if (prefix !== 'tks' && prefix !== 'sks')
        throw new Error('Unsupported private address prefix');
}
function requireLength(name, bytes, length) {
    if (bytes.length !== length)
        throw new Error(`${name} must be ${length} bytes`);
}
function validateAddressFields(address) {
    requireLength('Address diversifier', address.diversifier, ADDRESS_DIVERSIFIER_BYTES);
    requireLength('Owner commitment', address.ownerCommitment, 32);
    requireLength('HPKE public key', address.hpkePublicKey, 32);
    if (!isCanonicalField(address.ownerCommitment) || address.ownerCommitment.every(byte => byte === 0)) {
        throw new Error('Invalid owner commitment');
    }
    if (address.hpkePublicKey.every(byte => byte === 0))
        throw new Error('Invalid HPKE public key');
}
export function encodePrivateAddress(address, prefix) {
    validatePrefix(prefix);
    validateAddressFields(address);
    const payload = new Uint8Array(PRIVATE_ADDRESS_PAYLOAD_BYTES);
    payload.set(address.diversifier, 0);
    payload.set(address.ownerCommitment, 4);
    payload.set(address.hpkePublicKey, 36);
    const encoded = encodeBech32m(prefix, payload);
    if (encoded.length !== PRIVATE_ADDRESS_ASCII_BYTES)
        throw new Error('Unexpected private address length');
    return encoded;
}
export async function decodePrivateAddress(encoded, expectedPrefix) {
    validatePrefix(expectedPrefix);
    if (encoded.length !== PRIVATE_ADDRESS_ASCII_BYTES || encoded !== encoded.toLowerCase() || /\s/u.test(encoded)) {
        throw new Error('Invalid private address spelling');
    }
    let payload;
    try {
        payload = decodeBech32m(encoded, expectedPrefix, PRIVATE_ADDRESS_PAYLOAD_BYTES);
    }
    catch (error) {
        throw new Error(error instanceof Error ? error.message.replace('Bech32m', 'private address') : 'Invalid private address', { cause: error });
    }
    const address = {
        diversifier: payload.slice(0, 4),
        ownerCommitment: payload.slice(4, 36),
        hpkePublicKey: payload.slice(36, 68),
    };
    validateAddressFields(address);
    try {
        const kem = new DhkemX25519HkdfSha256();
        const imported = await kem.deserializePublicKey(address.hpkePublicKey);
        const roundTrip = new Uint8Array(await kem.serializePublicKey(imported));
        if (!equalBytes(roundTrip, address.hpkePublicKey))
            throw new Error('Aliased HPKE public key');
        const encapsulated = await kem.encap({ recipientPublicKey: imported });
        new Uint8Array(encapsulated.sharedSecret).fill(0);
    }
    catch {
        throw new Error('Invalid HPKE public key');
    }
    return address;
}
export function groupPrivateAddress(address) {
    return groupBech32m(address);
}
