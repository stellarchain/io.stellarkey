'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  PreparedPrivateActionReview,
  PrivateActionDraft,
  PrivateActionProgressStage,
} from '@/features/private-balance/runtime/action-flow';
import type {
  PrivateChainedSendApproval,
  PrivateChainedSendDraft,
  PrivateChainedSendProgress,
  PrivateChainedSendResult,
} from '@/features/private-balance/runtime/chained-send';
import type { IncomingPrivateTransferSummary } from '@/features/private-balance/runtime/sync-machine';
import type {
  PrivatePendingAction,
  PrivateRecentRecipient,
  ShieldedActivityRecord,
  ShieldedCheckpoint,
} from '@/features/private-balance/runtime/types';
import type { PrivateArchiveRestorationProgress } from '@/features/private-balance/runtime/archive-restoration';
import type { PrivateBalanceAsset } from '@/lib/private-balance-assets';
import type { PrivatePortfolioEntry } from '@/features/private-balance/runtime/portfolio';
import type { StealthOwnedPayment } from '@/features/private-balance/runtime/stealth-cache';
import type { PrivateRelayJobReview } from '@/features/private-balance/relay/review';
import type { PrivateRelayPreparationCallbacks } from '@/features/private-balance/runtime/action-transaction';
import type { PrivateRelayPreparationContext } from '@/features/private-balance/relay/preparation';
import type { PrivateRelayPreparedEnvelope } from '@/features/private-balance/relay/prepared-envelope';

export type PrivateBalanceRuntimePhase =
  | 'disabled'
  | 'locked'
  | 'loading-artifacts'
  | 'reading-meta'
  | 'scanning-live'
  | 'current'
  | 'status-unknown'
  | 'safe-error';

export interface PrivateBalanceRuntimeControlValue {
  requested: boolean;
  runtimeRequestVersion: number;
  availabilityReason: string | null;
  availableAssets: PrivateBalanceAssetOption[];
  selectedDeploymentId: string | null;
  requestRuntime(): void;
  retryRuntime(): void;
  selectAsset(deploymentId: string): void;
  registerAvailableAssets(
    assets: PrivateBalanceAssetOption[],
    preferredDeploymentId: string | null,
  ): void;
}

export interface PrivateBalanceAssetOption {
  deploymentId: string;
  asset: PrivateBalanceAsset;
  encryptedStateExists: boolean;
}

export interface PrivateBalanceRecoveryEvidence {
  measuredActionCount: number;
  timeRange: string;
  feeRange: string;
}

export interface PrivateBalanceOptInOptions {
  /** Warm shared proving files after authenticated setup finishes. */
  prefetchArtifacts?: boolean;
}

export interface PrivateBalanceDeploymentSummary {
  manifestStatus: 'development' | 'testnet-preview' | 'testnet-beta' | 'production' | null;
  network: 'testnet' | 'mainnet' | null;
  poolContractId: string | null;
  assetContractId: string | null;
  assetAdminAddress: string | null;
  networkId: string | null;
  realmId: string | null;
  artifactVersion: string | null;
  manifestHash: string | null;
  circuitHash: string | null;
  artifactDownloadBytes: number | null;
  artifactBytesAreLowerBound: boolean;
  auditStatus: 'not-recorded' | 'recorded';
  ceremonyStatus: 'not-recorded' | 'recorded';
  depositsPaused: boolean | null;
  actionCount: number | null;
  pageCount: number | null;
  latestLedger: number | null;
  recoveryEvidence: PrivateBalanceRecoveryEvidence | null;
}

export interface PreparedStealthSweep {
  payment: Pick<
    StealthOwnedPayment,
    | 'transactionHash'
    | 'ephemeralPublicKey'
    | 'destinationPublicKey'
    | 'amountStroops'
  >;
  review: PreparedPrivateActionReview;
}

export interface PrivateRelaySubmissionCallbacks {
  requestSignature(input: {
    envelopeXdr: string;
    transactionHash: string;
    networkPassphrase: string;
  }): Promise<string>;
  requestSubmission(input: {
    signedEnvelopeXdr: string;
    transactionHash: string;
  }): Promise<{
    status: 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR';
    hash: string;
  }>;
}

