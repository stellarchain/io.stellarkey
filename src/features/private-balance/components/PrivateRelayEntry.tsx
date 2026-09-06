'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IconChevronDown, IconGift, IconShield } from '@/components/icons';
import { Modal, ModalHeader } from '@/components/ui';
import {
  loadPrivateRelayPreferences,
  PRIVATE_RELAY_PREFERENCES_EVENT,
  type PrivateRelayPreferences,
} from '../relay/preferences';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateRelayAvailability } from './PrivateRelayAvailability';
import { PrivateRelaySettings } from './PrivateRelaySettings';
import {
  getPrivateRelayHelperServerStatus,
  getPrivateRelayHelperStatus,
  subscribePrivateRelayHelperStatus,
} from '../relay/helper-status';

// A static connection motif, not a traffic or earnings visualization.
function RelayMark({ large = false }: { large?: boolean }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 80 80" fill="none"
    className={large ? 'h-20 w-20 shrink-0 text-accent' : 'h-10 w-10 shrink-0 text-accent'}>
    <path d="M17 24 40 40 64 20M40 40 62 62M40 40 17 60" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.5" />
    <circle cx="40" cy="40" r="17" stroke="currentColor" strokeOpacity=".2" />
    <circle cx="40" cy="40" r="10" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="40" cy="40" r="3" fill="currentColor" />
    <g fill="var(--color-panel)" stroke="currentColor" strokeWidth="1.5">
      <circle cx="17" cy="24" r="4" /><circle cx="64" cy="20" r="4" />
      <circle cx="62" cy="62" r="4" /><circle cx="17" cy="60" r="4" />
    </g>
  </svg>;
}

export function PrivateRelayEntry() {
  const { asset, deployment, publicAddress } = usePrivateBalanceRuntimeData();
  const [open, setOpen] = useState(false);
  const [exploring, setExploring] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [exitHeight, setExitHeight] = useState(0);
  const [preferences, setPreferences] = useState<PrivateRelayPreferences>(
    loadPrivateRelayPreferences,
  );
  const helperStatus = useSyncExternalStore(
    subscribePrivateRelayHelperStatus,
    getPrivateRelayHelperStatus,
    getPrivateRelayHelperServerStatus,
  );

  useEffect(() => {
    const refresh = () => setPreferences(loadPrivateRelayPreferences());
    window.addEventListener(PRIVATE_RELAY_PREFERENCES_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PRIVATE_RELAY_PREFERENCES_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const status = !preferences.helpRelay
    ? 'Set up'
    : helperStatus.phase === 'connected'
      ? 'Connected'
      : helperStatus.phase === 'reconnecting'
        ? 'Reconnecting'
        : helperStatus.phase === 'unavailable'
          ? 'Unavailable'
          : helperStatus.phase === 'waiting'
            ? 'Waiting'
            : 'Connecting';
  const helperDescription = !preferences.helpRelay
    ? 'Help submit private payments for a private reward'
    : helperStatus.phase === 'connected'
      ? `Connected to ${helperStatus.connectedRelays} of ${helperStatus.totalRelays} public relays`
      : helperStatus.phase === 'reconnecting'
        ? 'Reconnecting to the public relay network'
        : helperStatus.phase === 'unavailable'
          ? 'Public relay connection unavailable'
          : helperStatus.phase === 'waiting'
            ? 'Waiting for Private Payments to finish syncing'
            : 'Connecting to the public relay network';
  const helperIsConnected = preferences.helpRelay && helperStatus.phase === 'connected';
  const headline = !preferences.helpRelay
    ? 'Relay on your terms.'
    : helperIsConnected
      ? 'You’re available.'
      : helperStatus.phase === 'unavailable'
        ? 'Connection interrupted.'
        : helperStatus.phase === 'reconnecting'
          ? 'Getting you back online.'
          : helperStatus.phase === 'waiting'
            ? 'Waiting for your wallet.'
            : 'Getting connected.';
  const statusTone = helperIsConnected ? 'text-pos' : preferences.helpRelay ? 'text-warn' : 'text-muted';
  const close = () => {
    // Clear peer information immediately, retaining only geometry for exit.
    setExitHeight(bodyRef.current?.offsetHeight ?? 0);
    setOpen(false);
    setExploring(false);
  };

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="row-hover mt-2 flex min-h-14 w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left focus-visible:ring-2 focus-visible:ring-[#0A84FF]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#30D158]/12 text-[#30D158]">
          <IconGift size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-white">Earn by relaying</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-neutral-500">
            {helperDescription}
          </span>
        </span>
        <span className={`shrink-0 text-[12px] font-semibold ${
          helperIsConnected ? 'text-[#30D158]' : preferences.helpRelay ? 'text-neutral-400' : 'text-[#0A84FF]'
        }`} aria-live="polite">
          {status}
        </span>
        <IconChevronDown size={14} className="-rotate-90 text-neutral-600" />
      </button>

        <Modal open={open} onClose={close} wide>
          <ModalHeader
            title="Earn by relaying"
            subtitle="Help a payment. Receive a private fee."
            onClose={close}
          />
          <div ref={bodyRef} style={!open ? { height: exitHeight } : undefined} className="px-4 pb-4 sm:px-6 sm:pb-6">
          {open ? <>
            <section aria-label="Your relay status" className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <span role="status" className={`inline-flex items-center gap-2 font-semibold ${statusTone}`}>
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                  {preferences.helpRelay ? status : 'Not relaying'}
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted"><IconShield size={13} />Manual approval</span>
              </div>
              <div className="mt-3 flex min-h-24 items-center justify-between gap-3">
                <div className="min-w-0 max-w-80">
                  <h3 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink sm:text-[34px]">{headline}</h3>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
                    {preferences.helpRelay ? helperDescription : 'Help another wallet keep its sending account private. Choose a fee and review each request.'}
                  </p>
                </div>
                <span className="hidden min-[360px]:block"><RelayMark large /></span>
              </div>
            </section>
            <PrivateRelaySettings helperOnly />
            <details className="group/peers mt-1 border-t border-white/[0.08]" open={exploring}
              onToggle={event => setExploring(event.currentTarget.open)}>
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 text-[13px] font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                Explore other peers
                <IconChevronDown size={14} className="shrink-0 group-open/peers:rotate-180" />
              </summary>
              {exploring ? <div className="space-y-3 pb-4">
                <p className="px-1 text-[12px] leading-relaxed text-muted">Compare other helpers’ fees. This check is separate from your own relay connection.</p>
                <PrivateRelayAvailability
                  networkId={deployment.networkId}
                  poolContractId={deployment.poolContractId}
                  publicAddress={publicAddress}
                  code={asset?.code ?? 'Asset'}
                  decimals={asset?.decimals ?? 7}
                />
              </div> : null}
            </details>
          </> : null}
          </div>
        </Modal>
    </>
  );
}
