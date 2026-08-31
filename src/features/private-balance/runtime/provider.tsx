'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StrKey, rpc as SorobanRpc } from '@stellar/stellar-sdk';
import {
  computeContextHash,
  deriveStealthRootKey,
} from '@stellarkey/private-balance';
import {
  PrivateBalanceRuntimeDataProvider,
  type PrivateBalanceDeploymentSummary,
  type PrivateBalanceDurableRuntimeSummary,
  type PrivateBalanceRuntimeDataValue,
  type PrivateBalanceRuntimePhase,
  type PreparedStealthSweep,
} from '../../../hooks/usePrivateBalanceRuntime';
import { IndexedDbEncryptedRecordDriver } from '../../../lib/indexed-db';
import { privateBalanceSensitivePrefix } from '../../../lib/private-balance-bootstrap';
import {
  privateBalanceAvailability,
  type PrivateBalanceManifest,
} from '../../../lib/private-balance-manifest';
import {
  ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE,
} from '../../../lib/private-balance-expected-manifest';
import { prefetchCircuitArtifacts } from '../../../lib/private-balance-artifacts';
import { getRpcUrl, testRpcEndpoint } from '../../../lib/stellar-endpoints';
import type { NetworkKey } from '../../../lib/types';
import { withPrivacySessionRoot } from '../../../lib/vault';
import {
  useWalletLedger,
  useWalletPhase,
  useWalletTransactions,
} from '../../../hooks/useWallet';
import { PrivateBalanceWorkerClient } from '../worker/client';
import { PrivateBalanceArchiveClient } from './archive-client';
import {
  claimPrivateBalanceLease,
  forceClaimPrivateBalanceLease,
  openPrivateBalanceFollowerChannel,
  privateBalanceLeaseKey,
  releasePrivateBalanceLease,
  type PrivateBalanceFollowerChannel,
} from './coordination';
import { createPrivateRuntimeMutex } from './mutex';
import {
  initialPrivateBalanceState,
  privateBalanceReducer,
  type PrivateBalanceState,
} from './reducer';
import { formatPrivateBalanceAmount, selectTotalShieldedBalance } from './selectors';
import { parsePrivateAmount, selectPrivateNotes } from './coin-selection';
import {
  advancePrivateChainedApprovalFee,
  beginPrivateChainedApproval,
  clearPrivateChainedApproval,
  commitPrivateBalanceState,
  clearShieldedState,
  createEmptyPrivateBalanceState,
  loadPrivateBalanceState,
  recordPrivateBalanceAddress,
  recordPrivateRecentRecipient,
  releaseExpiredPrivateBuildReservations,
  releasePrivatePendingAction,
  releaseStalePrivatePendingActions,
  PRIVATE_BUILD_RESERVATION_TTL_MS,
  PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS,
} from './storage';
import { clearPrivateBalancePublicCache } from './public-cache';
import {
  assertReviewedPrivateActionEndpoint,
  preparePrivateBalanceActionFlow,
  validatePrivateTransferRecipient,
  MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS,
  PrivateStaleChainStateError,
  type PreparedPrivateActionReview,
  type PrivateActionDraft,
  type PrivateActionProgressStage,
} from './action-flow';
import {
  planPrivateChainedSend,
  runPrivateChainedSend,
  type PrivateChainedSendApproval,
  type PrivateChainedSendDraft,
  type PrivateChainedSendProgress,
  type PrivateChainedSendResult,
} from './chained-send';
import {
  broadcastPrivateBalanceAction,
  pollBroadcastPrivateBalanceTransaction,
  recoverPrivateBalanceAction,
  resumeSignedPrivateBalanceActions,
  signReviewedPrivateBalanceAction,
  PRIVATE_ACTION_EXPIRY_MARGIN_SECONDS,
  type PrivateBalanceSigningRequest,
} from './submission';
import { diffIncomingPrivateTransfers, syncPrivateBalance } from './sync-machine';
import type {
  PrivateBalanceDurableState,
  DeploymentContext,
} from './types';
import type { IncomingPrivateTransferSummary } from './sync-machine';
import type { PrivateBalanceStorageScope } from '../../../lib/private-balance-bootstrap';
import type { PrivateBalanceAsset } from '../../../lib/private-balance-assets';
import { syncStealthRuntime } from './stealth-runtime';
import {
  clearStealthDiscoveryCache,
  markStealthPaymentSweeping,
  reconcileStealthPaymentSweeps,
  type StealthOwnedPayment,
} from './stealth-cache';
import { signStealthSweepEnvelope } from './stealth-sweep';

const LEASE_TTL_MS = 15_000;
const LEASE_RENEW_MS = 5_000;
const IDLE_SYNC_INTERVAL_MS = 30_000;
const BACKGROUND_PROGRESS_SURFACE_MS = 2_000;

interface PrivateBalanceContextValue {
  state: PrivateBalanceState;
  totalBalanceStroops: bigint;
  totalBalanceDisplay: string;
  networkLabel: 'Testnet' | 'Mainnet';
  protocolVersion: number;
  noteCount: number;
  optIn(): Promise<void>;
  refreshSync(): Promise<void>;
  prepareAction(
    draft: PrivateActionDraft,
    onProgress?: (stage: PrivateActionProgressStage) => void,
    signal?: AbortSignal,
  ): Promise<PreparedPrivateActionReview>;
  cancelAction(actionId: string): Promise<void>;
  submitAction(review: PreparedPrivateActionReview): Promise<'broadcast' | 'ambiguous'>;
}

interface RuntimeSnapshot {
  phase: PrivateBalanceRuntimePhase;
  configured: boolean;
  isLeader: boolean;
  backgroundSyncing: boolean;
  syncProgress: { current: number; total: number } | null;
  verifiedBalanceStroops: string;
  lastVerifiedActionIndex: number | null;
  error: string | null;
  deployment: PrivateBalanceDeploymentSummary;
}

interface StealthRuntimeSnapshot {
  metaAddress: string | null;
  payments: StealthOwnedPayment[];
  latestLedger: number | null;
  syncing: boolean;
  error: string | null;
}

interface RuntimeReadySignal {
  promise: Promise<void>;
  resolve(): void;
}

function createRuntimeReadySignal(): RuntimeReadySignal {
  let resolveSignal = () => {};
  const promise = new Promise<void>(resolve => {
    resolveSignal = resolve;
  });
  return { promise, resolve: resolveSignal };
}

const INITIAL_STEALTH_SNAPSHOT: StealthRuntimeSnapshot = {
  metaAddress: null,
  payments: [],
  latestLedger: null,
  syncing: false,
  error: null,
};

interface PrivateBalanceProviderProps {
  children: ReactNode;
  accountId: string;
  accountPublicKey: string;
  accountCreatedAt: number;
  network: NetworkKey;
  manifest: PrivateBalanceManifest;
  manifestHash: string;
  storageScope: PrivateBalanceStorageScope;
  encryptedStateExists: boolean;
  deployment: PrivateBalanceDeploymentSummary;
  asset: PrivateBalanceAsset;
  runtimeKey: string;
  portfolioKey: string;
  deploymentId: string;
  onDurableStateChange?(
    runtimeKey: string,
    portfolioKey: string,
    deploymentId: string,
    asset: PrivateBalanceAsset,
    summary: PrivateBalanceDurableRuntimeSummary,
  ): void;
}

const PrivateBalanceContext = createContext<PrivateBalanceContextValue | null>(null);

