import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { decodeBase58, encodeBase58 } from './base58.js';
import { isCanonicalField } from './field.js';
import { concatBytes, equalBytes, sha256Bytes, utf8 } from './hash.js';

export const ADDRESS_DIVERSIFIER_BYTES = 4;
export const PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES = 16;
export const PRIVATE_ADDRESS_PAYLOAD_BYTES = 84;
export const PRIVATE_ADDRESS_CHECKSUM_BYTES = 4;
export const PRIVATE_ADDRESS_DECODED_BYTES = 89;
export const PRIVATE_ADDRESS_MAINNET_ASCII_BYTES = 127;
export const PRIVATE_ADDRESS_TESTNET_ASCII_BYTES = 128;
/** Current Testnet deployment width; use the network-specific constants when decoding either network. */
export const PRIVATE_ADDRESS_ASCII_BYTES = PRIVATE_ADDRESS_TESTNET_ASCII_BYTES;

const PRIVATE_ADDRESS_FORMAT = 1;
const MAINNET_PREFIX = 'skpay_';
const TESTNET_PREFIX = 'tskpay_';
const DEPLOYMENT_TAG_DOMAIN = utf8('StellarKey private payment address deployment tag v1');
const CHECKSUM_DOMAIN = utf8('StellarKey private payment address checksum v1');

export type PrivateAddressPrefix = typeof MAINNET_PREFIX | typeof TESTNET_PREFIX;

export interface PrivateAddress {
  deploymentTag: Uint8Array;
  diversifier: Uint8Array;
  ownerCommitment: Uint8Array;
  hpkePublicKey: Uint8Array;
}

function validatePrefix(prefix: string): asserts prefix is PrivateAddressPrefix {
  if (prefix !== MAINNET_PREFIX && prefix !== TESTNET_PREFIX) {
    throw new Error('Unsupported private address prefix');
  }
}

function expectedAsciiBytes(prefix: PrivateAddressPrefix): number {
  return prefix === TESTNET_PREFIX
    ? PRIVATE_ADDRESS_TESTNET_ASCII_BYTES
    : PRIVATE_ADDRESS_MAINNET_ASCII_BYTES;
}

function requireLength(name: string, bytes: Uint8Array, length: number): void {
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new Error(`${name} must be ${length} bytes`);
  }
}

export function derivePrivateAddressDeploymentTag(
  deploymentBindingHash: Uint8Array,
): Uint8Array {
  requireLength('Deployment binding hash', deploymentBindingHash, 32);
  return sha256Bytes(DEPLOYMENT_TAG_DOMAIN, deploymentBindingHash)
    .slice(0, PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES);
}

function validateAddressFields(address: PrivateAddress): void {
  requireLength(
    'Deployment tag',
    address.deploymentTag,
    PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES,
  );
  requireLength('Address diversifier', address.diversifier, ADDRESS_DIVERSIFIER_BYTES);
  requireLength('Owner commitment', address.ownerCommitment, 32);
  requireLength('HPKE public key', address.hpkePublicKey, 32);
  if (!isCanonicalField(address.ownerCommitment) || address.ownerCommitment.every(byte => byte === 0)) {
    throw new Error('Invalid owner commitment');
  }
  if (address.hpkePublicKey.every(byte => byte === 0)) throw new Error('Invalid HPKE public key');
}

function checksum(prefix: PrivateAddressPrefix, body: Uint8Array): Uint8Array {
  return sha256Bytes(CHECKSUM_DOMAIN, utf8(prefix), body)
    .slice(0, PRIVATE_ADDRESS_CHECKSUM_BYTES);
}

export function encodePrivateAddress(address: PrivateAddress, prefix: string): string {
  validatePrefix(prefix);
  validateAddressFields(address);

  const body = new Uint8Array(PRIVATE_ADDRESS_DECODED_BYTES - PRIVATE_ADDRESS_CHECKSUM_BYTES);
  body[0] = PRIVATE_ADDRESS_FORMAT;
  body.set(address.deploymentTag, 1);
  body.set(address.diversifier, 17);
  body.set(address.ownerCommitment, 21);
  body.set(address.hpkePublicKey, 53);

  const encoded = `${prefix}${encodeBase58(concatBytes(body, checksum(prefix, body)))}`;
  if (encoded.length !== expectedAsciiBytes(prefix)) {
    throw new Error('Unexpected private address length');
  }
  return encoded;
}

export async function decodePrivateAddress(
  encoded: string,
  expectedPrefix: string,
  expectedDeploymentBindingHash?: Uint8Array,
): Promise<PrivateAddress> {
  validatePrefix(expectedPrefix);
  if (
    typeof encoded !== 'string' ||
    encoded.length !== expectedAsciiBytes(expectedPrefix) ||
    !encoded.startsWith(expectedPrefix) ||
    /\s/u.test(encoded)
  ) {
    throw new Error('Invalid private address prefix or length');
  }

  let decoded: Uint8Array;
  try {
    decoded = decodeBase58(encoded.slice(expectedPrefix.length));
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message.replace('Base58', 'private address') : 'Invalid private address',
      { cause: error },
    );
  }
  if (decoded.length !== PRIVATE_ADDRESS_DECODED_BYTES || decoded[0] !== PRIVATE_ADDRESS_FORMAT) {
    throw new Error('Invalid private address format');
  }

  const body = decoded.subarray(0, decoded.length - PRIVATE_ADDRESS_CHECKSUM_BYTES);
  const actualChecksum = decoded.subarray(decoded.length - PRIVATE_ADDRESS_CHECKSUM_BYTES);
  if (!equalBytes(actualChecksum, checksum(expectedPrefix, body))) {
    throw new Error('Private address checksum mismatch');
  }

  const address: PrivateAddress = {
    deploymentTag: body.slice(1, 17),
    diversifier: body.slice(17, 21),
    ownerCommitment: body.slice(21, 53),
    hpkePublicKey: body.slice(53, 85),
  };
  validateAddressFields(address);

  if (expectedDeploymentBindingHash) {
    const expectedTag = derivePrivateAddressDeploymentTag(expectedDeploymentBindingHash);
    if (!equalBytes(address.deploymentTag, expectedTag)) {
      throw new Error('Private address belongs to another Private Payments deployment');
    }
  }

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
  return address;
}
