import { x25519 } from '@noble/curves/ed25519.js';
let nativeX25519Available;
function base64Url(bytes) {
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
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
async function deriveNative(privateKey, publicKey) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        throw new Error('WebCrypto is unavailable');
    const ownPublicKey = x25519.getPublicKey(privateKey);
    const privateCryptoKey = await subtle.importKey('jwk', {
        kty: 'OKP',
        crv: 'X25519',
        d: base64Url(privateKey),
        x: base64Url(ownPublicKey),
        ext: true,
        key_ops: ['deriveBits'],
    }, { name: 'X25519' }, false, ['deriveBits']);
    const publicCryptoKey = await subtle.importKey('raw', ownedBuffer(publicKey), { name: 'X25519' }, false, []);
    const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: publicCryptoKey }, privateCryptoKey, 256));
    if (isAllZero(shared))
        throw new Error('Invalid low-order X25519 public key');
    return shared;
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
