import { fieldId, isCanonicalField } from './field.js';
import { sha256Bytes, utf8 } from './hash.js';
export const DOMAIN_CONTEXT = 'SKSB_CONTEXT_V1';
export const DOMAIN_CONTEXT_FIELD = 'SKSB_CONTEXT_FIELD_V1';
export const DOMAIN_ADDRESS_CONTEXT = 'SKSB_ADDRESS_CONTEXT_V1';
export const DOMAIN_HPKE_INFO = 'SKSB_HPKE_INFO_V1';
export const DOMAIN_HPKE_AAD = 'SKSB_HPKE_AAD_V1';
export const DOMAIN_OUTGOING_AAD = 'SKSB_OUTGOING_AAD_V1';
export const OUTGOING_PLAINTEXT_BYTES = 128;
export const OUTGOING_DUMMY_FLAG = 1;
function requireUnsignedInteger(value, maximum, name) {
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
        throw new Error(`${name} must be an unsigned integer no greater than ${maximum}`);
    }
}
function requireUnsignedBigInt(value, bits, name) {
    if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) {
        throw new Error(`${name} must fit in ${bits} unsigned bits`);
    }
}
function requireLength(name, bytes, length) {
    if (bytes.length !== length)
        throw new Error(`${name} must be ${length} bytes`);
}
export function encodeU8(val, out) {
    requireUnsignedInteger(val, 0xff, 'u8');
    out.push(val);
}
export function encodeU16Be(val, out) {
    requireUnsignedInteger(val, 0xffff, 'u16');
    out.push((val >> 8) & 0xff);
    out.push(val & 0xff);
}
export function encodeU32Be(val, out) {
    requireUnsignedInteger(val, 0xffff_ffff, 'u32');
    out.push((val >> 24) & 0xff);
    out.push((val >> 16) & 0xff);
    out.push((val >> 8) & 0xff);
    out.push(val & 0xff);
}
export function encodeU64Be(val, out) {
    requireUnsignedBigInt(val, 64, 'u64');
    for (let i = 7; i >= 0; i--) {
        out.push(Number((val >> BigInt(i * 8)) & 0xffn));
    }
}
export function encodeU128Be(val, out) {
    requireUnsignedBigInt(val, 128, 'u128');
    for (let i = 15; i >= 0; i--) {
        out.push(Number((val >> BigInt(i * 8)) & 0xffn));
    }
}
export function encodeDomain(label, out) {
    const bytes = utf8(label);
    if (bytes.length === 0 || bytes.length > 0xffff || !/^[\x20-\x7e]+$/.test(label)) {
        throw new Error('Domain label must be nonempty printable ASCII');
    }
    encodeU16Be(bytes.length, out);
    for (const b of bytes) {
        out.push(b);
    }
}
export function encodeBytesWithLen(bytes, out) {
    if (bytes.length > 0xffff_ffff)
        throw new Error('Byte string is too long');
    encodeU32Be(bytes.length, out);
    for (const b of bytes) {
        out.push(b);
    }
}
export function hashNetworkId(net) {
    return sha256Bytes(net);
}
export function hashRealmId(realm) {
    return sha256Bytes(realm);
}
export function computeContextHash(protocolVersion, networkId, realmId, poolId) {
    requireLength('Network ID', networkId, 32);
    requireLength('Realm ID', realmId, 32);
    requireLength('Pool ID', poolId, 32);
    const buf = [];
    encodeDomain(DOMAIN_CONTEXT, buf);
    encodeU16Be(protocolVersion, buf);
    for (const b of networkId)
        buf.push(b);
    for (const b of realmId)
        buf.push(b);
    for (const b of poolId)
        buf.push(b);
    return sha256Bytes(Uint8Array.from(buf));
}
export function computeContextField(contextHash) {
    requireLength('Context hash', contextHash, 32);
    return fieldId(DOMAIN_CONTEXT_FIELD, contextHash);
}
export function computeAddressContextTag(contextHash) {
    requireLength('Context hash', contextHash, 32);
    const buf = [];
    encodeDomain(DOMAIN_ADDRESS_CONTEXT, buf);
    for (const b of contextHash)
        buf.push(b);
    return sha256Bytes(Uint8Array.from(buf)).slice(0, 16);
}
export function deriveHpkeInfo(protocolVersion, contextHash) {
    requireLength('Context hash', contextHash, 32);
    const buf = [];
    encodeDomain(DOMAIN_HPKE_INFO, buf);
    encodeU16Be(protocolVersion, buf);
    for (const b of contextHash)
        buf.push(b);
    return Uint8Array.from(buf);
}
export function deriveHpkeAad(contextHash, cm, actionNonce, outputIndex) {
    requireLength('Context hash', contextHash, 32);
    requireLength('Commitment', cm, 32);
    requireLength('Action nonce', actionNonce, 32);
    if (outputIndex !== 0 && outputIndex !== 1 && outputIndex !== 2) {
        throw new Error('Invalid output index');
    }
    const buf = [];
    encodeDomain(DOMAIN_HPKE_AAD, buf);
    for (const b of contextHash)
        buf.push(b);
    for (const b of cm)
        buf.push(b);
    for (const b of actionNonce)
        buf.push(b);
    encodeU8(outputIndex, buf);
    return Uint8Array.from(buf);
}
function validateOutgoingPlaintext(plaintext) {
    if (plaintext.protocolVersion !== 2)
        throw new Error('Unsupported outgoing plaintext version');
    if (plaintext.flags !== 0 && plaintext.flags !== OUTGOING_DUMMY_FLAG) {
        throw new Error('Unsupported outgoing plaintext flags');
    }
    const dummy = plaintext.flags === OUTGOING_DUMMY_FLAG;
    if (dummy ? plaintext.value !== 0n : plaintext.value < 1n || plaintext.value > (1n << 63n) - 1n) {
        throw new Error('Invalid outgoing value');
    }
    requireLength('Outgoing diversifier', plaintext.diversifier, 4);
    requireLength('Outgoing owner commitment', plaintext.ownerCommitment, 32);
    requireLength('Outgoing recipient HPKE key', plaintext.recipientHpkePublicKey, 32);
    requireLength('Outgoing memo', plaintext.memo, 32);
    requireUnsignedInteger(plaintext.assetIndex, 0xffff_ffff, 'Outgoing asset index');
    requireLength('Outgoing reserved field', plaintext.reserved, 11);
    if (!isCanonicalField(plaintext.ownerCommitment) || plaintext.ownerCommitment.every(byte => byte === 0)) {
        throw new Error('Invalid outgoing owner commitment');
    }
    if (plaintext.recipientHpkePublicKey.every(byte => byte === 0)) {
        throw new Error('Invalid outgoing recipient HPKE key');
    }
    if (!Number.isInteger(plaintext.memoLength) || plaintext.memoLength < 0 || plaintext.memoLength > 32) {
        throw new Error('Invalid outgoing memo length');
    }
    if (plaintext.memo.slice(plaintext.memoLength).some(byte => byte !== 0)) {
        throw new Error('Outgoing memo tail must be zero');
    }
    if (dummy && plaintext.memoLength !== 0)
        throw new Error('Dummy outgoing memo must be empty');
    if (plaintext.reserved.some(byte => byte !== 0))
        throw new Error('Outgoing reserved bytes must be zero');
}
export function encodeOutgoingPlaintext(plaintext) {
    validateOutgoingPlaintext(plaintext);
    const output = new Uint8Array(OUTGOING_PLAINTEXT_BYTES);
    output[0] = (plaintext.protocolVersion >>> 8) & 0xff;
    output[1] = plaintext.protocolVersion & 0xff;
    output[2] = (plaintext.flags >>> 8) & 0xff;
    output[3] = plaintext.flags & 0xff;
    for (let index = 7; index >= 0; index -= 1) {
        output[4 + (7 - index)] = Number((plaintext.value >> BigInt(index * 8)) & 0xffn);
    }
    output.set(plaintext.diversifier, 12);
    output.set(plaintext.ownerCommitment, 16);
    output.set(plaintext.recipientHpkePublicKey, 48);
    output[80] = plaintext.memoLength;
    output.set(plaintext.memo, 81);
    output[113] = (plaintext.assetIndex >>> 24) & 0xff;
    output[114] = (plaintext.assetIndex >>> 16) & 0xff;
    output[115] = (plaintext.assetIndex >>> 8) & 0xff;
    output[116] = plaintext.assetIndex & 0xff;
    output.set(plaintext.reserved, 117);
    return output;
}
export function decodeOutgoingPlaintext(bytes) {
    requireLength('Outgoing plaintext', bytes, OUTGOING_PLAINTEXT_BYTES);
    let value = 0n;
    for (let index = 4; index < 12; index += 1)
        value = (value << 8n) | BigInt(bytes[index]);
    const plaintext = {
        protocolVersion: (bytes[0] << 8) | bytes[1],
        flags: (bytes[2] << 8) | bytes[3],
        value,
        diversifier: bytes.slice(12, 16),
        ownerCommitment: bytes.slice(16, 48),
        recipientHpkePublicKey: bytes.slice(48, 80),
        memoLength: bytes[80],
        memo: bytes.slice(81, 113),
        assetIndex: (bytes[113] * 0x100_0000
            + bytes[114] * 0x1_0000
            + bytes[115] * 0x100
            + bytes[116]),
        reserved: bytes.slice(117, 128),
    };
    validateOutgoingPlaintext(plaintext);
    return plaintext;
}
export function deriveOutgoingAad(deploymentBindingHash, contextHash, assetField, cm, actionNonce, outputIndex) {
    requireLength('Deployment binding hash', deploymentBindingHash, 32);
    requireLength('Context hash', contextHash, 32);
    requireLength('Asset field', assetField, 32);
    requireLength('Commitment', cm, 32);
    requireLength('Action nonce', actionNonce, 32);
    if (outputIndex !== 0 && outputIndex !== 1 && outputIndex !== 2) {
        throw new Error('Invalid output index');
    }
    const output = [];
    encodeDomain(DOMAIN_OUTGOING_AAD, output);
    output.push(...deploymentBindingHash, ...contextHash, ...assetField, ...cm, ...actionNonce, outputIndex);
    return Uint8Array.from(output);
}
