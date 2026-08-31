import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';

const textEncoder = new TextEncoder();

export function utf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function sha256Bytes(...chunks: Uint8Array[]): Uint8Array {
  const hash = sha256.create();
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest();
}

export function sha512Bytes(...chunks: Uint8Array[]): Uint8Array {
  const hash = sha512.create();
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest();
}

export function hmacSha512(key: Uint8Array, ...chunks: Uint8Array[]): Uint8Array {
  const mac = hmac.create(sha512, key);
  for (const chunk of chunks) mac.update(chunk);
  return mac.digest();
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
