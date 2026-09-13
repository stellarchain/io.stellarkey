'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, ModalBody, ModalFooter, Notice } from '@/components/ui';
import {
  usePrivateBalanceRuntimeData,
} from '@/hooks/usePrivateBalanceRuntime';
import type { PrivateArchiveRestorationProgress } from '../runtime/archive-restoration';
import { HumanizedErrorNotice } from './PrivateBalanceStatus';
import { useReportToOwner } from './useReportToOwner';
import { PrivateHeldBalanceRecovery } from './PrivateHeldBalanceRecovery';

/**
 * Recovery is a local verification pass over immutable on-chain records. It
 * renders as a step inside the Private Payments dialog; the owning shell
 * shows the "Recovery" header and stays busy while a check is running.
 */
export function PrivateRecoveryContent({
  onBusyChange,
}: {
  onBusyChange?(busy: boolean): void;
}) {
  const {
    checkpoint,
    syncProgress,
    refreshSync,
    restorePrivateHistory,
    restoreRequiredActionIndex,
  } = usePrivateBalanceRuntimeData();
  const [working, setWorking] = useState(false);
  const [recoveryActivity, setRecoveryActivity] = useState({ busy: false, signing: false });
  const [error, setError] = useState<unknown>(null);
  const [restorationProgress, setRestorationProgress] =
    useState<PrivateArchiveRestorationProgress | null>(null);
  const [activeRestoration, setActiveRestoration] = useState(false);
  const operationRef = useRef<AbortController | null>(null);

  useEffect(() => () => operationRef.current?.abort(), []);
  useReportToOwner(onBusyChange, working || recoveryActivity.signing, false);

  const scan = async () => {
    const controller = new AbortController();
    operationRef.current?.abort();
    operationRef.current = controller;
    const needsRestoration = restoreRequiredActionIndex !== null;
    setWorking(true);
    setActiveRestoration(needsRestoration);
    setError(null);
    setRestorationProgress(null);
    try {
      if (!needsRestoration) {
        await refreshSync();
      } else {
        await restorePrivateHistory(setRestorationProgress, controller.signal);
      }
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        setError(cause ?? new Error('Private recovery stopped safely.'));
      }
    } finally {
      if (operationRef.current === controller) {
        operationRef.current = null;
        setWorking(false);
        setActiveRestoration(false);
      }
    }
  };

  const restoring = restoreRequiredActionIndex !== null;
  const restorationVisible = working ? activeRestoration : restoring;
  const checking = working && restorationVisible
    ? restorationProgress
      ? `Restored ${restorationProgress.restoredCount} of ${restorationProgress.totalCount} records…`
      : 'Preparing private history restoration…'
    : working && syncProgress && syncProgress.total > 1
    ? `Checking ${(syncProgress.current < syncProgress.total ? syncProgress.current : syncProgress.total)} of ${syncProgress.total}…`
    : 'Checking…';

  return (
    <ModalBody>
      {restorationVisible ? (
        <Notice tone="warn">
          Stellar has archived records needed to rebuild your private history. StellarKey
          restores the largest safe group in each maintenance transaction, and each transaction
          costs a network fee. It does not send a payment. Your password is required before signing.
        </Notice>
      ) : (
        <Notice>
          StellarKey reads activity reported by your selected RPC since your last checked
          point and validates its internal consistency on this device. Your recovery phrase stays inside your vault.
        </Notice>
      )}
      <dl className="list-group">
        <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-[13px]">
          <dt className="text-neutral-400">Checked through</dt>
          <dd className="font-semibold text-white">
            {checkpoint ? `Ledger ${checkpoint.latestLedger.toLocaleString()}` : 'Not yet'}
          </dd>
        </div>
      </dl>
      <p className="text-[11.5px] leading-relaxed text-neutral-500">
        Your balance stays unavailable for spending until the check completes.
      </p>
      {error !== null ? <HumanizedErrorNotice cause={error} /> : null}
      {/* Progress is spoken and shown here; the button keeps its one name. */}
      <div aria-live="polite">
        {working ? (
          <p className="text-center text-[12.5px] font-medium text-neutral-300">{checking}</p>
        ) : null}
      </div>
      <ModalFooter
        primary={
          <Button type="button" loading={working} loadingLabel={checking} disabled={recoveryActivity.busy} onClick={() => void scan()}>
            {restorationVisible ? 'Restore Private History' : 'Check for New Activity'}
          </Button>
        }
      />
      <p className="text-center text-[11px] leading-relaxed text-neutral-500">
        {restorationVisible
          ? 'Only contiguous records needed for this check are restored. Every confirmed group advances the saved resume point before StellarKey continues.'
          : 'Picks up where your last check left off. For a from-scratch recheck of your whole history, open Advanced privacy → Verify private history.'}
      </p>
      <PrivateHeldBalanceRecovery scanWorking={working} onActivityChange={setRecoveryActivity} />
    </ModalBody>
  );
}
