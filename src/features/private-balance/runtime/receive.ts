import { PRIVATE_ADDRESS_ASCII_BYTES } from '@stellarkey/private-balance';

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
  if (!/^(?:tks1|sks1)[02-9ac-hj-np-z]{115}$/u.test(address)) {
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
    address.length !== 113 ||
    /\s/u.test(address) ||
    address !== address.toLowerCase()
  ) {
    throw new Error('Reusable receive address is not canonical.');
  }
  if (!address.startsWith(`${expectedPrefix}1`)) {
    throw new Error('Reusable receive address is for another network.');
  }
  if (!/^(?:tsm1|ssm1)[02-9ac-hj-np-z]{109}$/u.test(address)) {
    throw new Error('Reusable receive address is not canonical.');
  }
  return address;
}

export function stealthAddressFingerprint(address: string): string {
  const prefix: StealthAddressPrefix = address.startsWith('ssm1') ? 'ssm' : 'tsm';
  return verificationCode(stealthReceivePayload(address, prefix));
}

function verificationCode(canonical: string): string {
  let fingerprint = 0x811c9dc5;
  for (const character of canonical) {
    fingerprint ^= character.charCodeAt(0);
    fingerprint = Math.imul(fingerprint, 0x01000193) >>> 0;
  }
  const compact = fingerprint.toString(16).padStart(8, '0').toUpperCase();
  return `${compact.slice(0, 4)} ${compact.slice(4)}`;
}
