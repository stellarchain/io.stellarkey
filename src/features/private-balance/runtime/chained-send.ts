import { parsePrivateAmount } from './coin-selection';
import type { PreparedPrivateActionReview, PrivateActionDraft } from './action-flow';

export const PRIVATE_CHAINED_APPROVAL_WINDOW_SECONDS = 15 * 60;
export const MAX_PRIVATE_CHAINED_STEPS = 64;

export interface PrivateChainedSendDraft {
  kind: 'transfer';
  amount: string;
  recipientAddress: string;
  memo?: string;
}

export interface PrivateChainedSendApproval {
  id: string;
  steps: number;
  perStepMaxFeeStroops: string;
  cumulativeMaxFeeStroops: string;
  expiresAtSeconds: number;
}

export interface PrivateChainedSendProgress {
  step: number;
  totalSteps: number;
  stage: 'preparing' | 'confirming' | 'waiting';
}

export interface PrivateChainedSendResult {
  status: 'broadcast' | 'ambiguous';
  /** Transaction hash of the chain's final send, for the explorer link. */
  finalTransactionHash?: string;
}

export class PrivateChainedFeePreflightError extends Error {
  public readonly missingStroops: string;

  constructor(missingStroops: bigint) {
    super('Not enough public XLM to cover the network fees for this private send.');
    this.name = 'PrivateChainedFeePreflightError';
    this.missingStroops = missingStroops.toString();
  }
}

export class PrivateChainedStepRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivateChainedStepRejectedError';
  }
}

function stroops(value: bigint, name: string): bigint {
  if (value < 0n) throw new Error(`${name} is invalid.`);
  return value;
}

/**
 * Builds the single approval descriptor for a consolidation chain: k − 1
 * self-transfers followed by the final send, one consent, one cumulative
 * fee cap, time-boxed. Preflights the public XLM needed for the whole
 * chain before anything is shown for approval.
 */
export function planPrivateChainedSend(input: {
  approvalId: string;
  consolidationActionCount: number;
  perStepMaxFeeStroops: bigint;
  publicXlmBalanceStroops: bigint;
  nowSeconds?: number;
}): PrivateChainedSendApproval {
  if (
    !Number.isSafeInteger(input.consolidationActionCount) ||
    input.consolidationActionCount < 1 ||
    input.consolidationActionCount + 1 > MAX_PRIVATE_CHAINED_STEPS
  ) {
    throw new Error('Private chained send step count is invalid.');
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.approvalId)) {
    throw new Error('Private chained approval ID is invalid.');
  }
  const perStep = stroops(input.perStepMaxFeeStroops, 'Private chained per-step fee cap');
  const steps = input.consolidationActionCount + 1;
  const cumulative = perStep * BigInt(steps);
  const available = stroops(input.publicXlmBalanceStroops, 'Public XLM balance');
  if (available < cumulative) {
    throw new PrivateChainedFeePreflightError(cumulative - available);
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('Private chained approval time is invalid.');
  }
  return {
    id: input.approvalId,
    steps,
    perStepMaxFeeStroops: perStep.toString(),
    cumulativeMaxFeeStroops: cumulative.toString(),
    expiresAtSeconds: nowSeconds + PRIVATE_CHAINED_APPROVAL_WINDOW_SECONDS,
  };
}

export interface RunPrivateChainedSendInput {
  approval: PrivateChainedSendApproval;
  draft: PrivateChainedSendDraft;
  ownFingerprint: string;
  assetDecimals: number;
  prepare(draft: PrivateActionDraft): Promise<PreparedPrivateActionReview>;
  submit(
    review: PreparedPrivateActionReview,
    options: { isFinal: boolean },
  ): Promise<'broadcast' | 'ambiguous'>;
  cancel(actionId: string): Promise<void>;
  awaitConfirmation(review: PreparedPrivateActionReview): Promise<boolean>;
  advanceApprovedFee(stepFeeStroops: bigint): Promise<void>;
  onProgress?(progress: PrivateChainedSendProgress): void;
  now?: () => number;
}

