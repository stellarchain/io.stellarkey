'use client';

import { useEffect, useState } from 'react';
import { IconCheck, IconChevronDown, IconShieldStellar } from '@/components/icons';
import { Button, Modal, ModalHeader, Spinner } from '@/components/ui';
import {
  usePrivateBalanceRuntime,
  usePrivateBalanceRuntimeData,
} from '@/hooks/usePrivateBalanceRuntime';
import { triggerHaptic } from '@/lib/haptics';
import { PrivacyDisclosure } from './PrivacyDisclosure';
import { HumanizedErrorNotice } from './PrivateBalanceStatus';
import { PrivateSuccess } from './PrivateSuccess';

const SETUP_STEPS = [
  'Preparing privacy tools',
  'Creating your keys',
  'Creating your private address',
  'Saving securely on this device',
] as const;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'a small amount of data';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAssetList(codes: readonly string[]): string {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return 'XLM';
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`;
}

/**
 * One-screen setup (D7): the hero, the honest two-row disclosure with a
 * Learn more expansion, one consent checkbox, and "Turn On" — then the live
 * local setup stepper and the shared success moment.
 */
export function PrivateBalanceSetup({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const { availableAssets } = usePrivateBalanceRuntime();
  const {
    optIn,
    phase,
    configured,
    privateAddress,
    error,
    deployment,
  } = usePrivateBalanceRuntimeData();
  const [stage, setStage] = useState<'consent' | 'running' | 'done'>('consent');
  const [accepted, setAccepted] = useState(false);
  const [learnMore, setLearnMore] = useState(false);
  const [setupError, setSetupError] = useState<unknown>(null);
  const [addressBeat, setAddressBeat] = useState(false);
  const assetList = formatAssetList(
    availableAssets.map(option => option.asset.code),
  );
  const setupReady = stage === 'running' && configured && privateAddress !== null;
  const visibleStage = setupReady ? 'done' : stage;
  const visibleSetupError = setupError ?? (
    stage === 'running' && phase === 'safe-error' && error
      ? new Error(error)
      : null
  );
  const working = visibleStage === 'running' && visibleSetupError === null;

  // Setup ends once the encrypted local state and private address are durable.
  // Past-activity verification continues outside this dialog and keeps
  // spending locked until the private balance is current.
  useEffect(() => {
    if (stage !== 'running' || phase !== 'reading-meta') return;
    const timer = window.setTimeout(() => setAddressBeat(true), 1400);
    return () => window.clearTimeout(timer);
  }, [phase, stage]);
  const reachedStep = visibleStage === 'done'
    ? SETUP_STEPS.length
    : phase === 'current'
      ? 3
      : phase === 'scanning-live'
        ? 3
        : phase === 'reading-meta'
          ? (addressBeat ? 2 : 1)
          : 0;

  const reset = () => {
    setStage('consent');
    setAccepted(false);
    setLearnMore(false);
    setSetupError(null);
    setAddressBeat(false);
  };

  const close = () => {
    if (working) return;
    reset();
    onClose();
  };

  const handleOptIn = () => {
    triggerHaptic('selection');
    setStage('running');
    setSetupError(null);
    void optIn().catch((cause: unknown) => {
      setSetupError(cause ?? new Error('Private payments setup stopped safely.'));
    });
  };

  return (
    <Modal open={open} onClose={close} dismissable={!working}>
      <ModalHeader
        title="Private Payments"
        subtitle={visibleStage === 'running' ? 'Setting up on this device' : 'Set up on this device'}
        onClose={working ? undefined : close}
      />
      <div className="p-4 sm:p-6">
        {visibleStage === 'consent' ? (
          <section aria-labelledby="private-setup-hero">
            <div className="mb-5 flex flex-col items-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0A84FF]/14 text-[#0A84FF]">
                <IconShieldStellar size={28} />
              </span>
              <h3 id="private-setup-hero" className="mt-3 text-[20px] font-bold text-white">
                Private Payments
              </h3>
              <p className="mt-1 max-w-[36ch] text-[13px] leading-relaxed text-neutral-400">
                Send and receive {assetList} where the amount and recipient stay encrypted.
              </p>
            </div>

            <div className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-3.5">
              <PrivacyDisclosure />
              <button
                type="button"
                aria-expanded={learnMore}
                onClick={() => {
                  triggerHaptic('selection');
                  setLearnMore(value => !value);
                }}
                className="mt-3 flex min-h-8 items-center gap-1 text-[12px] font-semibold text-[#0A84FF]"
              >
                Learn more
                <IconChevronDown
                  size={12}
                  className={`transition-transform ${learnMore ? 'rotate-180' : ''}`}
                />
              </button>
              {learnMore ? (
                <div className="mt-3 space-y-3 border-t border-white/[0.07] pt-3">
                  <p className="text-[12px] leading-relaxed text-neutral-400">
                    One-time download: {deployment.artifactBytesAreLowerBound ? 'at least ' : 'about '}
                    {formatBytes(deployment.artifactDownloadBytes)} of verified proving files. They
                    are kept on this device and reused.
                  </p>
                  <p className="text-[12px] leading-relaxed text-neutral-400">
                    Your recovery phrase can rebuild your private balance from Stellar. Recovery may
                    require network fees and downloading the proving files again.
                  </p>
                </div>
              ) : null}
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.1] bg-white/[0.035] p-3.5">
              <input
                type="checkbox"
                checked={accepted}
                onChange={event => {
                  triggerHaptic('selection');
                  setAccepted(event.target.checked);
                }}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[#0A84FF]"
              />
              <span className="text-[12.5px] leading-relaxed text-neutral-300">
                Money moving in or out of my private balance is public, and restoring from my
                recovery phrase can cost network fees. I understand.
              </span>
            </label>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button type="button" variant="ghost" onClick={close}>Not Now</Button>
              <Button type="button" disabled={!accepted} onClick={() => void handleOptIn()}>
                Turn On
              </Button>
            </div>
          </section>
        ) : null}

        {visibleStage === 'running' ? (
          <section aria-label="Setting up Private Payments">
            <ol className="space-y-0.5 rounded-2xl border border-white/[0.09] bg-white/[0.025] p-2.5">
              {SETUP_STEPS.map((label, index) => {
                const done = index < reachedStep;
                const active = index === reachedStep && visibleSetupError === null;
                return (
                  <li key={label} className="flex min-h-11 items-center gap-3 px-2 text-[13px]">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                      {done ? (
                        <IconCheck size={15} className="text-[#30D158]" />
                      ) : active ? (
                        <span className="text-[#0A84FF]"><Spinner size={14} /></span>
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-white/[0.18]" />
                      )}
                    </span>
                    <span className={
                      done
                        ? 'text-neutral-400'
                        : active
                          ? 'font-semibold text-white'
                          : 'text-neutral-600'
                    }>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div aria-live="polite" className="mt-4">
              {visibleSetupError !== null ? <HumanizedErrorNotice cause={visibleSetupError} /> : null}
            </div>
            {visibleSetupError !== null ? (
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button type="button" variant="ghost" onClick={close}>Close</Button>
                <Button type="button" onClick={() => void handleOptIn()}>Try Again</Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {visibleStage === 'done' ? (
          <PrivateSuccess
            title="Private Payments is on"
            subtitle={`Your private ${assetList} balances are ready. Checking past private activity continues in the background.`}
            celebrate={false}
            doneLabel="Done"
            onDone={close}
          />
        ) : null}
      </div>
    </Modal>
  );
}
