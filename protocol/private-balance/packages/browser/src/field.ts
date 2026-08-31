import { concatBytes, sha256Bytes, utf8 } from './hash.js';

// BN254 Fr scalar field modulus:
// 21888242871839275222246405745257275088548364400416034343698204186575808495617
export const BN254_FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const BN254_FR_MODULUS_BYTES = new Uint8Array([
  0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
  0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
]);

export function isCanonicalField(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  for (let i = 0; i < 32; i++) {
    if (bytes[i] < BN254_FR_MODULUS_BYTES[i]) return true;
    if (bytes[i] > BN254_FR_MODULUS_BYTES[i]) return false;
  }
  return false;
}

export function bytesToField(bytes: Uint8Array): Uint8Array {
  let val = 0n;
  for (const b of bytes) {
    val = (val << 8n) | BigInt(b);
  }
  val = val % BN254_FR_MODULUS;
  return bigintTo32Bytes(val);
}

export function bigintTo32Bytes(n: bigint): Uint8Array {
  if (n < 0n || n >= 1n << 256n) throw new Error('Integer does not fit in 32 bytes');
  const out = new Uint8Array(32);
  let cur = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(cur & 0xffn);
    cur >>= 8n;
  }
  return out;
}

export function bytesToBigint(bytes: Uint8Array): bigint {
  let val = 0n;
  for (const b of bytes) {
    val = (val << 8n) | BigInt(b);
  }
  return val;
}

export function fieldId(label: string, payload: Uint8Array): Uint8Array {
  if (!/^[\x20-\x7e]+$/.test(label)) throw new Error('Field domain must be nonempty ASCII');
  return bytesToField(sha256Bytes(concatBytes(utf8(label), Uint8Array.of(0), payload)));
}
