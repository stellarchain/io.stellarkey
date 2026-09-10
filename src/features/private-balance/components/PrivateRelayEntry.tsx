'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { IconChevronDown, IconGift } from '@/components/icons';
import { LoadingRegion, Modal, ModalHeader } from '@/components/ui';
import { usePrivateBalanceRuntime, usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import {
  loadPrivateRelayPreferences,
  PRIVATE_RELAY_PREFERENCES_EVENT,
  type PrivateRelayPreferences,
} from '../relay/preferences';
import {
  getPrivateRelayHelperServerStatus,
  getPrivateRelayHelperStatus,
  subscribePrivateRelayHelperStatus,
} from '../relay/helper-status';
import { describePrivateRelayNetwork, privateRelayNetwork } from '../relay/network';
import { describePrivateRelayConfigurationProblem } from '../relay/connection-error';
import type { PrivateRelayEntryPresentation } from './PrivateRelayEntryBody';

// The status, settings and peer availability content pulls the relay settings
// form and the Waku transport. It loads on the first open; the trigger row
// and the dialog shell are always ready.
const PrivateRelayEntryBody = dynamic(
  () => import('./PrivateRelayEntryBody').then((module) => module.PrivateRelayEntryBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

export function PrivateRelayEntry() {
  const { phase, error } = usePrivateBalanceRuntimeData();
  const { requested } = usePrivateBalanceRuntime();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
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

  const runtimeUnavailable = phase === 'safe-error' || phase === 'status-unknown' || error !== null;
  // Never infer a socket attempt from a saved opt-in. The helper is lazy and
  // may not even be mounted yet; private runtime intent is scoped to unlock.
  const helperPhase = !requested ? 'paused'
    : runtimeUnavailable ? 'unavailable'
      : phase !== 'current' || helperStatus.phase === 'off' || helperStatus.phase === 'waiting'
        ? 'preparing' : helperStatus.phase;
  const status = !preferences.helpRelay
    ? 'Set up'
    : helperPhase === 'paused'
      ? 'Paused'
      : helperPhase === 'preparing'
        ? 'Preparing wallet'
        : helperPhase === 'connected'
          ? 'Connected'
          : helperPhase === 'reconnecting'
            ? 'Reconnecting'
            : helperPhase === 'configuration-error'
              ? 'Check connections'
              : helperPhase === 'unavailable'
                ? 'Unavailable'
                : 'Connecting';
  const networkCopy = describePrivateRelayNetwork(privateRelayNetwork(preferences));
  const networkName = 'the Waku network';
  const helperDescription = !preferences.helpRelay
    ? 'Help submit private payments for a private reward'
    : helperPhase === 'paused'
      ? 'Resume relaying to connect this unlocked wallet'
      : helperPhase === 'preparing'
        ? 'Preparing Private Payments before connecting'
        : helperPhase === 'connected'
          ? networkCopy.connection(helperStatus.connectedRelays, helperStatus.totalRelays)
          : helperPhase === 'reconnecting'
            ? `Reconnecting to ${networkName}`
            : helperPhase === 'configuration-error' && helperStatus.configurationProblem
              ? describePrivateRelayConfigurationProblem(helperStatus.configurationProblem)
              : helperPhase === 'unavailable'
                ? runtimeUnavailable
                  ? 'Private Payments needs attention. Open its details before relaying.'
                  : 'Waku service node connection unavailable; retrying automatically'
                : `Connecting to ${networkName}`;
  const helperIsConnected = preferences.helpRelay && helperPhase === 'connected';
  const headline = !preferences.helpRelay
    ? 'Relaying is off'
    : helperIsConnected
      ? 'Relaying'
      : helperPhase === 'paused'
        ? 'Ready to relay'
        : helperPhase === 'configuration-error'
          ? 'Connection settings need attention'
          : helperPhase === 'unavailable'
            ? runtimeUnavailable ? 'Wallet needs attention' : 'Connection interrupted'
            : helperPhase === 'reconnecting'
              ? 'Reconnecting…'
              : helperPhase === 'preparing'
                ? 'Getting ready…'
                : 'Connecting…';
  const tone: PrivateRelayEntryPresentation['tone'] = !preferences.helpRelay
    ? 'off'
    : helperIsConnected
      ? 'live'
      : helperPhase === 'unavailable' || helperPhase === 'configuration-error'
        ? 'trouble'
        : 'waiting';
  const presentation: PrivateRelayEntryPresentation = {
    helpRelay: preferences.helpRelay,
    status,
    tone,
    headline,
    helperDescription,
  };
  const close = () => {
    // Peer information clears immediately with the body; the shell holds its
    // geometry through the exit on its own.
    setOpen(false);
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
          <span className="block text-[13.5px] font-semibold text-white">Earn by Relaying</span>
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

      <Modal open={open} onClose={close} wide dirty={dirty}>
        <ModalHeader
          title="Earn by Relaying"
          subtitle="Help a payment. Receive a private fee."
          onClose={close}
        />
        {open ? (
          <PrivateRelayEntryBody presentation={presentation} onDirtyChange={setDirty} />
        ) : null}
      </Modal>
    </>
  );
}
