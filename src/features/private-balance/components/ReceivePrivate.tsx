'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import QRCode from 'qrcode';
import {
  IconChevronDown,
  IconDownload,
  IconRefresh,
  IconShare,
  IconShieldStellar,
} from '@/components/icons';
import { Button, CopyButton, Modal, ModalBody, ModalHeader, Select, Spinner } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { useWalletIdentity } from '@/hooks/useWallet';
import { getSessionSnapshot, subscribeSessionChanges } from '@/lib/vault';
import { triggerHaptic } from '@/lib/haptics';
import {
  privateAddressFingerprint,
  privateReceivePayload,
  privateReceiveState,
  stealthAddressFingerprint,
  stealthReceivePayload,
  type PrivateAddressPrefix,
  type StealthAddressPrefix,
} from '../runtime/receive';
import { HumanizedErrorNotice } from './PrivateBalanceStatus';

/**
 * The receive body without the Modal wrapper, so it can embed inside other
 * surfaces (the public ReceiveModal's Public | Private segments). Available
 * whenever the durable privateAddress exists — no sync required. Creating a
 * fresh address reports busy so the owning dialog blocks dismissal meanwhile.
 */
export function PrivateReceiveContent({
  onBusyChange,
  assetSelector,
}: {
  onBusyChange?(busy: boolean): void;
  assetSelector?: ReactNode;
} = {}) {
  const {
    privateAddress,
    stealthMetaAddress,
    networkLabel,
    asset,
    configured,
    isLeader,
    rotatePrivateAddress,
    phase, error, stealthError, stealthSyncing, refreshSync, refreshStealth,
    takeoverLeadership, publicAddress, deployment, receiveSessionId,
  } = usePrivateBalanceRuntimeData();
  const { activeAccount, network } = useWalletIdentity();
  const session = useSyncExternalStore(subscribeSessionChanges, getSessionSnapshot, () => null);
  const sessionCurrent = session !== null && (!(privateAddress || stealthMetaAddress) || receiveSessionId === session);
  const locked = phase === 'locked' || !sessionCurrent;
  const scope = useMemo(() => ({ accountId: activeAccount?.id, network, session, publicAddress, networkLabel,
    assetId: asset?.contractId, pool: deployment.poolContractId, manifest: deployment.manifestHash, locked }),
  [activeAccount?.id, network, session, publicAddress, networkLabel, asset?.contractId, deployment.poolContractId, deployment.manifestHash, locked]);
  const owner = useRef<object | null>(null);
  const operation = useRef<object | null>(null);
  useLayoutEffect(() => {
    owner.current = scope;
    return () => { owner.current = null; operation.current = null; };
  }, [scope]);
  const [receiveKind, setReceiveKind] = useState<'reusable' | 'shielded'>('shielded');
  const nativeAsset = asset?.kind === 'native';
  const reusable = nativeAsset && receiveKind === 'reusable';
  const address = locked ? '' : reusable ? (stealthMetaAddress ?? '') : (privateAddress ?? '');
  const prefix: PrivateAddressPrefix = networkLabel === 'Mainnet' ? 'skpay_' : 'tskpay_';
  const stealthPrefix: StealthAddressPrefix = networkLabel === 'Mainnet' ? 'ssm' : 'tsm';
  const encoded = useMemo(
    () => {
      try {
        return { payload: address ? reusable ? stealthReceivePayload(address, stealthPrefix) : privateReceivePayload(address, prefix) : '', error: null };
      } catch (cause) {
        return { payload: '', error: cause };
      }
    },
    [address, prefix, reusable, stealthPrefix],
  );
  const payload = encoded.payload;
  const fingerprint = useMemo(
    () => payload
      ? reusable
        ? stealthAddressFingerprint(payload)
        : privateAddressFingerprint(payload)
      : 'Unavailable',
    [payload, reusable],
  );
  const compactAddress = useMemo(
    () => payload ? `${payload.slice(0, 14)}…${payload.slice(-12)}` : '',
    [payload],
  );
  const [qrImage, setQrImage] = useState<{ scope: object; payload: string; url: string | null; failed: boolean } | null>(null);
  const [qrAttempt, setQrAttempt] = useState(0);
  // Clear the rendered/downloadable QR synchronously when its input changes;
  // effect cleanup alone only prevents a late result, not a stale old image.
  const currentQr = qrImage?.scope === scope && qrImage.payload === payload ? qrImage : null;
  const qrDataUrl = payload ? currentQr?.url : null;
  const [aboutOpen, setAboutOpen] = useState(false);
  const [expandedAddressScope, setExpandedAddressScope] = useState<object | null>(null);
  const showFullAddress = expandedAddressScope === scope;
  const [activity, setActivity] = useState<{ scope: object; kind: 'rotate' | 'retry' } | null>(null);
  const rotating = activity?.scope === scope && activity.kind === 'rotate';
  const retrying = activity?.scope === scope && activity.kind === 'retry';
  const [failure, setFailure] = useState<{ scope: object; kind: string; cause: unknown } | null>(null);
  // Forget old private output as soon as its owner/input changes, including
  // a lock with no replacement QR request to clear it later.
  if (qrImage && (qrImage.scope !== scope || qrImage.payload !== payload)) setQrImage(null);
  if (activity && activity.scope !== scope) setActivity(null);
  if (failure && failure.scope !== scope) setFailure(null);
  if (expandedAddressScope && expandedAddressScope !== scope) setExpandedAddressScope(null);
  const localError = failure?.scope === scope && failure.kind === receiveKind ? failure.cause : null;
  const receiveError = encoded.error || localError || (reusable ? stealthError || error : error);
  const state = privateReceiveState({ configured, hasAddress: !!payload, isLeader, phase, reusable, stealthSyncing, hasError: !!receiveError, sessionCurrent });
  const statusRef = useRef<HTMLDivElement | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  useLayoutEffect(() => { onBusyChange?.(rotating); return () => onBusyChange?.(false); }, [onBusyChange, rotating]);
  const addressChoice = (
    <div className="space-y-3">
      <div className="divide-y divide-white/[0.07] rounded-2xl border border-white/[0.08] bg-white/[0.025] px-3.5">
        <div className="flex min-h-14 items-center justify-between gap-4 py-1.5">
          <span className="text-[13px] text-neutral-400">Asset</span>
          {assetSelector ?? <span className="text-[13px] font-semibold text-white">{asset?.code ?? 'Unavailable'}</span>}
        </div>
        <div className="flex min-h-14 items-center justify-between gap-4 py-1.5">
          <span className="text-[13px] text-neutral-400">Address type</span>
          {nativeAsset ? <Select
            value={receiveKind}
            onChange={value => {
              operation.current = null;
              setActivity(null);
              setReceiveKind(value as 'reusable' | 'shielded'); setFailure(null); setExpandedAddressScope(null);
            }}
            ariaLabel="Private receive address type"
            size="sm"
            disabled={rotating}
            options={[{ value: 'shielded', label: 'Shielded' }, { value: 'reusable', label: 'Reusable' }]}
          /> : <span className="text-[13px] font-semibold text-white">Shielded</span>}
        </div>
      </div>
      <p className="px-1 text-center text-[12px] leading-relaxed text-neutral-400">
        {reusable
          ? 'Fresh one-time account per payment. Sender, amount, and timing stay public.'
          : 'Amount and counterparty are encrypted inside Private Balance.'}
      </p>
    </div>
  );

  useEffect(() => {
    let active = true;
    if (!payload) return undefined;
    void QRCode.toDataURL(payload, {
      width: 440,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(value => {
      if (active && owner.current === scope && getSessionSnapshot() === session) setQrImage({ scope, payload, url: value, failed: false });
    }).catch(() => {
      if (active && owner.current === scope && getSessionSnapshot() === session) setQrImage({ scope, payload, url: null, failed: true });
    });
    return () => { active = false; };
  }, [payload, scope, session, qrAttempt]);

  const share = async () => {
    try {
      await navigator.share({
        title: reusable ? 'My reusable private address' : 'My shielded address',
        text: `Send ${asset?.code ?? 'funds'} to: ${payload}`,
      });
    } catch {
      // Ignore user cancel.
    }
  };

  const run = async (kind: 'rotate' | 'retry') => {
    if (operation.current) return;
    const token = {};
    operation.current = token;
    const current = () => owner.current === scope && operation.current === token && getSessionSnapshot() === session;
    setActivity({ scope, kind });
    setFailure(null);
    // The stable content region retains keyboard focus when recovery replaces
    // its button. Do not move focus again when the asynchronous result arrives.
    if (kind === 'retry') statusRef.current?.focus({ preventScroll: true });
    try {
      if (kind === 'rotate') await rotatePrivateAddress();
      else if (reusable && privateAddress && phase === 'current') await refreshStealth();
      else await refreshSync();
      if (current() && kind === 'rotate') triggerHaptic('success');
    } catch (cause) {
      if (current()) { setFailure({ scope, kind: receiveKind, cause }); triggerHaptic('error'); }
    } finally {
      if (current()) { operation.current = null; setActivity(null); }
    }
  };

  return (
    <ModalBody>
      <div ref={statusRef} tabIndex={-1} aria-label="Private receive" className="mx-auto max-w-[420px] space-y-5 outline-none">
      {addressChoice}
      {state !== 'ready' ? <div className="flex min-h-56 flex-col items-center justify-center gap-3 py-5 text-center">
        {state === 'loading' || retrying ? <Spinner size={26} /> : <IconShieldStellar size={30} className="text-neutral-400" />}
        <div role="status" aria-live="polite">
          <h3 className="text-[17px] font-semibold tracking-tight text-white">
            {retrying ? 'Checking your private address…' : state === 'loading' ? 'Preparing your private address…' : state === 'locked' ? 'Unlock to receive privately' : state === 'setup' ? 'No private address yet' : state === 'follower' ? 'Private Payments is active in another tab' : 'Your private address is unavailable'}
          </h3>
          <p className="mx-auto mt-2 max-w-[36ch] text-[13px] leading-relaxed text-neutral-400">
            {state === 'locked' ? 'Unlock your wallet, then open Receive again.' : state === 'setup' ? 'Set up Private Payments to receive privately.' : state === 'follower' ? 'Continue in that tab, or move Private Payments here to show your address.' : state === 'loading' || retrying ? 'You can close this sheet while the check continues.' : 'The private connection stopped before your address was ready. Try a fresh check; this does not create a new payment.'}
          </p>
        </div>
        {state === 'follower' ? <Button onClick={() => { statusRef.current?.focus({ preventScroll: true }); takeoverLeadership(); }}>Use in This Tab</Button> : null}
        {['stopped', 'missing'].includes(state) || retrying ? <Button loading={retrying} loadingLabel="Checking address" onClick={() => void run('retry')}>Try Again</Button> : null}
        {receiveError && !retrying && state !== 'locked' && state !== 'setup' ? <HumanizedErrorNotice cause={receiveError} className="w-full" /> : null}
      </div> : <>
      <div className="flex justify-center">
        <div className="w-full max-w-[180px] rounded-[22px] bg-white p-2.5 shadow-[0_16px_38px_-14px_rgba(0,0,0,0.85)]">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt={`${reusable ? 'Reusable private' : 'Shielded'} receive address QR code`}
              width={180}
              height={180}
              className="aspect-square w-full rounded-xl"
            />
          ) : currentQr?.failed ? (
            <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl text-center text-neutral-800">
              <p role="status" className="text-[12px]">QR code unavailable</p>
              <button type="button" className="min-h-11 px-2 text-[13px] font-semibold text-blue-700" onClick={() => { setQrImage(null); setQrAttempt(value => value + 1); }}>Retry QR</button>
            </div>
          ) : (
            <div role="status" aria-label="Creating QR code" className="skeleton aspect-square w-full rounded-xl" />
          )}
        </div>
      </div>

      <div className="text-center">
        <p className="text-[11px] font-medium text-neutral-500">Verification code</p>
        <p className="mono mx-auto mt-1 max-w-[30ch] text-[13px] font-medium leading-relaxed tracking-[0.08em] text-neutral-200">{fingerprint}</p>
        <p className="mt-1 text-[11px] text-neutral-500">
          The sender can compare this code before paying.
        </p>
      </div>

      <div
        aria-label="Private address"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-3.5 py-3"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-medium text-neutral-500">
              {reusable ? 'Reusable private address' : 'Shielded address'}
            </p>
            <p className="mono mt-0.5 truncate text-[12px] text-neutral-200">
              {showFullAddress ? '' : compactAddress}
            </p>
          </div>
        </div>
        {showFullAddress ? (
          <p className="mono -mt-3 break-all text-[11.5px] leading-relaxed text-neutral-200">{payload}</p>
        ) : null}
        <button
          type="button"
          aria-expanded={showFullAddress}
          onClick={() => setExpandedAddressScope(showFullAddress ? null : scope)}
          className="-mb-2 mt-1 flex min-h-11 items-center gap-1 text-[12.5px] font-semibold text-[#0A84FF]"
        >
          {showFullAddress ? 'Hide full address' : 'Show full address'}
          <IconChevronDown size={12} className={`transition-transform ${showFullAddress ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <CopyButton value={payload} label="Copy Address" className="btn btn-primary min-h-12 w-full justify-center rounded-2xl text-[14px] font-semibold" />

      <div className="flex min-h-11 flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {!reusable ? (
          <button
            type="button"
            disabled={!isLeader || rotating || retrying}
            onClick={() => void run('rotate')}
            title={isLeader ? 'Create a fresh shielded receive address' : 'Private Payments is active in another tab'}
            className="flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-neutral-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            {rotating ? (
              <><Spinner size={12} /> Creating address…</>
            ) : (
              <><IconRefresh size={12} /><span>New address</span></>
            )}
          </button>
        ) : null}
        {canShare ? (
          <button
            type="button"
            onClick={() => void share()}
            className="flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-neutral-400 transition-colors hover:text-white"
          >
            <IconShare size={12} /> Share
          </button>
        ) : null}
        {qrDataUrl ? (
          <a
            href={qrDataUrl}
            download="stellarkey-private-receive-qr.png"
            className="flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-neutral-400 transition-colors hover:text-white"
          >
            <IconDownload size={13} /> Save QR
          </a>
        ) : null}
      </div>
      {receiveError ? <HumanizedErrorNotice cause={receiveError} /> : null}

      <div className="rounded-2xl border border-white/[0.09] bg-white/[0.025]">
        <button
          type="button"
          aria-expanded={aboutOpen}
          onClick={() => setAboutOpen(value => !value)}
          className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
        >
          <span className="text-[12.5px] font-semibold text-neutral-200">About this address</span>
          <IconChevronDown
            size={13}
            className={`shrink-0 text-neutral-500 transition-transform ${aboutOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {aboutOpen ? (
          <div className="border-t border-white/[0.07] px-4 py-3">
            <dl className="space-y-2 text-[12.5px]">
              {[
                ['Network', networkLabel],
                ['Asset', asset?.code ?? 'Unavailable'],
                ['Address type', reusable ? 'Reusable one-time accounts' : 'Shielded pool'],
                ['Privacy', reusable ? 'Recipient identity' : 'Amount and counterparty'],
                ['Protocol', reusable ? 'Stealth receive V1' : 'Protocol V1'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="text-neutral-400">{label}</dt>
                  <dd className="text-right font-semibold text-neutral-100">{value}</dd>
                </div>
              ))}
            </dl>
            {reusable ? (
              <>
                <p className="mt-3 text-[11.5px] leading-relaxed text-neutral-500">
                  Each payer derives a fresh one-time Stellar account. Your reusable address is not
                  published on-chain, but the payer, amount, and timing of each funding payment remain public.
                </p>
                <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-500">
                  Moving a received payment into Private Balance makes later activity private; it does
                  not erase the original public funding transaction.
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 text-[11.5px] leading-relaxed text-neutral-500">
                  Reusing this address does not expose it on-chain, but people you share it with can
                  recognize the same address if they compare it.
                </p>
                <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-500">
                  Previous addresses remain valid. Create a new one when you want a separate address
                  for another person or payment request.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>
      </>}
      </div>
    </ModalBody>
  );
}

/**
 * The standalone receive dialog. The address and QR are sensitive, so the
 * content leaves the moment the dialog closes while the shell keeps its
 * geometry through the exit.
 */
export function ReceivePrivate({ open = true, onClose }: { open?: boolean; onClose: () => void }) {
  const { asset } = usePrivateBalanceRuntimeData();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      busyReason="Wait for the new address to finish before closing."
    >
      <ModalHeader
        title="Receive Privately"
        subtitle={`Your private ${asset?.code ?? ''} address`.replace(/\s+/g, ' ')}
        onClose={onClose}
      />
      {open ? <PrivateReceiveContent onBusyChange={setBusy} /> : null}
    </Modal>
  );
}
