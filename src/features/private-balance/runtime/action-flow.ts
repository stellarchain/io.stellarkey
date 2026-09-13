import { comparePrivateIndices } from './indices';
import {
  StrKey,
  rpc as SorobanRpc,
} from '@stellar/stellar-sdk';
import {
  decodePrivateAddress,
  type ActionModel,
  type MerklePathWitness,
} from '@stellarkey/private-balance';
import { loadCircuitArtifacts, computeSha256 } from '../../../lib/private-balance-artifacts';
import type { PrivateBalanceManifest } from '../../../lib/private-balance-manifest';
import type { PrivateBalanceStorageScope } from '../../../lib/private-balance-bootstrap';
import { privateAddressFingerprint } from './receive';
import { parsePrivateAmount, selectPrivateNotes } from './coin-selection';
import { PrivateBalanceArchiveClient } from './archive-client';
import {
  clearPrivateBalanceMerkleCache,
  loadPrivateBalanceMerklePaths,
} from './merkle-cache';
import {
  commitPrivateBuildReservation,
  commitPrivateSpendRecovery,
  loadPrivateBalanceState,
  releasePrivateBuildReservation,
  releasePrivatePendingAction,
  reservePrivateBuildReservation,
  transitionPrivatePendingAction,
  type PrivateRecordDriver,
} from './storage';
import { PrivateBalanceTransactionBuilder, type ContractProof } from './transaction-builder';
import { prepareReviewedPrivateBalanceTransaction } from './action-transaction';
import { hasExposedPrivateSpend, PrivateProofExposedError } from './proof-exposure';
import { disclosePrivateProof, type AuthorizePrivateProofDisclosure } from './proof-disclosure';
import type { PrivateBalanceTransactionReview } from './transaction-review';
import type {
  PrivateBalanceDurableState,
  PrivatePendingAction,
  ShieldedNoteRecord,
} from './types';
import type { PrivateBalanceWorkerClient } from '../worker/client';
import { MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS, privateActionClassicFeeStroops, type PrivateFeePayer } from './fee-policy';
import { privateOutgoingHistoryMode, type PrivateOutgoingHistoryMode } from './outgoing-history';
import { assertPrivateRecoveryReplacement, selectPrivateRecoveryInputs } from './spend-recovery';
import { assertDirectPrivateSubmission } from './direct-submission';

export { MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS } from './fee-policy';
const MAX_RESOURCE_FEE_STROOPS = MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS;
const HEX_PROOF_BYTES = (64 + 128 + 64) * 2;

export type PrivateActionDraft = (
  | { kind: 'deposit'; amount: string }
  | { kind: 'transfer'; amount: string; recipientAddress: string; memo?: string }
  | { kind: 'withdraw'; amount: string; publicRecipient: string; selectedNoteIds?: string[]; requireFullInputExit?: boolean }
  | { kind: 'consolidate' }) & { feePayerAccountId?: string };

export type PrivateActionProgressStage =
  | 'checking-chain'
  | 'reserving-inputs'
  | 'building-outputs'
  | 'loading-artifacts'
  | 'proving-locally'
  | 'simulating'
  | 'ready-to-review';

export interface PreparedPrivateActionReview {
  id: string;
  recoveryOfActionId?: string;
  actionField: string;
  outgoingHistoryMode?: PrivateOutgoingHistoryMode;
  kind: PrivateActionDraft['kind'];
  assetContractId?: string;
  selectedNoteIds?: string[];
  recipientOutputCommitment?: string;
  rpcUrl: string;
  amountStroops: string;
  inputValueStroops: string;
  changeValueStroops: string;
  recipientAddress: string | null;
  recipientFingerprint: string | null;
  /** Journaled private memo (hex of the trimmed draft memo), transfers only. */
  memoHex: string | null;
  publicRecipient: string | null;
  anchorExpiresAtLedger: number;
  latestLedger: number;
  transaction: PrivateBalanceTransactionReview;
}

