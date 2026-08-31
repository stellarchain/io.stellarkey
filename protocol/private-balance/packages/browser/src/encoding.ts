import { fieldId } from './field.js';
import { sha256Bytes, utf8 } from './hash.js';

export const DOMAIN_CONTEXT = 'SKSB_CONTEXT_V1';
export const DOMAIN_CONTEXT_FIELD = 'SKSB_CONTEXT_FIELD_V1';
export const DOMAIN_ADDRESS_CONTEXT = 'SKSB_ADDRESS_CONTEXT_V1';
export const DOMAIN_HPKE_INFO = 'SKSB_HPKE_INFO_V1';
export const DOMAIN_HPKE_AAD = 'SKSB_HPKE_AAD_V1';

function requireUnsignedInteger(value: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an unsigned integer no greater than ${maximum}`);
  }
}

function requireUnsignedBigInt(value: bigint, bits: number, name: string): void {
  if (value < 0n || value >= 1n << BigInt(bits)) {
    throw new Error(`${name} must fit in ${bits} unsigned bits`);
  }
}

function requireLength(name: string, bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) throw new Error(`${name} must be ${length} bytes`);
}

export function encodeU8(val: number, out: number[]): void {
  requireUnsignedInteger(val, 0xff, 'u8');
  out.push(val);
}

export function encodeU16Be(val: number, out: number[]): void {
  requireUnsignedInteger(val, 0xffff, 'u16');
  out.push((val >> 8) & 0xff);
  out.push(val & 0xff);
}

export function encodeU32Be(val: number, out: number[]): void {
  requireUnsignedInteger(val, 0xffff_ffff, 'u32');
  out.push((val >> 24) & 0xff);
  out.push((val >> 16) & 0xff);
  out.push((val >> 8) & 0xff);
  out.push(val & 0xff);
}

export function encodeU64Be(val: bigint, out: number[]): void {
  requireUnsignedBigInt(val, 64, 'u64');
  for (let i = 7; i >= 0; i--) {
    out.push(Number((val >> BigInt(i * 8)) & 0xffn));
  }
}

export function encodeU128Be(val: bigint, out: number[]): void {
  requireUnsignedBigInt(val, 128, 'u128');
  for (let i = 15; i >= 0; i--) {
    out.push(Number((val >> BigInt(i * 8)) & 0xffn));
  }
}

export function encodeDomain(label: string, out: number[]): void {
  const bytes = utf8(label);
  if (bytes.length === 0 || bytes.length > 0xffff || !/^[\x20-\x7e]+$/.test(label)) {
    throw new Error('Domain label must be nonempty printable ASCII');
  }
  encodeU16Be(bytes.length, out);
  for (const b of bytes) {
    out.push(b);
  }
}

export function encodeBytesWithLen(bytes: Uint8Array, out: number[]): void {
  if (bytes.length > 0xffff_ffff) throw new Error('Byte string is too long');
  encodeU32Be(bytes.length, out);
  for (const b of bytes) {
    out.push(b);
  }
}

export function hashNetworkId(net: Uint8Array): Uint8Array {
  return sha256Bytes(net);
}

export function hashRealmId(realm: Uint8Array): Uint8Array {
  return sha256Bytes(realm);
}

export function computeContextHash(
  protocolVersion: number,
  networkId: Uint8Array,
  realmId: Uint8Array,
  poolId: Uint8Array,
): Uint8Array {
  requireLength('Network ID', networkId, 32);
  requireLength('Realm ID', realmId, 32);
  requireLength('Pool ID', poolId, 32);
  const buf: number[] = [];
  encodeDomain(DOMAIN_CONTEXT, buf);
  encodeU16Be(protocolVersion, buf);
  for (const b of networkId) buf.push(b);
  for (const b of realmId) buf.push(b);
  for (const b of poolId) buf.push(b);

  return sha256Bytes(Uint8Array.from(buf));
}

export function computeContextField(contextHash: Uint8Array): Uint8Array {
  requireLength('Context hash', contextHash, 32);
  return fieldId(DOMAIN_CONTEXT_FIELD, contextHash);
}

export function computeAddressContextTag(contextHash: Uint8Array): Uint8Array {
  requireLength('Context hash', contextHash, 32);
  const buf: number[] = [];
  encodeDomain(DOMAIN_ADDRESS_CONTEXT, buf);
  for (const b of contextHash) buf.push(b);
  return sha256Bytes(Uint8Array.from(buf)).slice(0, 16);
}

export function deriveHpkeInfo(protocolVersion: number, contextHash: Uint8Array): Uint8Array {
  requireLength('Context hash', contextHash, 32);
  const buf: number[] = [];
  encodeDomain(DOMAIN_HPKE_INFO, buf);
  encodeU16Be(protocolVersion, buf);
  for (const b of contextHash) buf.push(b);
  return Uint8Array.from(buf);
}

export function deriveHpkeAad(
  contextHash: Uint8Array,
  cm: Uint8Array,
  actionNonce: Uint8Array,
  outputIndex: number
): Uint8Array {
  requireLength('Context hash', contextHash, 32);
  requireLength('Commitment', cm, 32);
  requireLength('Action nonce', actionNonce, 32);
  if (outputIndex !== 0 && outputIndex !== 1) throw new Error('Invalid output index');
  const buf: number[] = [];
  encodeDomain(DOMAIN_HPKE_AAD, buf);
  for (const b of contextHash) buf.push(b);
  for (const b of cm) buf.push(b);
  for (const b of actionNonce) buf.push(b);
  encodeU8(outputIndex, buf);
  return Uint8Array.from(buf);
}