export interface PrivateBalanceRuntimeDataValue {
  phase: PrivateBalanceRuntimePhase;
  configured: boolean;
  isLeader: boolean;
  backgroundSyncing: boolean;
  syncProgress: { current: number; total: number } | null;
  verifiedBalanceStroops: string;
  lastVerifiedActionIndex: number | null;
  error: string | null;
  restoreRequiredActionIndex: number | null;
  deployment: PrivateBalanceDeploymentSummary;
  privateAddress: string | null;
  publicAddress: string | null;
  networkLabel: 'Testnet' | 'Mainnet';
  protocolVersion: number;
  noteCount: number;
  activities: ShieldedActivityRecord[];
  pendingActions: PrivatePendingAction[];
  recentPrivateRecipients: PrivateRecentRecipient[];
  checkpoint: ShieldedCheckpoint | null;
  selectedRpc: string | null;
  witnessRpc: string | null;
  rpcWitnessEnabled: boolean;
  encryptedStorageBytes: number | null;
  asset: PrivateBalanceAsset | null;
  stealthMetaAddress: string | null;
  stealthPayments: StealthOwnedPayment[];
  stealthLatestLedger: number | null;
  stealthSyncing: boolean;
  stealthError: string | null;
  optIn(options?: PrivateBalanceOptInOptions): Promise<void>;
  refreshSync(): Promise<void>;
  restorePrivateHistory(
    onProgress?: (progress: PrivateArchiveRestorationProgress) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  refreshStealth(): Promise<void>;
  prepareStealthSweep(
    payment: StealthOwnedPayment,
    onProgress?: (stage: PrivateActionProgressStage) => void,
    signal?: AbortSignal,
  ): Promise<PreparedStealthSweep>;
  submitStealthSweep(sweep: PreparedStealthSweep): Promise<'broadcast' | 'ambiguous'>;
  rotatePrivateAddress(): Promise<string>;
  validateRecipient(address: string): Promise<{ fingerprint: string }>;
  prepareAction(
    draft: PrivateActionDraft,
    onProgress?: (stage: PrivateActionProgressStage) => void,
    signal?: AbortSignal,
    relayPreparation?: PrivateRelayPreparationCallbacks,
  ): Promise<PreparedPrivateActionReview>;
  cancelAction(actionId: string): Promise<void>;
  submitAction(
    review: PreparedPrivateActionReview,
    relay?: PrivateRelaySubmissionCallbacks,
  ): Promise<'broadcast' | 'ambiguous'>;
  derivePrivateRelayPayout(input: {
    assetIndex: number;
    actionDiversifier: string;
  }): Promise<string>;
  reviewPrivateRelayJob(input: {
    unsignedEnvelopeXdr: string;
    transactionHash: string;
    sourceAccount: string;
    assetIndex: number;
    actionDiversifier: string;
    feeAtomic: string;
  }): Promise<PrivateRelayJobReview>;
  preparePrivateRelayJob(input: PrivateRelayPreparationContext, signal?: AbortSignal): Promise<PrivateRelayPreparedEnvelope>;
  signPrivateRelayJob(review: PrivateRelayJobReview): Promise<string>;
  submitPrivateRelayJob(input: {
    signedEnvelopeXdr: string;
    transactionHash: string;
  }): Promise<{
    status: 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR';
    hash: string;
  }>;
  prepareChainedSend(draft: PrivateChainedSendDraft): Promise<PrivateChainedSendApproval>;
  submitChainedSend(
    approval: PrivateChainedSendApproval,
    draft: PrivateChainedSendDraft,
    onProgress?: (progress: PrivateChainedSendProgress) => void,
  ): Promise<PrivateChainedSendResult>;
  onIncomingPrivatePayment(
    listener: (event: IncomingPrivateTransferSummary) => void,
  ): () => void;
  takeoverLeadership(): void;
  setRpcWitnessEnabled(enabled: boolean): void;
  runFullVerification(): Promise<void>;
  disableLocalData(confirmation: string): Promise<void>;
}

export type PrivateBalanceDurableRuntimeSummary = Pick<
  PrivateBalanceRuntimeDataValue,
  | 'phase'
  | 'configured'
  | 'verifiedBalanceStroops'
  | 'lastVerifiedActionIndex'
  | 'noteCount'
  | 'activities'
  | 'pendingActions'
  | 'checkpoint'
>;

const unavailable = async (): Promise<void> => {
  throw new Error('Private Balance is unavailable.');
};

const unavailableRecipient = async (): Promise<{ fingerprint: string }> => {
  throw new Error('Private Balance is unavailable.');
};

const unavailableReview = async (): Promise<PreparedPrivateActionReview> => {
  throw new Error('Private Balance is unavailable.');
};

const unavailableStealthSweep = async (): Promise<PreparedStealthSweep> => {
  throw new Error('Private Balance is unavailable.');
};

const unavailableSubmission = async (): Promise<'broadcast' | 'ambiguous'> => {
  throw new Error('Private Balance is unavailable.');
};

const unavailableRelayPayout = async (): Promise<string> => {
  throw new Error('Private Balance is unavailable.');
};

const unavailableRelayReview = async (): Promise<PrivateRelayJobReview> => {
  throw new Error('Private Balance is unavailable.');
};

const unavailableRelaySign = async (): Promise<string> => {
  throw new Error('Private Balance is unavailable.');
};

const unavailableRelaySubmit = async (): Promise<{
  status: 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR';
  hash: string;
}> => {
  throw new Error('Private Balance is unavailable.');
};

const unavailableChainedApproval = async (): Promise<PrivateChainedSendApproval> => {
  throw new Error('Private Balance is unavailable.');
};

const unavailableChainedSubmission = async (): Promise<PrivateChainedSendResult> => {
  throw new Error('Private Balance is unavailable.');
};

export const initialPrivateBalanceRuntimeData: PrivateBalanceRuntimeDataValue = {
  phase: 'disabled',
  configured: false,
  isLeader: false,
  backgroundSyncing: false,
  syncProgress: null,
  verifiedBalanceStroops: '0',
  lastVerifiedActionIndex: null,
  error: null,
  restoreRequiredActionIndex: null,
  privateAddress: null,
  publicAddress: null,
  networkLabel: 'Testnet',
  protocolVersion: 1,
  noteCount: 0,
  activities: [],
  pendingActions: [],
  recentPrivateRecipients: [],
  checkpoint: null,
  selectedRpc: null,
  witnessRpc: null,
  rpcWitnessEnabled: true,
  encryptedStorageBytes: null,
  asset: null,
  stealthMetaAddress: null,
  stealthPayments: [],
  stealthLatestLedger: null,
  stealthSyncing: false,
  stealthError: null,
  deployment: {
    manifestStatus: null,
    network: null,
    poolContractId: null,
    assetContractId: null,
    assetAdminAddress: null,
    networkId: null,
    realmId: null,
    artifactVersion: null,
    manifestHash: null,
    circuitHash: null,
    artifactDownloadBytes: null,
    artifactBytesAreLowerBound: false,
    auditStatus: 'not-recorded',
    ceremonyStatus: 'not-recorded',
    depositsPaused: null,
    actionCount: null,
    pageCount: null,
    latestLedger: null,
    recoveryEvidence: null,
  },
  optIn: unavailable,
  refreshSync: unavailable,
  restorePrivateHistory: unavailable,
  refreshStealth: unavailable,
  prepareStealthSweep: unavailableStealthSweep,
  submitStealthSweep: unavailableSubmission,
  rotatePrivateAddress: async () => {
    throw new Error('Private Balance is unavailable.');
  },
  validateRecipient: unavailableRecipient,
  prepareAction: unavailableReview,
  cancelAction: unavailable,
  submitAction: unavailableSubmission,
  derivePrivateRelayPayout: unavailableRelayPayout,
  reviewPrivateRelayJob: unavailableRelayReview,
  preparePrivateRelayJob: async () => { throw new Error('Private Balance is unavailable.'); },
  signPrivateRelayJob: unavailableRelaySign,
  submitPrivateRelayJob: unavailableRelaySubmit,
  prepareChainedSend: unavailableChainedApproval,
  submitChainedSend: unavailableChainedSubmission,
  onIncomingPrivatePayment: () => () => {},
  takeoverLeadership: () => {},
  setRpcWitnessEnabled: () => {},
  runFullVerification: unavailable,
  disableLocalData: unavailable,
};

const PrivateBalanceRuntimeControlContext =
  createContext<PrivateBalanceRuntimeControlValue | null>(null);
const PrivateBalanceRuntimeDataContext =
  createContext<PrivateBalanceRuntimeDataValue>(initialPrivateBalanceRuntimeData);

export interface PrivateBalancePortfolioValue {
  entries: PrivatePortfolioEntry[];
}

const PrivateBalancePortfolioContext = createContext<PrivateBalancePortfolioValue>({ entries: [] });

interface PrivateBalanceRuntimeControlState {
  scopeKey: string | null;
  requested: boolean;
  runtimeRequestVersion: number;
  availableAssets: PrivateBalanceAssetOption[];
  selectedDeploymentId: string | null;
}

function emptyRuntimeControlState(scopeKey: string | null): PrivateBalanceRuntimeControlState {
  return {
    scopeKey,
    requested: false,
    runtimeRequestVersion: 0,
    availableAssets: [],
    selectedDeploymentId: null,
  };
}

export function PrivateBalanceRuntimeControlProvider({
  children,
  scopeKey,
  availabilityReason = null,
}: {
  children: ReactNode;
  scopeKey: string | null;
  availabilityReason?: string | null;
}) {
  const [state, setState] = useState<PrivateBalanceRuntimeControlState>(
    () => emptyRuntimeControlState(scopeKey),
  );
  // Account/network changes must publish an empty control view during this
  // render, before asynchronous catalogue discovery for the new scope begins.
  const scopedState = state.scopeKey === scopeKey
    ? state
    : emptyRuntimeControlState(scopeKey);
  const requestRuntime = useCallback(() => {
    setState(current => {
      const scoped = current.scopeKey === scopeKey
        ? current
        : emptyRuntimeControlState(scopeKey);
      return scoped.requested ? scoped : { ...scoped, requested: true };
    });
  }, [scopeKey]);
  const retryRuntime = useCallback(() => {
    setState(current => {
      const scoped = current.scopeKey === scopeKey
        ? current
        : emptyRuntimeControlState(scopeKey);
      return {
        ...scoped,
        requested: true,
        runtimeRequestVersion: scoped.runtimeRequestVersion + 1,
      };
    });
  }, [scopeKey]);
  const selectAsset = useCallback((deploymentId: string) => {
    // Selection is user intent, while the verified catalogue is asynchronous.
    // Retain the intent here and let selectPrivateBalanceDeploymentId validate
    // it against the verified deployment list before a runtime can mount.
    setState(current => {
      const scoped = current.scopeKey === scopeKey
        ? current
        : emptyRuntimeControlState(scopeKey);
      return { ...scoped, selectedDeploymentId: deploymentId };
    });
  }, [scopeKey]);
  const registerAvailableAssets = useCallback((
    assets: PrivateBalanceAssetOption[],
    preferredDeploymentId: string | null,
  ) => {
    setState(current => {
      const scoped = current.scopeKey === scopeKey
        ? current
        : emptyRuntimeControlState(scopeKey);
      const selectedDeploymentId =
        scoped.selectedDeploymentId &&
        assets.some(option => option.deploymentId === scoped.selectedDeploymentId)
          ? scoped.selectedDeploymentId
          : preferredDeploymentId &&
              assets.some(option => option.deploymentId === preferredDeploymentId)
            ? preferredDeploymentId
            : assets[0]?.deploymentId ?? null;
      return { ...scoped, availableAssets: assets, selectedDeploymentId };
    });
  }, [scopeKey]);
  const value = useMemo(
    () => ({
      requested: scopedState.requested,
      runtimeRequestVersion: scopedState.runtimeRequestVersion,
      availabilityReason,
      availableAssets: scopedState.availableAssets,
      selectedDeploymentId: scopedState.selectedDeploymentId,
      requestRuntime,
      retryRuntime,
      selectAsset,
      registerAvailableAssets,
    }),
    [
      availabilityReason,
      registerAvailableAssets,
      requestRuntime,
      retryRuntime,
      scopedState.availableAssets,
      scopedState.requested,
      scopedState.runtimeRequestVersion,
      scopedState.selectedDeploymentId,
      selectAsset,
    ],
  );
  return (
    <PrivateBalanceRuntimeControlContext.Provider value={value}>
      {children}
    </PrivateBalanceRuntimeControlContext.Provider>
  );
}

export function PrivateBalanceRuntimeDataProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: PrivateBalanceRuntimeDataValue;
}) {
  return (
    <PrivateBalanceRuntimeDataContext.Provider value={value}>
      {children}
    </PrivateBalanceRuntimeDataContext.Provider>
  );
}

export function PrivateBalancePortfolioProvider({
  children,
  entries,
}: {
  children: ReactNode;
  entries: PrivatePortfolioEntry[];
}) {
  const value = useMemo(() => ({ entries }), [entries]);
  return (
    <PrivateBalancePortfolioContext.Provider value={value}>
      {children}
    </PrivateBalancePortfolioContext.Provider>
  );
}

export function usePrivateBalanceRuntime(): PrivateBalanceRuntimeControlValue {
  const context = useContext(PrivateBalanceRuntimeControlContext);
  if (!context) {
    throw new Error(
      'usePrivateBalanceRuntime must be used within PrivateBalanceRuntimeControlProvider',
    );
  }
  return context;
}

export function usePrivateBalanceRuntimeData(): PrivateBalanceRuntimeDataValue {
  return useContext(PrivateBalanceRuntimeDataContext);
}

export function usePrivateBalancePortfolio(): PrivateBalancePortfolioValue {
  return useContext(PrivateBalancePortfolioContext);
}
