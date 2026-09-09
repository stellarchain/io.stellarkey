'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccountMark } from '@/components/AccountMark';
import { FiatValue } from '@/components/FiatValue';
import { XlmFeeFiatValue } from '@/components/XlmFeeFiatValue';
import { Button, HashValue, ModalBody, ModalFooter, Notice } from '@/components/ui';
import { fmtAmount } from '@/lib/format';
import { triggerHaptic } from '@/lib/haptics';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { PRIVACY_ROW, WHAT_STAYS_PUBLIC, progressLabel } from '../copy';
import { parsePrivateAmount } from '../runtime/coin-selection';
import { formatPrivateBalanceAmount, formatPrivateBalanceXlm } from '../runtime/selectors';
import type {
  PreparedPrivateActionReview,
  PrivateActionProgressStage,
} from '../runtime/action-flow';
import type { PrivateChainedSendProgress } from '../runtime/chained-send';
import type { PrivateRelayQuote } from '../relay/protocol';
import { PrivateActionError, PrivateReviewMismatchError } from './PrivateActionError';
import { privateReviewBalanceSimulation } from './PrivateReviewSimulation';
import { PrivateRelayQuotePicker } from './PrivateRelayQuotePicker';
import type { PrivateProofDisclosure } from '../runtime/proof-disclosure';
import type {
  PrivateChainedReview,
  PrivateRelayProgress,
} from './usePrivateActionController';

/** What the person actually typed — the review screen renders this at once. */
export interface PrivateReviewDraft {
  purpose?: 'recovery';
  kind: 'deposit' | 'transfer' | 'withdraw';
  /** Display-units amount exactly as entered. */
  amount: string;
  /** Recipient fingerprint shown while composing (transfers). */
  fingerprint?: string | null;
  /** Full canonical private recipient shown and bound on review. */
  recipientAddress?: string | null;
  /** Public G or C recipient (withdrawals). */
  publicRecipient?: string | null;
  memo?: string;
}

