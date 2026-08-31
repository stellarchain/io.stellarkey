'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, HashValue, Spinner } from '@/components/ui';
import { fmtAmount } from '@/lib/format';
import {
  type PreparedStealthSweep,
  usePrivateBalanceRuntimeData,
} from '@/hooks/usePrivateBalanceRuntime';
import { progressLabel } from '../copy';
import type { PrivateActionProgressStage } from '../runtime/action-flow';
import type { StealthOwnedPayment } from '../runtime/stealth-cache';
import { formatPrivateBalanceAmount, formatPrivateBalanceXlm } from '../runtime/selectors';
import { PrivateActionError } from './PrivateActionError';

/**
 * Cached reusable-address receipts are intentionally folded into the native
 * private asset sheet. Preparing and confirming never opens a second modal.
 */
export function StealthReceipts() {
  const {
    asset,
    isLeader,
    verifiedBalanceStroops,
    stealthPayments,
    stealthSyncing,
    stealthError,
    prepareStealthSweep,
    submitStealthSweep,
    cancelAction,
  } = usePrivateBalanceRuntimeData();
  const [selected, setSelected] = useState<StealthOwnedPayment | null>(null);
  const [prepared, setPrepared] = useState<PreparedStealthSweep | null>(null);
  const [progress, setProgress] = useState<PrivateActionProgressStage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const preparedRef = useRef<PreparedStealthSweep | null>(null);
  const cancelRef = useRef(cancelAction);

  const receipts = useMemo(
    () => stealthPayments.filter(payment =>
      payment.status === 'unspent' || payment.status === 'sweeping'),
    [stealthPayments],
  );

  useEffect(() => {
    cancelRef.current = cancelAction;
  }, [cancelAction]);

  useEffect(() => () => {
    abortRef.current?.abort();
    const abandoned = preparedRef.current;
    preparedRef.current = null;
    if (abandoned) void cancelRef.current(abandoned.review.id).catch(() => undefined);
  }, []);

  if (asset?.kind !== 'native' || (receipts.length === 0 && !stealthError && !status)) {
    return null;
  }

  const decimals = asset.decimals;
  const code = asset.code;
  const amount = (stroops: string | bigint) =>
    `${fmtAmount(formatPrivateBalanceAmount(BigInt(stroops), decimals))} ${code}`;

  async function startReview(payment: StealthOwnedPayment) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSelected(payment);
    setPrepared(null);
    preparedRef.current = null;
    setError(null);
    setStatus(null);
    setProgress('checking-chain');
    setPreparing(true);
    try {
      const next = await prepareStealthSweep(payment, setProgress, controller.signal);
      if (controller.signal.aborted) return;
      preparedRef.current = next;
      setPrepared(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause);
    } finally {
      if (!controller.signal.aborted) setPreparing(false);
    }
  }

  async function discardReview() {
    abortRef.current?.abort();
    const abandoned = preparedRef.current;
    preparedRef.current = null;
    setPrepared(null);
    setSelected(null);
    setPreparing(false);
    setProgress(null);
    setError(null);
    if (abandoned) {
      try {
        await cancelAction(abandoned.review.id);
      } catch (cause) {
        setError(cause);
      }
    }
  }

  async function confirmMove() {
    if (!prepared) return;
    const submitted = prepared;
    preparedRef.current = null;
    setWorking(true);
    setError(null);
    try {
      const outcome = await submitStealthSweep(submitted);
      setPrepared(null);
      setSelected(null);
      setStatus(outcome === 'broadcast'
        ? 'Moving to your private balance…'
        : 'Submitted. Checking the result…');
    } catch (cause) {
      setPrepared(null);
      setSelected(null);
      setError(cause);
    } finally {
      setWorking(false);
    }
  }

  if (selected) {
    const review = prepared?.review ?? null;
    const maximumFee = review
      ? review.transaction.classicFeeStroops + review.transaction.resourceFeeStroops
      : null;
    const balanceAfter = BigInt(verifiedBalanceStroops) + BigInt(selected.amountStroops);
    return (
      <section className="mt-5" aria-labelledby="private-receipt-review-title">
        <div className="panel-inset p-4">
          <p id="private-receipt-review-title" className="text-[13px] font-semibold text-white">
            Move to Private Balance
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-neutral-400">
            This deposits a reusable-address receipt into your encrypted private balance.
          </p>

          <dl className="mt-3 divide-y divide-white/[0.08] border-y border-white/[0.08]">
            <ReviewRow label="Amount">
              <span className="mono text-white">{amount(selected.amountStroops)}</span>
            </ReviewRow>
            <ReviewRow label="One-time account">
              <HashValue
                value={selected.destinationPublicKey}
                className="justify-end text-[11.5px] text-neutral-300"
              />
            </ReviewRow>
            <ReviewRow label="Maximum network fee">
              {maximumFee === null ? (
                <span className="inline-flex items-center gap-2 text-neutral-400">
                  <Spinner size={12} /> {progressLabel(progress ?? 'checking-chain')}
                </span>
              ) : (
                <span className="mono text-white">
                  {fmtAmount(formatPrivateBalanceXlm(maximumFee))} XLM
                </span>
              )}
            </ReviewRow>
            <ReviewRow label="Private balance after">
              <span className="mono text-[#30D158]">{amount(balanceAfter)}</span>
            </ReviewRow>
          </dl>

          <p className="mt-3 text-[11.5px] leading-relaxed text-neutral-500">
            The receipt and this deposit remain visible on Stellar. Future private transfers hide
            their amount and recipient.
          </p>
          {error ? <div className="mt-3"><PrivateActionError cause={error} /></div> : null}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button variant="ghost" disabled={working} onClick={() => void discardReview()}>
              Back
            </Button>
            <Button
              loading={working}
              disabled={preparing || !prepared || working}
              onClick={() => void confirmMove()}
            >
              Confirm
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-5" aria-labelledby="private-receipts-title">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div>
          <h3 id="private-receipts-title" className="text-[13px] font-semibold text-white">
            Ready to move
          </h3>
          <p className="mt-0.5 text-[11.5px] text-neutral-500">
            Received through your reusable private address
          </p>
        </div>
        {stealthSyncing ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
            <Spinner size={11} /> Checking
          </span>
        ) : null}
      </div>

      {status ? (
        <p aria-live="polite" className="mb-2 rounded-xl bg-[#0A84FF]/[0.08] px-3 py-2 text-[12px] text-neutral-300">
          {status}
        </p>
      ) : null}
      {stealthError ? <PrivateActionError cause={new Error(stealthError)} /> : null}

      {receipts.length > 0 ? (
        <div className="panel-inset divide-y divide-white/[0.08]">
          {receipts.map(payment => {
            const moving = payment.status === 'sweeping';
            return (
              <div
                key={`${payment.transactionHash}:${payment.destinationPublicKey}`}
                className="flex items-center gap-3 px-4 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="mono text-[14px] font-semibold text-white">
                    +{amount(payment.amountStroops)}
                  </p>
                  <HashValue
                    value={payment.destinationPublicKey}
                    className="mt-1 justify-start text-[10.5px] text-neutral-500"
                  />
                </div>
                <Button
                  variant="secondary"
                  className="shrink-0 !min-h-9 !px-3 !py-1.5 text-[11.5px]"
                  disabled={moving || !isLeader}
                  loading={moving}
                  onClick={() => void startReview(payment)}
                >
                  Move to Private Balance
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      {!isLeader && receipts.some(payment => payment.status === 'unspent') ? (
        <p className="mt-2 px-1 text-[11.5px] text-neutral-500">
          Private payments are active in another tab. Continue there to move this receipt.
        </p>
      ) : null}
    </section>
  );
}

function ReviewRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2.5 text-[12px]">
      <dt className="shrink-0 text-neutral-400">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-neutral-100">{children}</dd>
    </div>
  );
}
