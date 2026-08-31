import {
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  loadPrivateBalanceState,
  recordPrivatePendingActionRpcStatus,
  releasePrivatePendingAction,
  transitionPrivatePendingAction,
  type PrivateRecordDriver,
  type PrivateStorageContext,
} from './storage';
import type { PrivateBalanceDurableState, PrivatePendingAction } from './types';
import type { PrivateBalanceTransactionReview } from './transaction-review';

const HEX_32 = /^[0-9a-f]{64}$/;
const ZERO_NULLIFIER = '0'.repeat(64);
export const PRIVATE_BROADCAST_POLL_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
export const PRIVATE_ACTION_EXPIRY_MARGIN_SECONDS = 60;

export class PrivateActionReviewExpiredError extends Error {
  constructor() {
    super('This payment review expired. Review it again to continue.');
    this.name = 'PrivateActionReviewExpiredError';
  }
}

/**
 * Polls the read-only RPC transaction status after a broadcast, purely as a
 * TRIGGER for canonical reconciliation. The status alone never finalizes or
 * releases anything: SUCCESS and FAILED both hand off to `reconcile`, which
 * runs the canonical sync (and, for FAILED, the recovery classifier) and
 * reports whether the pending action left the durable journal. An action
 * still unresolved after the schedule is re-checked by every later sync.
 */