function hex32(value: string, name: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${name} must be 32-byte lowercase hex.`);
  }
  return Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}

function deploymentContext(manifest: PrivateBalanceManifest): DeploymentContext {
  const networkId = hex32(manifest.networkId, 'Private Balance network ID');
  const realmId = hex32(manifest.realmId, 'Private Balance realm ID');
  const poolId = new Uint8Array(StrKey.decodeContract(manifest.poolContractId));
  const contextHash = computeContextHash(
    manifest.protocolVersion,
    networkId,
    realmId,
    poolId,
  );
  return {
    protocolVersion: manifest.protocolVersion,
    networkId: manifest.networkId,
    realmId: manifest.realmId,
    poolContractId: manifest.poolContractId,
    contextHash: Array.from(
      contextHash,
      byte => byte.toString(16).padStart(2, '0'),
    ).join(''),
    deploymentBindingHash: manifest.deploymentBindingHash,
  };
}

function verifiedBalance(state: PrivateBalanceDurableState, assetContractId?: string): string {
  return selectTotalShieldedBalance({ notes: state.notes }, assetContractId).toString();
}

function encryptedRecordBytes(records: ReadonlyMap<string, string>): number {
  const encoder = new TextEncoder();
  return [...records].reduce(
    (total, [key, value]) => total + encoder.encode(key).byteLength + encoder.encode(value).byteLength,
    0,
  );
}

function ownerId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function publicXlmBalanceStroops(
  balances: ReadonlyArray<{ balance: string; isNative?: boolean }> | null | undefined,
): bigint {
  const native = balances?.find(balance => balance.isNative);
  if (!native || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,7})?$/.test(native.balance)) return 0n;
  const [whole, fraction = ''] = native.balance.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0') || '0');
}

export function PrivateBalanceProvider({
  children,
  accountId,
  accountPublicKey,
  accountCreatedAt,
  network,
  manifest,
  manifestHash,
  storageScope,
  encryptedStateExists,
  deployment,
  asset,
  runtimeKey,
  portfolioKey,
  deploymentId,
  onDurableStateChange,
}: PrivateBalanceProviderProps) {
  const { recommendedBaseFeeStroops, balances } = useWalletLedger();
  const { phase: walletPhase } = useWalletPhase();
  const { signPrivateBalanceEnvelope } = useWalletTransactions();
  const [state, dispatch] = useReducer(privateBalanceReducer, initialPrivateBalanceState);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(() => ({
    phase: encryptedStateExists ? 'reading-meta' : 'disabled',
    configured: encryptedStateExists,
    isLeader: false,
    backgroundSyncing: false,
    syncProgress: null,
    verifiedBalanceStroops: '0',
    lastVerifiedActionIndex: null,
    error: null,
    deployment,
  }));
  const [encryptedStorageBytes, setEncryptedStorageBytes] = useState<number | null>(null);
  const [stealthSnapshot, setStealthSnapshot] = useState<StealthRuntimeSnapshot>(
    INITIAL_STEALTH_SNAPSHOT,
  );
  const [syncReadySignal] = useState(createRuntimeReadySignal);
  const workerRef = useRef<PrivateBalanceWorkerClient | null>(null);
  // The leader keeps one worker session per epoch; routine syncs reuse it
  // instead of paying the terminate/recreate and key-derivation cost.
  const workerIdentityRef = useRef<{ ownerCommitmentHex: string; address: string } | null>(null);
  const performSyncRef = useRef<
    ((createIfMissing: boolean, options?: { background?: boolean }) => Promise<void>) | null
  >(null);
  const leaderRef = useRef(false);
  const actionBusyRef = useRef(false);
  // Serializes the sync machine with prepare/sign/broadcast/cancel so action
  // flows await an in-flight sync instead of failing on a transient phase.
  const mutexRef = useRef(createPrivateRuntimeMutex());
  // True after the latest completed sync published 'current'; background
  // re-syncs of an already-current wallet must not flip the visible phase.
  const lastSyncCurrentRef = useRef(false);
  // A quiet background pass that fails stashes its error here instead of
  // tearing down the current snapshot; the next foreground failure surfaces
  // normally and the next successful sync clears it.
  const backgroundSyncErrorRef = useRef<string | null>(null);
  const walletPhaseRef = useRef(walletPhase);
  const takeoverRef = useRef<(() => void) | null>(null);
  const incomingListenersRef = useRef(
    new Set<(event: IncomingPrivateTransferSummary) => void>(),
  );
  // Tracks whether encrypted state exists right now; the mount-time prop goes
  // stale as soon as the user opts in or removes local data in this session.
  const encryptedStateExistsRef = useRef(encryptedStateExists);
  const providerMountedRef = useRef(true);
  const stealthRunRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    providerMountedRef.current = true;
    return () => {
      providerMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    walletPhaseRef.current = walletPhase;
  }, [walletPhase]);

  const refreshStealth = useCallback((): Promise<void> => {
    if (asset.kind !== 'native') return Promise.resolve();
    if (!leaderRef.current) {
      return Promise.reject(new Error('Private Payments is active in another StellarKey tab.'));
    }
    if (walletPhaseRef.current !== 'unlocked') {
      return Promise.reject(new Error('Unlock StellarKey to check reusable private payments.'));
    }
    if (stealthRunRef.current) return stealthRunRef.current;
    const context = deploymentContext(manifest);
    const driver = new IndexedDbEncryptedRecordDriver();
    const run = (async () => {
      if (providerMountedRef.current) {
        setStealthSnapshot(current => ({ ...current, syncing: true, error: null }));
      }
      try {
        await withPrivacySessionRoot(accountId, context, async (sessionRoot, storageKey) => {
          const stealthRoot = deriveStealthRootKey(sessionRoot);
          try {
            const result = await syncStealthRuntime({
              rootKey: stealthRoot,
              storageKey,
              context: storageScope,
              network,
              walletCreatedAt: accountCreatedAt,
              announcerPublicKey: manifest.stealthAnnouncerAddress,
              storageDriver: driver,
              onIdentity: metaAddress => {
                if (!providerMountedRef.current) return;
                setStealthSnapshot(current => ({ ...current, metaAddress }));
              },
            });
            if (!providerMountedRef.current) return;
            setStealthSnapshot({
              metaAddress: result.metaAddress,
              payments: result.cache.payments,
              latestLedger: result.cache.latestLedger,
              syncing: false,
              error: null,
            });
          } finally {
            stealthRoot.fill(0);
          }
        });
      } catch (error: unknown) {
        if (providerMountedRef.current) {
          setStealthSnapshot(current => ({
            ...current,
            syncing: false,
            error: error instanceof Error
              ? error.message
              : 'Reusable private payment discovery stopped safely.',
          }));
        }
        throw error;
      }
    })();
    const tracked = run.finally(() => {
      stealthRunRef.current = null;
    });
    stealthRunRef.current = tracked;
    return tracked;
  }, [accountCreatedAt, accountId, asset.kind, manifest, network, storageScope]);

  useEffect(() => {
    let active = true;
    let queuedBackgroundSync: Promise<void> | null = null;
    let channel: PrivateBalanceFollowerChannel | null = null;
    let leaseTimer: ReturnType<typeof setInterval> | null = null;
    let idleTimer: ReturnType<typeof setInterval> | null = null;
    const mutex = mutexRef.current;
    const driver = new IndexedDbEncryptedRecordDriver();
    const runtimeOwnerId = ownerId();
    const context = deploymentContext(manifest);
    const runtimeScope = {
      networkId: storageScope.networkId,
      realmId: storageScope.realmId,
      poolId: storageScope.poolId,
      accountId,
    };
    const leaseKey = privateBalanceLeaseKey(runtimeScope);
    const availability = privateBalanceAvailability(manifest, network, {
      allowDevelopmentFixture: ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE,
    });

    const clearDecryptedState = (error: string | null) => {
      workerRef.current?.terminate();
      workerRef.current = null;
      workerIdentityRef.current = null;
      lastSyncCurrentRef.current = false;
      dispatch({ type: 'RESET' });
      if (error) dispatch({ type: 'SET_ERROR', error });
    };

    const showDurableState = (
      durable: PrivateBalanceDurableState,
      address: string,
      ownerCommitmentHex: string,
    ) => {
      dispatch({ type: 'RESET' });
      dispatch({ type: 'SET_OPTED_IN', optedIn: true });
      dispatch({
        type: 'SET_UNLOCKED',
        unlocked: true,
        address,
        ownerCommitmentHex,
      });
      dispatch({ type: 'SET_NOTES', notes: durable.notes });
      dispatch({ type: 'SET_ACTIVITIES', activities: durable.activities });
      dispatch({ type: 'SET_PENDING_ACTIONS', pendingActions: durable.pendingActions });
      dispatch({
        type: 'SET_RECENT_RECIPIENTS',
        recentRecipients: durable.recentPrivateRecipients ?? [],
      });
      if (durable.checkpoint) {
        dispatch({ type: 'SET_CHECKPOINT', checkpoint: durable.checkpoint });
      }
      dispatch({ type: 'SET_ERROR', error: null });
      setSnapshot(current => ({ ...current, configured: true }));
    };

    const publish = (
      durable: PrivateBalanceDurableState,
      phase: PrivateBalanceRuntimePhase,
    ) => {
      const selectedNotes = durable.notes.filter(note => note.assetContractId === asset.contractId);
      const selectedActivities = durable.activities.filter(
        activity => activity.assetContractId === asset.contractId,
      );
      const selectedPendingActions = durable.pendingActions.filter(
        action => action.assetContractId === asset.contractId,
      );
      const next = {
        verifiedBalanceStroops: verifiedBalance(durable, asset.contractId),
        lastVerifiedActionIndex: durable.account.lastVerifiedActionIndex,
      };
      setSnapshot(current => ({
        ...current,
        phase,
        configured: true,
        isLeader: true,
        backgroundSyncing: false,
        syncProgress: null,
        ...next,
        error: null,
      }));
      onDurableStateChange?.(
        runtimeKey,
        portfolioKey,
        deploymentId,
        asset,
        {
          phase,
          configured: true,
          ...next,
          noteCount: selectedNotes.filter(note => note.status === 'unspent').length,
          activities: selectedActivities,
          pendingActions: selectedPendingActions,
          checkpoint: durable.checkpoint,
        },
      );
      try {
        channel?.post({
          phase,
          revision: durable.revision,
          verifiedBalanceStroops: next.verifiedBalanceStroops,
          lastVerifiedActionIndex: next.lastVerifiedActionIndex,
        });
      } catch {
        // Cross-tab updates are advisory; the leader's verified state remains authoritative.
      }
    };

    const performSyncExclusive = async (
      createIfMissing: boolean,
      background: boolean,
    ): Promise<void> => {
      if (!active || !leaderRef.current) {
        // Leadership can move while this pass waits behind the mutex.
        throw new Error('Private Balance is active in another StellarKey tab.');
      }
      // A background pass over an already-current wallet must not flip the
      // visible phase; progress only surfaces when it finds real catch-up
      // work or overstays the quiet window.
      const quiet = background && lastSyncCurrentRef.current;
      const syncStartedAt = Date.now();
      let surfacedProgress = false;
      if (quiet) setSnapshot(current => ({ ...current, backgroundSyncing: true }));
      const progress: { durable: PrivateBalanceDurableState | null } = { durable: null };
      try {
          if (!availability.ready) throw new Error(availability.reason);
          const rpcUrl = getRpcUrl(network);
          if (!rpcUrl) throw new Error('Configure a Stellar RPC endpoint for Private Balance.');
          if (!quiet) {
            setSnapshot(current => ({
              ...current,
              phase: 'reading-meta',
              isLeader: true,
              error: null,
              syncProgress: null,
            }));
          }
          await testRpcEndpoint(network, rpcUrl);
          const endpoint = new URL(rpcUrl);
          const allowHttp = endpoint.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
          const rpc = new SorobanRpc.Server(endpoint.toString(), { allowHttp });
          const archive = new PrivateBalanceArchiveClient(rpcUrl, manifest);
          const contextHashBytes = hex32(context.contextHash, 'Private Balance context hash');
          const [head, depositsPaused] = await Promise.all([
            archive.readHead(),
            archive.readDepositsPaused(),
          ]);
          setSnapshot(current => ({
            ...current,
            deployment: {
              ...current.deployment,
              depositsPaused,
              actionCount: head.meta.actionCount,
              pageCount: null,
              latestLedger: head.latestLedger,
            },
          }));
          await withPrivacySessionRoot(accountId, context, async (sessionRoot, storageKey) => {
            let durable = await loadPrivateBalanceState(storageScope, storageKey, driver);
            if (!durable && createIfMissing) {
              durable = createEmptyPrivateBalanceState(manifestHash);
              await commitPrivateBalanceState(
                storageScope,
                storageKey,
                durable,
                null,
                driver,
              );
            }
            if (!durable) {
              throw new Error('Choose Enable Private Balance before syncing this account.');
            }
            encryptedStateExistsRef.current = true;
            progress.durable = durable;
            // A reservation past the TTL is pre-proof by construction and was
            // provably never broadcast; releasing it unblocks its notes.
            durable = await releaseExpiredPrivateBuildReservations(
              storageScope,
              storageKey,
              Date.now(),
              PRIVATE_BUILD_RESERVATION_TTL_MS,
              driver,
            ) ?? durable;
            progress.durable = durable;
            // A pre-broadcast pending action past its TTL (prepared/reviewed,
            // zero broadcast attempts) was provably never signed: a closed or
            // locked tab, or a chain that died between preparing a step and
            // advancing its fee, orphaned it. Releasing it unblocks its notes.
            durable = await releaseStalePrivatePendingActions(
              storageScope,
              storageKey,
              Date.now(),
              PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS,
              driver,
            ) ?? durable;
            progress.durable = durable;
            if (
              durable.chainedApproval &&
              Math.floor(Date.now() / 1000) > durable.chainedApproval.expiresAtSeconds
            ) {
              // A chain never resumes without fresh consent, so a dead
              // approval journal entry only needs sweeping.
              durable = await clearPrivateChainedApproval(
                storageScope,
                storageKey,
                durable.revision,
                driver,
              );
              progress.durable = durable;
            }
            if (durable.pendingActions.some(action => action.status === 'signed')) {
              // A crash between the sign and broadcast commits may or may not
              // have reached Stellar; resending resolves it (DUPLICATE lands
              // the action safely in 'broadcast').
              durable = await resumeSignedPrivateBalanceActions({
                context: storageScope,
                storageKey,
                networkPassphrase: manifest.networkPassphrase,
                rpc,
                storageDriver: driver,
              }) ?? durable;
              progress.durable = durable;
            }
            let worker = workerRef.current;
            let identity = workerIdentityRef.current;
            if (!worker || worker.failed || !identity) {
              workerRef.current?.terminate();
              worker = new PrivateBalanceWorkerClient(
                new Worker(new URL('../worker/private-balance.worker.ts', import.meta.url), {
                  name: 'stellarkey-private-balance',
                  type: 'module',
                }),
              );
              workerRef.current = worker;
              identity = await worker.initSession(
                manifest,
                accountPublicKey,
                sessionRoot,
                durable.privateAddress,
              );
              workerIdentityRef.current = identity;
            }
            if (!active || !leaderRef.current) {
              clearDecryptedState(null);
              throw new Error('Private Balance leadership changed during sync.');
            }
            if (durable.privateAddress !== identity.address) {
              // Persisted at opt-in so Receive works without a completed sync.
              durable = await recordPrivateBalanceAddress(
                storageScope,
                storageKey,
                durable.revision,
                identity.address,
                driver,
              );
              progress.durable = durable;
            }
            showDurableState(durable, identity.address, identity.ownerCommitmentHex);
            dispatch({ type: 'SET_SYNCING', syncing: true });
            if (!quiet) {
              setSnapshot(current => ({
                ...current,
                phase: 'scanning-live',
                isLeader: true,
                error: null,
              }));
            }
            const previousAccount = durable.account;
            durable = await syncPrivateBalance({
              archive: {
                readHead: () => archive.readHead(),
                readRecords: (startActionIndex, count) =>
                  archive.readRecords(startActionIndex, count),
                readLedgerCloseTimes: sequences => archive.readLedgerCloseTimes(sequences),
              },
              worker,
              contextHash: contextHashBytes,
              deploymentBindingHash: hex32(
                manifest.deploymentBindingHash,
                'Private Balance deployment binding hash',
              ),
              manifestHash,
              storageContext: storageScope,
              storageKey,
              storageDriver: driver,
              publicCacheDriver: driver,
              onProgress: ({ actionIndex, actionCount, firstActionIndex }) => {
                const total = Math.max(1, actionCount - firstActionIndex);
                const currentRecord = Math.min(
                  total,
                  Math.max(1, actionIndex - firstActionIndex + 1),
                );
                if (
                  quiet &&
                  !surfacedProgress &&
                  total <= 1 &&
                  Date.now() - syncStartedAt <= BACKGROUND_PROGRESS_SURFACE_MS
                ) {
                  return;
                }
                surfacedProgress = true;
                setSnapshot(current => ({
                  ...current,
                  phase: 'scanning-live',
                  isLeader: true,
                  syncProgress: { current: currentRecord, total },
                }));
              },
            });
            progress.durable = durable;
            if (
              previousAccount.syncStatus === 'current' &&
              previousAccount.lastVerifiedActionIndex !== null
            ) {
              // Incremental syncs only: collapse the freshly verified inbound
              // transfers into one leader-side event for the UI to surface.
              const incoming = diffIncomingPrivateTransfers(
                previousAccount.lastVerifiedActionIndex,
                durable.activities,
              );
              if (incoming.count > 0) {
                for (const listener of incomingListenersRef.current) {
                  try {
                    listener(incoming);
                  } catch {
                    // Listener failures never affect the completed sync.
                  }
                }
              }
            }
            try {
              const nowSeconds = Math.floor(Date.now() / 1000);
              for (const pending of durable.pendingActions) {
                if (pending.status !== 'broadcast' && pending.status !== 'ambiguous') continue;
                if (
                  pending.expiresAtSeconds === undefined ||
                  nowSeconds <= pending.expiresAtSeconds + PRIVATE_ACTION_EXPIRY_MARGIN_SECONDS
                ) {
                  continue;
                }
                // The canonical sync just completed, so absence of the action
                // field and its nullifiers is decisive once the chain has
                // closed past the envelope expiry.
                const canonical = durable;
                const recovered = await recoverPrivateBalanceAction({
                  context: storageScope,
                  storageKey,
                  actionId: pending.id,
                  rpc,
                  scanCanonicalTranscript: async () => ({
                    actionFields: canonical.activities.map(activity => activity.id),
                    nullifiers: canonical.activities.flatMap(activity => activity.nullifiers),
                  }),
                  storageDriver: driver,
                });
                durable = recovered.state;
              }
            } catch {
              // Expired-action recovery re-runs on every later sync; a failed
              // attempt never invalidates the completed canonical sync.
            }
            progress.durable = durable;
            if (asset.kind === 'native') {
              try {
                const stealth = await reconcileStealthPaymentSweeps(
                  storageScope,
                  storageKey,
                  new Set(durable.activities.map(activity => activity.id)),
                  new Set(durable.pendingActions.map(action => action.actionField)),
                  driver,
                );
                setStealthSnapshot(current => ({
                  ...current,
                  payments: stealth.payments,
                  latestLedger: stealth.latestLedger,
                  error: null,
                }));
              } catch (error) {
                if (!/cache is unavailable/i.test(
                  error instanceof Error ? error.message : '',
                )) {
                  setStealthSnapshot(current => ({
                    ...current,
                    error: error instanceof Error
                      ? error.message
                      : 'Reusable private payments could not be reconciled.',
                  }));
                }
              }
            }
            setEncryptedStorageBytes(encryptedRecordBytes(await driver.readPrefix(
              privateBalanceSensitivePrefix(storageScope),
            )));
            if (!active || !leaderRef.current) {
              clearDecryptedState(null);
              throw new Error('Private Balance leadership changed during sync.');
            }
            showDurableState(durable, identity.address, identity.ownerCommitmentHex);
            dispatch({ type: 'SET_SYNCING', syncing: false });
            publish(durable, 'current');
            lastSyncCurrentRef.current = true;
            backgroundSyncErrorRef.current = null;
            void refreshStealth().catch(() => undefined);
          });
        } catch (error: unknown) {
          if (!active) return;
          const message = error instanceof Error
            ? error.message
            : 'Private Balance stopped safely after an unexpected error.';
          if (!leaderRef.current) {
            // Leadership moved mid-pass ("Use Here" in another tab). The
            // displaced tab presents as a follower — never as a safe-error —
            // and the new leader's first channel publish refreshes its
            // numbers.
            lastSyncCurrentRef.current = false;
            clearDecryptedState(null);
            setSnapshot(current => ({
              ...current,
              isLeader: false,
              backgroundSyncing: false,
              syncProgress: null,
              error: null,
            }));
            return;
          }
          if (quiet) {
            // A routine background tick that fails (flaky wifi, a transient
            // RPC 5xx, a vault that locked mid-pass) must not tear down a
            // current wallet: keep the last verified snapshot and worker,
            // stay quiet for later ticks, and stash the error internally. A
            // failing foreground pass still fails closed below.
            backgroundSyncErrorRef.current = message;
            return;
          }
          lastSyncCurrentRef.current = false;
          clearDecryptedState(message);
          setSnapshot({
            phase: 'safe-error',
            configured: encryptedStateExistsRef.current,
            isLeader: leaderRef.current,
            backgroundSyncing: false,
            syncProgress: null,
            verifiedBalanceStroops: '0',
            lastVerifiedActionIndex: null,
            error: message,
            deployment,
          });
      } finally {
        if (quiet) setSnapshot(current => ({ ...current, backgroundSyncing: false }));
      }
    };

    const performSync = (
      createIfMissing: boolean,
      options: { background?: boolean } = {},
    ): Promise<void> => {
      if (!active || !leaderRef.current) {
        return Promise.reject(
          new Error('Private Balance is active in another StellarKey tab.'),
        );
      }
      const background = Boolean(options.background);
      // Background triggers (visibility, idle cadence, post-broadcast polls)
      // collapse into the queued pass; explicit calls always queue a fresh one.
      if (background && queuedBackgroundSync) return queuedBackgroundSync;
      const run = mutex.runExclusive(() => performSyncExclusive(createIfMissing, background));
      if (background) {
        const queued = run.finally(() => {
          if (queuedBackgroundSync === queued) queuedBackgroundSync = null;
        });
        queuedBackgroundSync = queued;
        return queued;
      }
      return run;
    };

    const maybeBackgroundSync = () => {
      if (!active || !leaderRef.current || !encryptedStateExistsRef.current) return;
      // Re-verify the vault is still unlocked and no action flow is open
      // before touching encrypted state from an ambient trigger.
      if (walletPhaseRef.current !== 'unlocked') return;
      if (actionBusyRef.current || mutex.locked) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void performSync(false, { background: true }).catch(() => undefined);
    };

    const onVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      claimOrRenewLease();
      maybeBackgroundSync();
    };

    performSyncRef.current = performSync;
    syncReadySignal.resolve();
    channel = openPrivateBalanceFollowerChannel(runtimeScope, runtimeOwnerId, update => {
      if (!active || leaderRef.current) return;
      clearDecryptedState(null);
      dispatch({ type: 'SET_OPTED_IN', optedIn: true });
      setSnapshot({
        phase: update.phase,
        configured: true,
        isLeader: false,
        backgroundSyncing: false,
        syncProgress: null,
        verifiedBalanceStroops: update.verifiedBalanceStroops,
        lastVerifiedActionIndex: update.lastVerifiedActionIndex,
        error: null,
        deployment,
      });
    });

    const claimOrRenewLease = () => {
      if (!active) return;
      let claimed = false;
      try {
        claimed = claimPrivateBalanceLease(
          window.localStorage,
          leaseKey,
          runtimeOwnerId,
          Date.now(),
          LEASE_TTL_MS,
        );
      } catch {
        claimed = false;
      }
      if (!claimed) {
        if (leaderRef.current) {
          leaderRef.current = false;
          clearDecryptedState(null);
          setSnapshot(current => ({ ...current, isLeader: false }));
        }
        return;
      }
      if (leaderRef.current) return;
      leaderRef.current = true;
      setSnapshot(current => ({ ...current, isLeader: true, error: null }));
      if (encryptedStateExistsRef.current) void performSync(false);
    };

    takeoverRef.current = () => {
      if (!active || leaderRef.current) return;
      try {
        // "Use Here": the displaced leader notices the foreign owner on its
        // next renewal and clears cleanly; CAS keeps the short race safe.
        forceClaimPrivateBalanceLease(
          window.localStorage,
          leaseKey,
          runtimeOwnerId,
          Date.now(),
          LEASE_TTL_MS,
        );
      } catch {
        // The renewal below reports the outcome either way.
      }
      claimOrRenewLease();
    };

    claimOrRenewLease();
    leaseTimer = setInterval(claimOrRenewLease, LEASE_RENEW_MS);
    idleTimer = setInterval(maybeBackgroundSync, IDLE_SYNC_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      active = false;
      performSyncRef.current = null;
      syncReadySignal.resolve();
      takeoverRef.current = null;
      if (leaseTimer) clearInterval(leaseTimer);
      if (idleTimer) clearInterval(idleTimer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      channel?.close();
      workerRef.current?.terminate();
      workerRef.current = null;
      workerIdentityRef.current = null;
      lastSyncCurrentRef.current = false;
      if (leaderRef.current) {
        try {
          releasePrivateBalanceLease(window.localStorage, leaseKey, runtimeOwnerId);
        } catch {
          // The short lease expires naturally when localStorage is unavailable during teardown.
        }
      }
      leaderRef.current = false;
    };
  }, [
    accountId,
    accountPublicKey,
    asset,
    deploymentId,
    encryptedStateExists,
    deployment,
    manifest,
    manifestHash,
    network,
    onDurableStateChange,
    portfolioKey,
    refreshStealth,
    runtimeKey,
    storageScope,
    syncReadySignal,
  ]);

  const optIn = useCallback(async () => {
    if (!performSyncRef.current) await syncReadySignal.promise;
    const performSync = performSyncRef.current;
    if (!performSync) throw new Error('Private Balance runtime is not ready.');
    // Start the artifact download alongside setup so the first payment does
    // not stall on it.
    prefetchCircuitArtifacts(manifest);
    await performSync(true);
  }, [manifest, syncReadySignal]);

  const refreshSync = useCallback(async () => {
    const performSync = performSyncRef.current;
    if (!performSync) throw new Error('Private Balance runtime is not ready.');
    await performSync(false);
  }, []);

  const reflectDurableState = useCallback((durable: PrivateBalanceDurableState) => {
    dispatch({ type: 'SET_NOTES', notes: durable.notes });
    dispatch({ type: 'SET_ACTIVITIES', activities: durable.activities });
    dispatch({ type: 'SET_PENDING_ACTIONS', pendingActions: durable.pendingActions });
    dispatch({
      type: 'SET_RECENT_RECIPIENTS',
      recentRecipients: durable.recentPrivateRecipients ?? [],
    });
    if (durable.checkpoint) dispatch({ type: 'SET_CHECKPOINT', checkpoint: durable.checkpoint });
    setSnapshot(current => ({
      ...current,
      configured: true,
      verifiedBalanceStroops: verifiedBalance(durable),
      lastVerifiedActionIndex: durable.account.lastVerifiedActionIndex,
      error: null,
    }));
  }, []);

  const rotatePrivateAddress = useCallback(async (): Promise<string> => {
    if (!leaderRef.current) {
      throw new Error('Use Private Payments in this tab before creating a new address.');
    }
    if (actionBusyRef.current) {
      throw new Error('Wait for the current Private Balance action to finish.');
    }
    const worker = workerRef.current;
    if (!worker || worker.failed || !workerIdentityRef.current) {
      throw new Error('Private Balance worker is not ready.');
    }
    const context = deploymentContext(manifest);
    const driver = new IndexedDbEncryptedRecordDriver();
    return mutexRef.current.runExclusive(() => withPrivacySessionRoot(
      accountId,
      context,
      async (_sessionRoot, storageKey) => {
        const current = await loadPrivateBalanceState(storageScope, storageKey, driver);
        if (!current) throw new Error('Private Balance state is unavailable.');
        const identity = await worker.generateAddress();
        try {
          const next = await recordPrivateBalanceAddress(
            storageScope,
            storageKey,
            current.revision,
            identity.address,
            driver,
          );
          workerIdentityRef.current = identity;
          dispatch({
            type: 'SET_UNLOCKED',
            unlocked: true,
            address: identity.address,
            ownerCommitmentHex: identity.ownerCommitmentHex,
          });
          reflectDurableState(next);
          return identity.address;
        } catch (error) {
          // The worker has already selected the new identity. If encrypted
          // storage loses a revision race, discard the session so the next
          // sync restores the last committed address instead of diverging.
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          workerIdentityRef.current = null;
          throw error;
        }
      },
    ));
  }, [accountId, manifest, reflectDurableState, storageScope]);

  const cancelAction = useCallback(async (actionId: string) => {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(actionId)) {
      throw new Error('Private Balance action ID is invalid.');
    }
    const context = deploymentContext(manifest);
    const driver = new IndexedDbEncryptedRecordDriver();
    await mutexRef.current.runExclusive(() =>
      withPrivacySessionRoot(accountId, context, async (_sessionRoot, storageKey) => {
        const current = await loadPrivateBalanceState(storageScope, storageKey, driver);
        const pending = current?.pendingActions.find(action => action.id === actionId);
        if (!current || !pending) return;
        if (!['prepared', 'reviewed'].includes(pending.status) || pending.broadcastAttempts > 0) {
          throw new Error('A signed or broadcast Private Balance action cannot be cancelled.');
        }
        const released = await releasePrivatePendingAction(
          storageScope,
          storageKey,
          current.revision,
          actionId,
          { reason: 'pre-broadcast-rejection', updatedAt: Date.now() },
          driver,
        );
        reflectDurableState(released);
      }));
  }, [accountId, manifest, reflectDurableState, storageScope]);

  const prepareActionInternal = useCallback(async (
    draft: PrivateActionDraft,
    onProgress?: (stage: PrivateActionProgressStage) => void,
    signal?: AbortSignal,
    sourcePublicKey = accountPublicKey,
  ): Promise<PreparedPrivateActionReview> => {
    if (!leaderRef.current) {
      throw new Error('Sync Private Balance in this tab before creating an action.');
    }
    const rpcUrl = getRpcUrl(network);
    if (!rpcUrl) throw new Error('Configure a Stellar RPC endpoint for Private Balance.');
    const context = deploymentContext(manifest);
    const driver = new IndexedDbEncryptedRecordDriver();
    for (let attempt = 0; ; attempt += 1) {
      try {
        // Awaiting the mutex waits out any in-flight sync instead of failing
        // on a transient non-current phase.
        const result = await mutexRef.current.runExclusive(async () => {
          const worker = workerRef.current;
          const privateAddress = workerIdentityRef.current?.address ?? null;
          if (!worker || !privateAddress) throw new Error('Private Balance worker is not ready.');
          return withPrivacySessionRoot(
            accountId,
            context,
            async (_sessionRoot, storageKey) => preparePrivateBalanceActionFlow({
              manifest,
              accountPublicKey: sourcePublicKey,
              privateAddress,
              storageContext: storageScope,
              storageKey,
              storageDriver: driver,
              worker,
              rpcUrl,
              classicFeeStroops: BigInt(recommendedBaseFeeStroops),
              assetContractId: asset.contractId,
              assetCode: asset.code,
              assetDecimals: asset.decimals,
              draft,
              signal,
              onProgress,
            }),
          );
        });
        reflectDurableState(result.state);
        return result.review;
      } catch (error) {
        if (
          signal?.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          // Back during prepare: the flow already released its reservation
          // and nothing was signed or broadcast, so the card must return
          // instantly — no automatic foreground resync, no held busy flag.
          throw error;
        }
        if (error instanceof PrivateStaleChainStateError && attempt === 0) {
          // The chain view went stale between syncs; resync and retry the
          // preparation once before surfacing anything.
          try {
            await performSyncRef.current?.(false);
          } catch {
            // The retried preparation reports the live failure.
          }
          continue;
        }
        try {
          await performSyncRef.current?.(false);
        } catch {
          // The action error is more useful; normal status surfaces the resync failure.
        }
        throw error;
      }
    }
  }, [
    accountId,
    accountPublicKey,
    asset.code,
    asset.contractId,
    asset.decimals,
    manifest,
    network,
    recommendedBaseFeeStroops,
    reflectDurableState,
    storageScope,
  ]);

  const prepareAction = useCallback(async (
    draft: PrivateActionDraft,
    onProgress?: (stage: PrivateActionProgressStage) => void,
    signal?: AbortSignal,
  ): Promise<PreparedPrivateActionReview> => {
    if (actionBusyRef.current) throw new Error('Another Private Balance action is already open.');
    actionBusyRef.current = true;
    try {
      return await prepareActionInternal(draft, onProgress, signal);
    } finally {
      actionBusyRef.current = false;
    }
  }, [prepareActionInternal]);

  const prepareStealthSweep = useCallback(async (
    payment: StealthOwnedPayment,
    onProgress?: (stage: PrivateActionProgressStage) => void,
    signal?: AbortSignal,
  ): Promise<PreparedStealthSweep> => {
    if (asset.kind !== 'native') {
      throw new Error('Reusable private receipts currently support XLM only.');
    }
    const current = stealthSnapshot.payments.find(candidate =>
      candidate.transactionHash === payment.transactionHash &&
      candidate.destinationPublicKey === payment.destinationPublicKey);
    if (!current || current.status !== 'unspent') {
      throw new Error('This reusable private payment is no longer available to move.');
    }
    if (actionBusyRef.current) throw new Error('Another Private Balance action is already open.');
    actionBusyRef.current = true;
    try {
      const review = await prepareActionInternal(
        {
          kind: 'deposit',
          amount: formatPrivateBalanceAmount(BigInt(current.amountStroops), asset.decimals),
        },
        onProgress,
        signal,
        current.destinationPublicKey,
      );
      if (
        review.kind !== 'deposit' ||
        review.amountStroops !== current.amountStroops
      ) {
        throw new Error('Reusable private payment review does not match the discovered amount.');
      }
      return {
        payment: {
          transactionHash: current.transactionHash,
          ephemeralPublicKey: current.ephemeralPublicKey,
          destinationPublicKey: current.destinationPublicKey,
          amountStroops: current.amountStroops,
        },
        review,
      };
    } finally {
      actionBusyRef.current = false;
    }
  }, [asset.decimals, asset.kind, prepareActionInternal, stealthSnapshot.payments]);

  const watchBroadcastOutcome = useCallback((
    actionId: string,
    transactionHash: string,
    rpc: SorobanRpc.Server,
    context: DeploymentContext,
    driver: IndexedDbEncryptedRecordDriver,
  ) => {
    // Read-only trigger: the poll never holds the mutex; the canonical sync
    // (and, for FAILED, the recovery classifier) stays the sole mutator.
    void pollBroadcastPrivateBalanceTransaction({
      transactionHash,
      rpc,
      reconcile: async rpcStatus => {
        const performSync = performSyncRef.current;
        if (!performSync) return true;
        await performSync(false, { background: true });
        return withPrivacySessionRoot(accountId, context, async (_sessionRoot, storageKey) => {
          const current = await loadPrivateBalanceState(storageScope, storageKey, driver);
          const pending = current?.pendingActions.find(action => action.id === actionId);
          if (!current || !pending) return true;
          if (rpcStatus !== 'FAILED' || !['broadcast', 'ambiguous'].includes(pending.status)) {
            return false;
          }
          // FAILED still routes through the classifier against the freshly
          // completed canonical sync; the RPC status alone never releases.
          const recovered = await recoverPrivateBalanceAction({
            context: storageScope,
            storageKey,
            actionId,
            rpc,
            scanCanonicalTranscript: async () => ({
              actionFields: current.activities.map(activity => activity.id),
              nullifiers: current.activities.flatMap(activity => activity.nullifiers),
            }),
            storageDriver: driver,
          });
          reflectDurableState(recovered.state);
          return !recovered.state.pendingActions.some(action => action.id === actionId);
        });
      },
    }).catch(() => undefined);
  }, [accountId, reflectDurableState, storageScope]);

  const submitActionInternal = useCallback(async (
    preparedReview: PreparedPrivateActionReview,
    options: {
      watchOutcome?: boolean;
      beforeSign?(input: {
        sessionRoot: Uint8Array;
        storageKey: Uint8Array;
      }): Promise<void>;
      sign?(
        request: PrivateBalanceSigningRequest,
        sessionRoot: Uint8Array,
      ): Promise<string>;
    } = {},
  ): Promise<'broadcast' | 'ambiguous'> => {
    if (!leaderRef.current) {
      throw new Error('Sync Private Balance in this tab before signing.');
    }
    const rpcUrl = getRpcUrl(network);
    if (!rpcUrl) throw new Error('Configure a Stellar RPC endpoint for Private Balance.');
    assertReviewedPrivateActionEndpoint(preparedReview, rpcUrl);
    const context = deploymentContext(manifest);
    const driver = new IndexedDbEncryptedRecordDriver();
    const endpoint = new URL(rpcUrl);
    const allowHttp = endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    const rpc = new SorobanRpc.Server(endpoint.toString(), { allowHttp });
    try {
      const status = await mutexRef.current.runExclusive(() =>
        withPrivacySessionRoot(accountId, context, async (sessionRoot, storageKey) => {
          const current = await loadPrivateBalanceState(storageScope, storageKey, driver);
          if (!current) throw new Error('Private Balance state is unavailable.');
          await options.beforeSign?.({ sessionRoot, storageKey });
          const signed = await signReviewedPrivateBalanceAction({
            context: storageScope,
            storageKey,
            expectedRevision: current.revision,
            actionId: preparedReview.id,
            review: preparedReview.transaction,
            networkPassphrase: manifest.networkPassphrase,
            sign: request => options.sign
              ? options.sign(request, sessionRoot)
              : signPrivateBalanceEnvelope({
                  envelopeXdr: request.envelopeXdr,
                  expectedTransactionHash: request.transactionHash,
                  networkPassphrase: request.networkPassphrase,
                }),
            storageDriver: driver,
          });
          const broadcast = await broadcastPrivateBalanceAction({
            context: storageScope,
            storageKey,
            expectedRevision: signed.revision,
            actionId: preparedReview.id,
            networkPassphrase: manifest.networkPassphrase,
            rpc,
            storageDriver: driver,
          });
          let latest = broadcast.state;
          if (
            broadcast.status === 'broadcast' &&
            preparedReview.kind === 'transfer' &&
            preparedReview.recipientAddress &&
            preparedReview.recipientFingerprint
          ) {
            try {
              latest = await recordPrivateRecentRecipient(
                storageScope,
                storageKey,
                latest.revision,
                {
                  address: preparedReview.recipientAddress,
                  fingerprint: preparedReview.recipientFingerprint,
                  lastUsedAt: Date.now(),
                },
                driver,
              );
            } catch {
              // Recents are a convenience; the durable journal already holds the send.
            }
          }
          reflectDurableState(latest);
          return broadcast.status;
        }));
      try {
        await performSyncRef.current?.(false);
      } catch {
        // Broadcast remains durably journaled and will reconcile on the next sync.
      }
      if (options.watchOutcome !== false) {
        watchBroadcastOutcome(
          preparedReview.id,
          preparedReview.transaction.transactionHash,
          rpc,
          context,
          driver,
        );
      }
      return status;
    } catch (error) {
      try {
        await cancelAction(preparedReview.id);
      } catch {
        // Never release a transaction that may have reached broadcast.
      }
      throw error;
    }
  }, [
    accountId,
    cancelAction,
    manifest,
    network,
    reflectDurableState,
    signPrivateBalanceEnvelope,
    storageScope,
    watchBroadcastOutcome,
  ]);

  const submitAction = useCallback(async (
    preparedReview: PreparedPrivateActionReview,
  ): Promise<'broadcast' | 'ambiguous'> => {
    if (actionBusyRef.current) throw new Error('Another Private Balance action is already running.');
    actionBusyRef.current = true;
    try {
      return await submitActionInternal(preparedReview);
    } finally {
      actionBusyRef.current = false;
    }
  }, [submitActionInternal]);

  const submitStealthSweep = useCallback(async (
    sweep: PreparedStealthSweep,
  ): Promise<'broadcast' | 'ambiguous'> => {
    if (asset.kind !== 'native') {
      throw new Error('Reusable private receipts currently support XLM only.');
    }
    const current = stealthSnapshot.payments.find(candidate =>
      candidate.transactionHash === sweep.payment.transactionHash &&
      candidate.destinationPublicKey === sweep.payment.destinationPublicKey);
    const sameJournal = current?.status === 'sweeping' &&
      current.sweptTransactionHash === sweep.review.transaction.transactionHash &&
      current.sweepActionField === sweep.review.actionField;
    if (
      !current ||
      (current.status !== 'unspent' && !sameJournal) ||
      current.ephemeralPublicKey !== sweep.payment.ephemeralPublicKey ||
      current.amountStroops !== sweep.payment.amountStroops ||
      sweep.review.kind !== 'deposit' ||
      sweep.review.amountStroops !== current.amountStroops
    ) {
      throw new Error('Reusable private payment changed. Prepare the move again.');
    }
    if (actionBusyRef.current) {
      throw new Error('Another Private Balance action is already running.');
    }
    actionBusyRef.current = true;
    try {
      return await submitActionInternal(sweep.review, {
        beforeSign: async ({ storageKey }) => {
          const cache = await markStealthPaymentSweeping(
            storageScope,
            storageKey,
            sweep.payment,
            {
              transactionHash: sweep.review.transaction.transactionHash,
              actionField: sweep.review.actionField,
            },
            new IndexedDbEncryptedRecordDriver(),
          );
          setStealthSnapshot(snapshot => ({
            ...snapshot,
            payments: cache.payments,
            latestLedger: cache.latestLedger,
            error: null,
          }));
        },
        sign: async (request, sessionRoot) => {
          const stealthRoot = deriveStealthRootKey(sessionRoot);
          try {
            return await signStealthSweepEnvelope({
              rootKey: stealthRoot,
              payment: sweep.payment,
              network,
              networkPassphrase: request.networkPassphrase,
              envelopeXdr: request.envelopeXdr,
              expectedTransactionHash: request.transactionHash,
            });
          } finally {
            stealthRoot.fill(0);
          }
        },
      });
    } catch (error) {
      try {
        await performSyncRef.current?.(false, { background: true });
      } catch {
        // The encrypted sweep and action journals remain authoritative.
      }
      throw error;
    } finally {
      actionBusyRef.current = false;
    }
  }, [asset.kind, network, storageScope, stealthSnapshot.payments, submitActionInternal]);

  const prepareChainedSend = useCallback(async (
    draft: PrivateChainedSendDraft,
  ): Promise<PrivateChainedSendApproval> => {
    if (!leaderRef.current) {
      throw new Error('Sync Private Balance in this tab before creating an action.');
    }
    const amount = parsePrivateAmount(draft.amount, asset.decimals);
    const selection = selectPrivateNotes(state.notes, amount);
    if (selection.kind === 'insufficient') {
      throw new Error('Private Balance is insufficient for this amount.');
    }
    if (selection.kind === 'selected') {
      throw new Error('This send does not need multiple steps.');
    }
    return planPrivateChainedSend({
      approvalId: ownerId(),
      consolidationActionCount: selection.actionCount,
      perStepMaxFeeStroops:
        BigInt(recommendedBaseFeeStroops) + MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS,
      publicXlmBalanceStroops: publicXlmBalanceStroops(balances),
    });
  }, [asset.decimals, balances, recommendedBaseFeeStroops, state.notes]);

  const submitChainedSend = useCallback(async (
    approval: PrivateChainedSendApproval,
    draft: PrivateChainedSendDraft,
    onProgress?: (progress: PrivateChainedSendProgress) => void,
  ): Promise<PrivateChainedSendResult> => {
    if (actionBusyRef.current) throw new Error('Another Private Balance action is already open.');
    if (!leaderRef.current) {
      throw new Error('Sync Private Balance in this tab before signing.');
    }
    const privateAddress = workerIdentityRef.current?.address;
    if (!privateAddress) throw new Error('Private Balance worker is not ready.');
    actionBusyRef.current = true;
    const context = deploymentContext(manifest);
    const driver = new IndexedDbEncryptedRecordDriver();
    try {
      const ownFingerprint = (
        await validatePrivateTransferRecipient(privateAddress, manifest)
      ).fingerprint;
      // Journal the one-shot approval before the first step; a dead leftover
      // from an expired chain is replaced under this fresh consent.
      await mutexRef.current.runExclusive(() =>
        withPrivacySessionRoot(accountId, context, async (_sessionRoot, storageKey) => {
          let current = await loadPrivateBalanceState(storageScope, storageKey, driver);
          if (!current) throw new Error('Private Balance state is unavailable.');
          if (current.chainedApproval) {
            current = await clearPrivateChainedApproval(
              storageScope,
              storageKey,
              current.revision,
              driver,
            );
          }
          const now = Date.now();
          await beginPrivateChainedApproval(
            storageScope,
            storageKey,
            current.revision,
            {
              id: approval.id,
              steps: approval.steps,
              perStepMaxFeeStroops: approval.perStepMaxFeeStroops,
              cumulativeMaxFeeStroops: approval.cumulativeMaxFeeStroops,
              accumulatedFeeStroops: '0',
              expiresAtSeconds: approval.expiresAtSeconds,
              createdAt: now,
              updatedAt: now,
            },
            driver,
          );
        }));
      try {
        return await runPrivateChainedSend({
          approval,
          draft,
          ownFingerprint,
          assetDecimals: asset.decimals,
          prepare: stepDraft => prepareActionInternal(stepDraft),
          // Non-final steps await their canonical confirmation inside the
          // driver, so their fire-and-forget outcome watcher stays off; the
          // final send keeps the standard post-broadcast poll so it resolves
          // within seconds like any ordinary submit.
          submit: (review, { isFinal }) =>
            submitActionInternal(review, { watchOutcome: isFinal }),
          cancel: actionId => cancelAction(actionId),
          awaitConfirmation: async review => {
            const rpcUrl = getRpcUrl(network);
            if (!rpcUrl) return false;
            const endpoint = new URL(rpcUrl);
            const allowHttp = endpoint.protocol === 'http:' &&
              ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
            const rpc = new SorobanRpc.Server(endpoint.toString(), { allowHttp });
            const stepGone = () => withPrivacySessionRoot(
              accountId,
              context,
              async (_sessionRoot, storageKey) => {
                const current = await loadPrivateBalanceState(storageScope, storageKey, driver);
                return !current?.pendingActions.some(action => action.id === review.id);
              },
            );
            const outcome = await pollBroadcastPrivateBalanceTransaction({
              transactionHash: review.transaction.transactionHash,
              rpc,
              reconcile: async () => {
                await performSyncRef.current?.(false, { background: true });
                return stepGone();
              },
            });
            if (outcome === 'confirmed') return true;
            try {
              await performSyncRef.current?.(false, { background: true });
            } catch {
              return false;
            }
            return stepGone();
          },
          advanceApprovedFee: stepFeeStroops =>
            mutexRef.current.runExclusive(() =>
              withPrivacySessionRoot(accountId, context, async (_sessionRoot, storageKey) => {
                const current = await loadPrivateBalanceState(storageScope, storageKey, driver);
                if (!current) throw new Error('Private Balance state is unavailable.');
                await advancePrivateChainedApprovalFee(
                  storageScope,
                  storageKey,
                  current.revision,
                  approval.id,
                  stepFeeStroops,
                  Date.now(),
                  driver,
                );
              })),
          onProgress,
        });
      } finally {
        // The approval is one-shot: finished or dead, its journal entry goes.
        try {
          await mutexRef.current.runExclusive(() =>
            withPrivacySessionRoot(accountId, context, async (_sessionRoot, storageKey) => {
              const current = await loadPrivateBalanceState(storageScope, storageKey, driver);
              if (current?.chainedApproval?.id === approval.id) {
                const cleared = await clearPrivateChainedApproval(
                  storageScope,
                  storageKey,
                  current.revision,
                  driver,
                );
                reflectDurableState(cleared);
              }
            }));
        } catch {
          // An expired leftover approval is swept at the next leader sync.
        }
      }
    } finally {
      actionBusyRef.current = false;
    }
  }, [
    accountId,
    asset.decimals,
    cancelAction,
    manifest,
    network,
    prepareActionInternal,
    reflectDurableState,
    storageScope,
    submitActionInternal,
  ]);

  const onIncomingPrivatePayment = useCallback((
    listener: (event: IncomingPrivateTransferSummary) => void,
  ): (() => void) => {
    incomingListenersRef.current.add(listener);
    return () => {
      incomingListenersRef.current.delete(listener);
    };
  }, []);

  const takeoverLeadership = useCallback(() => {
    takeoverRef.current?.();
  }, []);

  const validateRecipient = useCallback(
    (address: string) => validatePrivateTransferRecipient(address, manifest),
    [manifest],
  );

  const runFullVerification = useCallback(async () => {
    if (actionBusyRef.current) throw new Error('Another Private Balance operation is already running.');
    if (!leaderRef.current) throw new Error('Run verification in the active Private Balance tab.');
    actionBusyRef.current = true;
    const driver = new IndexedDbEncryptedRecordDriver();
    const context = deploymentContext(manifest);
    try {
      await withPrivacySessionRoot(accountId, context, async (_sessionRoot, storageKey) => {
        const current = await loadPrivateBalanceState(storageScope, storageKey, driver);
        if (!current) throw new Error('Private Balance state is unavailable.');
        if (current.pendingActions.length > 0 || current.buildReservations.length > 0) {
          throw new Error('Reconcile or cancel every pending Private Balance action before full verification.');
        }
        const empty = createEmptyPrivateBalanceState(manifestHash);
        const reset: PrivateBalanceDurableState = {
          ...empty,
          revision: current.revision + 1,
          account: {
            ...empty.account,
            setupState: 'ready',
          },
        };
        await commitPrivateBalanceState(
          storageScope,
          storageKey,
          reset,
          current.revision,
          driver,
        );
        await clearPrivateBalancePublicCache(storageScope, driver);
        reflectDurableState(reset);
      });
      await performSyncRef.current?.(false);
    } finally {
      actionBusyRef.current = false;
    }
  }, [accountId, manifest, manifestHash, reflectDurableState, storageScope]);

  const disableLocalData = useCallback(async (confirmation: string) => {
    if (confirmation !== 'REMOVE PRIVATE BALANCE') {
      throw new Error('Type REMOVE PRIVATE BALANCE exactly to remove local data.');
    }
    if (actionBusyRef.current) throw new Error('Another Private Balance operation is already running.');
    if (!leaderRef.current) throw new Error('Remove local data in the active Private Balance tab.');
    actionBusyRef.current = true;
    const driver = new IndexedDbEncryptedRecordDriver();
    const context = deploymentContext(manifest);
    try {
      await withPrivacySessionRoot(accountId, context, async (_sessionRoot, storageKey) => {
        const current = await loadPrivateBalanceState(storageScope, storageKey, driver);
        if (current && (current.pendingActions.length > 0 || current.buildReservations.length > 0)) {
          throw new Error('Reconcile or cancel every pending Private Balance action before removing local data.');
        }
        await clearShieldedState(storageScope, driver);
        await clearStealthDiscoveryCache(storageScope, driver);
      });
      encryptedStateExistsRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = null;
      workerIdentityRef.current = null;
      lastSyncCurrentRef.current = false;
      dispatch({ type: 'RESET' });
      setEncryptedStorageBytes(0);
      setStealthSnapshot(INITIAL_STEALTH_SNAPSHOT);
      setSnapshot(current => ({
        ...current,
        phase: 'disabled',
        configured: false,
        backgroundSyncing: false,
        syncProgress: null,
        verifiedBalanceStroops: '0',
        lastVerifiedActionIndex: null,
        error: null,
      }));
      onDurableStateChange?.(
        runtimeKey,
        portfolioKey,
        deploymentId,
        asset,
        {
          phase: 'disabled',
          configured: false,
          verifiedBalanceStroops: '0',
          lastVerifiedActionIndex: null,
          noteCount: 0,
          activities: [],
          pendingActions: [],
          checkpoint: null,
        },
      );
    } finally {
      actionBusyRef.current = false;
    }
  }, [
    accountId,
    asset,
    deploymentId,
    manifest,
    onDurableStateChange,
    portfolioKey,
    runtimeKey,
    storageScope,
  ]);

  const selectedState = useMemo(() => ({
    ...state,
    notes: state.notes.filter(note => note.assetContractId === asset.contractId),
    activities: state.activities.filter(activity => activity.assetContractId === asset.contractId),
    pendingActions: state.pendingActions.filter(action => action.assetContractId === asset.contractId),
  }), [asset.contractId, state]);
  const totalBalanceStroops = selectTotalShieldedBalance(selectedState);
  const totalBalanceDisplay = formatPrivateBalanceAmount(totalBalanceStroops, asset.decimals);
  const legacyValue = useMemo<PrivateBalanceContextValue>(() => ({
    state: selectedState,
    totalBalanceStroops,
    totalBalanceDisplay,
    networkLabel: network === 'mainnet' ? 'Mainnet' : 'Testnet',
    protocolVersion: manifest.protocolVersion,
    noteCount: selectedState.notes.filter(note => note.status === 'unspent').length,
    optIn,
    refreshSync,
    prepareAction,
    cancelAction,
    submitAction,
  }), [
    cancelAction,
    manifest.protocolVersion,
    network,
    optIn,
    prepareAction,
    refreshSync,
    selectedState,
    submitAction,
    totalBalanceStroops,
    totalBalanceDisplay,
  ]);
  const runtimeValue = useMemo<PrivateBalanceRuntimeDataValue>(() => ({
    ...snapshot,
    verifiedBalanceStroops: totalBalanceStroops.toString(),
    asset,
    privateAddress: state.shieldedAddress,
    publicAddress: accountPublicKey,
    networkLabel: network === 'mainnet' ? 'Mainnet' : 'Testnet',
    protocolVersion: manifest.protocolVersion,
    noteCount: selectedState.notes.filter(note => note.status === 'unspent').length,
    activities: selectedState.activities,
    pendingActions: selectedState.pendingActions,
    recentPrivateRecipients: state.recentRecipients,
    checkpoint: state.checkpoint,
    selectedRpc: getRpcUrl(network),
    encryptedStorageBytes,
    stealthMetaAddress: stealthSnapshot.metaAddress,
    stealthPayments: stealthSnapshot.payments,
    stealthLatestLedger: stealthSnapshot.latestLedger,
    stealthSyncing: stealthSnapshot.syncing,
    stealthError: stealthSnapshot.error,
    optIn,
    refreshSync,
    refreshStealth,
    prepareStealthSweep,
    submitStealthSweep,
    rotatePrivateAddress,
    validateRecipient,
    prepareAction,
    cancelAction,
    submitAction,
    prepareChainedSend,
    submitChainedSend,
    onIncomingPrivatePayment,
    takeoverLeadership,
    runFullVerification,
    disableLocalData,
  }), [
    accountPublicKey,
    asset,
    cancelAction,
    disableLocalData,
    encryptedStorageBytes,
    manifest.protocolVersion,
    network,
    onIncomingPrivatePayment,
    optIn,
    prepareAction,
    prepareChainedSend,
    prepareStealthSweep,
    refreshSync,
    refreshStealth,
    rotatePrivateAddress,
    runFullVerification,
    snapshot,
    stealthSnapshot,
    selectedState.activities,
    state.checkpoint,
    selectedState.notes,
    selectedState.pendingActions,
    state.recentRecipients,
    state.shieldedAddress,
    submitAction,
    submitChainedSend,
    submitStealthSweep,
    takeoverLeadership,
    totalBalanceStroops,
    validateRecipient,
  ]);

  return (
    <PrivateBalanceRuntimeDataProvider value={runtimeValue}>
      <PrivateBalanceContext.Provider value={legacyValue}>
        {children}
      </PrivateBalanceContext.Provider>
    </PrivateBalanceRuntimeDataProvider>
  );
}

export function usePrivateBalance(): PrivateBalanceContextValue {
  const context = useContext(PrivateBalanceContext);
  if (!context) {
    throw new Error('usePrivateBalance must be used within PrivateBalanceProvider');
  }
  return context;
}
