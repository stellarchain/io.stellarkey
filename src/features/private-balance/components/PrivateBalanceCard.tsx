'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FiatValue } from '@/components/FiatValue';
import {
  IconArrowDownLeft,
  IconArrowUpRight,
  IconPlus,
  IconSend,
} from '@/components/icons';
import { Button } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { fmtAmount } from '@/lib/format';
import { triggerHaptic } from '@/lib/haptics';
import {
  ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE,
} from '@/lib/private-balance-expected-manifest';
import {
  PRIVATE_ADD_REQUEST_EVENT,
  PRIVATE_RECEIVE_REQUEST_EVENT,
  PRIVATE_SEND_REQUEST_EVENT,
  consumePrivateAddIntent,
  consumePrivateReceiveIntent,
  consumePrivateSendIntent,
} from '@/lib/private-address';
import { formatPrivateBalanceAmount } from '../runtime/selectors';
import { AddPrivateFunds } from './AddPrivateFunds';
import { PrivateAssetSelector } from './PrivateAssetSelector';
import { PrivateBalanceSetup } from './PrivateBalanceSetup';
import {
  privateBalancePendingLine,
  privateBalanceStatusLine,
} from './PrivateBalanceStatusLine';
import { PrivatePaymentsDetails } from './PrivatePaymentsDetails';
import { ReceivePrivate } from './ReceivePrivate';
import { SendPrivate } from './SendPrivate';
import { WithdrawPrivate } from './WithdrawPrivate';

function ActionButton({
  icon,
  label,
  disabled,
  primary = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  primary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`${label} · private balance`}
      className="group flex w-full min-w-0 flex-col items-center gap-2 outline-none disabled:cursor-not-allowed"
    >
      <span className={`flex h-[clamp(48px,16vw,60px)] w-[clamp(48px,16vw,60px)] items-center justify-center rounded-full transition-all duration-200 group-focus-visible:ring-2 group-focus-visible:ring-white/60 group-active:scale-[0.86] ${
        primary
          ? 'bg-gradient-to-b from-[#2f94ff] to-[#0a7aff] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_26px_-8px_rgba(10,132,255,0.55)]'
          : 'border border-white/[0.1] bg-white/[0.07] text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
      } ${disabled ? 'opacity-30' : 'group-hover:bg-white/[0.12]'}`}>
        {icon}
      </span>
      <span className={`truncate text-[12px] font-medium ${disabled ? 'text-neutral-600' : 'text-neutral-300'}`}>
        {label}
      </span>
    </button>
  );
}

