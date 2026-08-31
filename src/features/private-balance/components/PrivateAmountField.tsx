'use client';

import { useId } from 'react';
import { FiatValue } from '@/components/FiatValue';
import { fmtAmount } from '@/lib/format';
import { triggerHaptic } from '@/lib/haptics';

const QUICK_AMOUNTS = [10, 25, 50, 100] as const;

/** Strips the padded decimals a formatter emits so the value re-parses. */
export function trimAmountInput(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

/**
 * The shared amount block for the private flows, mirroring the public send
 * form: Max in the label row, decimal input, live fiat line, quick chips,
 * and the inline validation message.
 */
export function PrivateAmountField({
  amount,
  onAmount,
  max,
  code,
  issuer,
  isNative,
  error,
  showQuickAmounts = true,
}: {
  amount: string;
  onAmount(next: string): void;
  /** Largest spendable amount in display units, already trimmed; null hides Max. */
  max: string | null;
  code: string;
  issuer?: string | null;
  isNative?: boolean;
  error?: string | null;
  showQuickAmounts?: boolean;
}) {
  const amountId = useId();
  const errorId = `${amountId}-error`;
  const applyMax = () => {
    if (max === null) return;
    triggerHaptic('selection');
    onAmount(max);
  };

  return (
    <div>
      <div className="flex items-center justify-between pb-1">
        <label htmlFor={amountId} className="field-label !pb-0">Amount</label>
        {max !== null ? (
          <button
            type="button"
            onClick={applyMax}
            className="text-[12px] font-medium text-[#0A84FF] hover:underline"
          >
            Max: {fmtAmount(max)} {code}
          </button>
        ) : null}
      </div>
      <input
        id={amountId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={amount}
        onChange={event => onAmount(event.target.value.replace(/,/g, '.'))}
        className="input mono text-base sm:text-[15px]"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      <FiatValue
        amount={amount}
        code={code}
        issuer={issuer}
        isNative={isNative}
        className="mt-1 block text-[11.5px] text-neutral-500"
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-[11.5px] text-[#FF453A]">{error}</p>
      ) : null}
      {showQuickAmounts ? <PrivateQuickAmounts onAmount={onAmount} max={max} /> : null}
    </div>
  );
}

export function PrivateQuickAmounts({
  onAmount,
  max,
}: {
  onAmount(next: string): void;
  max: string | null;
}) {
  return (
    <div className="mt-2 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
      {QUICK_AMOUNTS.map(value => (
        <button
          key={value}
          type="button"
          onClick={() => {
            triggerHaptic('selection');
            onAmount(String(value));
          }}
          className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11.5px] font-medium text-neutral-300 transition-colors hover:bg-white/[0.12] active:bg-white/[0.16]"
        >
          {value}
        </button>
      ))}
      {max !== null ? (
        <button
          type="button"
          onClick={() => {
            triggerHaptic('selection');
            onAmount(max);
          }}
          className="rounded-lg border border-[#0A84FF]/30 bg-[#0A84FF]/15 px-2.5 py-1 text-[11.5px] font-bold text-[#0A84FF] transition-colors hover:bg-[#0A84FF]/22 active:bg-[#0A84FF]/28"
        >
          MAX
        </button>
      ) : null}
    </div>
  );
}