export function assertReviewedPrivateActionEndpoint(
  review: Pick<PreparedPrivateActionReview, 'rpcUrl'>,
  currentRpcUrl: string,
): void {
  let reviewed: string;
  let current: string;
  try {
    reviewed = new URL(review.rpcUrl).href;
    current = new URL(currentRpcUrl).href;
  } catch {
    throw new Error('Private Balance RPC endpoint is invalid. Create a new review.');
  }
  if (reviewed !== current) {
    throw new Error('Private Balance RPC endpoint changed. Create a new review before signing.');
  }
}

export class PrivateConsolidationRequiredError extends Error {
  public readonly actionCount: number;
  public readonly inputCount: number;

  constructor(actionCount: number, inputCount: number) {
    super(`Prepare Private Balance with ${actionCount} consolidation action${actionCount === 1 ? '' : 's'} first.`);
    this.name = 'PrivateConsolidationRequiredError';
    this.actionCount = actionCount;
    this.inputCount = inputCount;
  }
}

export class PrivateActionInFlightError extends Error {
  constructor() {
    super('A previous private payment is unresolved. Its inputs remain reserved until canonical reconciliation.');
    this.name = 'PrivateActionInFlightError';
  }
}

/**
 * The verified local chain view went stale between syncs (the root changed
 * or the commitment cache trails the head). A fresh sync
 * followed by one automatic re-prepare resolves it without user action.
 */
export class PrivateStaleChainStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivateStaleChainStateError';
  }
}

