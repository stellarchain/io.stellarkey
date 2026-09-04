import type { PreparedPrivateActionReview, PrivateActionDraft, PrivateActionRelayBinding, PrivateRelayChainPreparation } from './action-flow';
import type { PrivateRelayPreparationCallbacks } from './action-transaction';
import type { PrivateRelaySubmissionCallbacks } from '../../../hooks/usePrivateBalanceRuntime';
import type { PrivateChainedSendProgress, PrivateChainedSendResult } from './chained-send';
import { assertPrivateRelayChainApproval, confirmPrivateRelayMerge, resolvePrivateRelayChainInputs, type PrivateRelayChainApproval, type PrivateRelayChainStep } from './relay-chain-policy';
import type { PrivateBalanceDurableState } from './types';

export interface PrivateRelayChainPeer {
  binding: PrivateActionRelayBinding;
  preparation: PrivateRelayPreparationCallbacks;
  submission: PrivateRelaySubmissionCallbacks;
  close(): void;
}

export type SelectPrivateRelayChainPeer = (request: {
  step: number; totalSteps: number; recipientAddress: string; maximumPrivateFeeAtomic: string;
}, signal: AbortSignal) => Promise<PrivateRelayChainPeer>;

/** Each helper choice is explicit; this driver has no network or signing implementation. */
export async function runPrivateRelayChainedSend(input: {
  approval: PrivateRelayChainApproval;
  signal: AbortSignal;
  readState(): Promise<PrivateBalanceDurableState>;
  issueSelfAddress(): Promise<string>;
  selectPeer: SelectPrivateRelayChainPeer;
  prepare(draft: PrivateActionDraft, step: PrivateRelayChainPreparation, peer: PrivateRelayChainPeer): Promise<PreparedPrivateActionReview>;
  submit(review: PreparedPrivateActionReview, peer: PrivateRelayChainPeer, isFinal: boolean): Promise<'broadcast' | 'ambiguous'>;
  cancel(actionId: string): Promise<void>;
  awaitConfirmation(review: PreparedPrivateActionReview, step: PrivateRelayChainStep): Promise<boolean>;
  onProgress?(progress: PrivateChainedSendProgress): void;
  now?: () => number;
}): Promise<PrivateChainedSendResult> {
  const approval = structuredClone(input.approval);
  assertPrivateRelayChainApproval(approval);
  const now = input.now ?? Date.now;
  const check = () => {
    if (input.signal.aborted) throw new DOMException('Private relay chain cancelled.', 'AbortError');
    if (Math.floor(now() / 1000) >= approval.expiresAtSeconds) throw new Error('Private relay chain approval expired. Review again.');
  };
  const memoHex = Array.from(new TextEncoder().encode(approval.draft.memo?.trim() ?? ''), byte => byte.toString(16).padStart(2, '0')).join('') || null;
  for (let index = 0; index < approval.steps; index += 1) {
    check();
    const state = await input.readState();
    check();
    const journal = state.relayChainedApproval;
    if (!journal || JSON.stringify(journal.approval) !== JSON.stringify(approval) || journal.authorized.length !== index) throw new Error('Private relay chain context or authorization changed.');
    const notes = resolvePrivateRelayChainInputs(journal, state);
    const inputValue = notes.reduce((sum, note) => sum + BigInt(note.value), 0n);
    const isFinal = index === approval.steps - 1;
    const recipientAddress = isFinal ? approval.draft.recipientAddress : await input.issueSelfAddress();
    check();
    input.onProgress?.({ step: index + 1, totalSteps: approval.steps, stage: 'choosing-peer' });
    const peer = await input.selectPeer({ step: index + 1, totalSteps: approval.steps, recipientAddress, maximumPrivateFeeAtomic: approval.plan.perStepMaxPrivateFeeAtomic }, input.signal);
    let review: PreparedPrivateActionReview | null = null;
    let submitted = false;
    try {
      check();
      if (BigInt(peer.binding.feeAtomic) <= 0n || BigInt(peer.binding.feeAtomic) > BigInt(approval.plan.perStepMaxPrivateFeeAtomic) || peer.preparation.expiresAt * 1000 <= now()) throw new Error('Helper quote exceeds the approved private fee cap or expired. Review the chain again.');
      const stepContext = { approvalId: approval.id, step: index, ...(!isFinal ? { selfAddress: recipientAddress } : {}) };
      const draft: PrivateActionDraft = isFinal ? { ...approval.draft, relay: peer.binding } : { kind: 'consolidate', relay: peer.binding };
      input.onProgress?.({ step: index + 1, totalSteps: approval.steps, stage: 'preparing' });
      review = await input.prepare(draft, stepContext, peer);
      check();
      const expectedAmount = isFinal ? approval.plan.amountAtomic : (inputValue - BigInt(peer.binding.feeAtomic)).toString();
      if (review.kind !== draft.kind || review.assetContractId !== approval.assetContractId ||
        review.recipientAddress !== recipientAddress || review.amountStroops !== expectedAmount || review.inputValueStroops !== inputValue.toString() ||
        review.changeValueStroops !== (inputValue - BigInt(expectedAmount) - BigInt(peer.binding.feeAtomic)).toString() ||
        JSON.stringify(review.selectedNoteIds) !== JSON.stringify(notes.map(note => note.id)) ||
        (review.memoHex ?? null) !== (isFinal ? memoHex : null) || JSON.stringify(review.relay) !== JSON.stringify(peer.binding) ||
        !review.recipientOutputCommitment || !/^[0-9a-f]{64}$/.test(review.recipientOutputCommitment)) throw new Error('The prepared private relay step no longer matches the exact approved inputs, address or amount.');
      const networkFee = review.transaction.classicFeeStroops + review.transaction.resourceFeeStroops;
      if (networkFee > BigInt(approval.perStepMaxFeeStroops) || review.transaction.expiresAt * 1000 <= now()) throw new Error('Private relay step fee exceeds approval or review expired.');
      const step: PrivateRelayChainStep = { actionId: review.id, step: index, actionField: review.actionField,
        inputNoteIds: notes.map(note => note.id), outputCommitment: review.recipientOutputCommitment,
        amountAtomic: review.amountStroops, recipientAddress, privateFeeAtomic: peer.binding.feeAtomic,
        networkFeeStroops: approval.perStepMaxFeeStroops, quoteId: peer.binding.quoteId, requestId: peer.binding.requestId,
        sourceAccount: peer.binding.sourceAccount, expiresAtSeconds: peer.preparation.expiresAt };
      // Preparation must have advanced consent BEFORE sending the proof. The
      // returned simulated fee is only checked against that reserved maximum.
      const authorized = (await input.readState()).relayChainedApproval;
      check();
      const recorded = authorized?.authorized[index];
      if (!authorized || JSON.stringify(authorized.approval) !== JSON.stringify(approval) || authorized.authorized.length !== index + 1 ||
        !recorded || !/^(0|[1-9][0-9]*)$/.test(recorded.networkFeeStroops) ||
        BigInt(recorded.networkFeeStroops) > BigInt(approval.perStepMaxFeeStroops) || networkFee > BigInt(recorded.networkFeeStroops) ||
        JSON.stringify(recorded) !== JSON.stringify({ ...step, networkFeeStroops: recorded.networkFeeStroops })) throw new Error('Private relay chain authorization changed before signing.');
      // A lower current classic fee can legitimately lower the independent
      // pre-disclosure cap. It never raises the user's cap or follows a peer claim.
      step.networkFeeStroops = recorded.networkFeeStroops;
      input.onProgress?.({ step: index + 1, totalSteps: approval.steps, stage: 'confirming' });
      const status = await input.submit(review, peer, isFinal);
      submitted = true;
      check();
      if (isFinal) return { status, finalTransactionHash: review.transaction.transactionHash };
      if (status !== 'broadcast') throw new Error('The previous relay step is still unconfirmed. Review a new chain after synchronization.');
      input.onProgress?.({ step: index + 1, totalSteps: approval.steps, stage: 'waiting' });
      if (!(await input.awaitConfirmation(review, step))) throw new Error('The previous relay step has not reached canonical confirmation.');
      check();
      if (!confirmPrivateRelayMerge(approval, step, await input.readState())) throw new Error('The exact canonical consolidation output is not yet spendable.');
    } catch (error) {
      if (review && !submitted) await input.cancel(review.id).catch(() => undefined);
      throw error;
    } finally { peer.close(); }
  }
  throw new Error('Private relay chain did not reach its final send.');
}
