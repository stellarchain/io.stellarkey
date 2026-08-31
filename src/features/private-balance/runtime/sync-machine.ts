import {
  computeGenesisRecordHash,
  type ArchiveRecordModel,
  type MerkleTree,
} from '@stellarkey/private-balance';
import { MAX_ARCHIVE_RECORD_BATCH, type ArchiveHeadState } from './archive-client';
import {
  recordVerifiedPrivateBalanceCommitments,
  type PrivateBalancePublicCacheDriver,
} from './public-cache';
import {
  commitPrivateBalanceState,
  loadPrivateBalanceState,
  type PrivateRecordDriver,
  type PrivateStorageContext,
} from './storage';
import type {
  PrivateBalanceDurableState,
  PrivatePendingAction,
  ShieldedActivityRecord,
  ShieldedNoteRecord,
} from './types';

interface ArchiveReader {
  readHead(): Promise<ArchiveHeadState>;
  readRecords(startActionIndex: number, count: number): Promise<ArchiveRecordModel[]>;
  readLedgerCloseTimes?(sequences: readonly number[]): Promise<Record<number, number>>;
}

interface ScanWorker {
  scanPage(input: {
    records: ArchiveRecordModel[];
    expectedPriorRecordHash: Uint8Array;
    initialTree?: MerkleTree;
    existingNotes?: ShieldedNoteRecord[];
    ledgerClosedAt?: Readonly<Record<number, number>>;
  }): Promise<{
    notes: ShieldedNoteRecord[];
    activities: ShieldedActivityRecord[];
    tree: MerkleTree;
    lastRecordHash: Uint8Array;
    spentNullifierHexes: string[];
    nullifiersByCommitment: Map<string, string>;
  }>;
}

export interface SyncPrivateBalanceProgress {
  actionIndex: number;
  actionCount: number;
  firstActionIndex: number;
}

export interface SyncPrivateBalanceInput {
  archive: ArchiveReader;
  worker: ScanWorker;
  contextHash: Uint8Array;
  deploymentBindingHash: Uint8Array;
  manifestHash: string;
  storageContext: PrivateStorageContext;
  storageKey: Uint8Array;
  storageDriver?: PrivateRecordDriver;
  publicCacheDriver?: PrivateBalancePublicCacheDriver;
  onProgress?(progress: SyncPrivateBalanceProgress): void;
  now?: () => number;
}

export const MAX_CONTRACT_ADVANCE_RESUMES = 3;

