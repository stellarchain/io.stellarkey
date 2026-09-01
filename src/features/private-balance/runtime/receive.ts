import { PRIVATE_ADDRESS_ASCII_BYTES } from '@stellarkey/private-balance';
import { STEALTH_META_ADDRESS_ASCII_BYTES } from '@stellarkey/private-balance';
import { hash } from '@stellar/stellar-sdk';

export type PrivateAddressPrefix = 'tks' | 'sks';
export type StealthAddressPrefix = 'tsm' | 'ssm';

export function privateReceivePayload(
  address: string,
  expectedPrefix: PrivateAddressPrefix = 'tks',
): string {
  if (
    address.length !== PRIVATE_ADDRESS_ASCII_BYTES ||
    /\s/u.test(address) ||
    address !== address.toLowerCase()
  ) {
    throw new Error('Private receive address is not canonical.');
  }
  if (!address.startsWith(`${expectedPrefix}1`)) {
    throw new Error('Private receive address is for another network.');
  }
  if (!/^(?:tks1|sks1)[02-9ac-hj-np-z]{166}$/u.test(address)) {
    throw new Error('Private receive address is not canonical.');
  }
  return address;
}

export function privateAddressFingerprint(address: string): string {
  const prefix: PrivateAddressPrefix = address.startsWith('sks1') ? 'sks' : 'tks';
  const canonical = privateReceivePayload(address, prefix);
  return verificationCode(canonical);
}

export function stealthReceivePayload(
  address: string,
  expectedPrefix: StealthAddressPrefix = 'tsm',
): string {
  if (
    address.length !== STEALTH_META_ADDRESS_ASCII_BYTES ||
    /\s/u.test(address) ||
    address !== address.toLowerCase()
  ) {
    throw new Error('Reusable receive address is not canonical.');
  }
  if (!address.startsWith(`${expectedPrefix}1`)) {
    throw new Error('Reusable receive address is for another network.');
  }
  if (!/^(?:tsm1|ssm1)[02-9ac-hj-np-z]{160}$/u.test(address)) {
    throw new Error('Reusable receive address is not canonical.');
  }
  return address;
}

export function stealthAddressFingerprint(address: string): string {
  const prefix: StealthAddressPrefix = address.startsWith('ssm1') ? 'ssm' : 'tsm';
  return verificationCode(stealthReceivePayload(address, prefix));
}

function verificationCode(canonical: string): string {
  const compact = Array.from(hash(new TextEncoder().encode(canonical)).slice(0, 16), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('').toUpperCase();
  return compact.match(/.{4}/g)?.join(' ') ?? compact;
}
