'use client';

import { useId, useState } from 'react';
import { Select } from '@/components/ui';
import { useWalletIdentity } from '@/hooks/useWallet';
import { privateFeePayerUnavailableReason, type PrivateFeePayer } from '../runtime/fee-policy';

/** Local to an opening; selecting a payer never selects the wallet account. */
export function usePrivateFeeAccount() {
  const { activeAccount, accounts } = useWalletIdentity();
  const [selection, setSelection] = useState<{ owner: string; id: string; publicKey: string } | null>(null);
  const owner = activeAccount?.id ?? '';
  const feePayerAccountId = selection?.owner === owner ? selection.id : owner;
  const feePayer: PrivateFeePayer | undefined = selection?.owner === owner && activeAccount && selection.publicKey !== activeAccount.publicKey
    ? { accountId: selection.id, publicKey: selection.publicKey } : undefined;
  return {
    feePayerAccountId,
    feePayer,
    select: (id: string) => {
      const account = accounts.find(candidate => candidate.id === id);
      if (account && !privateFeePayerUnavailableReason(account)) setSelection({ owner, id, publicKey: account.publicKey });
    },
  };
}

export function PrivateFeeAccountSelector({ value, onChange, disabled = false }: {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const { activeAccount, accounts } = useWalletIdentity();
  const descriptionId = useId();
  return <div className="space-y-2">
    <p className="text-[12px] font-medium text-neutral-300">Network fee account</p>
    <Select
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel="Network fee account"
      aria-describedby={descriptionId}
      placeholder="Choose fee account"
      className="w-full"
      options={accounts.map(account => {
        const reason = privateFeePayerUnavailableReason(account);
        return {
          value: account.id,
          label: account.label,
          sublabel: account.hardware ? 'Hardware unavailable' : account.watchOnly ? 'Watch-only'
            : account.id === activeAccount?.id ? 'Current account' : 'Fees only',
          triggerLabel: account.label,
          disabled: reason !== null,
        };
      })}
    />
    <p id={descriptionId} className="text-[11.5px] leading-relaxed text-neutral-400">
      Pays network fees in public XLM. Your private funds stay in the current account.
      {value && value !== activeAccount?.id ? ' Both accounts are visible on Stellar.' : ''}
    </p>
    {accounts.some(account => privateFeePayerUnavailableReason(account)) ? (
      <p className="text-[11.5px] leading-relaxed text-neutral-400">Watch-only accounts cannot sign. Hardware fee signing is not supported in this build.</p>
    ) : null}
  </div>;
}
