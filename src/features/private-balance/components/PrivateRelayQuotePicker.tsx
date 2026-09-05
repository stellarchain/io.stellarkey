'use client';

import { useState } from 'react';
import { AccountMark } from '@/components/AccountMark';
import { fmtAmount } from '@/lib/format';
import type { PrivateRelayQuote } from '../relay/protocol';
import { formatPrivateBalanceAmount } from '../runtime/selectors';

export function PrivateRelayQuotePicker({
  quotes,
  code,
  decimals,
  disabled,
  comparing,
  onSelect,
}: {
  quotes: readonly PrivateRelayQuote[];
  code: string;
  decimals: number;
  disabled: boolean;
  comparing: boolean;
  onSelect(quoteId: string): void;
}) {
  // Once choices are actionable, a later/lower offer must not move another
  // account under a pointer or replace the focused row. Reset for a new job.
  const requestId = quotes[0]?.requestId;
  const [ordering, setOrdering] = useState(() => ({ requestId, rows: [...quotes] }));
  const previous = ordering.requestId === requestId ? ordering.rows : [];
  const added = quotes.filter(quote => !previous.some(row => row.peerAccount === quote.peerAccount));
  // Keep unavailable slots too: removing an expired first row would move the
  // next account under the same pointer. These public offers live only here.
  const orderedQuotes = [...previous.map(row => quotes.find(quote => quote.peerAccount === row.peerAccount) ?? row), ...added];
  if (ordering.requestId !== requestId || added.length > 0 || previous.some((row, index) => row !== orderedQuotes[index])) {
    setOrdering({ requestId, rows: orderedQuotes });
  }
  const lowestFee = quotes.reduce<bigint | null>((lowest, quote) => {
    const fee = BigInt(quote.feeAtomic);
    return lowest === null || fee < lowest ? fee : lowest;
  }, null);
  return (
    <section
      aria-labelledby="private-relay-quotes-title"
      className="panel-inset overflow-hidden"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.08] px-4 py-3">
        <div>
          <h3 id="private-relay-quotes-title" className="text-[13px] font-semibold text-white">
            Available peers
          </h3>
          <p className="mt-0.5 text-[11.5px] text-neutral-500">
            {comparing ? 'Choose now, or wait briefly for more offers' : 'Choose who submits this transaction'}
          </p>
        </div>
        <span className="text-[11.5px] font-medium text-neutral-400">
          {quotes.length} {quotes.length === 1 ? 'offer' : 'offers'}{comparing ? ' found' : ''}
        </span>
      </div>
      <div className="divide-y divide-white/[0.08]">
        {orderedQuotes.map((quote, index) => {
          const available = quotes.some(candidate => candidate.quoteId === quote.quoteId);
          const fee = `${fmtAmount(formatPrivateBalanceAmount(BigInt(quote.feeAtomic), decimals))} ${code}`;
          const peer = `${quote.peerAccount.slice(0, 8)}…${quote.peerAccount.slice(-8)}`;
          const validUntil = new Date(quote.expiresAt * 1_000).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          return (
            <button
              key={quote.peerAccount}
              type="button"
              disabled={disabled || !available}
              aria-label={`Choose peer ${index + 1} for ${fee}`}
              onClick={() => onSelect(quote.quoteId)}
              className="row-hover flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0A84FF] disabled:cursor-wait disabled:opacity-50"
            >
              <AccountMark publicKey={quote.peerAccount} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-white">
                  Peer {index + 1}
                  {available && BigInt(quote.feeAtomic) === lowestFee ? (
                    <span className="rounded-full bg-[#30D158]/12 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[#30D158]">
                      Lowest fee
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block font-mono text-[10.5px] text-neutral-400" title={quote.peerAccount}>
                  {peer}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[12.5px] font-semibold text-white">{fee}</span>
                <span className="mt-0.5 block text-[11px] font-semibold text-[#64B5FF]">
                  {available ? `Choose now · until ${validUntil}` : 'Offer no longer available'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-white/[0.08] px-4 py-2.5 text-[11px] leading-relaxed text-neutral-500">
        The selected peer receives this fee privately in {code}. Its account becomes the public
        transaction source; your account does not.
      </p>
    </section>
  );
}
