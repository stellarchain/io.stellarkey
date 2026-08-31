'use client';

import { useState, type ReactNode } from 'react';
import { AccountMark } from '@/components/AccountMark';
import { IconExternal } from '@/components/icons';
import { Button, Notice } from '@/components/ui';
import { NETWORKS } from '@/lib/stellar';
import type { NetworkKey } from '@/lib/types';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { fmtAmount } from '@/lib/format';
import { triggerHaptic } from '@/lib/haptics';
import { activityKindLabel } from '../copy';
import { formatPrivateBalanceAmount } from '../runtime/selectors';
import type { PrivatePendingAction, ShieldedActivityRecord } from '../runtime/types';
import { HumanizedErrorNotice } from './PrivateBalanceStatus';
import { isInternalPendingAction } from './PrivateBalanceStatusLine';

export type PrivateActivitySelection =
  | { type: 'verified'; activity: ShieldedActivityRecord }
  | { type: 'pending'; action: PrivatePendingAction };

function DetailRow({ name, value }: { name: string; value: ReactNode }) {
  return (
    <div className="ios-sep flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-[13px]">
      <dt className="text-neutral-400">{name}</dt>
      <dd className="min-w-0 text-right font-semibold text-neutral-100">{value}</dd>
    </div>
  );
}

function memoText(memoHex: string | undefined): string | null {
  if (!memoHex) return null;
  const bytes = Uint8Array.from(memoHex.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function PrivateActivityDetails({
  selection,
  network,
  poolContractId,
  privacyMode = false,
  onBack,
}: {
  selection: PrivateActivitySelection;
  network: NetworkKey;
  poolContractId: string | null;
  privacyMode?: boolean;
  onBack(): void;
}) {
  const { asset, refreshSync } = usePrivateBalanceRuntimeData();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<unknown>(null);
  const pending = selection.type === 'pending';
  const activity = selection.type === 'verified' ? selection.activity : null;
  // A chained send's internal consolidation step or a verified self-transfer:
  // the protocol-true balance delta is zero, and there is no counterparty.
  const internal = pending
    ? isInternalPendingAction(selection.action)
    : activity !== null && activity.direction === 'internal';
  const kind = activity ? activity.actionKind : pending ? selection.action.kind : 'transfer';
  const inflow = activity !== null && activity.direction === 'inflow';
  // An outgoing private transfer — the one case whose recipient/memo live
  // only in this device's local journal.
  const sentTransfer = kind === 'transfer' && !internal && !inflow;
  const title = internal
    ? pending
      ? 'Preparing balance…'
      : activityKindLabel('transfer', 'internal')
    : activity
      ? activityKindLabel(activity.actionKind, activity.direction)
      : 'Confirming…';
  const decimals = asset?.decimals ?? 7;
  const code = asset?.code ?? 'Asset';
  const pendingAmountStroops = pending ? selection.action.amountStroops : undefined;
  const knownAmount = activity
    ? `${fmtAmount(formatPrivateBalanceAmount(BigInt(activity.amount), decimals))} ${code}`
    : pendingAmountStroops
      ? `${fmtAmount(formatPrivateBalanceAmount(BigInt(pendingAmountStroops), decimals))} ${code}`
      : null;
  const amount = knownAmount === null
    ? 'Unavailable until verified'
    : privacyMode
      ? '••••••'
      : knownAmount;
  const localRecipient = activity?.recipientFingerprint ??
    (pending ? selection.action.recipientFingerprint : undefined);
  const localMemo = memoText(activity?.memoHex ?? (pending ? selection.action.memoHex : undefined));

  // "Check Status" runs a normal sync; the sync path also resolves an expired
  // payment safely, so this is the one honest answer to "is it done yet?".
  const checkStatus = async () => {
    triggerHaptic('light');
    setChecking(true);
    setCheckError(null);
    try {
      await refreshSync();
    } catch (cause: unknown) {
      setCheckError(cause ?? new Error('Private payments stopped safely.'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Private activity</p>
        <h3 className="mt-1 text-[20px] font-bold text-white">{title}</h3>
      </div>
      <dl className="ios-group overflow-hidden">
        {/* Internal steps move nothing in or out — no amount to show. */}
        {internal && pending ? null : <DetailRow name="Amount" value={amount} />}
        <DetailRow name="Verification" value={pending ? 'Confirming…' : 'Verified locally'} />
        {activity ? <DetailRow name="Action index" value={activity.actionIndex.toLocaleString()} /> : null}
        {activity?.timestamp ? <DetailRow name="Time" value={new Date(activity.timestamp).toLocaleString()} /> : null}
        {/* Recipient, told honestly per kind: only SENT transfers depend on
            this device's journal — everything else is either you or public. */}
        {internal ? null : kind === 'deposit' ? (
          <DetailRow name="Recipient" value="Your private balance" />
        ) : kind === 'withdraw' ? (
          <DetailRow name="Recipient" value="Shown on the public record" />
        ) : inflow ? (
          <DetailRow name="Recipient" value="You" />
        ) : (
          <DetailRow
            name="Recipient"
            value={localRecipient ? (
              <span className="inline-flex items-center gap-2">
                <AccountMark publicKey={localRecipient} size={16} />
                <span className="mono">{localRecipient}</span>
              </span>
            ) : (
              'Unavailable after seed recovery'
            )}
          />
        )}
        {/* Private memos exist only on transfers. A sent transfer with an
            intact journal but no memo simply had none; an inflow's memo shows
            when it was decrypted into this activity, and is never claimed
            lost — the note plaintext carries it through seed recovery. */}
        {sentTransfer ? (
          <DetailRow
            name="Memo"
            value={localMemo ?? (localRecipient ? 'None' : 'Unavailable after seed recovery')}
          />
        ) : kind === 'transfer' && inflow && localMemo ? (
          <DetailRow name="Memo" value={localMemo} />
        ) : null}
      </dl>
      <Notice>
        {internal
          ? 'This step prepared your balance for a payment — nothing left your private balance, and the amounts involved stay encrypted.'
          : kind === 'deposit'
            ? 'Adding funds is public on Stellar; the private balance it creates stays encrypted, and your recovery phrase alone restores it.'
            : kind === 'withdraw'
              ? 'This withdrawal is public on Stellar like any payment — its amount, recipient, and timing appear on the public record.'
              : inflow
                ? 'Received payments travel encrypted with the payment itself, so your recovery phrase alone restores them — amount and memo included. The public record cannot prove the hidden amount.'
                : 'Recipient and memo for payments you sent are saved only in this device’s encrypted history — a recovery from your phrase alone cannot reconstruct them. The public record cannot prove the hidden recipient or amount.'}
      </Notice>
      {checkError !== null ? <HumanizedErrorNotice cause={checkError} /> : null}
      {pending ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          loading={checking}
          onClick={() => void checkStatus()}
        >
          {checking ? 'Checking…' : 'Check Status'}
        </Button>
      ) : null}
      {poolContractId ? (
        <a
          href={NETWORKS[network].explorerAccountUrl(poolContractId)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary flex w-full items-center justify-center gap-2"
        >
          View Public Record <IconExternal size={14} />
        </a>
      ) : null}
      <Button type="button" variant="ghost" className="w-full" onClick={onBack}>Back to activity</Button>
    </div>
  );
}
