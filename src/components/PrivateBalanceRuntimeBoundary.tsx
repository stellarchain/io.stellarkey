'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { useWalletIdentity, useWalletPhase } from '@/hooks/useWallet';
import {
  PrivateBalancePortfolioProvider,
  PrivateBalanceRuntimeControlProvider,
  PrivateBalanceRuntimeDataProvider,
  initialPrivateBalanceRuntimeData,
  usePrivateBalanceRuntime,
  usePrivateBalanceRuntimeData,
  type PrivateBalanceDeploymentSummary,
  type PrivateBalanceDurableRuntimeSummary,
  type PrivateBalanceRuntimeDataValue,
} from '@/hooks/usePrivateBalanceRuntime';
import { IndexedDbEncryptedRecordDriver } from '@/lib/indexed-db';
import {
  hasEncryptedPrivateBalanceState,
  privateBalanceAccountSupport,
  selectPrivateBalanceDeploymentId,
  shouldMountPrivateBalanceRuntime,
  updatePrivateBalancePoolStorageState,
  type PrivateBalanceStorageScope,
} from '@/lib/private-balance-bootstrap';
import {
  privateBalanceAvailability,
} from '@/lib/private-balance-manifest';
import {
  loadExpectedPrivateBalanceCatalogue,
  loadPrivateBalanceDeployments,
  type LoadedPrivateBalanceDeployment,
} from '@/lib/private-balance-assets';
import {
  ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE,
} from '@/lib/private-balance-expected-manifest';
import { PrivateIncomingToasts } from '@/features/private-balance/components/PrivateIncomingToasts';
import { withPrivacySessionRoot } from '@/lib/vault';
import {
  buildPrivatePortfolioEntries,
  reconcilePrivatePortfolioRuntimeEntry,
  upsertPrivatePortfolioEntry,
  updatePrivatePortfolioPoolEntries,
  type PrivatePortfolioEntry,
} from '@/features/private-balance/runtime/portfolio';
import type { DeploymentContext } from '@/features/private-balance/runtime/types';
import { mergePrivateRuntimePublication } from '@/features/private-balance/runtime/publication';

const DynamicPrivateBalanceProvider = dynamic(
  () => import("@/features/private-balance/runtime/provider").then(
    module => module.PrivateBalanceProvider,
  ),
  { ssr: false, loading: () => null },
);

interface ReadyDeployment extends LoadedPrivateBalanceDeployment {
  storageScope: PrivateBalanceStorageScope;
  encryptedStateExists: boolean;
  deployment: PrivateBalanceDeploymentSummary;
}

interface BootstrapState {
  key: string | null;
  ready: ReadyDeployment[];
  fallbackDeployment: PrivateBalanceDeploymentSummary | null;
  reason: string | null;
  checking: boolean;
}

const INITIAL_BOOTSTRAP: BootstrapState = {
  key: null,
  ready: [],
  fallbackDeployment: null,
  reason: null,
  checking: true,
};

interface PublishedRuntime {
  key: string;
  value: PrivateBalanceRuntimeDataValue;
}

interface PublishedPrivatePortfolio {
  key: string | null;
  entries: PrivatePortfolioEntry[];
}

function portfolioEntryFromRuntime(
  deploymentId: string,
  value: PrivateBalanceRuntimeDataValue,
  existing: PrivatePortfolioEntry | undefined,
): PrivatePortfolioEntry | null {
  if (!value.configured || !value.asset) return null;
  const candidate = {
    deploymentId,
    asset: value.asset,
    verifiedBalanceAtomicUnits: value.verifiedBalanceStroops,
    lastVerifiedLedger: value.checkpoint?.latestLedger ?? existing?.lastVerifiedLedger ?? null,
    lastVerifiedActionIndex:
      value.lastVerifiedActionIndex ?? existing?.lastVerifiedActionIndex ?? null,
    activities: value.activities,
    pendingActions: value.pendingActions,
  };
  return reconcilePrivatePortfolioRuntimeEntry(
    existing,
    candidate,
    value.phase === 'current',
  );
}

/**
 * Reads the dynamically loaded runtime and publishes its value into the stable
 * provider that owns the dashboard. Keeping the dashboard outside the dynamic
 * provider prevents the first Private Payments request from remounting every
 * wallet screen and discarding its navigation state.
 */
