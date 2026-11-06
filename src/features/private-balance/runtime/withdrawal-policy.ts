import { TREE_CAPACITY } from '@stellarkey/private-balance';

/** Call only with the fresh head count matched to the authenticated checkpoint. */
export function privateWithdrawalAppends(nextLeafIndex: bigint): boolean {
  if (typeof nextLeafIndex !== 'bigint' || nextLeafIndex < 0n || nextLeafIndex > TREE_CAPACITY) {
    throw new Error('Private withdrawal capacity checkpoint is invalid.');
  }
  return nextLeafIndex <= TREE_CAPACITY - 3n;
}
