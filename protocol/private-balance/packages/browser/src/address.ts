import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { decodeBech32m, encodeBech32m, groupBech32m } from './bech32m.js';
import { isCanonicalField } from './field.js';
import { equalBytes } from './hash.js';

export const PRIVATE_ADDRESS_PAYLOAD_BYTES = 68;
export const ADDRESS_DIVERSIFIER_BYTES = 4;
export const PRIVATE_ADDRESS_ASCII_BYTES = 119;

export type PrivateAddressPrefix = 'tks' | 'sks';

export interface PrivateAddress {
  diversifier: Uint8Array;
  ownerCommitment: Uint8Array;
  hpkePublicKey: Uint8Array;
}

function validatePrefix(prefix: string): asserts prefix is PrivateAddressPrefix {
  if (prefix !== 'tks' && prefix !== 'sks') throw new Error('Unsupported private address prefix');
}

function requireLength(name: string, bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) throw new Error(`${name} must be ${length} bytes`);
}

function validateAddressFields(address: PrivateAddress): void {
  requireLength('Address diversifier', address.diversifier, ADDRESS_DIVERSIFIER_BYTES);
  requireLength('Owner commitment', address.ownerCommitment, 32);
  requireLength('HPKE public key', address.hpkePublicKey, 32);
  if (!isCanonicalField(address.ownerCommitment) || address.ownerCommitment.every(byte => byte === 0)) {
    throw new Error('Invalid owner commitment');
  }
  if (address.hpkePublicKey.every(byte => byte === 0)) throw new Error('Invalid HPKE public key');
}

export function encodePrivateAddress(address: PrivateAddress, prefix: string): string {
  validatePrefix(prefix);
  validateAddressFields(address);
  const payload = new Uint8Array(PRIVATE_ADDRESS_PAYLOAD_BYTES);
  payload.set(address.diversifier, 0);
  payload.set(address.ownerCommitment, 4);
  payload.set(address.hpkePublicKey, 36);
  const encoded = encodeBech32m(prefix, payload);
  if (encoded.length !== PRIVATE_ADDRESS_ASCII_BYTES) throw new Error('Unexpected private address length');
  return encoded;
}

export async function decodePrivateAddress(
  encoded: string,
  expectedPrefix: string,
): Promise<PrivateAddress> {
  validatePrefix(expectedPrefix);
  if (encoded.length !== PRIVATE_ADDRESS_ASCII_BYTES || encoded !== encoded.toLowerCase() || /\s/u.test(encoded)) {
    throw new Error('Invalid private address spelling');
  }
  let payload: Uint8Array;
  try {
    payload = decodeBech32m(encoded, expectedPrefix, PRIVATE_ADDRESS_PAYLOAD_BYTES);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message.replace('Bech32m', 'private address') : 'Invalid private address', { cause: error });
  }
  const address: PrivateAddress = {
    diversifier: payload.slice(0, 4),
    ownerCommitment: payload.slice(4, 36),
    hpkePublicKey: payload.slice(36, 68),
  };
  validateAddressFields(address);
  try {
    const kem = new DhkemX25519HkdfSha256();
    const imported = await kem.deserializePublicKey(address.hpkePublicKey);
    const roundTrip = new Uint8Array(await kem.serializePublicKey(imported));
    if (!equalBytes(roundTrip, address.hpkePublicKey)) throw new Error('Aliased HPKE public key');
    const encapsulated = await kem.encap({ recipientPublicKey: imported });
    new Uint8Array(encapsulated.sharedSecret).fill(0);
  } catch {
    throw new Error('Invalid HPKE public key');
  }
  return address;
}

export function groupPrivateAddress(address: string): string {
  return groupBech32m(address);
}
