'use client';

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
  return (
    <section
      aria-labelledby="private-relay-quotes-title"
      aria-busy={comparing}
      className="panel-inset overflow-hidden"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.08] px-4 py-3">
        <div>
          <h3 id="private-relay-quotes-title" className="text-[13px] font-semibold text-white">
            Available peers
          </h3>
          <p className="mt-0.5 text-[11.5px] text-neutral-500">
            {comparing ? 'Checking briefly for a better fee' : 'Choose who submits this transaction'}
          </p>
        </div>
        <span className="text-[11.5px] font-medium text-neutral-400">
          {quotes.length} {quotes.length === 1 ? 'offer' : 'offers'}{comparing ? ' found' : ''}
        </span>
      </div>
      <div className="divide-y divide-white/[0.08]">
        {quotes.map((quote, index) => {
          const fee = `${fmtAmount(formatPrivateBalanceAmount(BigInt(quote.feeAtomic), decimals))} ${code}`;
          const peer = `${quote.peerAccount.slice(0, 8)}…${quote.peerAccount.slice(-8)}`;
          const validUntil = new Date(quote.expiresAt * 1_000).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          return (
            <button
              key={quote.quoteId}
              type="button"
              disabled={disabled}
              aria-label={`Choose peer ${index + 1} for ${fee}`}
              onClick={() => onSelect(quote.quoteId)}
              className="row-hover flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0A84FF] disabled:cursor-wait disabled:opacity-50"
            >
              <AccountMark publicKey={quote.peerAccount} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-white">
                  Peer {index + 1}
                  {index === 0 ? (
                    <span className="rounded-full bg-[#30D158]/12 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[#30D158]">
                      Lowest fee
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block font-mono text-[10.5px] text-neutral-500" title={quote.peerAccount}>
                  {peer}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[12.5px] font-semibold text-white">{fee}</span>
                <span className="mt-0.5 block text-[11px] font-semibold text-[#0A84FF]">
                  Choose · until {validUntil}
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
