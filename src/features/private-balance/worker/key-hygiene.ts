import type { ExpandedSpendingKey } from '@stellarkey/private-balance';

/** Best-effort buffer overwrite; JavaScript cannot guarantee physical memory erasure. */
export function wipePrivateBalanceSpendingKey(key: ExpandedSpendingKey): void {
  key.ask.fill(0);
  key.nk.fill(0);
  key.baseOwnerCommitment.fill(0);
  key.ownerCommitment.fill(0);
  key.hpkePrivateKey.fill(0);
  key.hpkePublicKey.fill(0);
  key.outgoingViewingKey.fill(0);
}
