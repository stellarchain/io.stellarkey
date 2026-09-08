'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconCheck, IconChevronDown, IconShieldStellar } from '@/components/icons';
import { Button, ModalBody, ModalFooter } from '@/components/ui';
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
import {
  useReportToOwner,
  type PrivateFlowHeader,
  type PrivateFlowHeaderChange,
} from './useReportToOwner';

const SETUP_COMPLETION_HOLD_MS = 650;

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
 * local setup progress, which shows its completed state briefly and then
 * dismisses itself. The shell in `PrivateBalanceSetup.tsx` owns the dialog
 * and shows the header and busy state this body reports.
 */
export function PrivateBalanceSetupBody({
  open,
  onClose,
  onBusyChange,
  onHeaderChange,
}: {
  open: boolean;
  onClose(): void;
  onBusyChange(busy: boolean): void;
  onHeaderChange: PrivateFlowHeaderChange;
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
  const [stage, setStage] = useState<'consent' | 'running'>('consent');
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
  const onCloseRef = useRef(onClose);
  // State only: the attempted-deployment ref is cleared by Turn On and Try
  // Again themselves, so this may run during render on reopen.
  const reset = useCallback(() => {
    setStage('consent');
    setAccepted(false);
    setLearnMore(false);
    setSetupError(null);
    setAddressBeatDeploymentId(null);
    setProgressHighWater(0);
    setSetupPlan(null);
    setRetryVersion(0);
  }, []);
  // The completed (or consent) screen stays on through the exit animation;
  // a reopen starts from consent again.
  // (State adjusted during render per https://react.dev/learn/you-might-not-need-an-effect)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) reset();
  }
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
  const visibleSetupError = setupError ?? setupPlanError ?? (
    stage === 'running'
      && setupTargetDeploymentId === selectedDeploymentId
      && runtimeMatchesSelection
      && (phase === 'safe-error' || phase === 'status-unknown')
      && error
      ? new Error(error)
      : null
  );
  const working = stage === 'running' && visibleSetupError === null;
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
  const progressPercent = setupReady ? 100 : progressHighWater;
  const runningStatus = setupReady
    ? 'Private Payments ready'
    : allAssetsPrepared
      ? 'Finishing secure setup'
      : phase === 'scanning-live' && runtimeMatchesSetupTarget
        ? 'Checking private history'
        : phase === 'reading-meta' && runtimeMatchesSetupTarget
          ? (addressBeat ? 'Creating your private address' : 'Creating private keys')
          : 'Preparing privacy tools';

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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

  // The completed state holds briefly, then the dialog releases itself. The
  // state is not reset here: the check mark stays through the exit and a
  // later reopen starts fresh from consent.
  useEffect(() => {
    if (!open || !setupReady) return;
    const timer = window.setTimeout(() => {
      triggerHaptic('success');
      onCloseRef.current();
    }, SETUP_COMPLETION_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [open, setupReady]);

  const handleOptIn = () => {
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

  const runningSubtitle = stage === 'running'
    ? 'Securing this device'
    : 'Set up on this device';
  // The shell shows the title and this subtitle; setup in flight blocks
  // dismissal there too.
  const header = useMemo<PrivateFlowHeader>(
    () => ({ title: 'Private Payments', subtitle: runningSubtitle }),
    [runningSubtitle],
  );
  useReportToOwner<PrivateFlowHeader | null>(onHeaderChange, header, null);
  useReportToOwner(onBusyChange, working, false);

  return (
    <ModalBody>
      {stage === 'consent' ? (
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
              onClick={() => setLearnMore(value => !value)}
              className="mt-1 flex items-center gap-1 text-[13px] font-semibold text-[#0A84FF]"
            >
              Learn more
              <IconChevronDown
                size={12}
                className={`transition-transform ${learnMore ? 'rotate-180' : ''}`}
              />
            </button>
            {learnMore ? (
              <div className="mt-2 space-y-3 border-t border-white/[0.07] pt-3">
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
              onChange={event => setAccepted(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#0A84FF]"
            />
            <span className="text-[12.5px] leading-relaxed text-neutral-300">
              Money moving in or out of my private balance is public, and recovery can cost
              network fees. This testnet preview uses a single-party development proving key;
              anyone who retained its setup secret could forge proofs and take testnet funds.
              I understand and will use testnet funds only.
            </span>
          </label>

          <ModalFooter
            secondary={
              <Button type="button" variant="ghost" onClick={onClose}>Not Now</Button>
            }
            primary={
              <Button type="button" disabled={!accepted} onClick={() => void handleOptIn()}>
                Turn On
              </Button>
            }
          />
        </section>
      ) : null}

      {stage === 'running' ? (
        <section
          aria-label="Setting up Private Payments"
          className="relative overflow-hidden px-1 pb-2 pt-3 sm:px-2 sm:pb-4 sm:pt-5"
        >
          <div className="relative">
            <div className="flex items-end justify-between gap-6">
              <div className="min-w-0">
                {setupReady ? (
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#30D158]">
                    <IconCheck size={12} aria-hidden="true" />
                    Complete
                  </p>
                ) : (
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#64D2FF]">
                    On-device setup
                  </p>
                )}
                <p
                  aria-live="polite"
                  className="mt-2 text-[18px] font-semibold leading-tight tracking-[-0.015em] text-white sm:text-[20px]"
                >
                  {runningStatus}
                </p>
              </div>
              {setupReady ? (
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#30D158]/14 text-[#30D158]"
                >
                  <IconCheck size={24} />
                </span>
              ) : (
                <p
                  aria-hidden="true"
                  className="mono shrink-0 text-[34px] font-medium leading-none tracking-[-0.06em] text-white sm:text-[38px]"
                >
                  {progressPercent}<span className="ml-0.5 text-[15px] tracking-normal text-neutral-500">%</span>
                </p>
              )}
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
                className={`absolute inset-0 origin-left rounded-full shadow-[0_0_14px_rgba(10,132,255,0.5)] transition-transform duration-[var(--motion-duration-progress)] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${setupReady ? 'bg-[#30D158]' : 'bg-[#0A84FF]'}`}
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
            <ModalFooter
              secondary={<Button type="button" variant="ghost" onClick={onClose}>Close</Button>}
              primary={<Button type="button" onClick={retrySetup}>Try Again</Button>}
            />
          ) : null}
        </section>
      ) : null}
    </ModalBody>
  );
}
