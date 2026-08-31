import type { PreparedPrivateActionReview } from '../runtime/action-flow';

/**
 * The "Private balance after" panel's math. `liveUnspentStroops` is the live
 * verified balance, which counts unspent notes only — so the moment a
 * prepared review lands, this action's input notes are already reserved and
 * the live figure has dropped by their full value (amount + change). The
 * panel adds that reservation back so Before/After stay protocol-true both
 * while preparing (nothing reserved yet) and once the review is ready:
 *
 *   before = unspent + amount + change   (after prepare reserves the inputs)
 *   after  = unspent + change            (change returns to the balance)
 *
 * Deposits reserve no notes, so they pass through unadjusted.
 */
export function privateReviewBalanceSimulation(input: {
  kind: 'deposit' | 'transfer' | 'withdraw';
  liveUnspentStroops: bigint;
  amountStroops: bigint;
  review: Pick<PreparedPrivateActionReview, 'kind' | 'amountStroops' | 'changeValueStroops'> | null;
}): { beforeStroops: bigint; afterStroops: bigint } {
  const reservedInputs =
    input.review !== null && input.review.kind !== 'deposit'
      ? BigInt(input.review.amountStroops) + BigInt(input.review.changeValueStroops)
      : 0n;
  const beforeStroops = input.liveUnspentStroops + reservedInputs;
  const afterStroops =
    input.kind === 'deposit'
      ? beforeStroops + input.amountStroops
      : beforeStroops - input.amountStroops;
  return { beforeStroops, afterStroops };
}
