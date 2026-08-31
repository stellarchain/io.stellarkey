import {
  StrKey,
  rpc as SorobanRpc,
} from '@stellar/stellar-sdk';
import {
  decodePrivateAddress,
  type ActionModel,
} from '@stellarkey/private-balance';
import { loadCircuitArtifacts, computeSha256 } from '../../../lib/private-balance-artifacts';
import type { PrivateBalanceManifest } from '../../../lib/private-balance-manifest';
import type { PrivateBalanceStorageScope } from '../../../lib/private-balance-bootstrap';
import { privateAddressFingerprint } from './receive';
import { parsePrivateAmount, selectPrivateNotes } from './coin-selection';
import { PrivateBalanceArchiveClient } from './archive-client';
import { loadPrivateBalanceCommitments } from './public-cache';
import {
  commitPrivateBuildReservation,
  loadPrivateBalanceState,
  releasePrivateBuildReservation,
  releasePrivatePendingAction,
  reservePrivateBuildReservation,
  transitionPrivatePendingAction,
  type PrivateRecordDriver,
} from './storage';
import { PrivateBalanceTransactionBuilder, type ContractProof } from './transaction-builder';
import { prepareReviewedPrivateBalanceTransaction } from './action-transaction';
import type { PrivateBalanceTransactionReview } from './transaction-review';
import type {
  PrivateBalanceDurableState,
  PrivatePendingAction,
  ShieldedNoteRecord,
} from './types';
import type { PrivateBalanceWorkerClient } from '../worker/client';

export const MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS = 10_000_000n;
const MAX_RESOURCE_FEE_STROOPS = MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS;
const ROOT_EXPIRY_SAFETY_LEDGERS = 12;
const HEX_PROOF_BYTES = (64 + 128 + 64) * 2;

export type PrivateActionDraft =
  | { kind: 'deposit'; amount: string }
  | { kind: 'transfer'; amount: string; recipientAddress: string; memo?: string }
  | { kind: 'withdraw'; amount: string; publicRecipient: string }
  | { kind: 'consolidate' };

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
  actionField: string;
  kind: PrivateActionDraft['kind'];
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
    super("Your previous payment is still confirming. It'll be ready in a moment.");
    this.name = 'PrivateActionInFlightError';
  }
}

