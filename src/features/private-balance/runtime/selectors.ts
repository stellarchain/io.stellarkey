import type { PrivateBalanceState } from './reducer';
import type { PrivateBalanceDurableState, ShieldedNoteRecord } from './types';

export function selectTotalShieldedBalance(
  state: Pick<PrivateBalanceState, 'notes'>,
  assetContractId?: string,
): bigint {
  return state.notes
    .filter(note => note.status === 'unspent' && (
      assetContractId === undefined || note.assetContractId === assetContractId
    ))
    .reduce((sum, note) => sum + BigInt(note.value), 0n);
}

export function selectUnspentNotes(
  state: Pick<PrivateBalanceState, 'notes'>,
  assetContractId?: string,
): ShieldedNoteRecord[] {
  return state.notes.filter(note => note.status === 'unspent' && (
    assetContractId === undefined || note.assetContractId === assetContractId
  ));
}

export function formatPrivateBalanceAmount(atomicUnits: bigint, decimals: number): string {
  if (atomicUnits < 0n) throw new Error('Private Balance amount must be non-negative');
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Private Balance asset decimals are invalid');
  }
  if (decimals === 0) return atomicUnits.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = atomicUnits / scale;
  const fraction = (atomicUnits % scale).toString().padStart(decimals, '0');
  return `${whole}.${fraction}`;
}

export function formatPrivateBalanceXlm(stroops: bigint): string {
  return formatPrivateBalanceAmount(stroops, 7);
}

export function selectCanSpendPrivateBalance(
  state: Pick<PrivateBalanceDurableState, 'account'>,
): boolean {
  return state.account.syncStatus === 'current';
}
