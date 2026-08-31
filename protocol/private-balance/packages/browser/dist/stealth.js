import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { decodeBech32m, encodeBech32m, groupBech32m } from './bech32m.js';
import { concatBytes, hmacSha512, sha512Bytes, utf8 } from './hash.js';
import { deriveX25519SharedSecret, } from './x25519.js';
export const STEALTH_META_ADDRESS_PAYLOAD_BYTES = 64;
export const STEALTH_META_ADDRESS_ASCII_BYTES = 113;
const DOMAIN_META_ROOT = utf8('SK_STEALTH_META_ROOT_V1');
const DOMAIN_STEALTH_ROOT_KEY = utf8('SK_STEALTH_ROOT_KEY_V1');
const DOMAIN_SCAN_KEY = utf8('SK_STEALTH_SCAN_KEY_V1');
const DOMAIN_SPEND_KEY = utf8('SK_STEALTH_SPEND_KEY_V1');
const DOMAIN_NONCE_KEY = utf8('SK_STEALTH_NONCE_KEY_V1');
const DOMAIN_TWEAK = utf8('SK_STEALTH_TWEAK_V1');
const DOMAIN_CHILD_NONCE = utf8('SK_STEALTH_CHILD_NONCE_V1');
const DOMAIN_SIGNATURE_NONCE = utf8('SK_STEALTH_SIGNATURE_NONCE_V1');
const SCALAR_ORDER = ed25519.Point.CURVE().n;
function networkPrefix(network) {
    return network === 'testnet' ? 'tsm' : 'ssm';
}
function networkBytes(network) {
    if (network !== 'testnet' && network !== 'mainnet')
        throw new Error('Unsupported stealth network');
    return utf8(network);
}
function assertBytes(value, length, label) {
    if (!(value instanceof Uint8Array) || value.length !== length) {
        throw new Error(`${label} must be ${length} bytes`);
    }
}
export function deriveStealthRootKey(privacySessionRoot) {
    assertBytes(privacySessionRoot, 64, 'Privacy session root');
    const expanded = hmacSha512(privacySessionRoot, DOMAIN_STEALTH_ROOT_KEY);
    try {
        return expanded.slice(0, 32);
    }
    finally {
        expanded.fill(0);
    }
}
function bytesToBigIntLe(bytes) {
    let value = 0n;
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
        value = (value << 8n) | BigInt(bytes[index]);
    }
    return value;
}
function bigIntToBytesLe(value, length = 32) {
    const output = new Uint8Array(length);
    let remaining = value;
    for (let index = 0; index < length; index += 1) {
        output[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    if (remaining !== 0n)
        throw new Error('Scalar does not fit in the requested encoding');
    return output;
}
function nonzeroScalar(...chunks) {
    const scalar = bytesToBigIntLe(sha512Bytes(...chunks)) % SCALAR_ORDER;
    if (scalar === 0n)
        throw new Error('Derived an invalid zero scalar; retry with fresh randomness');
    return scalar;
}
function validateSpendPoint(publicKey) {
    assertBytes(publicKey, 32, 'Stealth spend public key');
    try {
        const point = ed25519.Point.fromBytes(publicKey, false);
        point.assertValidity();
        if (point.is0() || point.isSmallOrder() || !point.isTorsionFree())
            throw new Error('Invalid subgroup');
    }
    catch (error) {
        throw new Error('Invalid stealth spend public key', { cause: error });
    }
}
function validateScanPoint(publicKey) {
    assertBytes(publicKey, 32, 'Stealth scan public key');
    try {
        x25519.getSharedSecret(new Uint8Array(32).fill(7), publicKey);
    }
    catch (error) {
        throw new Error('Invalid stealth scan public key', { cause: error });
    }
}
function deriveTweak(sharedSecret, ephemeralPublicKey, address, network) {
    return nonzeroScalar(DOMAIN_TWEAK, networkBytes(network), ephemeralPublicKey, sharedSecret, address.scanPublicKey, address.spendPublicKey);
}
function deriveOneTimePublicKey(spendPublicKey, tweak) {
    const point = ed25519.Point.fromBytes(spendPublicKey, false)
        .add(ed25519.Point.BASE.multiply(tweak));
    if (point.is0())
        throw new Error('Derived an invalid zero one-time account; retry with fresh randomness');
    return point.toBytes();
}
export function deriveStealthMetaKeys(rootKey, network) {
    assertBytes(rootKey, 32, 'Stealth root key');
    const networkContext = networkBytes(network);
    const salt = sha512Bytes(DOMAIN_META_ROOT, networkContext);
    const scanPrivateKey = hkdf(sha512, rootKey, salt, DOMAIN_SCAN_KEY, 32);
    const spendMaterial = hkdf(sha512, rootKey, salt, DOMAIN_SPEND_KEY, 64);
    const nonceKey = hkdf(sha512, rootKey, salt, DOMAIN_NONCE_KEY, 32);
    const spendScalar = bytesToBigIntLe(spendMaterial) % SCALAR_ORDER;
    spendMaterial.fill(0);
    if (spendScalar === 0n)
        throw new Error('Derived an invalid zero spend scalar');
    return {
        scanPrivateKey,
        scanPublicKey: x25519.getPublicKey(scanPrivateKey),
        spendScalar,
        spendPublicKey: ed25519.Point.BASE.multiply(spendScalar).toBytes(),
        nonceKey,
        network,
    };
}
export function encodeStealthMetaAddress(address, network) {
    validateScanPoint(address.scanPublicKey);
    validateSpendPoint(address.spendPublicKey);
    const encoded = encodeBech32m(networkPrefix(network), concatBytes(address.scanPublicKey, address.spendPublicKey));
    if (encoded.length !== STEALTH_META_ADDRESS_ASCII_BYTES) {
        throw new Error('Unexpected stealth meta-address length');
    }
    return encoded;
}
export async function decodeStealthMetaAddress(encoded, network) {
    if (encoded.length !== STEALTH_META_ADDRESS_ASCII_BYTES) {
        throw new Error('Invalid stealth meta-address spelling');
    }
    let payload;
    try {
        payload = decodeBech32m(encoded, networkPrefix(network), STEALTH_META_ADDRESS_PAYLOAD_BYTES);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid stealth meta-address';
        if (/prefix/u.test(message))
            throw new Error('Stealth meta-address network prefix mismatch', { cause: error });
        throw new Error(message.replace('Bech32m', 'stealth meta-address'), { cause: error });
    }
    const address = {
        scanPublicKey: payload.slice(0, 32),
        spendPublicKey: payload.slice(32, 64),
    };
    validateScanPoint(address.scanPublicKey);
    validateSpendPoint(address.spendPublicKey);
    return address;
}
export function groupStealthMetaAddress(address) {
    return groupBech32m(address);
}
export async function deriveStealthRecipient(address, ephemeralPrivateKey, network, implementation = 'auto') {
    validateScanPoint(address.scanPublicKey);
    validateSpendPoint(address.spendPublicKey);
    assertBytes(ephemeralPrivateKey, 32, 'Stealth ephemeral private key');
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
    const sharedSecret = await deriveX25519SharedSecret(ephemeralPrivateKey, address.scanPublicKey, implementation);
    try {
        const tweak = deriveTweak(sharedSecret, ephemeralPublicKey, address, network);
        return {
            publicKey: deriveOneTimePublicKey(address.spendPublicKey, tweak),
            ephemeralPublicKey,
        };
    }
    finally {
        sharedSecret.fill(0);
    }
}
export async function deriveStealthRecipientKey(keys, ephemeralPublicKey, network, implementation = 'auto') {
    if (keys.network !== network)
        throw new Error('Stealth key network mismatch');
    assertBytes(ephemeralPublicKey, 32, 'Stealth ephemeral public key');
    const sharedSecret = await deriveX25519SharedSecret(keys.scanPrivateKey, ephemeralPublicKey, implementation);
    try {
        const tweak = deriveTweak(sharedSecret, ephemeralPublicKey, keys, network);
        const spendScalar = (keys.spendScalar + tweak) % SCALAR_ORDER;
        if (spendScalar === 0n)
            throw new Error('Derived an invalid zero one-time spend scalar');
        const publicKey = ed25519.Point.BASE.multiply(spendScalar).toBytes();
        const nonceKey = hmacSha512(keys.nonceKey, DOMAIN_CHILD_NONCE, networkBytes(network), ephemeralPublicKey, publicKey).slice(0, 32);
        return { publicKey, spendScalar, nonceKey };
    }
    finally {
        sharedSecret.fill(0);
    }
}
export function signWithEd25519Scalar(spendScalar, nonceKey, message) {
    if (spendScalar <= 0n || spendScalar >= SCALAR_ORDER)
        throw new Error('Invalid Ed25519 spend scalar');
    assertBytes(nonceKey, 32, 'Ed25519 nonce key');
    if (!(message instanceof Uint8Array))
        throw new Error('Ed25519 message must be bytes');
    const publicKey = ed25519.Point.BASE.multiply(spendScalar).toBytes();
    const nonceDigest = hmacSha512(nonceKey, DOMAIN_SIGNATURE_NONCE, publicKey, message);
    const nonce = bytesToBigIntLe(nonceDigest) % SCALAR_ORDER;
    nonceDigest.fill(0);
    if (nonce === 0n)
        throw new Error('Derived an invalid zero signing nonce');
    const encodedR = ed25519.Point.BASE.multiply(nonce).toBytes();
    const challenge = bytesToBigIntLe(sha512Bytes(encodedR, publicKey, message)) % SCALAR_ORDER;
    const encodedS = bigIntToBytesLe((nonce + challenge * spendScalar) % SCALAR_ORDER);
    return concatBytes(encodedR, encodedS);
}
