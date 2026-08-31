'use client';

import { useMemo } from 'react';
import { fmtAmount } from '@/lib/format';
import { humanizePrivateError, type HumanizedPrivateError } from '../copy';
import { PrivateConsolidationRequiredError } from '../runtime/action-flow';
import { PrivateChainedFeePreflightError } from '../runtime/chained-send';
import { formatPrivateBalanceXlm } from '../runtime/selectors';

/**
 * Raised by the review screen when a prepared review stops matching what the
 * person typed — the confirm button refuses to enable until they go back.
 */
export class PrivateReviewMismatchError extends Error {
  constructor(detail: string) {
    super(`Prepared review does not match the drafted action: ${detail}`);
    this.name = 'PrivateReviewMismatchError';
  }
}

/**
 * The single humanizer for action-flow errors: typed causes that carry data
 * (the fee shortfall, a review mismatch) get their own copy; everything else
 * goes through the shared `humanizePrivateError` rules.
 */
export function humanizeActionFlowError(cause: unknown): HumanizedPrivateError {
  if (cause instanceof PrivateChainedFeePreflightError) {
    const missing = fmtAmount(formatPrivateBalanceXlm(BigInt(cause.missingStroops)));
    return {
      title: 'Not enough XLM for network fees',
      body: `This send runs in several steps and needs about ${missing} XLM more in your public balance to cover their network fees. Nothing was sent — add XLM, then try again.`,
      action: 'add-funds',
      technical: cause.message,
    };
  }
  if (cause instanceof PrivateReviewMismatchError) {
    return {
      title: "The review didn't match what you entered",
      body: 'Nothing was signed and your money is safe. Go back and review it again.',
      technical: cause.message,
    };
  }
  if (cause instanceof PrivateConsolidationRequiredError) {
    // Only non-send flows surface this; a private send folds the steps into
    // one approval on its own.
    return {
      title: 'Your balance needs preparing first',
      body: 'This amount is spread across several past payments. Try a smaller amount, or make a private send first — sending tidies your balance automatically.',
      action: 'lower-amount',
      technical: cause.message,
    };
  }
  return humanizePrivateError(cause);
}

/**
 * Every action-flow error renders through this panel: plain words, a true
 * your-money-is-safe fact, and the raw runtime message folded away under
 * "Technical details".
 */
export function PrivateActionError({ cause }: { cause: unknown }) {
  const humanized = useMemo(() => humanizeActionFlowError(cause), [cause]);
  return (
    <div role="alert" className="rounded-2xl border border-[#FF453A]/25 bg-[#FF453A]/[0.08] p-4">
      <p className="text-[13px] font-semibold text-white">{humanized.title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-300">{humanized.body}</p>
      <details className="mt-2">
        <summary className="cursor-pointer select-none text-[11.5px] text-neutral-500">
          Technical details
        </summary>
        <p className="mt-1.5 break-all font-mono text-[10.5px] leading-relaxed text-neutral-500">
          {humanized.technical}
        </p>
      </details>
    </div>
  );
}
