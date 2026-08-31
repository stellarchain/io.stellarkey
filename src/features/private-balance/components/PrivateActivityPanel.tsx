'use client';

import { useState } from 'react';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { triggerHaptic } from '@/lib/haptics';
import { PrivateActivity, PrivateActivityList } from './PrivateActivity';
import type { PrivateActivitySelection } from './PrivateActivityDetails';
import { ReceivePrivate } from './ReceivePrivate';

export function PrivateActivityPanel({
  privacyMode,
  pulseToken,
}: {
  privacyMode: boolean;
  /** Changes when an action flow closes after submitting; re-pulses the fresh row. */
  pulseToken?: number;
}) {
  const { activities, pendingActions, privateAddress } = usePrivateBalanceRuntimeData();
  const [modalOpen, setModalOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [initialSelection, setInitialSelection] = useState<PrivateActivitySelection | null>(null);
  const total = activities.length + pendingActions.length;

  const open = (selection: PrivateActivitySelection | null = null) => {
    triggerHaptic('selection');
    setInitialSelection(selection);
    setModalOpen(true);
  };

  return (
    <section aria-labelledby="private-activity-title" className="panel fade-up overflow-hidden">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div>
          <h2 id="private-activity-title" className="text-[16px] font-bold tracking-tight text-white">
            Recent activity
          </h2>
          <p className="mt-0.5 text-[11.5px] text-neutral-500">Private payments only</p>
        </div>
        {total > 0 ? (
          <button
            type="button"
            onClick={() => open()}
            className="min-h-11 rounded-xl px-2 text-[12.5px] font-semibold text-[#0A84FF] transition hover:bg-[#0A84FF]/10"
          >
            View all
          </button>
        ) : null}
      </div>
      <PrivateActivityList
        limit={4}
        privacyMode={privacyMode}
        pulseToken={pulseToken}
        onSelect={selection => open(selection)}
        onReceive={privateAddress !== null ? () => {
          triggerHaptic('selection');
          setReceiveOpen(true);
        } : undefined}
      />
      {modalOpen ? (
        <PrivateActivity
          initialSelection={initialSelection}
          privacyMode={privacyMode}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
      {receiveOpen ? <ReceivePrivate onClose={() => setReceiveOpen(false)} /> : null}
    </section>
  );
}