export async function pollBroadcastPrivateBalanceTransaction(input: {
  transactionHash: string;
  rpc: PrivateBalanceRpcLookup;
  reconcile(rpcStatus: 'SUCCESS' | 'FAILED'): Promise<boolean>;
  delays?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<'confirmed' | 'pending'> {
  if (!HEX_32.test(input.transactionHash)) {
    throw new Error('Private Balance broadcast transaction hash is invalid');
  }
  const sleep = input.sleep ?? (milliseconds => new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  }));
  for (const delay of input.delays ?? PRIVATE_BROADCAST_POLL_DELAYS_MS) {
    if (!Number.isSafeInteger(delay) || delay < 0) {
      throw new Error('Private Balance broadcast polling delay is invalid');
    }
    await sleep(delay);
    let status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND';
    try {
      const response = await input.rpc.getTransaction(input.transactionHash);
      if (response.txHash && response.txHash.toLowerCase() !== input.transactionHash) {
        throw new Error('RPC returned a different private transaction hash');
      }
      status = response.status;
    } catch {
      continue;
    }
    if (status !== 'SUCCESS' && status !== 'FAILED') continue;
    try {
      if (await input.reconcile(status)) return 'confirmed';
    } catch {
      // The durable pending journal remains authoritative; keep polling and
      // otherwise leave the action for the next canonical sync.
    }
  }
  return 'pending';
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface ValidatedSignedPrivateBalanceEnvelope {
  transaction: Transaction;
  hash: string;
  signatures: number;
}

export function validateSignedPrivateBalanceEnvelope(input: {
  signedEnvelopeXdr: string;
  networkPassphrase: string;
  expectedTransactionHash: string;
}): ValidatedSignedPrivateBalanceEnvelope {
  if (!HEX_32.test(input.expectedTransactionHash)) {
    throw new Error('Expected private transaction hash is invalid');
  }
  const parsed = TransactionBuilder.fromXdr(input.signedEnvelopeXdr, input.networkPassphrase);
  if (parsed instanceof FeeBumpTransaction || !(parsed instanceof Transaction)) {
    throw new Error('Signed Private Balance envelope cannot be fee-bumped');
  }
  const hash = bytesToHex(parsed.hash());
  if (hash !== input.expectedTransactionHash) {
    throw new Error('Signed envelope does not match the reviewed transaction');
  }
  if (parsed.signatures.length === 0) {
    throw new Error('Private Balance envelope is not signed');
  }
  return { transaction: parsed, hash, signatures: parsed.signatures.length };
}

export type PrivateActionRecoveryDecision = 'confirmed' | 'release' | 'ambiguous';
export type PrivateCanonicalTransactionStatus = 'SUCCESS' | 'FAILED' | 'NOT_FOUND' | 'UNAVAILABLE';

export function classifyPrivateActionRecovery(
  action: Pick<PrivatePendingAction, 'actionField' | 'nullifiers' | 'expiresAtSeconds'>,
  transactionStatus: PrivateCanonicalTransactionStatus,
  verifiedActionFields: readonly string[],
  verifiedNullifiers: readonly string[],
  headCloseTimeSeconds?: number,
): PrivateActionRecoveryDecision {
  if (verifiedActionFields.includes(action.actionField)) return 'confirmed';
  const observedNullifiers = new Set(verifiedNullifiers);
  if (action.nullifiers.some(nullifier =>
    nullifier !== ZERO_NULLIFIER && observedNullifiers.has(nullifier))) {
    return 'ambiguous';
  }
  if (transactionStatus === 'FAILED') return 'release';
  // Stellar cannot apply a transaction past its envelope maxTime, so once the
  // verified head closed beyond expiry plus margin, an absent action field and
  // absent real nullifiers prove non-inclusion.
  if (
    transactionStatus === 'NOT_FOUND' &&
    action.expiresAtSeconds !== undefined &&
    headCloseTimeSeconds !== undefined &&
    headCloseTimeSeconds > action.expiresAtSeconds + PRIVATE_ACTION_EXPIRY_MARGIN_SECONDS
  ) {
    return 'release';
  }
  return 'ambiguous';
}

export interface PrivateBalanceSigningRequest {
  envelopeXdr: string;
  transactionHash: string;
  networkPassphrase: string;
}

export async function signReviewedPrivateBalanceAction(input: {
  context: PrivateStorageContext;
  storageKey: Uint8Array;
  expectedRevision: number;
  actionId: string;
  review: PrivateBalanceTransactionReview;
  networkPassphrase: string;
  sign(request: PrivateBalanceSigningRequest): Promise<string>;
  storageDriver?: PrivateRecordDriver;
  now?: () => number;
}): Promise<PrivateBalanceDurableState> {
  const now = input.now ?? Date.now;
  if (Math.floor(now() / 1000) >= input.review.expiresAt) {
    throw new PrivateActionReviewExpiredError();
  }
  const state = await loadPrivateBalanceState(input.context, input.storageKey, input.storageDriver);
  if (!state || state.revision !== input.expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  const action = state.pendingActions.find(candidate => candidate.id === input.actionId);
  if (!action || action.status !== 'reviewed' || action.transactionHash !== input.review.transactionHash) {
    throw new Error('Private Balance action does not match the reviewed transaction');
  }
  const unsigned = TransactionBuilder.fromXdr(input.review.envelopeXdr, input.networkPassphrase);
  if (
    unsigned instanceof FeeBumpTransaction ||
    !(unsigned instanceof Transaction) ||
    unsigned.signatures.length !== 0 ||
    bytesToHex(unsigned.hash()) !== input.review.transactionHash
  ) {
    throw new Error('Private Balance reviewed envelope is invalid');
  }

  const signedEnvelopeXdr = await input.sign({
    envelopeXdr: input.review.envelopeXdr,
    transactionHash: input.review.transactionHash,
    networkPassphrase: input.networkPassphrase,
  });
  validateSignedPrivateBalanceEnvelope({
    signedEnvelopeXdr,
    networkPassphrase: input.networkPassphrase,
    expectedTransactionHash: input.review.transactionHash,
  });
  return transitionPrivatePendingAction(
    input.context,
    input.storageKey,
    state.revision,
    action.id,
    {
      from: 'reviewed',
      to: 'signed',
      signedEnvelopeXdr,
      expiresAtSeconds: input.review.expiresAt,
      updatedAt: now(),
    },
    input.storageDriver,
  );
}

export interface PrivateBalanceRpcSender {
  sendTransaction(transaction: Transaction): Promise<{
    status: 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR';
    hash: string;
  }>;
}

export interface PrivateBroadcastResult {
  state: PrivateBalanceDurableState;
  status: 'broadcast' | 'ambiguous';
  rpcStatus: NonNullable<PrivatePendingAction['latestRpcStatus']>;
}

export interface PrivateBalanceRpcLookup {
  getTransaction(hash: string): Promise<{
    status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND';
    txHash?: string;
    latestLedgerCloseTime?: number;
  }>;
}

export interface PrivateRecoveryResult {
  state: PrivateBalanceDurableState;
  outcome: PrivateActionRecoveryDecision;
  rpcStatus: PrivateCanonicalTransactionStatus;
}

/**
 * Resolves an ambiguous broadcast only after the caller has completed a fresh,
 * canonical archive scan. A failed RPC transaction alone is insufficient to
 * release notes; the action field and every real nullifier must also be absent.
 */
export async function recoverPrivateBalanceAction(input: {
  context: PrivateStorageContext;
  storageKey: Uint8Array;
  actionId: string;
  rpc: PrivateBalanceRpcLookup;
  scanCanonicalTranscript(): Promise<{ actionFields: string[]; nullifiers: string[] }>;
  storageDriver?: PrivateRecordDriver;
  now?: () => number;
}): Promise<PrivateRecoveryResult> {
  const initial = await loadPrivateBalanceState(input.context, input.storageKey, input.storageDriver);
  const action = initial?.pendingActions.find(candidate => candidate.id === input.actionId);
  if (!initial || !action || !['broadcast', 'ambiguous'].includes(action.status) || !action.transactionHash) {
    throw new Error('Private Balance action is not awaiting canonical recovery');
  }

  let rpcStatus: PrivateCanonicalTransactionStatus;
  let headCloseTimeSeconds: number | undefined;
  try {
    const response = await input.rpc.getTransaction(action.transactionHash);
    if (response.txHash && response.txHash.toLowerCase() !== action.transactionHash) {
      throw new Error('RPC returned a different private transaction hash');
    }
    rpcStatus = response.status;
    headCloseTimeSeconds = Number.isSafeInteger(response.latestLedgerCloseTime) &&
      (response.latestLedgerCloseTime as number) > 0
      ? response.latestLedgerCloseTime
      : undefined;
  } catch {
    rpcStatus = 'UNAVAILABLE';
  }
  const transcript = await input.scanCanonicalTranscript();
  if (
    !transcript.actionFields.every(value => HEX_32.test(value)) ||
    !transcript.nullifiers.every(value => HEX_32.test(value))
  ) {
    throw new Error('Private Balance canonical recovery transcript is invalid');
  }
  const decision = classifyPrivateActionRecovery(
    action,
    rpcStatus,
    transcript.actionFields,
    transcript.nullifiers,
    headCloseTimeSeconds,
  );

  const current = await loadPrivateBalanceState(input.context, input.storageKey, input.storageDriver);
  if (!current) throw new Error('Private Balance state disappeared during recovery');
  const currentAction = current.pendingActions.find(candidate => candidate.id === action.id);
  if (decision === 'confirmed') {
    if (currentAction) {
      throw new Error('Canonical scan found the action but did not reconcile encrypted state');
    }
    return { state: current, outcome: decision, rpcStatus };
  }
  if (!currentAction) throw new Error('Private Balance action changed during recovery');
  if (decision === 'release') {
    const state = await releasePrivatePendingAction(
      input.context,
      input.storageKey,
      current.revision,
      action.id,
      {
        reason: 'definitive-failure-nullifiers-absent',
        updatedAt: (input.now ?? Date.now)(),
      },
      input.storageDriver,
    );
    return { state, outcome: decision, rpcStatus };
  }
  const state = await recordPrivatePendingActionRpcStatus(
    input.context,
    input.storageKey,
    current.revision,
    action.id,
    rpcStatus,
    (input.now ?? Date.now)(),
    input.storageDriver,
  );
  return { state, outcome: decision, rpcStatus };
}

export async function broadcastPrivateBalanceAction(input: {
  context: PrivateStorageContext;
  storageKey: Uint8Array;
  expectedRevision: number;
  actionId: string;
  networkPassphrase: string;
  rpc: PrivateBalanceRpcSender;
  storageDriver?: PrivateRecordDriver;
  now?: () => number;
}): Promise<PrivateBroadcastResult> {
  const state = await loadPrivateBalanceState(input.context, input.storageKey, input.storageDriver);
  if (!state || state.revision !== input.expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  const action = state.pendingActions.find(candidate => candidate.id === input.actionId);
  if (!action || !['signed', 'broadcast', 'ambiguous'].includes(action.status)) {
    throw new Error('Private Balance action is not ready for broadcast');
  }
  if (!action.signedEnvelopeXdr || !action.transactionHash) {
    throw new Error('Private Balance signed recovery envelope is missing');
  }
  const signed = validateSignedPrivateBalanceEnvelope({
    signedEnvelopeXdr: action.signedEnvelopeXdr,
    networkPassphrase: input.networkPassphrase,
    expectedTransactionHash: action.transactionHash,
  });

  let rpcStatus: PrivateBroadcastResult['rpcStatus'];
  let status: PrivateBroadcastResult['status'];
  try {
    const response = await input.rpc.sendTransaction(signed.transaction);
    if (response.hash.toLowerCase() !== action.transactionHash) {
      throw new Error('RPC returned a different private transaction hash');
    }
    rpcStatus = response.status;
    status = response.status === 'PENDING' || response.status === 'DUPLICATE'
      ? 'broadcast'
      : 'ambiguous';
  } catch {
    rpcStatus = 'UNAVAILABLE';
    status = 'ambiguous';
  }

  const updatedAt = (input.now ?? Date.now)();
  try {
    const updated = await transitionPrivatePendingAction(
      input.context,
      input.storageKey,
      state.revision,
      action.id,
      {
        from: action.status as 'signed' | 'broadcast' | 'ambiguous',
        to: status,
        latestRpcStatus: rpcStatus,
        updatedAt,
      },
      input.storageDriver,
    );
    return { state: updated, status, rpcStatus };
  } catch (cause) {
    // The RPC request may already have reached Stellar. A concurrent canonical
    // sync can advance the encrypted-state revision while that request is in
    // flight, so never surface this as a safe pre-broadcast failure or release
    // its reserved notes. Reconcile against the latest durable journal instead.
    const current = await loadPrivateBalanceState(
      input.context,
      input.storageKey,
      input.storageDriver,
    );
    if (!current) throw cause;
    const currentAction = current.pendingActions.find(candidate => candidate.id === action.id);
    if (!currentAction) {
      // Canonical sync already observed and finalized this exact action.
      return { state: current, status, rpcStatus };
    }
    if (currentAction.status === 'signed') {
      const ambiguous = await transitionPrivatePendingAction(
        input.context,
        input.storageKey,
        current.revision,
        currentAction.id,
        {
          from: 'signed',
          to: 'ambiguous',
          latestRpcStatus: rpcStatus,
          updatedAt: Math.max(updatedAt, currentAction.updatedAt),
        },
        input.storageDriver,
      );
      return { state: ambiguous, status: 'ambiguous', rpcStatus };
    }
    if (currentAction.status === 'broadcast' || currentAction.status === 'ambiguous') {
      return {
        state: current,
        status: currentAction.status,
        rpcStatus: currentAction.latestRpcStatus ?? rpcStatus,
      };
    }
    throw cause;
  }
}

/**
 * Re-drives every persisted 'signed' action through broadcast at leader sync
 * start. A crash between the sign and broadcast commits leaves 'signed' with
 * zero recorded attempts even though the RPC send may already have fired, so
 * the only safe resolution is to resend: DUPLICATE lands it in 'broadcast'
 * and the canonical sync remains the sole authority on the outcome.
 */
export async function resumeSignedPrivateBalanceActions(input: {
  context: PrivateStorageContext;
  storageKey: Uint8Array;
  networkPassphrase: string;
  rpc: PrivateBalanceRpcSender;
  storageDriver?: PrivateRecordDriver;
  now?: () => number;
}): Promise<PrivateBalanceDurableState | null> {
  let state = await loadPrivateBalanceState(input.context, input.storageKey, input.storageDriver);
  if (!state) return null;
  const signedIds = state.pendingActions
    .filter(action => action.status === 'signed')
    .map(action => action.id);
  for (const actionId of signedIds) {
    const resumed = await broadcastPrivateBalanceAction({
      context: input.context,
      storageKey: input.storageKey,
      expectedRevision: state.revision,
      actionId,
      networkPassphrase: input.networkPassphrase,
      rpc: input.rpc,
      storageDriver: input.storageDriver,
      now: input.now,
    });
    state = resumed.state;
  }
  return state;
}
