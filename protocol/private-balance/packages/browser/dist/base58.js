const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_RADIX = 58n;
const BASE58_VALUES = new Map(Array.from(BASE58_ALPHABET, (character, index) => [character, BigInt(index)]));
export function encodeBase58(bytes) {
    if (!(bytes instanceof Uint8Array))
        throw new Error('Base58 input must be bytes');
    if (bytes.length === 0)
        return '';
    let leadingZeroes = 0;
    while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0)
        leadingZeroes += 1;
    let value = 0n;
    for (const byte of bytes)
        value = (value << 8n) | BigInt(byte);
    let encoded = '';
    while (value > 0n) {
        const digit = Number(value % BASE58_RADIX);
        encoded = BASE58_ALPHABET[digit] + encoded;
        value /= BASE58_RADIX;
    }
    return '1'.repeat(leadingZeroes) + encoded;
}
export function decodeBase58(encoded) {
    if (typeof encoded !== 'string' || encoded.length === 0) {
        throw new Error('Invalid Base58 spelling');
    }
    let leadingZeroes = 0;
    while (leadingZeroes < encoded.length && encoded[leadingZeroes] === '1')
        leadingZeroes += 1;
    let value = 0n;
    for (const character of encoded) {
        const digit = BASE58_VALUES.get(character);
        if (digit === undefined)
            throw new Error('Invalid Base58 character');
        value = value * BASE58_RADIX + digit;
    }
    const decoded = [];
    while (value > 0n) {
        decoded.push(Number(value & 0xffn));
        value >>= 8n;
    }
    decoded.reverse();
    const bytes = new Uint8Array(leadingZeroes + decoded.length);
    bytes.set(decoded, leadingZeroes);
    if (encodeBase58(bytes) !== encoded)
        throw new Error('Noncanonical Base58 spelling');
    return bytes;
}
