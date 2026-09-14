'use client';

import { useEffect, useState } from 'react';
import { Notice } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { privatePrivacyAdvisories } from '../runtime/privacy-advisories';

export function PrivatePrivacyAdvisory({ kind, amount }: {
  kind: 'deposit' | 'transfer' | 'withdraw';
  amount: bigint | null;
}) {
  const { asset, activities } = usePrivateBalanceRuntimeData();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Age the advice locally while the form stays open; never refresh ledger
    // observation times or request additional history for these hints.
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const warnings = privatePrivacyAdvisories({ kind, amount, activities, now,
    decimals: asset?.decimals ?? 7, assetContractId: asset?.contractId ?? null });
  return <div aria-live="polite">
    {warnings.length > 0 ? <Notice tone="warn" compact>
      <div className="space-y-1.5">
        {warnings.includes('precise-deposit') ? <p>Amounts with many decimal places can be distinctive. Consider a rounder amount if it suits your payment; rounding does not guarantee privacy.</p> : null}
        {warnings.includes('matching-deposit') ? <p>This amount matches a deposit in your local history.</p> : null}
        {warnings.includes('recent-deposit') ? <p>Your local history includes a deposit of this asset within the last 24 hours.</p> : null}
        {kind === 'withdraw' ? <p>Public amounts and timing may link deposits to withdrawals. Waiting or splitting a payment does not guarantee privacy.</p> : null}
        <p className="text-[11.5px]">Checked on this device using available history only. No warning does not mean a payment is anonymous.</p>
      </div>
    </Notice> : null}
  </div>;
}
