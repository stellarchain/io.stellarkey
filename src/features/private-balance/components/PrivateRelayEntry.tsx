'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { IconChevronDown, IconGift } from '@/components/icons';
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

export function PrivateRelayEntry() {
  const { asset, deployment, publicAddress } = usePrivateBalanceRuntimeData();
  const [open, setOpen] = useState(false);
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
    : helperStatus.phase === 'listening'
      ? 'Listening'
      : helperStatus.phase === 'reconnecting'
        ? 'Reconnecting'
        : helperStatus.phase === 'unavailable'
          ? 'Unavailable'
          : helperStatus.phase === 'waiting'
            ? 'Waiting'
            : 'Connecting';
  const helperDescription = !preferences.helpRelay
    ? 'Help submit private payments for a private reward'
    : helperStatus.phase === 'listening'
      ? `Listening on ${helperStatus.connectedRelays} of ${helperStatus.totalRelays} public relays`
      : helperStatus.phase === 'reconnecting'
        ? 'Reconnecting to the public relay network'
        : helperStatus.phase === 'unavailable'
          ? 'Public relay connection unavailable'
          : helperStatus.phase === 'waiting'
            ? 'Waiting for Private Payments to finish syncing'
            : 'Connecting to the public relay network';
  const helperIsListening = preferences.helpRelay && helperStatus.phase === 'listening';

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
          helperIsListening ? 'text-[#30D158]' : preferences.helpRelay ? 'text-neutral-400' : 'text-[#0A84FF]'
        }`} aria-live="polite">
          {status}
        </span>
        <IconChevronDown size={14} className="-rotate-90 text-neutral-600" />
      </button>

      {open ? (
        <Modal open onClose={() => setOpen(false)}>
          <ModalHeader
            title="Earn by relaying"
            subtitle="Help another wallet submit without exposing its account"
            onClose={() => setOpen(false)}
          />
          <div className="space-y-5 p-4 sm:p-6">
            <PrivateRelayAvailability
              networkId={deployment.networkId}
              poolContractId={deployment.poolContractId}
              publicAddress={publicAddress}
              code={asset?.code ?? 'Asset'}
              decimals={asset?.decimals ?? 7}
            />
            <PrivateRelaySettings helperOnly onSaved={() => setOpen(false)} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
