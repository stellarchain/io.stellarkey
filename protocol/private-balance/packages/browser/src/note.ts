import { isCanonicalField, bigintTo32Bytes } from './field.js';
import { p2 } from './poseidon2.js';

export const NOTE_PLAINTEXT_BYTES = 128;
export const MEMO_BYTES = 32;
export const MAX_NOTE_VALUE = (1n << 63n) - 1n;
export const DOMAIN_NOTE = 'SKSB_NOTE_COMMITMENT_V1';
export const DOMAIN_NULLIFIER = 'SKSB_NULLIFIER_V1';

export interface NotePlaintext {
  protocolVersion: number;
  flags: number;
  value: bigint;
  diversifier: Uint8Array;
  ownerCommitment: Uint8Array;
  rho: Uint8Array;
  memoLength: number;
  memo: Uint8Array;
  reserved: Uint8Array;
}

function requireLength(name: string, bytes: Uint8Array, expected: number): void {
  if (bytes.length !== expected) throw new Error(`${name} must be ${expected} bytes`);
}

function validateNote(note: NotePlaintext): void {
  if (note.protocolVersion !== 1) throw new Error('Unsupported note protocol version');
  if (note.flags !== 0) throw new Error('Unsupported note flags');
  if (note.value < 1n || note.value > MAX_NOTE_VALUE) throw new Error('Invalid note value');
  requireLength('Address diversifier', note.diversifier, 4);
  requireLength('Owner commitment', note.ownerCommitment, 32);
  requireLength('Rho', note.rho, 32);
  requireLength('Memo', note.memo, MEMO_BYTES);
  requireLength('Reserved field', note.reserved, 15);
  if (!isCanonicalField(note.ownerCommitment) || note.ownerCommitment.every((byte) => byte === 0)) {
    throw new Error('Invalid owner commitment');
  }
  if (!isCanonicalField(note.rho) || note.rho.every((byte) => byte === 0)) {
    throw new Error('Invalid rho');
  }
  if (!Number.isInteger(note.memoLength) || note.memoLength < 0 || note.memoLength > MEMO_BYTES) {
    throw new Error('Invalid memo length');
  }
  if (note.memo.slice(note.memoLength).some((byte) => byte !== 0)) {
    throw new Error('Memo tail must be zero');
  }
  if (note.reserved.some((byte) => byte !== 0)) throw new Error('Reserved note bytes must be zero');
}

export function encodeNotePlaintext(note: NotePlaintext): Uint8Array {
  validateNote(note);
  const output = new Uint8Array(NOTE_PLAINTEXT_BYTES);
  output[0] = (note.protocolVersion >>> 8) & 0xff;
  output[1] = note.protocolVersion & 0xff;
  output[2] = (note.flags >>> 8) & 0xff;
  output[3] = note.flags & 0xff;
  for (let index = 7; index >= 0; index -= 1) {
    output[4 + (7 - index)] = Number((note.value >> BigInt(index * 8)) & 0xffn);
  }
  output.set(note.diversifier, 12);
  output.set(note.ownerCommitment, 16);
  output.set(note.rho, 48);
  output[80] = note.memoLength;
  output.set(note.memo, 81);
  output.set(note.reserved, 113);
  return output;
}

export function decodeNotePlaintext(
  bytes: Uint8Array,
): NotePlaintext {
  if (bytes.length !== NOTE_PLAINTEXT_BYTES) throw new Error('Invalid note plaintext length');

  let value = 0n;
  for (let index = 4; index < 12; index += 1) value = (value << 8n) | BigInt(bytes[index]);
  const note: NotePlaintext = {
    protocolVersion: (bytes[0] << 8) | bytes[1],
    flags: (bytes[2] << 8) | bytes[3],
    value,
    diversifier: bytes.slice(12, 16),
    ownerCommitment: bytes.slice(16, 48),
    rho: bytes.slice(48, 80),
    memoLength: bytes[80],
    memo: bytes.slice(81, 113),
    reserved: bytes.slice(113, 128),
  };
  validateNote(note);
  return note;
}

export function computeCommitment(
  contextField: Uint8Array,
  assetField: Uint8Array,
  ownerCommitment: Uint8Array,
  value: bigint,
  rho: Uint8Array,
): Uint8Array {
  if (value < 1n || value > MAX_NOTE_VALUE) throw new Error('Invalid commitment value');
  return p2(DOMAIN_NOTE, [contextField, assetField, ownerCommitment, bigintTo32Bytes(value), rho]);
}

export function computeNullifier(
  contextField: Uint8Array,
  nk: Uint8Array,
  rho: Uint8Array,
  leafIndex: bigint,
  cm: Uint8Array,
): Uint8Array {
  if (leafIndex < 0n || leafIndex > 0xffff_ffffn) throw new Error('Invalid leaf index');
  return p2(DOMAIN_NULLIFIER, [contextField, nk, rho, bigintTo32Bytes(leafIndex), cm]);
}
