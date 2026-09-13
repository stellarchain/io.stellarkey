import type { LegacyPrivateRelayChainJournal } from './legacy-relay-state';
import type { PrivateOutgoingHistoryMode } from './outgoing-history';
import type { PrivateFeePayer } from './fee-policy';

export interface DeploymentContext {
  protocolVersion: number;
  networkId: string;
  realmId: string;
  poolContractId: string;
  contextHash: string;
  deploymentBindingHash: string;
}

export type NoteStatus = 'unspent' | 'reserved' | 'spent';

export interface ShieldedNoteRecord {
  id: string; // Stable 32-byte wallet identity; duplicate leaves are leaf-bound
  commitment: string; // Hex (32 bytes)
  value: string; // Decimal string of stroops
  assetIndex: number; // Immutable index in the pool's on-chain registry
  assetContractId: string; // Canonical SAC contract address
  diversifier: string; // Lowercase hex (4 bytes)
  ownerCommitment: string; // Hex (32 bytes)
  leafIndex: bigint;
  actionIndex: bigint;
  rho: string; // Hex (32 bytes)
  memoHex: string;
  senderFingerprintHex: string;
  status: NoteStatus;
  reservedAt?: number;
  spentInActionIndex?: bigint;
  createdAt: number;
}

export interface ShieldedActivityRecord {
  id: string; // Hex of actionField
  actionIndex: bigint;
  actionKind: 'deposit' | 'transfer' | 'withdraw';
  assetIndex: number; // Recovered privately for transfers; public at boundaries
  assetContractId: string; // Canonical SAC contract address
  amount: string; // Decimal stroops
  direction: 'inflow' | 'outflow' | 'internal';
  timestamp: number;
  nullifiers: string[];
  outputCommitments: string[];
  /** Exact locally reviewed transaction that produced this verified action. */
  transactionHash?: string;
  recipientFingerprint?: string;
  memoHex?: string;
}

export interface ShieldedCheckpoint {
  nextLeafIndex: bigint;
  lastActionIndex: bigint;
  lastRecordHash: string;
  treeRoot: string;
  treeFrontier: string[];
  deploymentBindingHash: string;
  manifestHash: string;
  latestLedger: number;
  updatedAt: number;
}

export type PrivateSetupState = 'not-configured' | 'ready';
export type PrivateSyncStatus =
  | 'never'
  | 'syncing'
  | 'current'
  | 'safe-error';

export interface PrivateAccountState {
  setupState: PrivateSetupState;
  syncStatus: PrivateSyncStatus;
  lastVerifiedActionIndex: bigint | null;
  updatedAt: number;
}

export type PendingActionStatus =
  | 'prepared'
  | 'reviewed'
  | 'signed'
  | 'broadcast'
  | 'ambiguous';

export interface PrivatePendingAction {
  feePayer?: PrivateFeePayer;
  /** Reviewed inner hash; present only once a sponsored envelope is signed. */
  innerTransactionHash?: string;
  id: string;
  kind: 'deposit' | 'transfer' | 'withdraw';
  assetIndex: number; // Immutable index in the pool's on-chain registry
  assetContractId: string; // Canonical SAC contract address
  status: PendingActionStatus;
  /** Missing on legacy records: reconcile only; never infer a direct route. */
  submissionMode?: 'direct' | 'relay';
  /** Persisted before any proof-bearing network call. Missing legacy spends are shared. */
  proofExposure?: 'local' | 'shared';
  /** Immutable policy selected before building this proof. */
  outgoingHistoryMode?: PrivateOutgoingHistoryMode;
  directChainApprovalId?: string;
  reservedNoteIds: string[];
  actionField: string;
  nullifiers: string[];
  outputCommitments: string[];
  anchorRoot: string;
  anchorExpiresAtLedger: number;
  proofHash: string;
  classicFeeCapStroops: string;
  resourceFeeCapStroops: string;
  amountStroops?: string; // Decimal stroops shown while the action confirms
  changeValueStroops?: string; // Decimal stroops returning as change
  expiresAtSeconds?: number; // Envelope maxTime (unix seconds), set when signed
  transactionHash?: string;
  signedEnvelopeXdr?: string;
  broadcastAttempts: number;
  latestRpcStatus?:
    | 'PENDING'
    | 'DUPLICATE'
    | 'TRY_AGAIN_LATER'
    | 'ERROR'
    | 'SUCCESS'
    | 'FAILED'
    | 'NOT_FOUND'
    | 'UNAVAILABLE';
  lastBroadcastAt?: number;
  journalId?: string;
  recipientFingerprint?: string;
  memoHex?: string;
  /** Archived relay metadata; never authorizes a new submission. */
  relayChain?: {
    approvalId: string;
    step: number;
    feeAtomic: string;
    quoteId: string;
    requestId: string;
    sourceAccount: string;
    recipientAddress: string;
    recipientOutputCommitment: string;
    expiresAtSeconds: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface PrivateBuildReservation {
  id: string;
  kind: 'deposit' | 'transfer' | 'withdraw';
  /** New reservations never leave the device; legacy reservations are uncertain. */
  proofExposure?: 'local';
  outgoingHistoryMode?: PrivateOutgoingHistoryMode;
  assetContractId: string; // Canonical SAC contract address
  reservedNoteIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PrivateRecentRecipient {
  address: string;
  fingerprint: string;
  lastUsedAt: number;
}

export interface PrivateChainedApproval {
  feePayer?: PrivateFeePayer;
  id: string;
  steps: number; // Total approved actions: consolidations plus the final send
  perStepMaxFeeStroops: string;
  cumulativeMaxFeeStroops: string;
  accumulatedFeeStroops: string; // Advanced before each step broadcasts
  expiresAtSeconds: number; // Unix seconds; the approval dies at expiry
  createdAt: number;
  updatedAt: number;
}

export interface PrivateBalanceDurableState {
  schemaVersion: 1;
  revision: number;
  lastValidatedManifestHash: string;
  account: PrivateAccountState;
  privateAddress?: string; // Derived at opt-in so Receive works without a sync
  /** Account+deployment scoped; missing legacy and seed-only state is recoverable. */
  outgoingHistoryMode?: PrivateOutgoingHistoryMode;
  /** Encrypted local issuance history; never sent to discovery or the worker. */
  issuedAddressDiversifiers?: string[];
  notes: ShieldedNoteRecord[];
  activities: ShieldedActivityRecord[];
  checkpoint: ShieldedCheckpoint | null;
  buildReservations: PrivateBuildReservation[];
  pendingActions: PrivatePendingAction[];
  /** Encrypted lineage; only a canonical scan may resolve a recovery attempt. */
  spendRecovery?: PrivateSpendRecovery;
  recentPrivateRecipients?: PrivateRecentRecipient[];
  chainedApproval?: PrivateChainedApproval; // One-shot multi-step send consent
  relayChainedApproval?: LegacyPrivateRelayChainJournal;
}

export interface PrivateSpendRecovery {
  originalActionField: string;
  recoveryActionFields: string[];
  reservedNoteIds: string[];
  assetContractId: string;
  outcome: 'pending' | 'recovered' | 'original-confirmed' | 'conflict-confirmed';
}
