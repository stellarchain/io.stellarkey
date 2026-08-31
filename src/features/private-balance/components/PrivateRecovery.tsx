'use client';

import { useState } from 'react';
import { Button, Modal, ModalHeader, Notice } from '@/components/ui';
import {
  usePrivateBalanceRuntimeData,
} from '@/hooks/usePrivateBalanceRuntime';
import { triggerHaptic } from '@/lib/haptics';
import { HumanizedErrorNotice } from './PrivateBalanceStatus';

/**
 * Recovery is a local verification pass over immutable on-chain records.
 */
export function PrivateRecovery({ onClose }: { onClose(): void }) {
  const {
    checkpoint,
    syncProgress,
    refreshSync,
  } = usePrivateBalanceRuntimeData();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const scan = async () => {
    triggerHaptic('selection');
    setWorking(true);
    setError(null);
    try {
      await refreshSync();
    } catch (cause: unknown) {
      setError(cause ?? new Error('Private recovery stopped safely.'));
    } finally {
      setWorking(false);
    }
  };

  const checking = working && syncProgress && syncProgress.total > 1
    ? `Checking ${Math.min(syncProgress.current, syncProgress.total)} of ${syncProgress.total}…`
    : 'Checking…';

  return (
    <Modal open onClose={onClose} dismissable={!working}>
      <ModalHeader
        title="Recovery"
        subtitle="Restore access on this device"
        onClose={working ? undefined : onClose}
      />
      <div className="space-y-4 p-4 sm:p-6">
        <>
            <Notice>
              StellarKey reads the public record on the network for activity since your last
              verified point and verifies it on this device. Your recovery phrase stays inside your vault.
            </Notice>
            <dl className="ios-group overflow-hidden">
              <div className="ios-sep flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-[13px]">
                <dt className="text-neutral-400">Verified through</dt>
                <dd className="font-semibold text-white">
                  {checkpoint ? `Ledger ${checkpoint.latestLedger.toLocaleString()}` : 'Not yet'}
                </dd>
              </div>
            </dl>
            <p className="text-[11.5px] leading-relaxed text-neutral-500">
              Your balance stays unavailable for spending until the check completes.
            </p>
            {error !== null ? <HumanizedErrorNotice cause={error} /> : null}
            <div aria-live="polite">
              {working ? (
                <p className="text-center text-[12.5px] font-medium text-neutral-300">{checking}</p>
              ) : null}
            </div>
            <Button type="button" className="w-full" loading={working} onClick={() => void scan()}>
              {working ? checking : 'Check for New Activity'}
            </Button>
            <p className="text-center text-[11px] leading-relaxed text-neutral-500">
              Picks up where your last check left off. For a from-scratch recheck of your whole
              history, open Advanced privacy → Verify private history.
            </p>
        </>
      </div>
    </Modal>
  );
}