export class PrivateContractAdvancedDuringSyncError extends Error {
  constructor() {
    super('Private Balance contract advanced during sync; retry from the verified checkpoint');
    this.name = 'PrivateContractAdvancedDuringSyncError';
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hex32(value: string, name: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be 32-byte lowercase hex`);
  return Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function reconstructTree(state: PrivateBalanceDurableState): MerkleTree | undefined {
  const checkpoint = state.checkpoint;
  if (!checkpoint) return undefined;
  return {
    nextIndex: (checkpoint.lastActionIndex + 1) * 2,
    frontier: checkpoint.treeFrontier.map((node, index) =>
      hex32(node, `Checkpoint tree frontier ${index}`)),
    currentRoot: hex32(checkpoint.treeRoot, 'Checkpoint tree root'),
  };
}

function mergeActivities(
  current: ShieldedActivityRecord[],
  additions: ShieldedActivityRecord[],
): ShieldedActivityRecord[] {
  const byId = new Map(current.map(activity => [activity.id, activity]));
  for (const activity of additions) byId.set(activity.id, activity);
  return [...byId.values()].sort((left, right) => left.actionIndex - right.actionIndex);
}

export function attachLocalActivityMetadata(
  activities: ShieldedActivityRecord[],
  pendingActions: Array<Pick<
    PrivatePendingAction,
    'actionField' | 'transactionHash' | 'recipientFingerprint' | 'memoHex'
  >>,
): ShieldedActivityRecord[] {
  const journalByAction = new Map(pendingActions.map(action => [action.actionField, action]));
  return activities.map(activity => {
    const journal = journalByAction.get(activity.id);
    if (!journal) return activity;
    return {
      ...activity,
      ...(journal.transactionHash ? { transactionHash: journal.transactionHash } : {}),
      ...(activity.actionKind === 'transfer' && journal.recipientFingerprint
        ? { recipientFingerprint: journal.recipientFingerprint }
        : {}),
      ...(activity.actionKind === 'transfer' && journal.memoHex
        ? { memoHex: journal.memoHex }
        : {}),
    };
  });
}

function reconcilePendingActions(
  pendingActions: PrivatePendingAction[],
  notes: ShieldedNoteRecord[],
  activities: ShieldedActivityRecord[],
): { pendingActions: PrivatePendingAction[]; notes: ShieldedNoteRecord[] } {
  const notesById = new Map(notes.map(note => [note.id, note]));
  const verifiedActionFields = new Set(activities.map(activity => activity.id));
  const releasedNoteIds = new Set<string>();
  const reconciled = pendingActions.filter(action => {
    if (verifiedActionFields.has(action.actionField)) return false;
    if (action.reservedNoteIds.length === 0) return true;
    const reserved = action.reservedNoteIds.map(noteId => {
      const note = notesById.get(noteId);
      if (!note) throw new Error('Pending Private Balance action references a missing note');
      return note.status === 'reserved';
    });
    if (reserved.every(Boolean)) return true;
    // At least one input nullifier was consumed by a foreign action, so this
    // action can never land; release its surviving reserved inputs with it.
    for (const [index, noteId] of action.reservedNoteIds.entries()) {
      if (reserved[index]) releasedNoteIds.add(noteId);
    }
    return false;
  });
  return {
    pendingActions: reconciled,
    notes: releasedNoteIds.size === 0
      ? notes
      : notes.map(note => releasedNoteIds.has(note.id)
        ? { ...note, status: 'unspent' as const, reservedAt: undefined }
        : note),
  };
}

function sameHead(left: ArchiveHeadState, right: ArchiveHeadState): boolean {
  return (
    right.latestLedger >= left.latestLedger &&
    right.meta.actionCount === left.meta.actionCount &&
    equalBytes(right.meta.transcriptHead, left.meta.transcriptHead) &&
    right.tree.nextIndex === left.tree.nextIndex &&
    equalBytes(right.tree.currentRoot, left.tree.currentRoot)
  );
}

export interface IncomingPrivateTransferSummary {
  count: number;
  totalAmountStroops: string;
}

/**
 * Collapses the inbound private transfers verified beyond the previous
 * checkpoint into one event. Consolidations classify as 'internal' and own
 * deposits as 'deposit', so neither can appear here.
 */
export function diffIncomingPrivateTransfers(
  previousLastVerifiedActionIndex: number,
  activities: readonly ShieldedActivityRecord[],
): IncomingPrivateTransferSummary {
  if (!Number.isSafeInteger(previousLastVerifiedActionIndex) || previousLastVerifiedActionIndex < 0) {
    throw new Error('Private Balance incoming diff index is invalid');
  }
  let count = 0;
  let totalAmountStroops = 0n;
  for (const activity of activities) {
    if (
      activity.actionIndex <= previousLastVerifiedActionIndex ||
      activity.actionKind !== 'transfer' ||
      activity.direction !== 'inflow'
    ) {
      continue;
    }
    count += 1;
    totalAmountStroops += BigInt(activity.amount);
  }
  return { count, totalAmountStroops: totalAmountStroops.toString() };
}

/**
 * Runs the canonical sync, resuming from the committed checkpoint a bounded
 * number of times when the contract advances mid-scan instead of surfacing
 * the transient failure.
 */
export async function syncPrivateBalance(
  input: SyncPrivateBalanceInput,
): Promise<PrivateBalanceDurableState> {
  for (let resumes = 0; ; resumes += 1) {
    try {
      return await syncPrivateBalanceOnce(input);
    } catch (error) {
      if (
        !(error instanceof PrivateContractAdvancedDuringSyncError) ||
        resumes >= MAX_CONTRACT_ADVANCE_RESUMES
      ) {
        throw error;
      }
    }
  }
}

async function syncPrivateBalanceOnce(
  input: SyncPrivateBalanceInput,
): Promise<PrivateBalanceDurableState> {
  if (input.contextHash.length !== 32 || input.deploymentBindingHash.length !== 32) {
    throw new Error('Private Balance sync context is invalid');
  }
  hex32(input.manifestHash, 'Manifest hash');
  const now = input.now ?? Date.now;
  let state = await loadPrivateBalanceState(
    input.storageContext,
    input.storageKey,
    input.storageDriver,
  );
  if (!state) throw new Error('Private Balance has not been configured for this account');
  if (
    state.checkpoint &&
    state.checkpoint.deploymentBindingHash !== hex(input.deploymentBindingHash)
  ) {
    throw new Error('Private Balance checkpoint deployment binding changed');
  }

  const initialHead = await input.archive.readHead();
  if (state.checkpoint && initialHead.latestLedger < state.checkpoint.latestLedger) {
    throw new Error('Private Balance RPC endpoint moved behind the verified checkpoint');
  }
  if (
    state.checkpoint &&
    state.checkpoint.lastActionIndex >= initialHead.meta.actionCount
  ) {
    throw new Error('Private Balance checkpoint is ahead of the contract head');
  }
  if (!state.checkpoint && initialHead.meta.actionCount === 0 && state.notes.length > 0) {
    throw new Error('Private Balance notes exist without a chain checkpoint');
  }

  let tree = reconstructTree(state);
  let nextActionIndex = state.checkpoint ? state.checkpoint.lastActionIndex + 1 : 0;
  let expectedPriorRecordHash = state.checkpoint
    ? hex32(state.checkpoint.lastRecordHash, 'Checkpoint record hash')
    : computeGenesisRecordHash(input.contextHash, input.deploymentBindingHash);
  let notes = state.notes.map(note => ({ ...note }));
  let activities = state.activities.map(activity => ({ ...activity }));
  const firstActionIndex = nextActionIndex;

  while (nextActionIndex < initialHead.meta.actionCount) {
    const batchCount = Math.min(
      MAX_ARCHIVE_RECORD_BATCH,
      initialHead.meta.actionCount - nextActionIndex,
    );
    input.onProgress?.({
      actionIndex: nextActionIndex,
      actionCount: initialHead.meta.actionCount,
      firstActionIndex,
    });
    const records = await input.archive.readRecords(nextActionIndex, batchCount);
    if (records.length !== batchCount) {
      throw new Error('Private Balance archive returned an incomplete record batch');
    }
    for (let offset = 0; offset < records.length; offset += 1) {
      if (records[offset].actionIndex !== nextActionIndex + offset) {
        throw new Error('Private Balance archive records are not sequential');
      }
    }

    let ledgerClosedAt: Record<number, number> | undefined;
    if (input.archive.readLedgerCloseTimes) {
      try {
        // RPC close times are unix seconds; note and activity timestamps are
        // stored in milliseconds. Sequences outside retention stay absent, so
        // the scanner keeps its zero-timestamp fallback for them.
        const closeTimes = await input.archive.readLedgerCloseTimes(
          records.map(record => record.ledgerSequence),
        );
        ledgerClosedAt = Object.fromEntries(
          Object.entries(closeTimes)
            .filter(([, seconds]) => Number.isSafeInteger(seconds) && seconds > 0)
            .map(([sequence, seconds]) => [sequence, seconds * 1000]),
        );
      } catch {
        // Timestamps are cosmetic; a failed lookup never fails the sync.
      }
    }
    const scanned = await input.worker.scanPage({
      records,
      expectedPriorRecordHash,
      initialTree: tree,
      existingNotes: notes,
      ...(ledgerClosedAt ? { ledgerClosedAt } : {}),
    });
    const lastRecord = records[records.length - 1];
    if (!equalBytes(scanned.tree.currentRoot, lastRecord.treeRootAfter)) {
      throw new Error('Private Balance worker returned an inconsistent archive result');
    }
    await recordVerifiedPrivateBalanceCommitments(
      input.storageContext,
      records[0].startingLeafIndex,
      records.flatMap(record => record.outputs.map(output => output.cm)),
      input.publicCacheDriver,
    );
    tree = scanned.tree;
    notes = scanned.notes;
    activities = mergeActivities(
      activities,
      attachLocalActivityMetadata(scanned.activities, state.pendingActions),
    );
    expectedPriorRecordHash = scanned.lastRecordHash;
    nextActionIndex = lastRecord.actionIndex + 1;

    const reconciled = reconcilePendingActions(state.pendingActions, notes, activities);
    const pendingActions = reconciled.pendingActions;
    notes = reconciled.notes;
    const checkpointTime = now();
    const nextState: PrivateBalanceDurableState = {
      ...state,
      revision: state.revision + 1,
      lastValidatedManifestHash: input.manifestHash,
      account: {
        setupState: 'ready',
        syncStatus: 'syncing',
        lastVerifiedActionIndex: lastRecord.actionIndex,
        updatedAt: checkpointTime,
      },
      notes,
      activities,
      checkpoint: {
        lastActionIndex: lastRecord.actionIndex,
        lastRecordHash: hex(scanned.lastRecordHash),
        treeRoot: hex(scanned.tree.currentRoot),
        treeFrontier: scanned.tree.frontier.map(hex),
        deploymentBindingHash: hex(input.deploymentBindingHash),
        manifestHash: input.manifestHash,
        latestLedger: initialHead.latestLedger,
        updatedAt: checkpointTime,
      },
      pendingActions,
    };
    await commitPrivateBalanceState(
      input.storageContext,
      input.storageKey,
      nextState,
      state.revision,
      input.storageDriver,
    );
    state = nextState;
  }

  const finalHead = await input.archive.readHead();
  if (!sameHead(initialHead, finalHead)) {
    throw new PrivateContractAdvancedDuringSyncError();
  }
  if (initialHead.meta.actionCount > 0) {
    if (
      !state.checkpoint ||
      state.checkpoint.lastActionIndex !== initialHead.meta.actionCount - 1 ||
      !equalBytes(expectedPriorRecordHash, initialHead.meta.transcriptHead) ||
      !tree ||
      tree.nextIndex !== initialHead.tree.nextIndex ||
      !equalBytes(tree.currentRoot, initialHead.tree.currentRoot)
    ) {
      throw new Error('Private Balance reconstructed state does not match the contract head');
    }
  }

  const completedAt = now();
  const currentState: PrivateBalanceDurableState = {
    ...state,
    revision: state.revision + 1,
    lastValidatedManifestHash: input.manifestHash,
    account: {
      setupState: 'ready',
      syncStatus: 'current',
      lastVerifiedActionIndex: initialHead.meta.actionCount === 0
        ? null
        : initialHead.meta.actionCount - 1,
      updatedAt: completedAt,
    },
    checkpoint: state.checkpoint
      ? {
          ...state.checkpoint,
          manifestHash: input.manifestHash,
          latestLedger: finalHead.latestLedger,
          updatedAt: completedAt,
        }
      : null,
  };
  await commitPrivateBalanceState(
    input.storageContext,
    input.storageKey,
    currentState,
    state.revision,
    input.storageDriver,
  );
  return currentState;
}
