'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconChevronDown, IconShieldStellar } from '@/components/icons';
import { Button, Modal, ModalHeader, Spinner } from '@/components/ui';
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

const SETUP_STEPS = [
  'Preparing privacy tools',
  'Creating your keys',
  'Creating your private address',
  'Saving securely on this device',
  'Checking private history',
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
  const [addressBeat, setAddressBeat] = useState(false);
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

  // One wallet-wide consent prepares every currently verified asset. The
  // provider owns one asset-pinned runtime at a time, so this effect advances
  // them sequentially and restores the user's original selection at the end.
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
    void optIn().catch((cause: unknown) => {
      if (attemptedDeploymentRef.current !== setupTargetDeploymentId) return;
      setSetupError(cause ?? new Error(
        `Private ${setupTargetCode} setup stopped safely.`,
      ));
    });
  }, [
    optIn,
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

  // Setup ends only after every asset is durable and the original asset has
  // returned to authenticated current state.
  useEffect(() => {
    if (stage !== 'running' || phase !== 'reading-meta') return;
    const timer = window.setTimeout(() => setAddressBeat(true), 1400);
    return () => window.clearTimeout(timer);
  }, [phase, stage]);
  const reachedStep = visibleStage === 'done'
    ? SETUP_STEPS.length
    : phase === 'current'
      ? 4
      : phase === 'scanning-live'
        ? 4
        : phase === 'reading-meta'
          ? (addressBeat ? 2 : 1)
          : 0;

  const reset = () => {
    setStage('consent');
    setAccepted(false);
    setLearnMore(false);
    setSetupError(null);
    setAddressBeat(false);
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

  const setupTargetIndex = setupPlan?.deploymentIds.indexOf(
    setupTargetDeploymentId ?? '',
  ) ?? -1;
  const setupProgress = setupPlan && setupPlan.deploymentIds.length > 1
    ? ` (${Math.max(0, setupTargetIndex) + 1} of ${setupPlan.deploymentIds.length})`
    : '';
  const runningSubtitle = allAssetsPrepared
    ? 'Finishing Private Payments'
    : phase === 'scanning-live' && runtimeMatchesSelection
      ? `Checking private ${setupTargetCode}${setupProgress}`
      : `Preparing private ${setupTargetCode}${setupProgress}`;

  return (
    <Modal open={open} onClose={close} dismissable={!working}>
      <ModalHeader
        title="Private Payments"
        subtitle={visibleStage === 'running'
          ? runningSubtitle
          : 'Set up on this device'}
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
