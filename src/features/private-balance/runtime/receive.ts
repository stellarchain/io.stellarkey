import {
  PRIVATE_ADDRESS_MAINNET_ASCII_BYTES,
  PRIVATE_ADDRESS_TESTNET_ASCII_BYTES,
} from '@stellarkey/private-balance';
import { STEALTH_META_ADDRESS_ASCII_BYTES } from '@stellarkey/private-balance';
import { hash } from '@stellar/stellar-sdk';

export type PrivateAddressPrefix = 'tskpay_' | 'skpay_';
export type StealthAddressPrefix = 'tsm' | 'ssm';

/** Missing identity is not evidence of work in progress. Retained local
 * addresses are usable during a read-only scan, but never while locked. */
export function privateReceiveState(input: {
  configured: boolean;
  hasAddress: boolean;
  isLeader: boolean;
  phase: string;
  reusable: boolean;
  stealthSyncing: boolean;
  hasError: boolean;
  sessionCurrent: boolean;
}): 'locked' | 'setup' | 'ready' | 'follower' | 'stopped' | 'loading' | 'missing' {
  if (!input.sessionCurrent || input.phase === 'locked') return 'locked';
  if (!input.configured) return 'setup';
  if (input.hasAddress) return 'ready';
  if (!input.isLeader) return 'follower';
  if (input.hasError || ['safe-error', 'status-unknown'].includes(input.phase)) return 'stopped';
  if (['reading-meta', 'loading-artifacts', 'scanning-live'].includes(input.phase)
    || (input.reusable && input.stealthSyncing)) return 'loading';
  return 'missing';
}

export function privateReceivePayload(
  address: string,
  expectedPrefix: PrivateAddressPrefix = 'tskpay_',
): string {
  const alternatePrefix: PrivateAddressPrefix = expectedPrefix === 'tskpay_' ? 'skpay_' : 'tskpay_';
  if (address.startsWith(alternatePrefix)) {
    throw new Error('Private receive address is for another network.');
  }
  const expectedLength = expectedPrefix === 'tskpay_'
    ? PRIVATE_ADDRESS_TESTNET_ASCII_BYTES
    : PRIVATE_ADDRESS_MAINNET_ASCII_BYTES;
  if (
    address.length !== expectedLength ||
    /\s/u.test(address)
  ) {
    throw new Error('Private receive address is not canonical.');
  }
  if (!/^(?:tskpay_|skpay_)[1-9A-HJ-NP-Za-km-z]+$/u.test(address)) {
    throw new Error('Private receive address is not canonical.');
  }
  return address;
}

export function privateAddressFingerprint(address: string): string {
  const prefix: PrivateAddressPrefix = address.startsWith('skpay_') ? 'skpay_' : 'tskpay_';
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