interface ActionRecordDriver extends PrivateRecordDriver {
  readPrefix(prefix: string): Promise<Map<string, string>>;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function proofFromHex(value: string): ContractProof {
  if (!new RegExp(`^[0-9a-f]{${HEX_PROOF_BYTES}}$`).test(value)) {
    throw new Error('Private Balance proof encoding is invalid');
  }
  const bytes = Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
  return {
    a: bytes.slice(0, 64),
    b: bytes.slice(64, 192),
    c: bytes.slice(192, 256),
  };
}

function commonContractAction(action: ActionModel) {
  return {
    actionNonce: action.actionNonce,
    anchorRoot: action.anchorRoot,
    nullifiers: action.nullifiers,
    outputs: action.outputs.map(output => ({
      commitment: output.cm,
      recipientEnvelope: output.recipientEnvelope,
      outgoingEnvelope: output.outgoingEnvelope,
    })) as [
      { commitment: Uint8Array; recipientEnvelope: Uint8Array; outgoingEnvelope: Uint8Array },
      { commitment: Uint8Array; recipientEnvelope: Uint8Array; outgoingEnvelope: Uint8Array },
      { commitment: Uint8Array; recipientEnvelope: Uint8Array; outgoingEnvelope: Uint8Array },
    ],
    publicValue: action.publicValue,
  };
}

function publicAddressPayload(address: string): { kind: number; payload: Uint8Array } {
  if (StrKey.isValidEd25519PublicKey(address)) {
    return { kind: 0, payload: new Uint8Array(StrKey.decodeEd25519PublicKey(address)) };
  }
  if (StrKey.isValidContract(address)) {
    return { kind: 1, payload: new Uint8Array(StrKey.decodeContract(address)) };
  }
  throw new Error('Public recipient is not a valid Stellar G or C address.');
}

function unspentNotes(notes: readonly ShieldedNoteRecord[]): ShieldedNoteRecord[] {
  return notes.filter(note => note.status === 'unspent');
}

export function privateActionNoteSnapshot(
  notes: readonly ShieldedNoteRecord[],
  selectedNoteIds: readonly string[],
  assetContractId?: string,
): ShieldedNoteRecord[] {
  const notesById = new Map(notes.map(note => [note.id, note]));
  return selectedNoteIds.map(noteId => {
    const note = notesById.get(noteId);
    if (!note || note.status !== 'unspent') {
      throw new Error('Selected private note is unavailable');
    }
    if (assetContractId !== undefined && note.assetContractId !== assetContractId) {
      throw new Error('Selected private note belongs to another asset');
    }
    return { ...note };
  });
}

function formatPublicAssetAmount(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function assertSufficientPublicDepositBalance(input: {
  available: bigint;
  requested: bigint;
  assetCode: string;
  assetDecimals: number;
}): void {
  if (input.available >= input.requested) return;
  const available = formatPublicAssetAmount(input.available, input.assetDecimals);
  const requested = formatPublicAssetAmount(input.requested, input.assetDecimals);
  throw new Error(
    `Insufficient public ${input.assetCode} balance. Available: ${available} ${input.assetCode}; requested: ${requested} ${input.assetCode}. Fund the public account first, then try again.`,
  );
}

export function assertSufficientStealthSweepBalance(input: {
  available: bigint;
  requested: bigint;
  minimumBalance: bigint;
  classicFee: bigint;
  maximumResourceFee: bigint;
}): void {
  if (
    input.available < 0n ||
    input.requested <= 0n ||
    input.minimumBalance < 0n ||
    input.classicFee <= 0n ||
    input.maximumResourceFee < 0n
  ) {
    throw new Error('Reusable private payment balance inputs are invalid.');
  }
  const required = input.requested + input.minimumBalance +
    input.classicFee + input.maximumResourceFee;
  if (input.available < required) {
    throw new Error(
      'The one-time account has insufficient balance to preserve its minimum reserve and the reviewed Private Balance fee budget. This receipt cannot be signed safely.',
    );
  }
}

function consolidationSelection(notes: readonly ShieldedNoteRecord[]): {
  noteIds: string[];
  amount: bigint;
} {
  const available = unspentNotes(notes)
    .map(note => ({ note, value: BigInt(note.value) }))
    .sort((left, right) => left.value === right.value
      ? comparePrivateIndices(left.note.leafIndex, right.note.leafIndex)
      : left.value > right.value ? -1 : 1);
  if (available.length < 2) {
    throw new Error('Private Balance does not need consolidation.');
  }
  const selected = available.slice(0, 2);
  return {
    noteIds: selected.map(item => item.note.id),
    amount: selected[0].value + selected[1].value,
  };
}

function abortError(): Error {
  return new DOMException('Private action cancelled.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function releaseFailedPreparation(input: {
  context: PrivateBalanceStorageScope;
  storageKey: Uint8Array;
  actionId: string;
  driver: PrivateRecordDriver;
  now: number;
}): Promise<void> {
  const state = await loadPrivateBalanceState(input.context, input.storageKey, input.driver);
  if (!state) return;
  const reservation = state.buildReservations.find(item => item.id === input.actionId);
  if (reservation) {
    await releasePrivateBuildReservation(
      input.context,
      input.storageKey,
      state.revision,
      input.actionId,
      input.now,
      input.driver,
    );
    return;
  }
  const pending = state.pendingActions.find(item => item.id === input.actionId);
  if (pending && pending.broadcastAttempts === 0 && !hasExposedPrivateSpend(pending)) {
    await releasePrivatePendingAction(
      input.context,
      input.storageKey,
      state.revision,
      input.actionId,
      { reason: 'pre-broadcast-rejection', updatedAt: input.now },
      input.driver,
    );
  }
}

export async function validatePrivateTransferRecipient(
  address: string,
  manifest: PrivateBalanceManifest,
): Promise<{ fingerprint: string }> {
  const prefix = manifest.networkPassphrase.startsWith('Public ') ? 'skpay_' : 'tskpay_';
  await decodePrivateAddress(address, prefix);
  return { fingerprint: privateAddressFingerprint(address) };
}

export async function preparePrivateBalanceActionFlow(input: {
  manifest: PrivateBalanceManifest;
  accountPublicKey: string;
  privateAddress: string;
  storageContext: PrivateBalanceStorageScope;
  storageKey: Uint8Array;
  storageDriver: ActionRecordDriver;
  worker: PrivateBalanceWorkerClient;
  rpcUrl: string;
  classicFeeStroops: bigint;
  feePayer?: PrivateFeePayer;
  depositSourceMinimumBalanceStroops?: bigint;
  assetContractId: string;
  assetIndex: number;
  registryAssets: ReadonlyArray<{ index: number; contractId: string }>;
  assetCode: string;
  assetDecimals: number;
  draft: PrivateActionDraft;
  signal?: AbortSignal;
  authorizeDisclosure?: AuthorizePrivateProofDisclosure;
  directChainApprovalId?: string;
  recoveryActionId?: string;
  assertContext?(): void;
  onProgress?(stage: PrivateActionProgressStage): void;
  now?: () => number;
}): Promise<{ review: PreparedPrivateActionReview; state: PrivateBalanceDurableState }> {
  assertDirectPrivateSubmission(input);
  assertDirectPrivateSubmission(input.draft);
  const feePayer = input.feePayer ? Object.freeze({ ...input.feePayer }) : undefined;
  const classicFeeCap = privateActionClassicFeeStroops(input.classicFeeStroops, feePayer);
  const now = input.now ?? Date.now;
  const actionId = globalThis.crypto?.randomUUID?.() ?? `private-${now().toString(36)}`;
  const createdAt = now();
  if (input.recoveryActionId && (input.draft.kind !== 'consolidate' || input.directChainApprovalId)) {
    throw new Error('Private recovery must be an explicit direct self-transfer.');
  }
  if (!StrKey.isValidContract(input.assetContractId)) {
    throw new Error('Private Balance asset contract is invalid.');
  }
  const manifestAsset = input.registryAssets[input.assetIndex];
  if (
    !manifestAsset
    || manifestAsset.index !== input.assetIndex
    || manifestAsset.contractId !== input.assetContractId
  ) {
    throw new Error('Private Balance asset does not match the authenticated registry metadata.');
  }
  let reserved = false;
  let exposedSpend = false;
  const progress = (stage: PrivateActionProgressStage) => {
    throwIfAborted(input.signal);
    input.onProgress?.(stage);
  };
  try {
    progress('checking-chain');
    const state = await loadPrivateBalanceState(
      input.storageContext,
      input.storageKey,
      input.storageDriver,
    );
    if (!state || state.account.syncStatus !== 'current') {
      throw new PrivateStaleChainStateError('Sync Private Balance before creating an action.');
    }
    // Snapshot once before any asynchronous building or proving. All lanes of
    // this proof and its later journal/review retain this same policy.
    const outgoingHistoryMode = privateOutgoingHistoryMode(state.outgoingHistoryMode);
    const recovery = input.recoveryActionId ? selectPrivateRecoveryInputs(state, input.recoveryActionId, input.assetContractId) : null;
    if (state.pendingActions.some(action =>
      action.id !== recovery?.pending.id && (hasExposedPrivateSpend(action) || action.status === 'signed' || action.broadcastAttempts > 0))) {
      throw new PrivateActionInFlightError();
    }
    throwIfAborted(input.signal);
    const depositAmount = input.draft.kind === 'deposit'
      ? parsePrivateAmount(input.draft.amount, input.assetDecimals)
      : null;
    const archive = new PrivateBalanceArchiveClient(input.rpcUrl, input.manifest);
    const [head, depositsPaused, publicAssetBalance] = await Promise.all([
      archive.readHead(),
      archive.readDepositsPaused(),
      depositAmount === null
        ? Promise.resolve(null)
        : archive.readAssetBalance(input.assetContractId, input.accountPublicKey).catch(() => {
            throw new Error(
              `Private Balance could not verify the public ${input.assetCode} balance. Check the RPC connection and try again.`,
            );
          }),
    ]);
    if (input.draft.kind === 'deposit' && depositsPaused) {
      throw new Error('Private Balance deposits are paused.');
    }
    if (depositAmount !== null && publicAssetBalance !== null) {
      assertSufficientPublicDepositBalance({
        available: publicAssetBalance,
        requested: depositAmount,
        assetCode: input.assetCode,
        assetDecimals: input.assetDecimals,
      });
      if (input.depositSourceMinimumBalanceStroops !== undefined) {
        assertSufficientStealthSweepBalance({
          available: publicAssetBalance,
          requested: depositAmount,
          minimumBalance: input.depositSourceMinimumBalanceStroops,
          classicFee: input.classicFeeStroops,
          maximumResourceFee: MAX_RESOURCE_FEE_STROOPS,
        });
      }
    }

    let amount: bigint;
    let selectedNoteIds: string[] = [];
    let anchorExpiresAtLedger = 0;
    let recipientFingerprint: string | null = null;
    let localMemoHex: string | undefined;
    let publicRecipient: string | null = null;
    let intent: Parameters<PrivateBalanceWorkerClient['buildAction']>[1] | null = null;
    let merklePaths: MerklePathWitness[] = [];
    let recoveryAddress: string | null = null;
    if (recovery) {
      const diversifier = crypto.getRandomValues(new Uint8Array(4));
      try {
        recoveryAddress = (await input.worker.deriveAddressForDiversifier(diversifier)).address;
        const decoded = await decodePrivateAddress(recoveryAddress, input.manifest.networkPassphrase.startsWith('Public ') ? 'skpay_' : 'tskpay_');
        if (hex(decoded.diversifier) !== hex(diversifier) || recoveryAddress === input.privateAddress) throw new Error('Private recovery worker returned a different self address.');
      } finally { diversifier.fill(0); }
    }
    if (input.draft.kind === 'deposit') {
      amount = depositAmount!;
      intent = {
        kind: 'deposit',
        assetIndex: input.assetIndex,
        assetContractId: input.assetContractId,
        publicValue: amount.toString(),
        depositSource: publicAddressPayload(input.accountPublicKey),
      };
    } else {
      if (!state.checkpoint || state.checkpoint.treeRoot !== hex(head.tree.currentRoot)) {
        throw new PrivateStaleChainStateError('Private Balance root changed. Sync and review again.');
      }
      anchorExpiresAtLedger = head.latestLedger + input.manifest.constants.rootWindowLedgers;
      if (anchorExpiresAtLedger > 0xffff_ffff) {
        throw new Error('Private Balance root refresh exceeds the supported ledger range.');
      }
      if (input.draft.kind === 'consolidate') {
        const selected = recovery ? { amount: recovery.amount, noteIds: recovery.pending.reservedNoteIds } : consolidationSelection(
          state.notes.filter(note => note.assetContractId === input.assetContractId),
        );
        amount = selected.amount;
        selectedNoteIds = selected.noteIds;
        recipientFingerprint = (await validatePrivateTransferRecipient(
          recoveryAddress ?? input.privateAddress,
          input.manifest,
        )).fingerprint;
        intent = {
          kind: 'transfer',
          assetIndex: input.assetIndex,
          assetContractId: input.assetContractId,
          amount: amount.toString(),
          recipientAddress: recoveryAddress ?? input.privateAddress,
          selectedNoteIds,
          anchorRoot: head.tree.currentRoot,
          anchorExpiresAtLedger,
        };
      } else {
        amount = parsePrivateAmount(input.draft.amount, input.assetDecimals, { aggregateWithdrawal: input.draft.kind === 'withdraw' });
        if (amount > (1n << 63n) - 1n) {
          const count = state.notes.filter(note => note.status === 'unspent' && note.assetContractId === input.assetContractId).length;
          throw new PrivateConsolidationRequiredError(Math.max(1, count - 1), count);
        }
        const plannedIds = input.draft.kind === 'withdraw' ? input.draft.selectedNoteIds : undefined;
        if (plannedIds && (plannedIds.length < 1 || plannedIds.length > 2 || new Set(plannedIds).size !== plannedIds.length)) {
          throw new Error('Private withdrawal inputs are invalid.');
        }
        const plannedInputValue = plannedIds
          ? privateActionNoteSnapshot(state.notes, plannedIds, input.assetContractId)
            .reduce((sum, note) => sum + BigInt(note.value), 0n)
          : null;
        if (plannedInputValue !== null && (plannedInputValue < amount || plannedInputValue > (1n << 63n) - 1n ||
          (input.draft.kind === 'withdraw' && input.draft.requireFullInputExit && plannedInputValue !== amount))) {
          throw new Error('Private withdrawal inputs no longer match the approved amount.');
        }
        const selection = plannedIds && plannedInputValue !== null
          ? { kind: 'selected' as const, noteIds: [...plannedIds], inputValue: plannedInputValue, changeValue: plannedInputValue - amount }
          : selectPrivateNotes(
            state.notes.filter(note => note.assetContractId === input.assetContractId),
            amount,
            { preferExact: input.draft.kind === 'withdraw' },
          );
        if (selection.kind === 'insufficient') {
          throw new Error('Private Balance is insufficient for this amount.');
        }
        if (selection.kind === 'consolidation-required') {
          throw new PrivateConsolidationRequiredError(selection.actionCount, selection.inputCount);
        }
        selectedNoteIds = selection.noteIds;
      }
      if (input.draft.kind === 'transfer') {
        recipientFingerprint = (await validatePrivateTransferRecipient(
          input.draft.recipientAddress,
          input.manifest,
        )).fingerprint;
        const memo = input.draft.memo?.trim()
          ? new TextEncoder().encode(input.draft.memo.trim())
          : undefined;
        if (memo && memo.length > 32) throw new Error('Private memo must not exceed 32 bytes.');
        localMemoHex = memo ? hex(memo) : undefined;
        intent = {
          kind: 'transfer',
          assetIndex: input.assetIndex,
          assetContractId: input.assetContractId,
          amount: amount.toString(),
          recipientAddress: input.draft.recipientAddress,
          selectedNoteIds,
          anchorRoot: head.tree.currentRoot,
          anchorExpiresAtLedger,
          memo,
        };
      } else if (input.draft.kind === 'withdraw') {
        publicRecipient = input.draft.publicRecipient;
        intent = {
          kind: 'withdraw',
          assetIndex: input.assetIndex,
          assetContractId: input.assetContractId,
          publicValue: amount.toString(),
          publicRecipient: publicAddressPayload(publicRecipient),
          selectedNoteIds,
          anchorRoot: head.tree.currentRoot,
          anchorExpiresAtLedger,
        };
      }
    }

    if (!intent) throw new Error('Private Balance action intent is incomplete.');
    intent = { ...intent, outgoingHistory: outgoingHistoryMode };
    const availableNotes = privateActionNoteSnapshot(
      recovery ? recovery.notes.map(note => ({ ...note, status: 'unspent' as const })) : state.notes,
      selectedNoteIds,
      input.assetContractId,
    );
    if (selectedNoteIds.length > 0) {
      const checkpoint = state.checkpoint;
      if (!checkpoint) {
        throw new PrivateStaleChainStateError('Private Balance Merkle checkpoint is unavailable. Sync and review again.');
      }
      try {
        merklePaths = await loadPrivateBalanceMerklePaths(
          input.storageContext,
          {
            deploymentBindingHash: checkpoint.deploymentBindingHash,
            cursor: checkpoint.lastActionIndex + 1n,
            transcriptHead: checkpoint.lastRecordHash,
            commitmentCount: checkpoint.nextLeafIndex,
            root: checkpoint.treeRoot,
            frontier: [...checkpoint.treeFrontier],
          },
          availableNotes.map(note => note.leafIndex),
          input.storageDriver,
        );
      } catch {
        await clearPrivateBalanceMerkleCache(
          input.storageContext,
          input.storageDriver,
        ).catch(() => undefined);
        throw new PrivateStaleChainStateError('Private Balance Merkle cache is invalid. Sync and review again.');
      }
    }
    progress('reserving-inputs');
    const reservationKind = input.draft.kind === 'consolidate' ? 'transfer' : input.draft.kind;
    let durable = recovery ? state : await reservePrivateBuildReservation(
      input.storageContext,
      input.storageKey,
      state.revision,
      {
        id: actionId,
        kind: reservationKind,
        proofExposure: 'local',
        outgoingHistoryMode,
        assetContractId: input.assetContractId,
        reservedNoteIds: selectedNoteIds,
        createdAt,
        updatedAt: createdAt,
      },
      input.storageDriver,
    );
    reserved = !recovery;
    progress('building-outputs');
    const prepared = await input.worker.buildAction(
      actionId,
      intent,
      merklePaths,
      availableNotes,
    );
    if (prepared.reservationId !== actionId) {
      throw new Error('Private Balance worker returned a mismatched reservation.');
    }
    if (recovery && (prepared.inputValue !== recovery.amount.toString() || prepared.changeValue !== '0' ||
      prepared.action.publicValue !== 0n || !prepared.recipientOutputCommitment ||
      !prepared.action.outputs.some(output => hex(output.cm) === prepared.recipientOutputCommitment))) {
      throw new Error('Private recovery worker returned a different self-transfer.');
    }
    if (input.draft.kind === 'withdraw' && input.draft.requireFullInputExit &&
      (prepared.action.kind !== 4 || prepared.changeValue !== '0' || prepared.inputValue !== amount.toString())) {
      throw new Error('Private withdrawal worker did not prepare the approved full-input exit.');
    }
    progress('loading-artifacts');
    const artifacts = await loadCircuitArtifacts(input.manifest);
    progress('proving-locally');
    const proved = await input.worker.generateProof(
      prepared.preparedActionId,
      artifacts.wasmBuffer,
      artifacts.zkeyBuffer,
      artifacts.verificationKey,
      { signal: input.signal },
    );
    const proof = proofFromHex(proved.sorobanProofHex);
    const builder = new PrivateBalanceTransactionBuilder(input.manifest);
    const common = commonContractAction(prepared.action);
    const operation = input.draft.kind === 'deposit'
      ? builder.buildDepositOperation({
          action: {
            ...common,
            assetIndex: input.assetIndex,
            depositSource: input.accountPublicKey,
          },
          proof,
        })
      : input.draft.kind === 'withdraw'
        ? (prepared.action.kind === 4
            ? builder.buildFullInputExitOperation.bind(builder)
            : builder.buildWithdrawOperation.bind(builder))({
            action: {
              ...common,
              assetIndex: input.assetIndex,
              publicRecipient: publicRecipient!,
            },
            proof,
          })
        : builder.buildTransferOperation({
            action: common,
            proof,
          });
    const proofBytes = Uint8Array.from(proved.sorobanProofHex.match(/../g) ?? [], value => Number.parseInt(value, 16));
    const proofHash = await computeSha256(proofBytes.buffer);
    const updatedAt = Math.max(createdAt, now());
    const pendingAction: PrivatePendingAction = {
      id: actionId,
      kind: reservationKind,
      assetIndex: input.assetIndex,
      assetContractId: input.assetContractId,
      status: 'prepared',
      submissionMode: 'direct',
      ...(feePayer ? { feePayer } : {}),
      proofExposure: 'shared',
      outgoingHistoryMode,
      ...(input.directChainApprovalId ? { directChainApprovalId: input.directChainApprovalId } : {}),
      reservedNoteIds: prepared.reservedNoteIds,
      actionField: prepared.actionFieldHex,
      nullifiers: prepared.action.nullifiers.map(hex),
      outputCommitments: prepared.action.outputs.map(output => hex(output.cm)),
      anchorRoot: hex(prepared.action.anchorRoot),
      anchorExpiresAtLedger: prepared.anchorExpiresAtLedger,
      proofHash,
      classicFeeCapStroops: classicFeeCap.toString(),
      resourceFeeCapStroops: MAX_RESOURCE_FEE_STROOPS.toString(),
      amountStroops: amount.toString(),
      changeValueStroops: prepared.changeValue,
      broadcastAttempts: 0,
      ...(input.draft.kind === 'transfer' && recipientFingerprint
        ? { recipientFingerprint }
        : {}),
      ...(input.draft.kind === 'transfer' && localMemoHex
        ? { memoHex: localMemoHex }
        : {}),
      createdAt,
      updatedAt,
    };
    if (recovery) assertPrivateRecoveryReplacement(recovery.pending, pendingAction, recovery.amount);
    const recipientAddress = recoveryAddress ?? (input.draft.kind === 'transfer' ? input.draft.recipientAddress : input.draft.kind === 'consolidate' ? input.privateAddress : null);
    const reviewKind = recovery ? 'transfer' : input.draft.kind;
    const transaction = await disclosePrivateProof({
      request: { kind: reviewKind, actionId, actionField: prepared.actionFieldHex, assetContractId: input.assetContractId,
        feePayer,
        ...(recovery ? { recoveryOfActionId: recovery.pending.id } : {}),
        amountStroops: amount.toString(), recipientAddress,
        publicRecipient, memoHex: localMemoHex ?? null, privateFeeAtomic: '0',
        maximumNetworkFeeStroops: (classicFeeCap + MAX_RESOURCE_FEE_STROOPS).toString(), submissionMode: 'direct' },
      signal: input.signal,
      authorize: input.authorizeDisclosure,
      assertContext: input.assertContext,
      commit: async () => {
        pendingAction.updatedAt = Math.max(createdAt, now());
        durable = recovery
          ? await commitPrivateSpendRecovery(input.storageContext, input.storageKey, durable.revision, recovery.pending.id, pendingAction, recoveryAddress!, input.storageDriver)
          : await commitPrivateBuildReservation(input.storageContext, input.storageKey, durable.revision, actionId, pendingAction, input.storageDriver);
        exposedSpend = hasExposedPrivateSpend(pendingAction);
      },
      disclose: async () => {
        progress('simulating');
        const endpoint = new URL(input.rpcUrl);
        const allowHttp = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
        const rpc = new SorobanRpc.Server(endpoint.toString(), { allowHttp });
        return prepareReviewedPrivateBalanceTransaction({ rpc, submissionMode: 'direct',
          signal: input.signal, operation, manifest: { networkPassphrase: input.manifest.networkPassphrase, poolContractId: input.manifest.poolContractId, assets: input.registryAssets },
          source: input.accountPublicKey, classicFeeStroops: input.classicFeeStroops, maximumResourceFeeStroops: MAX_RESOURCE_FEE_STROOPS });
      },
    });
    const transactionReview: PrivateBalanceTransactionReview = {
      ...transaction.review,
      ...(feePayer ? { feePayer } : {}),
      classicFeeStroops: privateActionClassicFeeStroops(transaction.review.classicFeeStroops, feePayer),
    };
    durable = await transitionPrivatePendingAction(
      input.storageContext,
      input.storageKey,
      durable.revision,
      actionId,
      {
        from: 'prepared',
        to: 'reviewed',
        transactionHash: transaction.review.transactionHash,
        classicFeeCapStroops: transactionReview.classicFeeStroops.toString(),
        resourceFeeCapStroops: transaction.review.resourceFeeStroops.toString(),
        updatedAt: Math.max(updatedAt, now()),
      },
      input.storageDriver,
    );
    progress('ready-to-review');
    reserved = false;
    return {
      state: durable,
      review: {
        id: actionId,
        ...(recovery ? { recoveryOfActionId: recovery.pending.id } : {}),
        actionField: prepared.actionFieldHex,
        outgoingHistoryMode,
        kind: reviewKind,
        assetContractId: input.assetContractId,
        selectedNoteIds: [...selectedNoteIds],
        recipientOutputCommitment: prepared.recipientOutputCommitment,
        rpcUrl: input.rpcUrl,
        amountStroops: amount.toString(),
        inputValueStroops: prepared.inputValue,
        changeValueStroops: prepared.changeValue,
        recipientAddress,
        recipientFingerprint,
        memoHex: input.draft.kind === 'transfer' ? localMemoHex ?? null : null,
        publicRecipient,
        anchorExpiresAtLedger,
        latestLedger: head.latestLedger,
        transaction: transactionReview,
      },
    };
  } catch (error) {
    if (reserved) {
      try {
        await releaseFailedPreparation({
          context: input.storageContext,
          storageKey: input.storageKey,
          actionId,
          driver: input.storageDriver,
          now: Math.max(createdAt, now()),
        });
      } catch (releaseError) {
        // The reservation stays journaled until the leader sync's TTL cleanup
        // releases it. Surface both failures; the preparation message leads.
        throw new AggregateError(
          [error, releaseError],
          error instanceof Error ? error.message : 'Private Balance preparation failed.',
        );
      }
    }
    if (exposedSpend && !input.signal?.aborted) throw new PrivateProofExposedError(error);
    throw error;
  }
}