/**
 * Drives one approved consolidation chain to completion. Enforcement, per
 * the restoration precedent: (a) every non-final step must be a
 * consolidation self-transfer addressed to the wallet's own fingerprint;
 * (b) each step's simulated fee stays within the per-step cap and a durable
 * running total stays within the cumulative cap, advanced before the step
 * broadcasts; (c) the final send must match the approved amount, recipient,
 * memo, and per-step fee cap; (d) the approval is time-boxed and the chain dies
 * on its first failure — resuming requires fresh consent; (e) step n + 1 is
 * prepared only after step n left the durable pending journal via canonical
 * sync, so the in-flight guard holds inside the chain.
 */
export async function runPrivateChainedSend(
  input: RunPrivateChainedSendInput,
): Promise<PrivateChainedSendResult> {
  const now = input.now ?? Date.now;
  const totalSteps = input.approval.steps;
  if (!Number.isSafeInteger(totalSteps) || totalSteps < 2) {
    throw new Error('Private chained approval step count is invalid.');
  }
  const perStepMax = BigInt(input.approval.perStepMaxFeeStroops);
  const cumulativeMax = BigInt(input.approval.cumulativeMaxFeeStroops);
  const expectedAmountStroops = parsePrivateAmount(
    input.draft.amount,
    input.assetDecimals,
  ).toString();
  // The final send's memo is enforced with the same normalization the
  // preparation flow applies before it journals memoHex.
  const trimmedMemo = input.draft.memo?.trim() ?? '';
  const expectedMemoHex = trimmedMemo.length > 0
    ? Array.from(
        new TextEncoder().encode(trimmedMemo),
        byte => byte.toString(16).padStart(2, '0'),
      ).join('')
    : null;
  let accumulated = 0n;

  for (let step = 1; step <= totalSteps; step += 1) {
    if (Math.floor(now() / 1000) > input.approval.expiresAtSeconds) {
      throw new PrivateChainedStepRejectedError(
        'This approval expired. Review and approve the send again to continue.',
      );
    }
    const isFinal = step === totalSteps;
    input.onProgress?.({ step, totalSteps, stage: 'preparing' });
    const review = await input.prepare(isFinal ? { ...input.draft } : { kind: 'consolidate' });
    let stepFee: bigint;
    try {
      if (isFinal) {
        if (
          review.kind !== 'transfer' ||
          review.amountStroops !== expectedAmountStroops ||
          review.recipientAddress !== input.draft.recipientAddress ||
          (review.memoHex ?? null) !== expectedMemoHex
        ) {
          throw new PrivateChainedStepRejectedError(
            'The prepared send no longer matches the approved amount and recipient.',
          );
        }
      } else if (
        review.kind !== 'consolidate' ||
        review.recipientFingerprint !== input.ownFingerprint
      ) {
        throw new PrivateChainedStepRejectedError(
          'A preparation step was not addressed to this wallet.',
        );
      }
      stepFee = review.transaction.classicFeeStroops + review.transaction.resourceFeeStroops;
      if (stepFee > perStepMax) {
        throw new PrivateChainedStepRejectedError(
          'A step fee exceeds the approved per-step cap.',
        );
      }
      if (accumulated + stepFee > cumulativeMax) {
        throw new PrivateChainedStepRejectedError(
          'The total fees would exceed the approved cap.',
        );
      }
      // The durable running total advances before the broadcast so a crashed
      // or failed step can never spend outside the approved cumulative cap,
      // even when the signed envelope is resent by the resume path. It stays
      // inside this cancel-on-failure block so a lapsed approval or a lost
      // CAS race releases the prepared step instead of orphaning it.
      await input.advanceApprovedFee(stepFee);
    } catch (error) {
      try {
        await input.cancel(review.id);
      } catch {
        // The reserved notes release via the leader sync's stale
        // pre-broadcast sweep.
      }
      throw error;
    }
    accumulated += stepFee;
    input.onProgress?.({ step, totalSteps, stage: 'confirming' });
    const status = await input.submit(review, { isFinal });
    if (isFinal) {
      return { status, finalTransactionHash: review.transaction.transactionHash };
    }
    if (status !== 'broadcast') {
      throw new PrivateChainedStepRejectedError(
        "We couldn't confirm this payment yet. Your money is safe — we'll keep checking, and you can close this.",
      );
    }
    input.onProgress?.({ step, totalSteps, stage: 'waiting' });
    if (!(await input.awaitConfirmation(review))) {
      throw new PrivateChainedStepRejectedError(
        "Your previous payment is still confirming. It'll be ready in a moment.",
      );
    }
  }
  throw new Error('Private chained send did not reach its final step.');
}
