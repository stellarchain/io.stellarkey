'use client';

import { useId } from 'react';
import { FiatValue } from '@/components/FiatValue';
import { FieldAction, FieldLabelRow, QuickAmountChips } from '@/components/ui';
import { fmtAmount } from '@/lib/format';

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
  enterKeyHint = 'next',
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
  /** `next` when another field follows, `done` when the amount is the last entry. */
  enterKeyHint?: 'next' | 'done';
}) {
  const amountId = useId();
  const errorId = `${amountId}-error`;
  const applyMax = () => {
    if (max === null) return;
    onAmount(max);
  };

  return (
    <div>
      <FieldLabelRow
        htmlFor={amountId}
        label="Amount"
        action={max !== null ? <FieldAction onClick={applyMax}>Max: {fmtAmount(max)} {code}</FieldAction> : null}
      />
      <input
        id={amountId}
        type="text"
        inputMode="decimal"
        enterKeyHint={enterKeyHint}
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
    <QuickAmountChips
      className="mt-2"
      values={QUICK_AMOUNTS}
      onPick={onAmount}
      max={max}
      onMax={max !== null ? () => onAmount(max) : undefined}
    />
  );
}
