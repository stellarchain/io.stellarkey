'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowDownLeft, IconArrowUpRight, IconRefresh, IconShieldStellar } from '@/components/icons';
import { Modal, ModalHeader } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { fmtAmount } from '@/lib/format';
import { activityKindLabel } from '../copy';
import { formatPrivateBalanceAmount } from '../runtime/selectors';
import type { PrivatePendingAction, ShieldedActivityRecord } from '../runtime/types';
import { PrivateActivityDetails, type PrivateActivitySelection } from './PrivateActivityDetails';
import { isConfirmingPendingAction, isInternalPendingAction } from './PrivateBalanceStatusLine';

export function activityLabel(activity: ShieldedActivityRecord): string {
  return activityKindLabel(activity.actionKind, activity.direction);
}

const PENDING_LABELS: Record<PrivatePendingAction['kind'], string> = {
  deposit: 'Adding privately',
  transfer: 'Sending privately',
  withdraw: 'Moving to public',
};

export function PrivateActivityList({
  limit,
  privacyMode = false,
  pulseToken,
  onSelect,
  onReceive,
}: {
  limit?: number;
  privacyMode?: boolean;
  /** Changes when an action flow closes after submitting; re-pulses the fresh row. */
  pulseToken?: number;
  onSelect(selection: PrivateActivitySelection): void;
  /** When provided, the empty state offers "Receive Privately". */
  onReceive?: () => void;
}) {
  const { activities, pendingActions, asset } = usePrivateBalanceRuntimeData();
  const amount = (atomicUnits: string) =>
    `${fmtAmount(formatPrivateBalanceAmount(BigInt(atomicUnits), asset?.decimals ?? 7))} ${asset?.code ?? 'Asset'}`;
  const ordered = useMemo(
    () => [...activities].sort((left, right) => right.actionIndex - left.actionIndex),
    [activities],
  );
  // Only actions actually confirming on the network appear as rows: a merely
  // prepared/reviewed action (its review screen still open, or abandoned) is
  // not an in-flight payment.
  const confirmingPending = useMemo(
    () => pendingActions.filter(isConfirmingPendingAction),
    [pendingActions],
  );
  const visiblePending = limit === undefined ? confirmingPending : confirmingPending.slice(0, limit);
  const remaining = limit === undefined ? undefined : Math.max(0, limit - visiblePending.length);
  const visibleActivities = remaining === undefined ? ordered : ordered.slice(0, remaining);

  // A pending row that appears after mount gets one calm .row-pulse flash —
  // it teaches where a freshly confirmed-away payment now lives.
  const knownPendingIdsRef = useRef<ReadonlySet<string> | null>(null);
  const [pulseIds, setPulseIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const ids = new Set(confirmingPending.map(action => action.id));
    const known = knownPendingIdsRef.current;
    knownPendingIdsRef.current = ids;
    if (known === null) return;
    const fresh = [...ids].filter(id => !known.has(id));
    if (fresh.length === 0) return;
    setPulseIds(new Set(fresh));
    const timer = window.setTimeout(() => setPulseIds(new Set()), 1700);
    return () => window.clearTimeout(timer);
  }, [confirmingPending]);

  // The first pulse usually fires while the success screen still covers the
  // page, so the action flow's close bumps `pulseToken` and the pending rows
  // pulse again — now that the person can actually see them.
  const confirmingPendingRef = useRef(confirmingPending);
  useEffect(() => {
    confirmingPendingRef.current = confirmingPending;
  }, [confirmingPending]);
  const knownPulseTokenRef = useRef(pulseToken);
  useEffect(() => {
    if (pulseToken === undefined || pulseToken === knownPulseTokenRef.current) return;
    knownPulseTokenRef.current = pulseToken;
    const ids = confirmingPendingRef.current.map(action => action.id);
    if (ids.length === 0) return;
    setPulseIds(new Set(ids));
    const timer = window.setTimeout(() => setPulseIds(new Set()), 1700);
    return () => window.clearTimeout(timer);
  }, [pulseToken]);

  if (visiblePending.length === 0 && visibleActivities.length === 0) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center gap-2 px-5 pb-5 text-center">
        <IconShieldStellar size={24} className="text-neutral-500" />
        <p className="text-[14px] font-semibold text-white">No private activity yet</p>
        <p className="max-w-[34ch] text-[12px] leading-relaxed text-neutral-500">
          Payments you send and receive privately appear here.
        </p>
        {onReceive ? (
          <button type="button" onClick={onReceive} className="chip mt-2 min-h-11 font-semibold text-[#0A84FF]">
            Receive Privately
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ios-group overflow-hidden">
      {visiblePending.map(action => {
        // A chained send's internal consolidation step is a self-transfer with
        // a zero protocol balance delta — never an outgoing spend, no amount.
        const internal = isInternalPendingAction(action);
        return (
          <button
            key={action.id}
            type="button"
            className={`ios-sep flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left ${pulseIds.has(action.id) ? 'row-pulse' : ''}`}
            onClick={() => onSelect({ type: 'pending', action })}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${internal ? 'bg-[#0A84FF]/12 text-[#0A84FF]' : 'bg-[#FF9F0A]/12 text-[#FF9F0A]'}`}>
              <IconRefresh size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-white">
                {internal ? 'Preparing balance…' : PENDING_LABELS[action.kind]}
              </span>
              <span className="block text-[11.5px] text-neutral-500">Confirming…</span>
            </span>
            {!internal && action.amountStroops ? (
              <span className={`shrink-0 text-[13px] font-semibold ${privacyMode ? 'text-neutral-500' : 'text-neutral-300'}`}>
                {privacyMode ? '••••••' : `${action.kind === 'deposit' ? '+' : '−'}${amount(action.amountStroops)}`}
              </span>
            ) : null}
          </button>
        );
      })}
      {visibleActivities.map(activity => {
        const inflow = activity.direction === 'inflow';
        const internal = activity.direction === 'internal';
        return (
          <button
            key={activity.id}
            type="button"
            aria-label={`${activityLabel(activity)}, ${privacyMode ? 'amount hidden' : amount(activity.amount)}`}
            className="ios-sep flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left"
            onClick={() => onSelect({ type: 'verified', activity })}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${inflow ? 'bg-[#30D158]/12 text-[#30D158]' : internal ? 'bg-[#0A84FF]/12 text-[#0A84FF]' : 'bg-[#FF9F0A]/12 text-[#FF9F0A]'}`}>
              {inflow ? <IconArrowDownLeft size={16} /> : <IconArrowUpRight size={16} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-white">{activityLabel(activity)}</span>
              <span className="block text-[11.5px] text-neutral-500">Verified locally</span>
            </span>
            <span className={`shrink-0 text-[13px] font-semibold ${privacyMode ? 'text-neutral-500' : inflow ? 'text-[#30D158]' : internal ? 'text-neutral-300' : 'text-white'}`}>
              {privacyMode ? '••••••' : `${inflow ? '+' : internal ? '' : '−'}${amount(activity.amount)}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function PrivateActivity({
  onClose,
  initialSelection = null,
  privacyMode = false,
}: {
  onClose(): void;
  initialSelection?: PrivateActivitySelection | null;
  privacyMode?: boolean;
}) {
  const { deployment } = usePrivateBalanceRuntimeData();
  const [selection, setSelection] = useState<PrivateActivitySelection | null>(initialSelection);

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title={selection ? 'Payment details' : 'Private activity'}
        subtitle="Decrypted locally while StellarKey is unlocked"
        onClose={onClose}
      />
      {selection ? (
        <PrivateActivityDetails
          selection={selection}
          network={deployment.network ?? 'testnet'}
          poolContractId={deployment.poolContractId}
          privacyMode={privacyMode}
          onBack={() => setSelection(null)}
        />
      ) : (
        <div className="p-4 sm:p-6">
          <PrivateActivityList privacyMode={privacyMode} onSelect={setSelection} />
        </div>
      )}
    </Modal>
  );
}