function ReviewRow({
  label,
  pulse = false,
  children,
}: {
  label: string;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-h-11 items-center justify-between gap-4 py-2.5 text-[13px] ${pulse ? 'row-pulse' : ''}`}>
      <dt className="shrink-0 text-neutral-400">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-neutral-100">{children}</dd>
    </div>
  );
}

function chainStageLabel(stage: PrivateChainedSendProgress['stage']): string {
  return stage === 'choosing-peer' ? 'Choose a helper for this step' : stage === 'preparing' ? 'Preparing your balance…' : 'Confirming…';
}

/**
 * The shared review screen for send, add, and withdraw. It renders instantly
 * from the draft while the proof is prepared underneath: the fee row cycles
 * two calm labels until the prepared review lands, and confirm stays disabled
 * until the prepared numbers provably match what was typed.
 */
export function PrivateActionReview({
  draft,
  review,
  disclosure = null,
  chained,
  chainProgress,
  progress,
  relayProgress,
  relayQuotes = [],
  preparing,
  working,
  error,
  errorCause,
  balanceBeforeStroops,
  confirmLabel,
  onConfirm,
  onBack,
  backInHeader = false,
  onSelectRelayQuote,
}: {
  draft: PrivateReviewDraft;
  review: PreparedPrivateActionReview | null;
  disclosure?: Readonly<PrivateProofDisclosure> | null;
  chained: PrivateChainedReview | null;
  chainProgress: PrivateChainedSendProgress | null;
  progress: PrivateActionProgressStage | null;
  relayProgress?: PrivateRelayProgress | null;
  relayQuotes?: readonly PrivateRelayQuote[];
  preparing: boolean;
  working: boolean;
  error: string | null;
  errorCause: Error | null;
  /** Verified private balance before this action, in stroops. */
  balanceBeforeStroops: bigint;
  confirmLabel: string;
  onConfirm(): void;
  onBack(): void;
  /** The owning header shows the back control; the footer then carries only the primary. */
  backInHeader?: boolean;
  onSelectRelayQuote?(quoteId: string): void;
}) {
  const { asset, publicAddress } = usePrivateBalanceRuntimeData();
  const decimals = asset?.decimals ?? 7;
  const code = asset?.code ?? 'Asset';
  const privateAmount = (atomicUnits: string | bigint) =>
    `${fmtAmount(formatPrivateBalanceAmount(BigInt(atomicUnits), decimals))} ${code}`;

  const amountStroops = useMemo(() => {
    try {
      return parsePrivateAmount(draft.amount, decimals);
    } catch {
      return null;
    }
  }, [decimals, draft.amount]);

  // Render-integrity: a prepared review may only enable confirm when it
  // byte-matches the draft the person is looking at.
  const mismatch = useMemo<PrivateReviewMismatchError | null>(() => {
    if (draft.purpose === 'recovery' && ((disclosure && (!disclosure.recoveryOfActionId || disclosure.submissionMode !== 'direct' || disclosure.privateFeeAtomic !== '0')) ||
      (review && (!review.recoveryOfActionId || review.relay || review.changeValueStroops !== '0' || review.inputValueStroops !== review.amountStroops)))) {
      return new PrivateReviewMismatchError('recovery intent changed');
    }
    if (disclosure) {
      const memoHex = Array.from(new TextEncoder().encode(draft.memo?.trim() ?? ''), byte => byte.toString(16).padStart(2, '0')).join('') || null;
      if (disclosure.kind !== draft.kind || disclosure.assetContractId !== asset?.contractId || disclosure.amountStroops !== amountStroops?.toString() ||
        (draft.kind === 'transfer' && (disclosure.recipientAddress !== draft.recipientAddress || disclosure.memoHex !== memoHex)) ||
        (draft.kind === 'withdraw' && disclosure.publicRecipient !== draft.publicRecipient)) return new PrivateReviewMismatchError('proof-sharing intent changed');
    }
    if (!review) return null;
    if (amountStroops === null) return new PrivateReviewMismatchError('draft amount is unreadable');
    if (review.kind !== draft.kind) {
      return new PrivateReviewMismatchError(`kind ${review.kind} != ${draft.kind}`);
    }
    if (review.amountStroops !== amountStroops.toString()) {
      return new PrivateReviewMismatchError(
        `amount ${review.amountStroops} != ${amountStroops.toString()}`,
      );
    }
    if (draft.kind === 'transfer' && (review.recipientFingerprint ?? '') !== (draft.fingerprint ?? '')) {
      return new PrivateReviewMismatchError('recipient fingerprint changed');
    }
    if (draft.kind === 'transfer' && (review.recipientAddress ?? '') !== (draft.recipientAddress ?? '')) {
      return new PrivateReviewMismatchError('recipient address changed');
    }
    if (draft.kind === 'withdraw' && (review.publicRecipient ?? '') !== (draft.publicRecipient ?? '')) {
      return new PrivateReviewMismatchError('public recipient changed');
    }
    return null;
  }, [amountStroops, asset?.contractId, disclosure, draft, review]);

  const maximumFeeStroops = review
    ? review.transaction.classicFeeStroops + review.transaction.resourceFeeStroops
    : null;
  const changeStroops = review ? BigInt(review.changeValueStroops) : null;

  // Auto-re-prepare diff: when a fresh review replaces an expired one, an
  // identical fee and change swap in seamlessly; any visible change pulses
  // its row and briefly holds confirm so the update cannot be missed. The
  // valid-until detail always moves on a re-prepare, so it never counts.
  // (State adjusted during render per react.dev/learn/you-might-not-need-an-effect)
  const [diff, setDiff] = useState<{
    id: string;
    fee: string;
    change: string;
    pulsed: ReadonlySet<string>;
  } | null>(null);
  if (review && maximumFeeStroops !== null && changeStroops !== null) {
    const fee = maximumFeeStroops.toString();
    const change = changeStroops.toString();
    if (!diff || diff.id !== review.id) {
      const pulsed = new Set<string>();
      if (diff) {
        if (diff.fee !== fee) pulsed.add('fee');
        if (diff.change !== change) pulsed.add('change');
      }
      setDiff({ id: review.id, fee, change, pulsed });
    }
  }
  const pulsedRows: ReadonlySet<string> = diff?.pulsed ?? new Set();
  const settling = pulsedRows.size > 0;
  useEffect(() => {
    if (!settling) return;
    triggerHaptic('warning');
    const timer = window.setTimeout(() => {
      setDiff(current =>
        current && current.pulsed.size > 0 ? { ...current, pulsed: new Set() } : current,
      );
    }, 1700);
    return () => window.clearTimeout(timer);
  }, [settling]);

  // Once prepare reserves this action's input notes, the live verified
  // balance (unspent-only) has already dropped by their full value; the
  // simulation adds them back so Before/After stay protocol-true both while
  // preparing and after the review lands.
  const privateChainFee = chained?.relayApproval ? BigInt(chained.relayApproval.plan.cumulativeMaxPrivateFeeAtomic) : 0n;
  const choosingChainPeer = !!chained?.relayApproval && chainProgress?.stage === 'choosing-peer';
  const simulation = draft.purpose === 'recovery' || amountStroops === null || (working && chained?.relayApproval)
    ? null
    : privateReviewBalanceSimulation({
        kind: draft.kind,
        liveUnspentStroops: balanceBeforeStroops,
        amountStroops: amountStroops + privateChainFee,
        privateFeeStroops: disclosure ? BigInt(disclosure.privateFeeAtomic) : 0n,
        review,
      });
  const displayCause = errorCause ?? (error ? new Error(error) : null) ?? mismatch;
  const ready = chained !== null || ((review !== null || disclosure !== null) && mismatch === null);
  const validUntil = review
    ? new Date(review.transaction.expiresAt * 1000).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  // One persistent live region for the whole preparation: live regions only
  // announce reliably when they stay mounted and their content changes, so
  // this span never unmounts — it carries the progress labels and then the
  // readiness announcement with the final maximum fee.
  const liveStatus = disclosure ? 'Review the exact payment and maximum fees before authorizing proof sharing.' : choosingChainPeer && relayQuotes.length > 0
    ? `Step ${chainProgress?.step} of ${chainProgress?.totalSteps}. Choose a helper for this step.`
    : review !== null && maximumFeeStroops !== null
    ? `Ready to confirm. Maximum network fee ${fmtAmount(formatPrivateBalanceXlm(maximumFeeStroops))} XLM.`
    : chained !== null
      ? `Ready to confirm. Sends in ${chained.approval.steps} steps.`
      : preparing && relayProgress === 'comparing-fees'
        ? `${relayQuotes.length} privacy relay ${relayQuotes.length === 1 ? 'offer found' : 'offers found'}. Choose now, or wait briefly for more offers.`
      : preparing && relayProgress === 'same-account-peer'
        ? 'A helper using this Stellar account answered. Still looking for a different Stellar account.'
      : relayQuotes.length > 0
        ? `${relayQuotes.length} privacy relay ${relayQuotes.length === 1 ? 'offer is' : 'offers are'} available. Choose a peer to continue.`
      : preparing
        ? relayProgress === 'finding-peer'
          ? 'Finding a privacy relay…'
          : relayProgress === 'agreeing-fee'
            ? 'Agreeing the private relay fee…'
            : progressLabel(progress ?? 'checking-chain')
        : '';

  // Cancelling a running relay chain is a footer action even when the header
  // owns Back: it must stay reachable while the shell is not busy.
  const cancellingChain = working && Boolean(chained?.relayApproval);
  const secondaryAction = cancellingChain || !backInHeader ? (
    <Button
      type="button"
      variant="ghost"
      disabled={working && !chained?.relayApproval}
      onClick={onBack}
    >
      {cancellingChain ? 'Cancel Chain' : 'Back'}
    </Button>
  ) : undefined;

  return (
    <ModalBody gap={3}>
      <span aria-live="polite" className="sr-only">{liveStatus}</span>
      <div className="flex flex-col items-center pb-1 text-center">
        <p className="display-h text-[36px] text-white">{fmtAmount(draft.amount)}</p>
        <p className="mt-1 text-[13px] font-semibold text-neutral-300">{code}</p>
        <FiatValue
          amount={draft.amount}
          code={code}
          issuer={asset?.issuer}
          isNative={asset?.kind === 'native'}
          className="mt-1 text-[13px] text-neutral-400"
        />
      </div>

      <dl className="panel-inset divide-y divide-white/[0.08] px-4">
        {draft.kind === 'transfer' && draft.fingerprint ? (
          <ReviewRow label="Check code">
            <span className="inline-flex items-center gap-2">
              <AccountMark publicKey={draft.fingerprint} size={20} />
              <span className="font-mono text-[12.5px]">{draft.fingerprint}</span>
            </span>
          </ReviewRow>
        ) : null}
        {draft.kind === 'transfer' && draft.recipientAddress ? (
          <ReviewRow label="Address">
            <span className="max-w-[min(62vw,430px)] break-all font-mono text-[10.5px] leading-relaxed text-white">
              {draft.recipientAddress}
            </span>
          </ReviewRow>
        ) : null}
        {draft.kind === 'withdraw' && draft.publicRecipient ? (
          <ReviewRow label="To">
            <HashValue value={draft.publicRecipient} className="justify-end text-[12px] text-white" />
          </ReviewRow>
        ) : null}
        {draft.kind === 'deposit' && publicAddress ? (
          <ReviewRow label="From">
            <HashValue value={publicAddress} className="justify-end text-[12px] text-white" />
          </ReviewRow>
        ) : null}
        {draft.memo ? <ReviewRow label="Memo">{draft.memo}</ReviewRow> : null}
        {chained ? (
          <div className="py-2.5 text-[13px]">
            {chained.relayApproval ? <>
              <dt className="text-neutral-400">Your private fee cap</dt>
              <dd className="mb-2 mt-0.5 font-medium text-neutral-100">
                {privateAmount(BigInt(chained.relayApproval.plan.perStepMaxPrivateFeeAtomic))} per step · {privateAmount(privateChainFee)} total
              </dd>
            </> : null}
            <dt className="text-neutral-400">{chained.relayApproval ? 'Helper-paid network fee cap' : 'Network Fee'}</dt>
            <dd className="mt-0.5 font-medium text-neutral-100">
              Sends in {chained.approval.steps} steps · total max fee{' '}
              {fmtAmount(formatPrivateBalanceXlm(BigInt(chained.approval.cumulativeMaxFeeStroops)))} XLM
              <XlmFeeFiatValue
                amount={formatPrivateBalanceXlm(BigInt(chained.approval.cumulativeMaxFeeStroops))}
                className="mt-0.5 block"
              />
            </dd>
          </div>
        ) : (
          <ReviewRow
            label={review?.relay ? 'Peer network fee (max)' : 'Network Fee (max)'}
            pulse={pulsedRows.has('fee')}
          >
            {maximumFeeStroops !== null ? (
              <span className="flex flex-col items-end">
                <span>{fmtAmount(formatPrivateBalanceXlm(maximumFeeStroops))} XLM</span>
                <XlmFeeFiatValue amount={formatPrivateBalanceXlm(maximumFeeStroops)} />
              </span>
            ) : preparing ? (
              <span className="skeleton inline-block rounded-md px-2.5 py-0.5 text-[12px] font-normal text-neutral-400">
                {relayProgress === 'finding-peer'
                  ? 'Finding a privacy relay…'
                  : relayProgress === 'same-account-peer'
                    ? 'Same account found; checking others…'
                  : relayProgress === 'comparing-fees'
                    ? 'Comparing relay fees…'
                  : relayProgress === 'agreeing-fee'
                    ? 'Agreeing relay fee…'
                    : progressLabel(progress ?? 'checking-chain')}
              </span>
            ) : (
              <span className="font-normal text-neutral-500">
                {relayQuotes.length > 0 ? 'Choose a peer below' : '—'}
              </span>
            )}
          </ReviewRow>
        )}
        {review?.relay ? (
          <ReviewRow label="Privacy relay fee">
            {privateAmount(review.relay.feeAtomic)}
          </ReviewRow>
        ) : null}
        {review?.transaction.refreshesAnchor ? (
          <ReviewRow label="Private access">Refreshed with this payment</ReviewRow>
        ) : null}
        <ReviewRow label="Privacy">
          <span className="text-[12.5px] font-normal text-neutral-300">{PRIVACY_ROW[draft.kind]}</span>
        </ReviewRow>
      </dl>

      {simulation !== null && simulation.afterStroops >= 0n ? (
        <div className="panel-inset space-y-1.5 p-3.5 text-[12px]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Private balance after
          </p>
          <div className="flex justify-between text-neutral-300">
            <span>Balance Before</span>
            <span className="mono">{privateAmount(simulation.beforeStroops)}</span>
          </div>
          <div className={`flex justify-between ${draft.kind === 'deposit' ? 'text-[#30D158]' : 'text-[#FF453A]'}`}>
            <span>{draft.kind === 'deposit' ? 'Amount Added' : 'Amount Sent'}</span>
            <span className="mono">
              {draft.kind === 'deposit' ? '+' : '−'}{fmtAmount(draft.amount)} {code}
            </span>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-1.5 font-semibold text-white">
            <span>{chained?.relayApproval ? 'Balance After Max Fees' : 'Balance After'}</span>
            <span className="mono">{privateAmount(simulation.afterStroops)}</span>
          </div>
        </div>
      ) : null}

      <details className="panel-inset px-4">
        <summary className="cursor-pointer select-none py-3 text-[12.5px] font-medium text-neutral-300">
          Details
        </summary>
        <div className="space-y-2.5 border-t border-white/[0.08] py-3 text-[12px] text-neutral-300">
          {changeStroops !== null && changeStroops > 0n ? (
            <div className={`flex justify-between gap-4 ${pulsedRows.has('change') ? 'row-pulse' : ''}`}>
              <span className="text-neutral-400">Back to your balance</span>
              <span className="mono">{privateAmount(changeStroops)}</span>
            </div>
          ) : null}
          {review?.relay || chained?.relayApproval ? (
            <div className="flex items-center justify-between gap-4">
              <span className="shrink-0 text-neutral-400">Submitted by</span>
              <span>Privacy relay peer</span>
            </div>
          ) : publicAddress ? (
            <div className="flex items-center justify-between gap-4">
              <span className="shrink-0 text-neutral-400">Fee paid by</span>
              <HashValue value={publicAddress} className="justify-end text-[11.5px] text-neutral-300" />
            </div>
          ) : null}
          {chained ? (
            <p className="leading-relaxed text-neutral-400">
              This runs as {chained.approval.steps} public transactions on Stellar, one after
              another — their timing is visible, the amounts moving privately are not.
              {' Confirming authorizes sharing a spend proof for each approved step. A shared proof can execute even after cancellation or transaction expiry; unresolved inputs remain reserved.'}
              {chained.relayApproval ? ' Choose a helper for each step. Helpers pay the public XLM fees; private rewards are deducted from your balance. Cancelling stops future local steps, but cannot retract a proof already shared with a helper or undo a submitted payment.' : ''}
            </p>
          ) : null}
          <p className="leading-relaxed text-neutral-400">{WHAT_STAYS_PUBLIC[draft.kind]}</p>
          {validUntil ? (
            <div className="flex justify-between gap-4">
              <span className="text-neutral-400">Valid until</span>
              <span className="mono">{validUntil}</span>
            </div>
          ) : null}
        </div>
      </details>

      {working && chainProgress ? (
        <Notice tone="accent" compact role="status" className="text-center">
          <p className="text-[13px] font-semibold text-white">
            Step {chainProgress.step} of {chainProgress.totalSteps} · {chainStageLabel(chainProgress.stage)}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-400">
            Each step can take a little while. Keep this open — your draft is safe.
          </p>
        </Notice>
      ) : null}

      {relayQuotes.length > 0 && onSelectRelayQuote ? (
        <PrivateRelayQuotePicker
          quotes={relayQuotes}
          code={code}
          decimals={decimals}
          disabled={(preparing && relayProgress !== 'comparing-fees') || (working && !choosingChainPeer)}
          comparing={preparing && relayProgress === 'comparing-fees'}
          onSelect={onSelectRelayQuote}
        />
      ) : null}

      {displayCause ? <PrivateActionError cause={displayCause} /> : null}

      {disclosure ? (
        <div className="panel-inset space-y-2 p-3.5 text-[12px] text-neutral-300">
          <p className="font-semibold text-white">Authorize this payment before sharing its proof</p>
          <p>Sharing authorizes the exact payment above. The {disclosure.submissionMode === 'relay' ? 'helper' : 'RPC provider'} can submit that proof in another transaction, even if you later cancel or this transaction expires.</p>
          <p>Maximum network fee: {fmtAmount(formatPrivateBalanceXlm(BigInt(disclosure.maximumNetworkFeeStroops)))} XLM{disclosure.submissionMode === 'relay' ? ' (paid by the helper)' : ''}.</p>
          {BigInt(disclosure.privateFeeAtomic) > 0n ? <p>Your private helper fee: {privateAmount(disclosure.privateFeeAtomic)}.</p> : null}
          <p>If preparation fails after sharing, these inputs stay reserved with status unknown until canonical reconciliation. You cannot reset or retry them as unspent.</p>
        </div>
      ) : null}

      <ModalFooter
        secondary={secondaryAction}
        primary={
          <Button
            type="button"
            loading={working}
            disabled={working || settling || !ready || (preparing && !chained)}
            onClick={onConfirm}
          >
            {disclosure ? 'Authorize Proof Sharing' : confirmLabel}
          </Button>
        }
      />
    </ModalBody>
  );
}
