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
import type { PrivateBalanceAsset } from '@/lib/private-balance-assets';
import type { PrivatePortfolioEntry } from '@/features/private-balance/runtime/portfolio';
import type { StealthOwnedPayment } from '@/features/private-balance/runtime/stealth-cache';

export type PrivateBalanceRuntimePhase =
  | 'disabled'
  | 'locked'
  | 'loading-artifacts'
  | 'reading-meta'
  | 'scanning-live'
  | 'current'
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

export interface PrivateBalanceDeploymentSummary {
  manifestStatus: 'development' | 'testnet-beta' | 'production' | null;
  network: 'testnet' | 'mainnet' | null;
  poolContractId: string | null;
  assetContractId: string | null;
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

export interface PrivateBalanceRuntimeDataValue {
  phase: PrivateBalanceRuntimePhase;
  configured: boolean;
  isLeader: boolean;
  backgroundSyncing: boolean;
  syncProgress: { current: number; total: number } | null;
  verifiedBalanceStroops: string;
  lastVerifiedActionIndex: number | null;
  error: string | null;
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
  encryptedStorageBytes: number | null;
  asset: PrivateBalanceAsset | null;
  stealthMetaAddress: string | null;
  stealthPayments: StealthOwnedPayment[];
  stealthLatestLedger: number | null;
  stealthSyncing: boolean;
  stealthError: string | null;
  optIn(): Promise<void>;
  refreshSync(): Promise<void>;
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
  ): Promise<PreparedPrivateActionReview>;
  cancelAction(actionId: string): Promise<void>;
  submitAction(review: PreparedPrivateActionReview): Promise<'broadcast' | 'ambiguous'>;
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
  prepareChainedSend: unavailableChainedApproval,
  submitChainedSend: unavailableChainedSubmission,
  onIncomingPrivatePayment: () => () => {},
  takeoverLeadership: () => {},
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

export function PrivateBalanceRuntimeControlProvider({
  children,
  availabilityReason = null,
}: {
  children: ReactNode;
  availabilityReason?: string | null;
}) {
  const [requested, setRequested] = useState(false);
  const [runtimeRequestVersion, setRuntimeRequestVersion] = useState(0);
  const [availableAssets, setAvailableAssets] = useState<PrivateBalanceAssetOption[]>([]);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const requestRuntime = useCallback(() => setRequested(true), []);
  const retryRuntime = useCallback(() => {
    setRequested(true);
    setRuntimeRequestVersion(current => current + 1);
  }, []);
  const selectAsset = useCallback((deploymentId: string) => {
    // Selection is user intent, while the verified catalogue is asynchronous.
    // Retain the intent here and let selectPrivateBalanceDeploymentId validate
    // it against the verified deployment list before a runtime can mount.
    setSelectedDeploymentId(deploymentId);
  }, []);
  const registerAvailableAssets = useCallback((
    assets: PrivateBalanceAssetOption[],
    preferredDeploymentId: string | null,
  ) => {
    setAvailableAssets(assets);
    setSelectedDeploymentId(current => {
      if (current && assets.some(option => option.deploymentId === current)) return current;
      if (preferredDeploymentId && assets.some(option => option.deploymentId === preferredDeploymentId)) {
        return preferredDeploymentId;
      }
      return assets[0]?.deploymentId ?? null;
    });
  }, []);
  const value = useMemo(
    () => ({
      requested,
      runtimeRequestVersion,
      availabilityReason,
      availableAssets,
      selectedDeploymentId,
      requestRuntime,
      retryRuntime,
      selectAsset,
      registerAvailableAssets,
    }),
    [
      availabilityReason,
      availableAssets,
      registerAvailableAssets,
      requestRuntime,
      requested,
      retryRuntime,
      runtimeRequestVersion,
      selectAsset,
      selectedDeploymentId,
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
