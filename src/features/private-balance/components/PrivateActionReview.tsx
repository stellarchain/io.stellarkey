'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccountMark } from '@/components/AccountMark';
import { FiatValue } from '@/components/FiatValue';
import { Button, HashValue } from '@/components/ui';
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
import { PrivateActionError, PrivateReviewMismatchError } from './PrivateActionError';
import { privateReviewBalanceSimulation } from './PrivateReviewSimulation';
import type { PrivateChainedReview } from './usePrivateActionController';

/** What the person actually typed — the review screen renders this at once. */
export interface PrivateReviewDraft {
  kind: 'deposit' | 'transfer' | 'withdraw';
  /** Display-units amount exactly as entered. */
  amount: string;
  /** Recipient fingerprint shown while composing (transfers). */
  fingerprint?: string | null;
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
  return stage === 'preparing' ? 'Preparing your balance…' : 'Confirming…';
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
  chained,
  chainProgress,
  progress,
  preparing,
  working,
  error,
  errorCause,
  balanceBeforeStroops,
  confirmLabel,
  onConfirm,
  onBack,
}: {
  draft: PrivateReviewDraft;
  review: PreparedPrivateActionReview | null;
  chained: PrivateChainedReview | null;
  chainProgress: PrivateChainedSendProgress | null;
  progress: PrivateActionProgressStage | null;
  preparing: boolean;
  working: boolean;
  error: string | null;
  errorCause: Error | null;
  /** Verified private balance before this action, in stroops. */
  balanceBeforeStroops: bigint;
  confirmLabel: string;
  onConfirm(): void;
  onBack(): void;
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
    if (draft.kind === 'withdraw' && (review.publicRecipient ?? '') !== (draft.publicRecipient ?? '')) {
      return new PrivateReviewMismatchError('public recipient changed');
    }
    return null;
  }, [amountStroops, draft, review]);

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
  const simulation = amountStroops === null
    ? null
    : privateReviewBalanceSimulation({
        kind: draft.kind,
        liveUnspentStroops: balanceBeforeStroops,
        amountStroops,
        review,
      });
  const displayCause = errorCause ?? (error ? new Error(error) : null) ?? mismatch;
  const ready = chained !== null || (review !== null && mismatch === null);
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
  const liveStatus = review !== null && maximumFeeStroops !== null
    ? `Ready to confirm. Maximum network fee ${fmtAmount(formatPrivateBalanceXlm(maximumFeeStroops))} XLM.`
    : chained !== null
      ? `Ready to confirm. Sends in ${chained.approval.steps} steps.`
      : preparing
        ? progressLabel(progress ?? 'checking-chain')
        : '';

  return (
    <div className="space-y-3 p-4 sm:p-6">
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
          <ReviewRow label="To">
            <span className="inline-flex items-center gap-2">
              <AccountMark publicKey={draft.fingerprint} size={20} />
              <span className="font-mono text-[12.5px]">{draft.fingerprint}</span>
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
            <dt className="text-neutral-400">Network Fee</dt>
            <dd className="mt-0.5 font-medium text-neutral-100">
              Sends in {chained.approval.steps} steps · total max fee{' '}
              {fmtAmount(formatPrivateBalanceXlm(BigInt(chained.approval.cumulativeMaxFeeStroops)))} XLM
            </dd>
          </div>
        ) : (
          <ReviewRow label="Network Fee (max)" pulse={pulsedRows.has('fee')}>
            {maximumFeeStroops !== null ? (
              `${fmtAmount(formatPrivateBalanceXlm(maximumFeeStroops))} XLM`
            ) : preparing ? (
              <span className="skeleton inline-block rounded-md px-2.5 py-0.5 text-[12px] font-normal text-neutral-400">
                {progressLabel(progress ?? 'checking-chain')}
              </span>
            ) : (
              <span className="font-normal text-neutral-500">—</span>
            )}
          </ReviewRow>
        )}
        <ReviewRow label="Privacy">
          <span className="text-[12.5px] font-normal text-neutral-300">{PRIVACY_ROW[draft.kind]}</span>
        </ReviewRow>
      </dl>

      {simulation !== null && simulation.afterStroops >= 0n ? (
        <div className="panel-inset space-y-1.5 p-3.5 text-[12px]">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">
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
            <span>Balance After</span>
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
          {publicAddress ? (
            <div className="flex items-center justify-between gap-4">
              <span className="shrink-0 text-neutral-400">Fee paid by</span>
              <HashValue value={publicAddress} className="justify-end text-[11.5px] text-neutral-300" />
            </div>
          ) : null}
          {chained ? (
            <p className="leading-relaxed text-neutral-400">
              This runs as {chained.approval.steps} public transactions on Stellar, one after
              another — their timing is visible, the amounts moving privately are not.
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
        <div
          aria-live="polite"
          className="rounded-2xl border border-[#0A84FF]/20 bg-[#0A84FF]/[0.08] p-3.5 text-center"
        >
          <p className="text-[13px] font-semibold text-white">
            Step {chainProgress.step} of {chainProgress.totalSteps} · {chainStageLabel(chainProgress.stage)}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-400">
            Each step can take a little while. Keep this open — your draft is safe.
          </p>
        </div>
      ) : null}

      {displayCause ? <PrivateActionError cause={displayCause} /> : null}

      <div className="grid grid-cols-2 gap-3 pt-1">
        <Button
          type="button"
          variant="ghost"
          disabled={working}
          onClick={() => {
            triggerHaptic('selection');
            onBack();
          }}
        >
          Back
        </Button>
        <Button
          type="button"
          loading={working}
          disabled={working || settling || !ready || (preparing && !chained)}
          onClick={() => {
            triggerHaptic('selection');
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
