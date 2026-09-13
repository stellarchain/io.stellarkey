import { StrKey } from '@stellar/stellar-sdk';
import type { AccountMeta } from '../../../lib/types';

/** Maximum Soroban resource fee accepted by any reviewed Private Balance action. */
export const MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS = 10_000_000n;

/** Alternate public fee account; absence retains ordinary active-account fees. */
export interface PrivateFeePayer {
  accountId: string;
  publicKey: string;
}

export function isPrivateFeePayer(value: unknown): value is PrivateFeePayer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payer = value as PrivateFeePayer;
  return typeof payer.accountId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(payer.accountId)
    && typeof payer.publicKey === 'string' && StrKey.isValidEd25519PublicKey(payer.publicKey);
}

export function privateFeePayerUnavailableReason(account: Pick<AccountMeta, 'watchOnly' | 'hardware'>): string | null {
  if (account.hardware) return 'Hardware fee signing is not supported in this build.';
  if (account.watchOnly) return 'Watch-only accounts cannot sign network fees.';
  return null;
}

export function resolvePrivateFeePayer(
  accounts: readonly Pick<AccountMeta, 'id' | 'publicKey' | 'watchOnly' | 'hardware'>[],
  activeAccountId: string,
  selectedAccountId = activeAccountId,
): PrivateFeePayer | undefined {
  const active = accounts.find(account => account.id === activeAccountId);
  const selected = accounts.find(account => account.id === selectedAccountId);
  if (!active || !selected) throw new Error('The selected fee-paying account is unavailable. Choose an account again.');
  const reason = privateFeePayerUnavailableReason(selected);
  if (reason) throw new Error(reason);
  const payer = { accountId: selected.id, publicKey: selected.publicKey };
  if (!isPrivateFeePayer(payer)) throw new Error('The selected fee-paying account is invalid.');
  return selected.publicKey === active.publicKey ? undefined : Object.freeze(payer);
}

export function assertSamePrivateFeePayer(expected?: PrivateFeePayer, actual?: PrivateFeePayer): void {
  if ((expected !== undefined && !isPrivateFeePayer(expected)) ||
    (actual !== undefined && !isPrivateFeePayer(actual)) ||
    expected?.accountId !== actual?.accountId || expected?.publicKey !== actual?.publicKey) {
    throw new Error('The fee-paying account changed. Create a new private payment review.');
  }
}

export function privateActionClassicFeeStroops(baseFeeStroops: bigint, feePayer?: PrivateFeePayer): bigint {
  if (baseFeeStroops < 1n || baseFeeStroops > 0xffff_ffffn) throw new Error('Private inclusion fee is invalid.');
  if (feePayer !== undefined && !isPrivateFeePayer(feePayer)) throw new Error('Private fee payer is invalid.');
  return baseFeeStroops * (feePayer ? 2n : 1n);
}
