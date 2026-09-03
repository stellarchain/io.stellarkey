'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, LoadingRegion } from '@/components/ui';
import {
  usePrivateBalancePortfolio,
  usePrivateBalanceRuntime,
  usePrivateBalanceRuntimeData,
} from '@/hooks/usePrivateBalanceRuntime';
import {
  privatePaymentsEnabled,
  privatePaymentAccessState,
} from '@/lib/private-balance-bootstrap';
import { PrivateAssetSelector } from './PrivateAssetSelector';
import { PrivateBalanceSetup } from './PrivateBalanceSetup';
import { HumanizedErrorNotice } from './PrivateBalanceStatus';
import { PrivateSetupContent } from './PrivateSetupContent';

type PrivatePaymentAction = 'send' | 'receive' | 'add';

/**
 * Keeps wallet-wide consent separate from per-asset runtime preparation.
 * Opening a private action is explicit intent, so an enabled wallet can safely
 * initialize the selected asset here without another disclosure prompt.
 */
export function PrivatePaymentAccessGate({
  action,
  children,
}: {
  action: PrivatePaymentAction;
  children: ReactNode;
}) {
  const {
    availableAssets,
    retryRuntime,
    selectedDeploymentId,
  } = usePrivateBalanceRuntime();
  const { entries } = usePrivateBalancePortfolio();
  const {
    asset,
    configured,
    error,
    optIn,
  } = usePrivateBalanceRuntimeData();
  const selected = availableAssets.find(
    option => option.deploymentId === selectedDeploymentId,
  ) ?? availableAssets[0] ?? null;
  const paymentsEnabled = privatePaymentsEnabled(availableAssets) || entries.length > 0;
  const runtimeMatchesSelection = Boolean(
    selected && asset?.contractId === selected.asset.contractId,
  );
  const accessState = privatePaymentAccessState({
    paymentsEnabled,
    selectedStateExists: selected?.encryptedStateExists ?? false,
    runtimeConfigured: configured,
    runtimeMatchesSelection,
  });
  const [activationFailure, setActivationFailure] = useState<{
    deploymentId: string;
    cause: unknown;
  } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const attemptedDeploymentRef = useRef<string | null>(null);

  const activateSelectedAsset = useCallback(() => {
    if (!selected || !runtimeMatchesSelection) return;
    attemptedDeploymentRef.current = selected.deploymentId;
    const deploymentId = selected.deploymentId;
    void optIn().catch((cause: unknown) => {
      if (attemptedDeploymentRef.current !== deploymentId) return;
      setActivationFailure({
        deploymentId,
        cause: cause ?? new Error(`Private ${selected.asset.code} preparation stopped safely.`),
      });
    });
  }, [optIn, runtimeMatchesSelection, selected]);

  useEffect(() => {
    if (
      setupOpen ||
      accessState !== 'preparing' ||
      !paymentsEnabled ||
      selected?.encryptedStateExists ||
      !runtimeMatchesSelection ||
      attemptedDeploymentRef.current === selected.deploymentId
    ) {
      return;
    }
    activateSelectedAsset();
  }, [
    accessState,
    activateSelectedAsset,
    paymentsEnabled,
    runtimeMatchesSelection,
    selected,
    setupOpen,
  ]);

  const code = selected?.asset.code ?? 'asset';
  const activationError = activationFailure?.deploymentId === selected?.deploymentId
    ? activationFailure.cause
    : error
      ? new Error(error)
      : null;
  const retryActivation = () => {
    setActivationFailure(null);
    attemptedDeploymentRef.current = null;
    if (selected?.encryptedStateExists || !runtimeMatchesSelection) {
      retryRuntime();
      return;
    }
    activateSelectedAsset();
  };
  const panel = accessState === 'needs-consent' || setupOpen ? (
    <PrivateSetupContent action={action} onTurnOn={() => setSetupOpen(true)} />
  ) : accessState === 'ready' ? (
    children
  ) : (
    <div className="p-4 sm:p-6">
      <div className="flex justify-center">
        <PrivateAssetSelector />
      </div>
      {activationError === null ? (
        <LoadingRegion
          label={`Preparing private ${code}`}
          className="min-h-48"
        />
      ) : (
        <div className="mx-auto flex min-h-48 max-w-[360px] flex-col justify-center">
          <HumanizedErrorNotice cause={activationError} />
          <Button type="button" className="mt-4 self-center" onClick={retryActivation}>
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
  return (
    <>
      {panel}
      <PrivateBalanceSetup open={setupOpen} onClose={() => setSetupOpen(false)} />
    </>
  );
}
