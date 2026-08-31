'use client';

import { useState } from 'react';
import { IconRefresh, IconShield } from '@/components/icons';
import { Modal, ModalHeader } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { triggerHaptic } from '@/lib/haptics';
import { PrivacyDisclosure } from './PrivacyDisclosure';
import { HumanizedErrorNotice, PrivateBalanceStatus } from './PrivateBalanceStatus';
import { PrivateProtocolSettings } from './PrivateProtocolSettings';
import { PrivateRecovery } from './PrivateRecovery';

function Chevron() {
  return (
    <svg aria-hidden="true" className="shrink-0 text-neutral-600" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1l5 6-5 6" />
    </svg>
  );
}

export function PrivatePaymentsDetails({
  onClose,
  onRemoved,
}: {
  onClose(): void;
  onRemoved?(): void;
}) {
  const { phase, refreshSync } = usePrivateBalanceRuntimeData();
  const [destination, setDestination] = useState<'recovery' | 'protocol' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const working = refreshing ||
    ['loading-artifacts', 'reading-meta', 'scanning-live'].includes(phase);

  // The refresh affordance lives here — the card stays silent when healthy.
  const refresh = async () => {
    triggerHaptic('light');
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshSync();
    } catch (cause: unknown) {
      setRefreshError(cause ?? new Error('Private payments stopped safely.'));
    } finally {
      setRefreshing(false);
    }
  };

  if (destination === 'recovery') return <PrivateRecovery onClose={onClose} />;
  if (destination === 'protocol') {
    return <PrivateProtocolSettings onClose={onClose} onRemoved={onRemoved} />;
  }

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title="Private Payments details"
        subtitle="Status, recovery, and privacy"
        onClose={onClose}
      />
      <div className="space-y-5 p-4 sm:p-6">
        <section aria-labelledby="private-details-status">
          <h3 id="private-details-status" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Current status
          </h3>
          <PrivateBalanceStatus detailed />
        </section>

        <section aria-labelledby="private-details-privacy">
          <h3 id="private-details-privacy" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            What stays public
          </h3>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <PrivacyDisclosure />
          </div>
        </section>

        <section aria-labelledby="private-details-tools">
          <h3 id="private-details-tools" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Manage
          </h3>
          <div className="list-group overflow-hidden">
            <button
              type="button"
              disabled={working}
              onClick={() => void refresh()}
              className="row-hover ios-sep flex min-h-14 w-full items-center gap-3.5 px-4 py-3 text-left disabled:opacity-60"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-neutral-200">
                <IconRefresh size={15} className={working ? 'animate-spin' : ''} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-white">
                  {working ? 'Updating…' : 'Refresh'}
                </span>
                <span className="block text-[11px] text-neutral-500">Check for new private activity</span>
              </span>
            </button>
            <button type="button" onClick={() => setDestination('recovery')} className="row-hover ios-sep flex min-h-14 w-full items-center gap-3.5 px-4 py-3 text-left">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#30D158]/12 text-[#30D158]"><IconRefresh size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-white">Recovery</span>
                <span className="block text-[11px] text-neutral-500">Restore or rescan safely</span>
              </span>
              <Chevron />
            </button>
            <button type="button" onClick={() => setDestination('protocol')} className="row-hover flex min-h-14 w-full items-center gap-3.5 px-4 py-3 text-left">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0A84FF]/12 text-[#0A84FF]"><IconShield size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-white">Advanced privacy</span>
                <span className="block text-[11px] text-neutral-500">Verification and data on this device</span>
              </span>
              <Chevron />
            </button>
          </div>
          <div aria-live="polite" className="mt-2">
            {refreshError !== null ? <HumanizedErrorNotice cause={refreshError} /> : null}
          </div>
        </section>

        <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-neutral-500">
          <IconShield size={14} className="mt-0.5 shrink-0" />
          Proofs are created on this device; only the finished transaction reaches Stellar.
          StellarKey has no recovery server.
        </p>
      </div>
    </Modal>
  );
}
