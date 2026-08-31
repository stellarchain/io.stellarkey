'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  IconChevronDown,
  IconDownload,
  IconRefresh,
  IconShare,
  IconShieldStellar,
} from '@/components/icons';
import { CopyButton, Modal, ModalHeader, SegmentedControl, Spinner } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { triggerHaptic } from '@/lib/haptics';
import {
  privateAddressFingerprint,
  privateReceivePayload,
  stealthAddressFingerprint,
  stealthReceivePayload,
  type PrivateAddressPrefix,
  type StealthAddressPrefix,
} from '../runtime/receive';

/**
 * The receive body without the Modal wrapper, so it can embed inside other
 * surfaces (the public ReceiveModal's Public | Private segments). Available
 * whenever the durable privateAddress exists — no sync required.
 */
export function PrivateReceiveContent() {
  const {
    privateAddress,
    stealthMetaAddress,
    networkLabel,
    asset,
    configured,
    isLeader,
    rotatePrivateAddress,
  } = usePrivateBalanceRuntimeData();
  const [receiveKind, setReceiveKind] = useState<'reusable' | 'shielded'>('shielded');
  const nativeAsset = asset?.kind === 'native';
  const reusable = nativeAsset && receiveKind === 'reusable';
  const address = reusable ? (stealthMetaAddress ?? '') : (privateAddress ?? '');
  const prefix: PrivateAddressPrefix = networkLabel === 'Mainnet' ? 'sks' : 'tks';
  const stealthPrefix: StealthAddressPrefix = networkLabel === 'Mainnet' ? 'ssm' : 'tsm';
  const payload = useMemo(
    () => address
      ? reusable
        ? stealthReceivePayload(address, stealthPrefix)
        : privateReceivePayload(address, prefix)
      : '',
    [address, prefix, reusable, stealthPrefix],
  );
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
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotationError, setRotationError] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const addressChoice = nativeAsset ? (
    <div className="space-y-2">
      <SegmentedControl
        value={receiveKind}
        onChange={(next) => {
          triggerHaptic('selection');
          setReceiveKind(next);
        }}
        ariaLabel="Private receive address type"
        options={[
          { value: 'reusable', label: 'Reusable' },
          { value: 'shielded', label: 'Shielded' },
        ]}
      />
      <p className="text-center text-[11.5px] leading-relaxed text-neutral-400">
        {reusable
          ? 'Fresh one-time account per payment. Sender, amount, and timing stay public.'
          : 'Amount and counterparty are encrypted inside Private Balance.'}
      </p>
    </div>
  ) : null;

  useEffect(() => {
    let active = true;
    if (!payload) return undefined;
    void QRCode.toDataURL(payload, {
      width: 440,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(value => {
      if (active) setQrDataUrl(value);
    }).catch(() => {
      if (active) setQrDataUrl(null);
    });
    return () => { active = false; };
  }, [payload]);

  const share = async () => {
    try {
      triggerHaptic('light');
      await navigator.share({
        title: reusable ? 'My reusable private address' : 'My shielded address',
        text: `Send ${asset?.code ?? 'funds'} to: ${payload}`,
      });
    } catch {
      // Ignore user cancel.
    }
  };

  const createFreshAddress = async () => {
    if (rotating) return;
    setRotating(true);
    setRotationError(null);
    triggerHaptic('selection');
    try {
      await rotatePrivateAddress();
      triggerHaptic('success');
    } catch (error) {
      setRotationError(error instanceof Error ? error.message : 'Could not create a new address.');
      triggerHaptic('error');
    } finally {
      setRotating(false);
    }
  };

  if (!address) {
    // A configured account always has an address — it just may not have
    // reached this tab yet (follower tab, or the leader hasn't published).
    // Never show setup copy to someone who already set up.
    if (configured) {
      return (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-5 text-center">
          {addressChoice ? <div className="mb-3 w-full max-w-[420px]">{addressChoice}</div> : null}
          <IconShieldStellar size={24} className="text-neutral-500" />
          <p className="text-[14px] font-semibold text-white">Your address is loading — one moment</p>
          <p className="max-w-[36ch] text-[12px] leading-relaxed text-neutral-500">
            If Private Payments is active in another tab, your address is available there right now.
          </p>
        </div>
      );
    }
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-5 text-center">
        <IconShieldStellar size={24} className="text-neutral-500" />
        <p className="text-[14px] font-semibold text-white">No private address yet</p>
        <p className="max-w-[34ch] text-[12px] leading-relaxed text-neutral-500">
          Set up Private Payments to receive privately.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-5 pt-3 sm:px-6 sm:pb-6">
      <div className="mx-auto max-w-[420px] space-y-4">
      {addressChoice}
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
          ) : (
            <div className="skeleton aspect-square w-full rounded-xl" />
          )}
        </div>
      </div>

      <div className="text-center">
        <p className="text-[11px] font-medium text-neutral-500">Verification code</p>
        <p className="mono mt-0.5 text-[17px] font-bold tracking-[0.12em] text-white">{fingerprint}</p>
        <p className="mt-1 text-[11px] text-neutral-500">
          The sender can compare this code before paying.
        </p>
      </div>

      <div
        aria-label="Private address"
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-3.5 py-3"
      >
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium text-neutral-500">
            {reusable ? 'Reusable private address' : 'Shielded address'}
          </p>
          <p className="mono mt-0.5 truncate text-[12px] text-neutral-200" title={payload}>
            {compactAddress}
          </p>
        </div>
        <CopyButton value={payload} label="Copy Address" className="chip min-h-11 shrink-0" />
      </div>

      <div className="flex min-h-11 flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {!reusable ? (
          <button
            type="button"
            disabled={!isLeader || rotating}
            onClick={() => void createFreshAddress()}
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
            onClick={() => triggerHaptic('selection')}
            className="flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-neutral-400 transition-colors hover:text-white"
          >
            <IconDownload size={13} /> Save QR
          </a>
        ) : null}
      </div>
      {rotationError ? (
        <p role="alert" className="text-center text-[11.5px] text-red-400">{rotationError}</p>
      ) : null}

      <div className="rounded-2xl border border-white/[0.09] bg-white/[0.025]">
        <button
          type="button"
          aria-expanded={aboutOpen}
          onClick={() => {
            triggerHaptic('selection');
            setAboutOpen(value => !value);
          }}
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
      </div>
    </div>
  );
}

export function ReceivePrivate({ onClose }: { onClose: () => void }) {
  const { asset } = usePrivateBalanceRuntimeData();
  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title="Receive Privately"
        subtitle={`Your private ${asset?.code ?? ''} address`.replace(/\s+/g, ' ')}
        onClose={onClose}
      />
      <PrivateReceiveContent />
    </Modal>
  );
}
