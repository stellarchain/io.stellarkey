const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHARSET_INDEX = new Map(Array.from(CHARSET, (character, index) => [character, index]));
const BECH32M_CONSTANT = 0x2bc830a3;
function polymod(values) {
    let checksum = 1;
    for (const value of values) {
        const top = checksum >>> 25;
        checksum = ((checksum & 0x1ffffff) << 5) ^ value;
        if (top & 1)
            checksum ^= 0x3b6a57b2;
        if (top & 2)
            checksum ^= 0x26508e6d;
        if (top & 4)
            checksum ^= 0x1ea119fa;
        if (top & 8)
            checksum ^= 0x3d4233dd;
        if (top & 16)
            checksum ^= 0x2a1462b3;
    }
    return checksum >>> 0;
}
function expandHrp(hrp) {
    return [
        ...Array.from(hrp, character => character.charCodeAt(0) >>> 5),
        0,
        ...Array.from(hrp, character => character.charCodeAt(0) & 31),
    ];
}
function createChecksum(hrp, words) {
    const value = polymod([...expandHrp(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONSTANT;
    return Array.from({ length: 6 }, (_, index) => (value >>> (5 * (5 - index))) & 31);
}
function convertBits(values, fromBits, toBits, pad) {
    let accumulator = 0;
    let bits = 0;
    const output = [];
    const maximum = (1 << toBits) - 1;
    const maximumAccumulator = (1 << (fromBits + toBits - 1)) - 1;
    for (const value of values) {
        if (value < 0 || value >>> fromBits !== 0)
            throw new Error('Invalid Bech32m data value');
        accumulator = ((accumulator << fromBits) | value) & maximumAccumulator;
        bits += fromBits;
        while (bits >= toBits) {
            bits -= toBits;
            output.push((accumulator >>> bits) & maximum);
        }
    }
    if (pad) {
        if (bits > 0)
            output.push((accumulator << (toBits - bits)) & maximum);
    }
    else if (bits >= fromBits || ((accumulator << (toBits - bits)) & maximum) !== 0) {
        throw new Error('Noncanonical Bech32m padding');
    }
    return output;
}
export function encodeBech32m(hrp, payload) {
    const words = convertBits(payload, 8, 5, true);
    return `${hrp}1${[...words, ...createChecksum(hrp, words)]
        .map(word => CHARSET[word])
        .join('')}`;
}
export function decodeBech32m(encoded, expectedHrp, expectedPayloadBytes) {
    if (encoded !== encoded.toLowerCase() || /\s/u.test(encoded)) {
        throw new Error('Invalid Bech32m spelling');
    }
    const separator = encoded.lastIndexOf('1');
    if (separator !== expectedHrp.length || encoded.slice(0, separator) !== expectedHrp) {
        throw new Error('Invalid Bech32m prefix');
    }
    const characters = encoded.slice(separator + 1);
    const words = Array.from(characters, character => {
        const value = CHARSET_INDEX.get(character);
        if (value === undefined)
            throw new Error('Invalid Bech32m character');
        return value;
    });
    if (words.length < 7 || polymod([...expandHrp(expectedHrp), ...words]) !== BECH32M_CONSTANT) {
        throw new Error('Bech32m checksum mismatch');
    }
    const payload = Uint8Array.from(convertBits(words.slice(0, -6), 5, 8, false));
    if (payload.length !== expectedPayloadBytes)
        throw new Error('Invalid Bech32m payload length');
    return payload;
}
export function groupBech32m(encoded) {
    const separator = encoded.indexOf('1') + 1;
    return `${encoded.slice(0, separator)} ${encoded.slice(separator).match(/.{1,4}/gu)?.join(' ') ?? ''}`;
}
