import { x25519 } from '@noble/curves/ed25519.js';
let nativeX25519Available;
const nativePrivateKeys = new WeakMap();
let nativeBasePoint;
const X25519_PKCS8_PREFIX = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);
const X25519_BASE_POINT = Uint8Array.from([9, ...new Uint8Array(31)]);
function isAllZero(bytes) {
    let combined = 0;
    for (const byte of bytes)
        combined |= byte;
    return combined === 0;
}
function assertKey(key, label) {
    if (key.length !== 32)
        throw new Error(`${label} must be 32 bytes`);
}
function ownedBuffer(bytes) {
    return Uint8Array.from(bytes).buffer;
}
export function encodeX25519PrivateKeyPkcs8(privateKey) {
    assertKey(privateKey, 'X25519 private key');
    const encoded = new Uint8Array(X25519_PKCS8_PREFIX.length + privateKey.length);
    encoded.set(X25519_PKCS8_PREFIX);
    encoded.set(privateKey, X25519_PKCS8_PREFIX.length);
    return encoded;
}
async function importNativePublicKey(publicKey) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        throw new Error('WebCrypto is unavailable');
    return subtle.importKey('raw', ownedBuffer(publicKey), { name: 'X25519' }, false, []);
}
function getNativePrivateKey(handle) {
    const key = nativePrivateKeys.get(handle);
    if (!key)
        throw new Error('Invalid X25519 private-key handle');
    return key;
}
export async function importX25519PrivateKey(privateKey) {
    assertKey(privateKey, 'X25519 private key');
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        throw new Error('WebCrypto is unavailable');
    const encodedPrivateKey = encodeX25519PrivateKeyPkcs8(privateKey);
    const encodedPrivateKeyBuffer = ownedBuffer(encodedPrivateKey);
    try {
        const cryptoKey = await subtle.importKey('pkcs8', encodedPrivateKeyBuffer, { name: 'X25519' }, false, ['deriveBits']);
        const handle = Object.freeze({});
        nativePrivateKeys.set(handle, cryptoKey);
        return handle;
    }
    catch (error) {
        throw new Error('Invalid X25519 private key', { cause: error });
    }
    finally {
        encodedPrivateKey.fill(0);
        new Uint8Array(encodedPrivateKeyBuffer).fill(0);
    }
}
export async function deriveX25519SharedSecretFromHandle(handle, publicKey) {
    assertKey(publicKey, 'X25519 public key');
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        throw new Error('WebCrypto is unavailable');
    try {
        const publicCryptoKey = await importNativePublicKey(publicKey);
        const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: publicCryptoKey }, getNativePrivateKey(handle), 256));
        if (isAllZero(shared))
            throw new Error('Invalid low-order X25519 public key');
        return shared;
    }
    catch (error) {
        throw new Error('Invalid X25519 key agreement', { cause: error });
    }
}
export async function deriveX25519PublicKeyFromHandle(handle) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        throw new Error('WebCrypto is unavailable');
    nativeBasePoint ??= importNativePublicKey(X25519_BASE_POINT);
    try {
        return new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: await nativeBasePoint }, getNativePrivateKey(handle), 256));
    }
    catch (error) {
        throw new Error('Invalid X25519 private key', { cause: error });
    }
}
async function deriveNative(privateKey, publicKey) {
    const handle = await importX25519PrivateKey(privateKey);
    return deriveX25519SharedSecretFromHandle(handle, publicKey);
}
function derivePortable(privateKey, publicKey) {
    try {
        const shared = x25519.getSharedSecret(privateKey, publicKey);
        if (isAllZero(shared))
            throw new Error('Invalid low-order X25519 public key');
        return shared;
    }
    catch (error) {
        throw new Error('Invalid low-order X25519 public key', { cause: error });
    }
}
export function deriveX25519PublicKey(privateKey) {
    assertKey(privateKey, 'X25519 private key');
    return x25519.getPublicKey(privateKey);
}
export async function deriveX25519SharedSecret(privateKey, publicKey, implementation = 'auto') {
    assertKey(privateKey, 'X25519 private key');
    assertKey(publicKey, 'X25519 public key');
    if (implementation === 'portable')
        return derivePortable(privateKey, publicKey);
    if (implementation === 'native')
        return deriveNative(privateKey, publicKey);
    if (nativeX25519Available !== false) {
        try {
            const shared = await deriveNative(privateKey, publicKey);
            nativeX25519Available = true;
            return shared;
        }
        catch {
            nativeX25519Available = false;
        }
    }
    return derivePortable(privateKey, publicKey);
}
