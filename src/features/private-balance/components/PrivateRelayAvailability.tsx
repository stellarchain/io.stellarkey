'use client';

import { useEffect, useRef, useState } from 'react';
import { AccountMark } from '@/components/AccountMark';
import { IconRefresh, IconUsers } from '@/components/icons';
import { fmtAmount } from '@/lib/format';
import {
  checkPrivateRelayAvailability,
  type PrivateRelayAvailability as AvailabilityResult,
} from '../relay/availability';
import { loadPrivateRelayPreferences } from '../relay/preferences';
import { formatPrivateBalanceAmount } from '../runtime/selectors';

const AVAILABILITY_WINDOW_MS = 5_000;

export function PrivateRelayAvailability({
  networkId,
  poolContractId,
  publicAddress,
  code,
  decimals,
}: {
  networkId: string | null;
  poolContractId: string | null;
  publicAddress: string | null;
  code: string;
  decimals: number;
}) {
  const [result, setResult] = useState<AvailabilityResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const check = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setChecking(true);
    setResult(null);
    setError(null);
    try {
      if (!networkId || !poolContractId) {
        throw new Error('Private relay deployment unavailable');
      }
      const preferences = loadPrivateRelayPreferences();
      const next = await checkPrivateRelayAvailability({
        relayUrls: preferences.relayUrls,
        networkId,
        poolContractId,
        quoteWindowMs: AVAILABILITY_WINDOW_MS,
        excludePeerAccounts: publicAddress ? [publicAddress] : [],
      }, controller.signal);
      if (!controller.signal.aborted) setResult(next);
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      void cause;
      setError('Could not check peers safely. Check your connection and try again.');
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setChecking(false);
      }
    }
  };

  const count = result?.quotes.length ?? null;
  const status = checking
    ? 'Checking'
    : error
      ? 'Unavailable'
      : count === null
        ? 'Not checked'
        : `${count} available`;
  const checkedAt = result
    ? new Date(result.checkedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <section aria-labelledby="private-relay-availability-title" className="space-y-2">
      <div className="flex items-center justify-between gap-4 px-1">
        <h3
          id="private-relay-availability-title"
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500"
        >
          Relay network
        </h3>
        <span aria-live="polite" className={`text-[11.5px] font-semibold ${
          count !== null && count > 0 ? 'text-[#30D158]' : 'text-neutral-500'
        }`}>
          {status}
        </span>
      </div>

      <div className="ios-group overflow-hidden">
        <button
          type="button"
          disabled={checking}
          onClick={() => void check()}
          className="row-hover flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0A84FF] disabled:cursor-wait disabled:opacity-60"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0A84FF]/12 text-[#0A84FF]">
            {checking
              ? <IconRefresh size={17} className="animate-spin" />
              : <IconUsers size={17} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold text-white">
              {checking ? 'Looking for peers…' : 'Check available peers'}
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-neutral-500">
              {checking
                ? 'Waiting briefly for live fee offers'
                : 'No payment details are included in this check'}
            </span>
          </span>
          {!checking ? (
            <span className="shrink-0 text-[12px] font-semibold text-[#0A84FF]">
              {result || error ? 'Check again' : 'Check'}
            </span>
          ) : null}
        </button>

        {result ? (
          <>
            <div className="ios-sep px-4 py-2.5 text-[11px] leading-relaxed text-neutral-500">
              {count === 0
                ? 'No peers answered. This does not prove every peer is offline.'
                : `${count} ${count === 1 ? 'peer was' : 'peers were'} available when checked at ${checkedAt}. Availability can change before payment.`}
            </div>
            {result.quotes.map((quote, index) => {
              const fee = fmtAmount(formatPrivateBalanceAmount(BigInt(quote.feeAtomic), decimals));
              const peer = `${quote.peerAccount.slice(0, 8)}…${quote.peerAccount.slice(-8)}`;
              return (
                <div key={quote.quoteId} className="ios-sep flex min-h-14 items-center gap-3 px-4 py-2.5">
                  <AccountMark publicKey={quote.peerAccount} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
                      Peer {index + 1}
                      {index === 0 ? (
                        <span className="rounded-full bg-[#30D158]/12 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[#30D158]">
                          Lowest fee
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-neutral-500" title={quote.peerAccount}>
                      {peer}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[12px] font-semibold text-white">{fee} {code}</span>
                    <span className="mt-0.5 block text-[10.5px] text-neutral-500">private fee</span>
                  </span>
                </div>
              );
            })}
          </>
        ) : null}
      </div>

      {error ? <p role="alert" className="px-1 text-[12px] text-[#FF6961]">{error}</p> : null}
    </section>
  );
}