function PrivateBalanceRuntimePublisher({
  runtimeKey,
  portfolioKey,
  deploymentId,
  onPublish,
}: {
  runtimeKey: string;
  portfolioKey: string;
  deploymentId: string;
  onPublish(
    key: string,
    portfolioKey: string,
    deploymentId: string,
    value: PrivateBalanceRuntimeDataValue,
  ): void;
}) {
  const value = usePrivateBalanceRuntimeData();

  useLayoutEffect(() => {
    onPublish(runtimeKey, portfolioKey, deploymentId, value);
  }, [deploymentId, onPublish, portfolioKey, runtimeKey, value]);

  return null;
}

function deploymentContext(
  manifest: LoadedPrivateBalanceDeployment['manifest'],
  computeContextHash: typeof import('@stellarkey/private-balance').computeContextHash,
): DeploymentContext {
  const networkId = Uint8Array.from(manifest.networkId.match(/../g) ?? [], value => Number.parseInt(value, 16));
  const realmId = Uint8Array.from(manifest.realmId.match(/../g) ?? [], value => Number.parseInt(value, 16));
  const poolId = new Uint8Array(StrKey.decodeContract(manifest.poolContractId));
  return {
    protocolVersion: manifest.protocolVersion,
    networkId: manifest.networkId,
    realmId: manifest.realmId,
    poolContractId: manifest.poolContractId,
    contextHash: hex(computeContextHash(
      manifest.protocolVersion,
      networkId,
      realmId,
      poolId,
    )),
    deploymentBindingHash: manifest.deploymentBindingHash,
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function runtimeFallback(
  walletPhase: string,
  checking: boolean,
  reason: string | null,
  deployment: PrivateBalanceDeploymentSummary | null,
): PrivateBalanceRuntimeDataValue {
  const fallbackPhase = walletPhase !== 'unlocked'
    ? 'locked'
    : checking
      ? 'loading-artifacts'
      : 'disabled';
  const unavailable = async () => {
    throw new Error(reason ?? 'Private Balance is unavailable.');
  };
  return {
    ...initialPrivateBalanceRuntimeData,
    phase: fallbackPhase,
    error: reason,
    ...(deployment ? { deployment } : {}),
    optIn: unavailable,
    refreshSync: unavailable,
  };
}

function summarizeManifest(
  manifest: LoadedPrivateBalanceDeployment['manifest'],
  network: 'testnet' | 'mainnet',
  manifestHash: string,
): PrivateBalanceDeploymentSummary {
  return {
    manifestStatus: manifest.status,
    network,
    poolContractId: manifest.poolContractId,
    assetContractId: null,
    realmId: manifest.realmId,
    artifactVersion: manifest.artifactVersion,
    manifestHash,
    circuitHash: manifest.artifacts.r1csSha256,
    artifactDownloadBytes:
      manifest.artifacts.wasmByteLength +
      (manifest.artifacts.zkeyTransport?.wireByteLength ?? manifest.artifacts.zkeyByteLength),
    artifactBytesAreLowerBound: false,
    auditStatus: 'not-recorded',
    ceremonyStatus: 'not-recorded',
    depositsPaused: null,
    actionCount: null,
    pageCount: null,
    latestLedger: null,
    recoveryEvidence: null,
  };
}

function PrivateBalanceRuntimeBootstrap({ children }: { children: ReactNode }) {
  const { activeAccount, network } = useWalletIdentity();
  const { phase } = useWalletPhase();
  const {
    requested,
    runtimeRequestVersion,
    selectedDeploymentId,
    registerAvailableAssets,
  } = usePrivateBalanceRuntime();
  const [bootstrap, setBootstrap] = useState<BootstrapState>(INITIAL_BOOTSTRAP);
  const [publishedRuntime, setPublishedRuntime] = useState<PublishedRuntime | null>(null);
  const [privatePortfolio, setPrivatePortfolio] = useState<PublishedPrivatePortfolio>({
    key: null,
    entries: [],
  });
  const readyDeploymentsRef = useRef<ReadyDeployment[]>([]);
  const updatePrivatePortfolioEntry = useCallback((
    portfolioKey: string,
    deploymentId: string,
    value: PrivateBalanceRuntimeDataValue,
  ) => {
    setPrivatePortfolio(current => {
      if (current.key !== portfolioKey) return current;
      // Render publication is advisory. A concurrent pre-setup render may
      // arrive after the encrypted record was committed, so only the durable
      // callback below may remove a configured portfolio entry.
      if (!value.configured) return current;
      const existing = current.entries.find(entry => entry.deploymentId === deploymentId);
      const entry = portfolioEntryFromRuntime(deploymentId, value, existing);
      if (!entry) return current;
      return {
        ...current,
        entries: upsertPrivatePortfolioEntry(current.entries, entry),
      };
    });
  }, []);
  const publishRuntime = useCallback((
    key: string,
    portfolioKey: string,
    deploymentId: string,
    value: PrivateBalanceRuntimeDataValue,
  ) => {
    setPublishedRuntime(current => mergePrivateRuntimePublication(
      current,
      key,
      value,
      'render',
    ));
    updatePrivatePortfolioEntry(portfolioKey, deploymentId, value);
  }, [updatePrivatePortfolioEntry]);
  const support = privateBalanceAccountSupport(phase, activeAccount);
  const accountReady = support.ready;
  const bootstrapKey = accountReady && activeAccount
    ? `${network}:${activeAccount.id}`
    : null;
  const publishAvailableDeployments = useCallback((
    loadedDeployments: LoadedPrivateBalanceDeployment[],
  ) => {
    const assets = loadedDeployments.map(deployment => ({
      deploymentId: deployment.id,
      asset: deployment.asset,
      encryptedStateExists: false,
    }));
    registerAvailableAssets(
      assets,
      assets.find(option => option.asset.kind === 'native')?.deploymentId
        ?? assets[0]?.deploymentId
        ?? null,
    );
  }, [registerAvailableAssets]);

  useEffect(() => {
    let active = true;
    if (!accountReady || !activeAccount || !bootstrapKey) return;
    const supportedAccount = activeAccount;

    void loadExpectedPrivateBalanceCatalogue()
      .then(({ catalogue }) => loadPrivateBalanceDeployments({ catalogue, network }))
      .then(async loadedDeployments => {
        // The verified catalogue is sufficient to render asset rows. Local
        // storage determines setup state, but must never hide the catalogue if
        // IndexedDB is slow, blocked by another tab, or unavailable.
        publishAvailableDeployments(loadedDeployments);
        const driver = new IndexedDbEncryptedRecordDriver();
        const deploymentsByPool = new Map<string, PrivateBalanceDeploymentSummary>();
        const scopesByPool = new Map<string, PrivateBalanceStorageScope>();
        const stateProbeByPool = new Map<string, Promise<boolean>>();
        const candidates = await Promise.all(loadedDeployments.map(async loaded => {
          let deployment = deploymentsByPool.get(loaded.poolDeploymentId);
          if (!deployment) {
            deployment = summarizeManifest(loaded.manifest, network, loaded.manifestHash);
            deploymentsByPool.set(loaded.poolDeploymentId, deployment);
          }
          const availability = privateBalanceAvailability(loaded.manifest, network, {
            allowDevelopmentFixture: ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE,
          });
          if (!availability.ready) {
            return { ready: null, deployment, reason: availability.reason };
          }
          let storageScope = scopesByPool.get(loaded.poolDeploymentId);
          if (!storageScope) {
            storageScope = {
              networkId: loaded.manifest.networkId,
              realmId: loaded.manifest.realmId,
              poolId: hex(new Uint8Array(StrKey.decodeContract(loaded.manifest.poolContractId))),
              accountId: supportedAccount.id,
              deploymentBindingHash: loaded.manifest.deploymentBindingHash,
            };
            scopesByPool.set(loaded.poolDeploymentId, storageScope);
          }
          let stateProbe = stateProbeByPool.get(loaded.poolDeploymentId);
          if (!stateProbe) {
            stateProbe = hasEncryptedPrivateBalanceState(storageScope, driver);
            stateProbeByPool.set(loaded.poolDeploymentId, stateProbe);
          }
          const encryptedStateExists = await stateProbe;
          const ready: ReadyDeployment = {
            ...loaded,
            storageScope,
            encryptedStateExists,
            deployment,
          };
          return { ready, deployment, reason: null };
        }));
        if (!active) return;
        const ready = candidates.flatMap(candidate => candidate.ready ? [candidate.ready] : []);
        const configured = ready.filter(deployment => deployment.encryptedStateExists);
        const portfolioEntries = configured.length === 0
          ? []
          : await (async () => {
              const [storageModule, browserProtocol] = await Promise.all([
                import('@/features/private-balance/runtime/storage'),
                import('@stellarkey/private-balance'),
              ]);
              const durableByPool = new Map<
                string,
                ReturnType<typeof storageModule.loadPrivateBalanceState>
              >();
              return buildPrivatePortfolioEntries(await Promise.all(
                configured.map(async deployment => {
                  let durable = durableByPool.get(deployment.poolDeploymentId);
                  if (!durable) {
                    durable = withPrivacySessionRoot(
                      supportedAccount.id,
                      deploymentContext(deployment.manifest, browserProtocol.computeContextHash),
                      async (_sessionRoot, storageKey) => storageModule.loadPrivateBalanceState(
                        deployment.storageScope,
                        storageKey,
                        driver,
                      ),
                    );
                    durableByPool.set(deployment.poolDeploymentId, durable);
                  }
                  return {
                    deploymentId: deployment.id,
                    asset: deployment.asset,
                    durable: await durable,
                  };
                }),
              ));
            })();
        if (!active) return;
        const preferredDeploymentId = selectPrivateBalanceDeploymentId(ready, null);
        registerAvailableAssets(
          ready.map(deployment => ({
            deploymentId: deployment.id,
            asset: deployment.asset,
            encryptedStateExists: deployment.encryptedStateExists,
          })),
          preferredDeploymentId,
        );
        setBootstrap({
          key: bootstrapKey,
          ready,
          fallbackDeployment: candidates[0]?.deployment ?? null,
          reason: ready.length > 0
            ? null
            : candidates[0]?.reason ?? 'Private Balance has no verified deployment on this network.',
          checking: false,
        });
        setPrivatePortfolio({ key: bootstrapKey, entries: portfolioEntries });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setBootstrap({
          key: bootstrapKey,
          ready: [],
          fallbackDeployment: null,
          reason: error instanceof Error
            ? error.message
            : 'Private Balance deployment verification failed.',
          checking: false,
        });
        setPrivatePortfolio({ key: bootstrapKey, entries: [] });
      });
    return () => {
      active = false;
    };
  }, [
    accountReady,
    activeAccount,
    bootstrapKey,
    network,
    publishAvailableDeployments,
    registerAvailableAssets,
  ]);

  const currentBootstrap: BootstrapState = bootstrap.key === bootstrapKey
    ? bootstrap
    : {
        key: bootstrapKey,
        ready: [],
        fallbackDeployment: null,
        reason: accountReady ? null : support.reason,
        checking: accountReady,
      };
  useEffect(() => {
    readyDeploymentsRef.current = currentBootstrap.ready;
  }, [currentBootstrap.ready]);

  const fallback = runtimeFallback(
    phase,
    currentBootstrap.checking,
    currentBootstrap.reason,
    currentBootstrap.fallbackDeployment,
  );
  const selectedId = selectPrivateBalanceDeploymentId(
    currentBootstrap.ready,
    selectedDeploymentId,
  );
  const deployment = currentBootstrap.ready.find(candidate => candidate.id === selectedId) ?? null;
  const mountRuntime = shouldMountPrivateBalanceRuntime({
    accountReady,
    deploymentReady: deployment !== null,
    requested,
    encryptedStateExists: deployment?.encryptedStateExists ?? false,
  });

  const runtimeKey = mountRuntime && deployment && activeAccount
    ? `${network}:${activeAccount.id}:${deployment.id}:${deployment.poolDeploymentId}:${deployment.manifestHash}:${runtimeRequestVersion}`
    : null;
  const publishDurableRuntime = useCallback((
    key: string,
    portfolioKey: string,
    deploymentId: string,
    asset: LoadedPrivateBalanceDeployment['asset'],
    summary: PrivateBalanceDurableRuntimeSummary,
  ) => {
    const selectedDeployment = readyDeploymentsRef.current.find(
      candidate => candidate.id === deploymentId,
    );
    const nextReady = selectedDeployment
      ? updatePrivateBalancePoolStorageState(
          readyDeploymentsRef.current,
          selectedDeployment.poolDeploymentId,
          summary.configured,
        )
      : readyDeploymentsRef.current;
    if (selectedDeployment) {
      readyDeploymentsRef.current = nextReady;
      registerAvailableAssets(
        nextReady.map(deployment => ({
          deploymentId: deployment.id,
          asset: deployment.asset,
          encryptedStateExists: deployment.encryptedStateExists,
        })),
        selectPrivateBalanceDeploymentId(nextReady, deploymentId),
      );
    }
    setBootstrap(current => {
      const selected = current.ready.find(candidate => candidate.id === deploymentId);
      if (!selected) return current;
      const ready = updatePrivateBalancePoolStorageState(
        current.ready,
        selected.poolDeploymentId,
        summary.configured,
      );
      return ready === current.ready ? current : { ...current, ready };
    });
    setPublishedRuntime(current => mergePrivateRuntimePublication(
      current,
      key,
      current?.key === key
        ? { ...current.value, ...summary, asset }
        : { ...initialPrivateBalanceRuntimeData, ...summary, asset },
      'durable',
    ));
    setPrivatePortfolio(current => {
      if (current.key !== portfolioKey) return current;
      const existing = current.entries.find(entry => entry.deploymentId === deploymentId);
      const poolAssets = selectedDeployment
        ? nextReady
            .filter(candidate => candidate.poolDeploymentId === selectedDeployment.poolDeploymentId)
            .map(candidate => ({ deploymentId: candidate.id, asset: candidate.asset }))
        : [{ deploymentId, asset }];
      const selectedEntry = summary.configured
        ? {
            deploymentId,
            asset,
            verifiedBalanceAtomicUnits: summary.verifiedBalanceStroops,
            lastVerifiedLedger:
              summary.checkpoint?.latestLedger ?? existing?.lastVerifiedLedger ?? null,
            lastVerifiedActionIndex:
              summary.lastVerifiedActionIndex ?? existing?.lastVerifiedActionIndex ?? null,
            activities: summary.activities,
            pendingActions: summary.pendingActions,
          }
        : null;
      return {
        ...current,
        entries: updatePrivatePortfolioPoolEntries(
          current.entries,
          poolAssets,
          selectedEntry,
        ),
      };
    });
  }, [registerAvailableAssets]);
  const effectiveRuntime = runtimeKey && publishedRuntime?.key === runtimeKey
    ? publishedRuntime.value
    : fallback;
  const publishedSelectedRuntime = Boolean(runtimeKey && publishedRuntime?.key === runtimeKey);
  const cachedPortfolioEntries = privatePortfolio.key === bootstrapKey
    ? privatePortfolio.entries
    : [];
  const bootstrappedPortfolioEntries = publishedSelectedRuntime && deployment && !effectiveRuntime.configured
    ? cachedPortfolioEntries.filter(entry => entry.deploymentId !== deployment.id)
    : cachedPortfolioEntries;
  const existingSelectedEntry = deployment
    ? bootstrappedPortfolioEntries.find(entry => entry.deploymentId === deployment.id)
    : undefined;
  const selectedRuntimeEntry = deployment &&
    effectiveRuntime.asset?.contractId === deployment.asset.contractId
      ? portfolioEntryFromRuntime(deployment.id, effectiveRuntime, existingSelectedEntry)
      : null;
  // The setup success state and the dashboard are rendered from the same live
  // runtime snapshot. Waiting for a second effect to copy that snapshot into
  // the portfolio left the setup dialog saying "on" while the asset row still
  // said "Set up". Other deployments retain their bootstrap/cache entries.
  const portfolioEntries = selectedRuntimeEntry
    ? upsertPrivatePortfolioEntry(bootstrappedPortfolioEntries, selectedRuntimeEntry)
    : bootstrappedPortfolioEntries;

  return (
    <PrivateBalancePortfolioProvider entries={portfolioEntries}>
      <PrivateBalanceRuntimeDataProvider value={effectiveRuntime}>
        {runtimeKey && deployment && activeAccount && bootstrapKey ? (
          <DynamicPrivateBalanceProvider
          key={runtimeKey}
          accountId={activeAccount.id}
          accountPublicKey={activeAccount.publicKey}
          accountCreatedAt={activeAccount.createdAt}
          network={network}
          manifest={deployment.manifest}
          manifestHash={deployment.manifestHash}
          storageScope={deployment.storageScope}
          encryptedStateExists={deployment.encryptedStateExists}
          deployment={deployment.deployment}
          asset={deployment.asset}
          runtimeKey={runtimeKey}
          portfolioKey={bootstrapKey}
          deploymentId={deployment.id}
          onDurableStateChange={publishDurableRuntime}
        >
            <PrivateBalanceRuntimePublisher
              runtimeKey={runtimeKey}
              portfolioKey={bootstrapKey}
              deploymentId={deployment.id}
              onPublish={publishRuntime}
            />
            {/* Inside the provider so it reads the live runtime value directly. */}
            <PrivateIncomingToasts />
          </DynamicPrivateBalanceProvider>
        ) : null}
        {children}
      </PrivateBalanceRuntimeDataProvider>
    </PrivateBalancePortfolioProvider>
  );
}

export function PrivateBalanceRuntimeBoundary({ children }: { children: ReactNode }) {
  return (
    <PrivateBalanceRuntimeControlProvider>
      <PrivateBalanceRuntimeBootstrap>{children}</PrivateBalanceRuntimeBootstrap>
    </PrivateBalanceRuntimeControlProvider>
  );
}