export function PrivateBalanceCard({
  privacyMode,
  onSubmittedClose,
  showAssetSelector = true,
}: {
  privacyMode: boolean;
  /** Fires when an action flow closes after its payment reached the network. */
  onSubmittedClose?: () => void;
  /** Asset detail sheets already identify the selected asset in their header. */
  showAssetSelector?: boolean;
}) {
  const {
    configured,
    phase,
    isLeader,
    backgroundSyncing,
    syncProgress,
    error,
    verifiedBalanceStroops,
    pendingActions,
    privateAddress,
    takeoverLeadership,
    deployment,
    asset,
  } = usePrivateBalanceRuntimeData();
  const [setupOpen, setSetupOpen] = useState(false);
  const [action, setAction] = useState<
    'add' | 'send' | 'receive' | 'withdraw' | 'details' | null
  >(null);
  const [prefillRecipient, setPrefillRecipient] = useState<string | undefined>(undefined);
  const [prefillAmount, setPrefillAmount] = useState<string | undefined>(undefined);
  const current = phase === 'current';
  const follower = configured && !isLeader;
  const actionable = current && isLeader;
  const decimals = asset?.decimals ?? 7;
  const balance = formatPrivateBalanceAmount(BigInt(verifiedBalanceStroops), decimals);
  const assetCode = asset?.code ?? 'Asset';
  const working = ['loading-artifacts', 'reading-meta', 'scanning-live'].includes(phase);

  // True once the open action flow reported a submission; the close that
  // follows notifies the page so the activity panel can pulse the new row.
  const submittedRef = useRef(false);
  const markSubmitted = () => {
    submittedRef.current = true;
  };

  const openAction = (next: NonNullable<typeof action>) => {
    triggerHaptic('selection');
    submittedRef.current = false;
    setAction(next);
  };
  const closeAction = () => {
    setPrefillRecipient(undefined);
    setPrefillAmount(undefined);
    setAction(null);
    if (submittedRef.current) {
      submittedRef.current = false;
      onSubmittedClose?.();
    }
  };

  // Handoff intents: keep listening while mounted so SendModal/ReceiveModal
  // and palette handoffs open the matching flow immediately with their
  // prefill, and drain anything stored before this card mounted on the next
  // tick. While unconfigured (or while setup's success screen is still up)
  // nothing is consumed — the stored intent waits and opens its flow once
  // setup completes and the modal closes.
  useEffect(() => {
    if (!configured || setupOpen) return undefined;
    const openSend = (recipient: string | null | undefined) => {
      setPrefillRecipient(typeof recipient === 'string' && recipient !== '' ? recipient : undefined);
      setAction('send');
    };
    const openAdd = (amount: string | null | undefined) => {
      setPrefillAmount(typeof amount === 'string' && amount !== '' ? amount : undefined);
      setAction('add');
    };
    const onSendRequest = (event: Event) => {
      consumePrivateSendIntent();
      openSend((event as CustomEvent<{ recipient?: string }>).detail?.recipient);
    };
    const onAddRequest = (event: Event) => {
      consumePrivateAddIntent();
      openAdd((event as CustomEvent<{ amount?: string }>).detail?.amount);
    };
    const onReceiveRequest = () => {
      consumePrivateReceiveIntent();
      setAction('receive');
    };
    window.addEventListener(PRIVATE_SEND_REQUEST_EVENT, onSendRequest);
    window.addEventListener(PRIVATE_ADD_REQUEST_EVENT, onAddRequest);
    window.addEventListener(PRIVATE_RECEIVE_REQUEST_EVENT, onReceiveRequest);
    const drain = window.setTimeout(() => {
      const sendIntent = consumePrivateSendIntent();
      if (sendIntent !== null) {
        openSend(sendIntent);
        return;
      }
      const addIntent = consumePrivateAddIntent();
      if (addIntent !== null) {
        openAdd(addIntent);
        return;
      }
      if (consumePrivateReceiveIntent()) setAction('receive');
    }, 0);
    return () => {
      window.clearTimeout(drain);
      window.removeEventListener(PRIVATE_SEND_REQUEST_EVENT, onSendRequest);
      window.removeEventListener(PRIVATE_ADD_REQUEST_EVENT, onAddRequest);
      window.removeEventListener(PRIVATE_RECEIVE_REQUEST_EVENT, onReceiveRequest);
    };
  }, [configured, setupOpen]);

  const statusLine = !configured || follower
    ? null
    : privateBalanceStatusLine({
        phase,
        backgroundSyncing,
        syncProgress,
        error,
        depositsPaused: deployment.depositsPaused,
      });
  const pendingLine = configured
    ? privateBalancePendingLine(pendingActions, decimals, assetCode, { privacyMode })
    : null;

  // One return with stable child positions: the setup modal must survive the
  // unconfigured → configured flip mid-opt-in so its success moment shows.
  return (
    <section aria-labelledby="private-balance-title" className="panel fade-up flex flex-col items-center p-4 text-center sm:p-6">
      <h2 id="private-balance-title" className="sr-only">Private Payments</h2>
      {showAssetSelector ? <PrivateAssetSelector /> : null}
      <div className="balance-display mt-1.5 text-white">
        <span className="balance-display-value">
          {!configured ? '0' : privacyMode ? '••••••' : fmtAmount(balance)}
        </span>
        {!configured || !privacyMode ? <span className="balance-display-unit">{assetCode}</span> : null}
      </div>
      {configured ? (
        <div className="mt-1 flex min-h-[18px] items-center justify-center">
          <FiatValue
            amount={balance}
            code={assetCode}
            issuer={asset?.issuer}
            isNative={asset?.kind === 'native'}
            className="text-[13px] text-neutral-400"
          />
        </div>
      ) : null}

      <div aria-live="polite" className="mt-2 flex min-h-[24px] flex-col items-center justify-center gap-1">
        {!configured ? (
          <p className="text-[13px] text-neutral-500">Not set up</p>
        ) : follower ? (
          <div className="flex items-center gap-2.5">
            <p className="text-[12.5px] font-medium text-neutral-400">Active in another tab</p>
            <button
              type="button"
              onClick={() => {
                triggerHaptic('selection');
                takeoverLeadership();
              }}
              className="chip min-h-8 font-semibold text-[#0A84FF]"
            >
              Use Here
            </button>
          </div>
        ) : (
          <>
            {statusLine ? (
              <button
                type="button"
                onClick={() => openAction('details')}
                className={`min-h-6 text-[12.5px] font-medium ${
                  statusLine.tone === 'caution' ? 'text-[#FFB340]' : 'text-neutral-400'
                }`}
              >
                {statusLine.label}
              </button>
            ) : null}
            {pendingLine ? (
              <p className="mono text-[12px] text-neutral-400">{pendingLine}</p>
            ) : null}
          </>
        )}
      </div>

      {!configured ? (
        <Button
          type="button"
          className="mt-8 min-w-48"
          disabled={working || (deployment.manifestStatus === 'development' && !ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE)}
          onClick={() => {
            triggerHaptic('selection');
            setSetupOpen(true);
          }}
        >
          Set Up Private Payments
        </Button>
      ) : (
        <div className="mt-8 grid w-full max-w-[360px] grid-cols-4 gap-2">
          <ActionButton icon={<IconSend size={21} />} label="Send" primary disabled={!actionable} onClick={() => openAction('send')} />
          <ActionButton icon={<IconArrowDownLeft size={21} />} label="Receive" disabled={privateAddress === null} onClick={() => openAction('receive')} />
          <ActionButton icon={<IconArrowUpRight size={21} />} label="Withdraw" disabled={!actionable} onClick={() => openAction('withdraw')} />
          <ActionButton icon={<IconPlus size={21} />} label="Add" disabled={!actionable || deployment.depositsPaused === true} onClick={() => openAction('add')} />
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={() => openAction('details')} className="chip min-h-11 sm:min-h-0">
          Details
        </button>
      </div>

      <PrivateBalanceSetup open={setupOpen} onClose={() => setSetupOpen(false)} />
      {configured && action === 'add' ? (
        <AddPrivateFunds onClose={closeAction} prefillAmount={prefillAmount} onSubmitted={markSubmitted} />
      ) : null}
      {configured && action === 'send' ? (
        <SendPrivate
          onClose={closeAction}
          prefill={prefillRecipient !== undefined ? { recipient: prefillRecipient } : undefined}
          onSubmitted={markSubmitted}
        />
      ) : null}
      {configured && action === 'receive' ? <ReceivePrivate onClose={closeAction} /> : null}
      {configured && action === 'withdraw' ? <WithdrawPrivate onClose={closeAction} onSubmitted={markSubmitted} /> : null}
      {action === 'details' ? <PrivatePaymentsDetails onClose={closeAction} /> : null}
    </section>
  );
}
