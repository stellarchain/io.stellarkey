'use client';

import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconShieldStellar } from '@/components/icons';
import { Button, Modal, ModalHeader } from '@/components/ui';
import {
  usePrivateBalanceRuntime,
  usePrivateBalanceRuntimeData,
} from '@/hooks/usePrivateBalanceRuntime';
import { triggerHaptic } from '@/lib/haptics';
import {
  privatePaymentSetupComplete,
  privatePaymentSetupTarget,
} from '@/lib/private-balance-bootstrap';
import { PrivacyDisclosure } from './PrivacyDisclosure';
import { HumanizedErrorNotice } from './PrivateBalanceStatus';
import { PrivateSuccess } from './PrivateSuccess';

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
 * local setup progress and the shared success moment.
 */
export function PrivateBalanceSetup({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const {
    availableAssets,
    selectedDeploymentId,
    selectAsset,
  } = usePrivateBalanceRuntime();
  const {
    asset,
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
  const [addressBeatDeploymentId, setAddressBeatDeploymentId] = useState<string | null>(null);
  const [progressHighWater, setProgressHighWater] = useState(0);
  const [setupPlan, setSetupPlan] = useState<{
    deploymentIds: string[];
    initialDeploymentId: string;
  } | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const attemptedDeploymentRef = useRef<string | null>(null);
  const assetList = formatAssetList(
    availableAssets.map(option => option.asset.code),
  );
  const selected = availableAssets.find(
    option => option.deploymentId === selectedDeploymentId,
  ) ?? availableAssets[0] ?? null;
  const selectedAssetCode = selected?.asset.code ?? 'asset';
  const runtimeMatchesSelection = Boolean(
    selected && asset?.contractId === selected.asset.contractId,
  );
  const setupAssets = setupPlan === null
    ? []
    : setupPlan.deploymentIds.flatMap(deploymentId => {
        const option = availableAssets.find(assetOption => (
          assetOption.deploymentId === deploymentId
        ));
        return option ? [option] : [];
      });
  const setupCatalogueStable = setupPlan === null
    || setupAssets.length === setupPlan.deploymentIds.length;
  const setupTargetDeploymentId = setupPlan === null
    ? null
    : privatePaymentSetupTarget(setupAssets, setupPlan.initialDeploymentId);
  const setupTarget = setupAssets.find(
    option => option.deploymentId === setupTargetDeploymentId,
  ) ?? null;
  const addressBeat = addressBeatDeploymentId === setupTargetDeploymentId;
  const remainingUnpreparedAssets = setupAssets.filter(
    option => !option.encryptedStateExists,
  ).length;
  const setupPlanError = setupPlan !== null && !setupCatalogueStable
    ? new Error('The verified Private Payments asset list changed during setup.')
    : setupPlan !== null && setupTargetDeploymentId === null
      ? new Error('No verified Private Payments asset is available.')
      : null;
  const setupTargetCode = setupTarget?.asset.code ?? selectedAssetCode;
  const allAssetsPrepared = setupPlan !== null
    && setupCatalogueStable
    && setupAssets.length > 0
    && setupAssets.every(option => option.encryptedStateExists);
  const selectedDeploymentRestored = setupPlan !== null
    && selectedDeploymentId === setupPlan.initialDeploymentId;
  const setupReady = privatePaymentSetupComplete({
    setupRunning: stage === 'running',
    phase,
    configured,
    privateAddressAvailable: privateAddress !== null,
    allAssetsPrepared,
    selectedDeploymentRestored,
    runtimeMatchesSelection,
  });
  const runtimeMatchesSetupTarget = runtimeMatchesSelection
    && selectedDeploymentId === setupTargetDeploymentId;
  const visibleStage = setupReady ? 'done' : stage;
  const visibleSetupError = setupError ?? setupPlanError ?? (
    stage === 'running'
      && setupTargetDeploymentId === selectedDeploymentId
      && runtimeMatchesSelection
      && (phase === 'safe-error' || phase === 'status-unknown')
      && error
      ? new Error(error)
      : null
  );
  const working = visibleStage === 'running' && visibleSetupError === null;
  const completedSetupAssets = setupAssets.length - remainingUnpreparedAssets;
  const currentAssetProgress = allAssetsPrepared
    ? 1
    : !runtimeMatchesSetupTarget
      ? 0
      : phase === 'current'
        ? 1
        : phase === 'scanning-live'
          ? 0.75
          : phase === 'reading-meta'
            ? (addressBeat ? 0.5 : 0.25)
            : 0.08;
  const measuredProgress = setupAssets.length === 0
    ? 0
    : Math.round(
        ((completedSetupAssets + currentAssetProgress) / setupAssets.length) * 100,
      );
  const progressTarget = allAssetsPrepared ? 100 : Math.min(99, measuredProgress);
  const progressPercent = visibleStage === 'done' ? 100 : progressHighWater;
  const runningStatus = allAssetsPrepared
    ? 'Finishing secure setup'
    : phase === 'scanning-live' && runtimeMatchesSetupTarget
      ? 'Checking private history'
      : phase === 'reading-meta' && runtimeMatchesSetupTarget
        ? (addressBeat ? 'Creating your private address' : 'Creating private keys')
        : 'Preparing privacy tools';

  // One wallet-wide consent prepares every currently verified asset. The
  // provider owns one asset-pinned runtime at a time, so this effect advances
  // them sequentially and finishes on the user's original selection. Only the
  // final pass starts the shared proving-file warm-up, after setup is current.
  useEffect(() => {
    if (stage !== 'running' || setupPlan === null || setupError !== null) return;
    if (!setupCatalogueStable || setupTargetDeploymentId === null) return;
    if (selectedDeploymentId !== setupTargetDeploymentId) {
      // Ignore any teardown rejection from the asset that just completed.
      attemptedDeploymentRef.current = null;
      selectAsset(setupTargetDeploymentId);
      return;
    }
    if (!runtimeMatchesSelection || setupTarget?.encryptedStateExists) return;
    if (attemptedDeploymentRef.current === setupTargetDeploymentId) return;

    attemptedDeploymentRef.current = setupTargetDeploymentId;
    void optIn({ prefetchArtifacts: remainingUnpreparedAssets === 1 }).catch((cause: unknown) => {
      if (attemptedDeploymentRef.current !== setupTargetDeploymentId) return;
      setSetupError(cause ?? new Error(
        `Private ${setupTargetCode} setup stopped safely.`,
      ));
    });
  }, [
    optIn,
    remainingUnpreparedAssets,
    retryVersion,
    runtimeMatchesSelection,
    selectAsset,
    selectedDeploymentId,
    setupCatalogueStable,
    setupError,
    setupPlan,
    setupTarget,
    setupTargetCode,
    setupTargetDeploymentId,
    stage,
  ]);

  // Setup ends only after every asset is durable and the original asset is in
  // authenticated current state.
  useEffect(() => {
    if (stage !== 'running' || phase !== 'reading-meta') return;
    const timer = window.setTimeout(
      () => setAddressBeatDeploymentId(setupTargetDeploymentId),
      1400,
    );
    return () => window.clearTimeout(timer);
  }, [phase, setupTargetDeploymentId, stage]);

  useEffect(() => {
    if (stage !== 'running') return;
    const frame = window.requestAnimationFrame(() => {
      setProgressHighWater(current => Math.max(current, progressTarget));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [progressTarget, stage]);

  const reset = () => {
    setStage('consent');
    setAccepted(false);
    setLearnMore(false);
    setSetupError(null);
    setAddressBeatDeploymentId(null);
    setProgressHighWater(0);
    setSetupPlan(null);
    setRetryVersion(0);
    attemptedDeploymentRef.current = null;
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
    setProgressHighWater(0);
    attemptedDeploymentRef.current = null;
    const initialDeploymentId = selected?.deploymentId ?? availableAssets[0]?.deploymentId;
    if (!initialDeploymentId || availableAssets.length === 0) {
      setSetupError(new Error('No verified Private Payments asset is available.'));
      return;
    }
    setSetupPlan({
      deploymentIds: availableAssets.map(option => option.deploymentId),
      initialDeploymentId,
    });
  };

  const retrySetup = () => {
    attemptedDeploymentRef.current = null;
    setSetupError(null);
    setRetryVersion(version => version + 1);
  };

  const runningSubtitle = visibleStage === 'running'
    ? 'Securing this device'
    : 'Set up on this device';

  return (
    <Modal open={open} onClose={close} dismissable={!working}>
      <ModalHeader
        title="Private Payments"
        subtitle={runningSubtitle}
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
                Money moving in or out of my private balance is public, and recovery can cost
                network fees. This testnet preview uses a single-party development proving key;
                anyone who retained its setup secret could forge proofs and take testnet funds.
                I understand and will use testnet funds only.
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
          <section
            aria-label="Setting up Private Payments"
            className="relative overflow-hidden px-1 pb-2 pt-3 sm:px-2 sm:pb-4 sm:pt-5"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -left-16 top-0 h-28 w-28 rounded-full bg-[#0A84FF]/10 blur-3xl"
            />
            <div className="relative">
              <div className="flex items-end justify-between gap-6">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#64D2FF]">
                    On-device setup
                  </p>
                  <p
                    aria-live="polite"
                    className="mt-2 text-[18px] font-semibold leading-tight tracking-[-0.015em] text-white sm:text-[20px]"
                  >
                    {runningStatus}
                  </p>
                </div>
                <p
                  aria-hidden="true"
                  className="mono shrink-0 text-[34px] font-medium leading-none tracking-[-0.06em] text-white sm:text-[38px]"
                >
                  {progressPercent}<span className="ml-0.5 text-[15px] tracking-normal text-neutral-500">%</span>
                </p>
              </div>
              <div
                role="progressbar"
                aria-label="Private Payments setup progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
                aria-valuetext={`${progressPercent}% complete. ${runningStatus}.`}
                className="relative mt-7 h-[3px] overflow-hidden rounded-full bg-white/[0.1]"
              >
                <div
                  className="absolute inset-0 origin-left rounded-full bg-[#0A84FF] shadow-[0_0_14px_rgba(10,132,255,0.5)] transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
                  style={{ transform: `scaleX(${progressPercent / 100})` }}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-[11px] text-neutral-500">
                <p className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#30D158] shadow-[0_0_8px_rgba(48,209,88,0.45)]" />
                  Encrypted on this device
                </p>
                <p>Keys stay local</p>
              </div>
            </div>
            <div aria-live="polite" className="mt-4">
              {visibleSetupError !== null ? <HumanizedErrorNotice cause={visibleSetupError} /> : null}
            </div>
            {visibleSetupError !== null ? (
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button type="button" variant="ghost" onClick={close}>Close</Button>
                <Button type="button" onClick={retrySetup}>Try Again</Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {visibleStage === 'done' ? (
          <PrivateSuccess
            title="Private Payments is on"
            subtitle={`Private Payments is ready for ${assetList}.`}
            celebrate={false}
            doneLabel="Done"
            onDone={close}
          />
        ) : null}
      </div>
    </Modal>
  );
}
