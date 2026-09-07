import { hasExposedPrivateSpend } from './proof-exposure';
import type { PrivateBalanceDurableState, PrivatePendingAction, PrivateSpendRecovery, ShieldedActivityRecord, ShieldedNoteRecord } from './types';

export const MAX_PRIVATE_RECOVERY_ATTEMPTS = 32;

export function selectPrivateRecoveryInputs(state: PrivateBalanceDurableState, actionId: string, assetContractId: string) {
  const pending = state.pendingActions.find(action => action.id === actionId);
  if (!pending || !hasExposedPrivateSpend(pending) || pending.assetContractId !== assetContractId ||
    state.pendingActions.length !== 1 || state.buildReservations.length !== 0 || state.chainedApproval || state.relayChainedApproval) {
    throw new Error('This held private payment is not available for recovery. Check for new activity first.');
  }
  const notes = pending.reservedNoteIds.map(id => state.notes.find(note => note.id === id));
  if (notes.length < 1 || notes.length > 2 || notes.some(note => !note || note.status !== 'reserved' || note.assetContractId !== assetContractId || note.assetIndex !== pending.assetIndex)) {
    throw new Error('Private recovery inputs changed. Check for new activity first.');
  }
  return { pending, notes: notes as ShieldedNoteRecord[], amount: notes.reduce((total, note) => total + BigInt(note!.value), 0n) };
}

export function assertPrivateRecoveryReplacement(original: PrivatePendingAction, replacement: PrivatePendingAction, amount: bigint) {
  if (replacement.id === original.id || replacement.actionField === original.actionField || replacement.status !== 'prepared' ||
    replacement.kind !== 'transfer' || replacement.submissionMode !== 'direct' || replacement.proofExposure !== 'shared' ||
    replacement.assetContractId !== original.assetContractId || replacement.assetIndex !== original.assetIndex ||
    replacement.amountStroops !== amount.toString() || replacement.changeValueStroops !== '0' ||
    replacement.reservedNoteIds.length !== original.reservedNoteIds.length ||
    replacement.reservedNoteIds.some((id, index) => id !== original.reservedNoteIds[index]) ||
    new Set(replacement.nullifiers).size !== 2 || replacement.nullifiers.some(value => /^0+$/.test(value)) ||
    // Input lanes may be shuffled; a one-input proof has a fresh dummy nullifier.
    replacement.nullifiers.filter(value => original.nullifiers.includes(value)).length < original.reservedNoteIds.length ||
    replacement.relayChain || replacement.directChainApprovalId) {
    throw new Error('Private recovery proof does not spend exactly the held inputs back to this wallet.');
  }
}

export function reconcilePrivateSpendRecovery(recovery: PrivateSpendRecovery | undefined, notes: ShieldedNoteRecord[], activities: ShieldedActivityRecord[]): PrivateSpendRecovery | undefined {
  if (!recovery || recovery.outcome !== 'pending') return recovery;
  const fields = new Set(activities.map(activity => activity.id));
  const outcome = recovery.recoveryActionFields.some(field => fields.has(field)) ? 'recovered'
    : fields.has(recovery.originalActionField) ? 'original-confirmed'
    : recovery.reservedNoteIds.some(id => notes.some(note => note.id === id && note.status === 'spent')) ? 'conflict-confirmed' : 'pending';
  return { ...recovery, outcome };
}

export function isPrivateSpendRecovery(value: unknown): value is PrivateSpendRecovery {
  if (!value || typeof value !== 'object') return false;
  const record = value as PrivateSpendRecovery;
  const field = (candidate: unknown) => typeof candidate === 'string' && /^[0-9a-f]{64}$/.test(candidate);
  return field(record.originalActionField) && Array.isArray(record.recoveryActionFields) && record.recoveryActionFields.length > 0 &&
    record.recoveryActionFields.length <= MAX_PRIVATE_RECOVERY_ATTEMPTS && record.recoveryActionFields.every(field) &&
    new Set(record.recoveryActionFields).size === record.recoveryActionFields.length && !record.recoveryActionFields.includes(record.originalActionField) &&
    Array.isArray(record.reservedNoteIds) && record.reservedNoteIds.length >= 1 && record.reservedNoteIds.length <= 2 && record.reservedNoteIds.every(field) &&
    new Set(record.reservedNoteIds).size === record.reservedNoteIds.length && typeof record.assetContractId === 'string' && /^C[A-Z2-7]{55}$/.test(record.assetContractId) &&
    ['pending', 'recovered', 'original-confirmed', 'conflict-confirmed'].includes(record.outcome);
}