/**
 * The verified local chain view went stale between syncs (root changed or
 * near expiry, or the commitment cache trails the head). A fresh sync
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
    assetContractId: StrKey.encodeContract(action.asset.payload),
    actionNonce: action.actionNonce,
    anchorRoot: action.anchorRoot,
    nullifiers: action.nullifiers,
    outputs: action.outputs.map(output => ({
      commitment: output.cm,
      recipientEnvelope: output.recipientEnvelope,
    })) as [
      { commitment: Uint8Array; recipientEnvelope: Uint8Array },
      { commitment: Uint8Array; recipientEnvelope: Uint8Array },
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

function consolidationSelection(notes: readonly ShieldedNoteRecord[]): {
  noteIds: string[];
  amount: bigint;
} {
  const available = unspentNotes(notes)
    .map(note => ({ note, value: BigInt(note.value) }))
    .sort((left, right) => left.value === right.value
      ? left.note.leafIndex - right.note.leafIndex
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
  if (pending && pending.broadcastAttempts === 0) {
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
  const prefix = manifest.networkPassphrase.startsWith('Public ') ? 'sks' : 'tks';
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
  assetContractId: string;
  assetCode: string;
  assetDecimals: number;
  draft: PrivateActionDraft;
  signal?: AbortSignal;
  onProgress?(stage: PrivateActionProgressStage): void;
  now?: () => number;
}): Promise<{ review: PreparedPrivateActionReview; state: PrivateBalanceDurableState }> {
  const now = input.now ?? Date.now;
  const actionId = globalThis.crypto?.randomUUID?.() ?? `private-${now().toString(36)}`;
  const createdAt = now();
  if (!StrKey.isValidContract(input.assetContractId)) {
    throw new Error('Private Balance asset contract is invalid.');
  }
  let reserved = false;
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
      throw new Error('Sync Private Balance before creating an action.');
    }
    if (state.pendingActions.some(action =>
      action.status === 'signed' || action.broadcastAttempts > 0)) {
      throw new PrivateActionInFlightError();
    }
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
    }

    let amount: bigint;
    let selectedNoteIds: string[] = [];
    let anchorExpiresAtLedger = 0;
    let recipientFingerprint: string | null = null;
    let localMemoHex: string | undefined;
    let publicRecipient: string | null = null;
    let intent: Parameters<PrivateBalanceWorkerClient['buildAction']>[1] | null = null;
    let commitments: Uint8Array[] = [];
    const selfRelayer = publicAddressPayload(input.accountPublicKey);

    if (input.draft.kind === 'deposit') {
      amount = depositAmount!;
      intent = {
        kind: 'deposit',
        assetContractId: input.assetContractId,
        publicValue: amount.toString(),
        depositSource: publicAddressPayload(input.accountPublicKey),
      };
    } else {
      if (!state.checkpoint || state.checkpoint.treeRoot !== hex(head.tree.currentRoot)) {
        throw new PrivateStaleChainStateError('Private Balance root changed. Sync and review again.');
      }
      const root = await archive.readKnownRoot(head.tree.currentRoot);
      if (root.validUntilLedger - root.latestLedger <= ROOT_EXPIRY_SAFETY_LEDGERS) {
        throw new PrivateStaleChainStateError('Private Balance root is too close to expiry. Sync and review again.');
      }
      anchorExpiresAtLedger = root.validUntilLedger;
      commitments = await loadPrivateBalanceCommitments(
        input.storageContext,
        input.storageDriver,
      );
      if (commitments.length !== head.tree.nextIndex) {
        throw new PrivateStaleChainStateError('Private Balance commitment cache is incomplete. Sync and review again.');
      }

      if (input.draft.kind === 'consolidate') {
        const selected = consolidationSelection(
          state.notes.filter(note => note.assetContractId === input.assetContractId),
        );
        amount = selected.amount;
        selectedNoteIds = selected.noteIds;
        recipientFingerprint = (await validatePrivateTransferRecipient(
          input.privateAddress,
          input.manifest,
        )).fingerprint;
        intent = {
          kind: 'transfer',
          assetContractId: input.assetContractId,
          amount: amount.toString(),
          recipientAddress: input.privateAddress,
          selectedNoteIds,
          anchorRoot: head.tree.currentRoot,
          anchorExpiresAtLedger,
          relayerFee: '0',
          relayer: selfRelayer,
        };
      } else {
        amount = parsePrivateAmount(input.draft.amount, input.assetDecimals);
        const selection = selectPrivateNotes(
          state.notes.filter(note => note.assetContractId === input.assetContractId),
          amount,
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
          assetContractId: input.assetContractId,
          amount: amount.toString(),
          recipientAddress: input.draft.recipientAddress,
          selectedNoteIds,
          anchorRoot: head.tree.currentRoot,
          anchorExpiresAtLedger,
          memo,
          relayerFee: '0',
          relayer: selfRelayer,
        };
      } else if (input.draft.kind === 'withdraw') {
        publicRecipient = input.draft.publicRecipient;
        intent = {
          kind: 'withdraw',
          assetContractId: input.assetContractId,
          publicValue: amount.toString(),
          publicRecipient: publicAddressPayload(publicRecipient),
          selectedNoteIds,
          anchorRoot: head.tree.currentRoot,
          anchorExpiresAtLedger,
          relayerFee: '0',
          relayer: selfRelayer,
        };
      }
    }

    if (!intent) throw new Error('Private Balance action intent is incomplete.');
    const availableNotes = privateActionNoteSnapshot(
      state.notes,
      selectedNoteIds,
      input.assetContractId,
    );
    progress('reserving-inputs');
    const reservationKind = input.draft.kind === 'consolidate' ? 'transfer' : input.draft.kind;
    let durable = await reservePrivateBuildReservation(
      input.storageContext,
      input.storageKey,
      state.revision,
      {
        id: actionId,
        kind: reservationKind,
        assetContractId: input.assetContractId,
        reservedNoteIds: selectedNoteIds,
        createdAt,
        updatedAt: createdAt,
      },
      input.storageDriver,
    );
    reserved = true;
    progress('building-outputs');
    const prepared = await input.worker.buildAction(
      actionId,
      intent,
      commitments,
      availableNotes,
    );
    if (prepared.reservationId !== actionId) {
      throw new Error('Private Balance worker returned a mismatched reservation.');
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
          action: { ...common, depositSource: input.accountPublicKey },
          proof,
        })
      : input.draft.kind === 'withdraw'
        ? builder.buildWithdrawOperation({
            action: {
              ...common,
              publicRecipient: publicRecipient!,
              relayerFee: prepared.action.relayerFee,
              relayer: input.accountPublicKey,
            },
            proof,
          })
        : builder.buildTransferOperation({
            action: {
              ...common,
              relayerFee: prepared.action.relayerFee,
              relayer: input.accountPublicKey,
            },
            proof,
          });
    progress('simulating');
    const endpoint = new URL(input.rpcUrl);
    const allowHttp = endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    const rpc = new SorobanRpc.Server(endpoint.toString(), { allowHttp });
    const transaction = await prepareReviewedPrivateBalanceTransaction({
      rpc,
      operation,
      manifest: input.manifest,
      assetContractId: input.assetContractId,
      source: input.accountPublicKey,
      classicFeeStroops: input.classicFeeStroops,
      maximumResourceFeeStroops: MAX_RESOURCE_FEE_STROOPS,
    });
    const proofBytes = Uint8Array.from(proved.sorobanProofHex.match(/../g) ?? [], value => Number.parseInt(value, 16));
    const proofHash = await computeSha256(proofBytes.buffer);
    const updatedAt = Math.max(createdAt, now());
    const pendingAction: PrivatePendingAction = {
      id: actionId,
      kind: reservationKind,
      assetContractId: input.assetContractId,
      status: 'prepared',
      reservedNoteIds: prepared.reservedNoteIds,
      actionField: prepared.actionFieldHex,
      nullifiers: prepared.action.nullifiers.map(hex),
      outputCommitments: prepared.action.outputs.map(output => hex(output.cm)),
      anchorRoot: hex(prepared.action.anchorRoot),
      anchorExpiresAtLedger: prepared.anchorExpiresAtLedger,
      proofHash,
      classicFeeCapStroops: transaction.review.classicFeeStroops.toString(),
      resourceFeeCapStroops: transaction.review.resourceFeeStroops.toString(),
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
    durable = await commitPrivateBuildReservation(
      input.storageContext,
      input.storageKey,
      durable.revision,
      actionId,
      pendingAction,
      input.storageDriver,
    );
    durable = await transitionPrivatePendingAction(
      input.storageContext,
      input.storageKey,
      durable.revision,
      actionId,
      {
        from: 'prepared',
        to: 'reviewed',
        transactionHash: transaction.review.transactionHash,
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
        actionField: prepared.actionFieldHex,
        kind: input.draft.kind,
        rpcUrl: input.rpcUrl,
        amountStroops: amount.toString(),
        inputValueStroops: prepared.inputValue,
        changeValueStroops: prepared.changeValue,
        recipientAddress: input.draft.kind === 'transfer' ? input.draft.recipientAddress : null,
        recipientFingerprint,
        memoHex: input.draft.kind === 'transfer' ? localMemoHex ?? null : null,
        publicRecipient,
        anchorExpiresAtLedger,
        latestLedger: head.latestLedger,
        transaction: transaction.review,
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
    throw error;
  }
}
