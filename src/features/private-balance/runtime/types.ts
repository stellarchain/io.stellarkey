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
  id: string; // Hex of note commitment
  commitment: string; // Hex (32 bytes)
  value: string; // Decimal string of stroops
  assetContractId: string; // Canonical SAC contract address
  diversifier: string; // Lowercase hex (4 bytes)
  ownerCommitment: string; // Hex (32 bytes)
  leafIndex: number;
  actionIndex: number;
  rho: string; // Hex (32 bytes)
  memoHex: string;
  senderFingerprintHex: string;
  status: NoteStatus;
  reservedAt?: number;
  spentInActionIndex?: number;
  createdAt: number;
}

export interface ShieldedActivityRecord {
  id: string; // Hex of actionField
  actionIndex: number;
  actionKind: 'deposit' | 'transfer' | 'withdraw';
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
  lastActionIndex: number;
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
  lastVerifiedActionIndex: number | null;
  updatedAt: number;
}

export type PendingActionStatus =
  | 'prepared'
  | 'reviewed'
  | 'signed'
  | 'broadcast'
  | 'ambiguous';

export interface PrivatePendingAction {
  id: string;
  kind: 'deposit' | 'transfer' | 'withdraw';
  assetContractId: string; // Canonical SAC contract address
  status: PendingActionStatus;
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
  createdAt: number;
  updatedAt: number;
}

export interface PrivateBuildReservation {
  id: string;
  kind: 'deposit' | 'transfer' | 'withdraw';
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
  notes: ShieldedNoteRecord[];
  activities: ShieldedActivityRecord[];
  checkpoint: ShieldedCheckpoint | null;
  buildReservations: PrivateBuildReservation[];
  pendingActions: PrivatePendingAction[];
  recentPrivateRecipients?: PrivateRecentRecipient[];
  chainedApproval?: PrivateChainedApproval; // One-shot multi-step send consent
}
