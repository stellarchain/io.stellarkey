import {
  ActionKind,
  appendFrontier,
  computeActionField,
  computeAssetField,
  computeNullifier,
  computeRecordHash,
  createEmptyTree,
  openRecipientEnvelope,
  refreshTreeRoot,
  type ActionModel,
  type ArchiveRecordModel,
  type FullViewingKey,
  type MerkleTree,
} from '@stellarkey/private-balance';
import { StrKey } from '@stellar/stellar-sdk';
import type { ShieldedActivityRecord, ShieldedNoteRecord } from './types';

export interface ArchiveScanContext {
  protocolVersion: number;
  networkId: Uint8Array;
  realmId: Uint8Array;
  poolId: Uint8Array;
  contextHash: Uint8Array;
  contextField: Uint8Array;
  accountAddress?: { kind: number; payload: Uint8Array };
}

export interface ScanArchiveRecordsInput {
  records: ArchiveRecordModel[];
  viewingKey: FullViewingKey;
  context: ArchiveScanContext;
  expectedPriorRecordHash: Uint8Array;
  initialTree?: MerkleTree;
  existingNotes?: ShieldedNoteRecord[];
  ledgerClosedAt?: Readonly<Record<number, number>>;
}

export interface ScanArchiveRecordsResult {
  notes: ShieldedNoteRecord[];
  activities: ShieldedActivityRecord[];
  tree: MerkleTree;
  lastRecordHash: Uint8Array;
  spentNullifierHexes: string[];
  nullifiersByCommitment: Map<string, string>;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function decodeHex32(value: string, name: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be 32-byte lowercase hex`);
  return Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every(byte => byte === 0);
}

function cloneTree(tree: MerkleTree): MerkleTree {
  return {
    nextIndex: tree.nextIndex,
    frontier: tree.frontier.map(node => node.slice()),
    currentRoot: tree.currentRoot.slice(),
  };
}

function cloneNote(note: ShieldedNoteRecord): ShieldedNoteRecord {
  return { ...note };
}

function actionFromRecord(record: ArchiveRecordModel, protocolVersion: number): ActionModel {
  return {
    protocolVersion,
    kind: record.actionKind as ActionKind,
    asset: record.asset,
    actionNonce: record.actionNonce,
    anchorRoot: record.anchorRoot,
    nullifiers: record.nullifiers,
    outputs: record.outputs,
    publicValue: record.publicValue,
    depositSource: record.depositSource,
    publicRecipient: record.publicRecipient,
    relayerFee: record.relayerFee,
    relayer: record.relayer,
  };
}

function addressMatches(
  left: { kind: number; payload: Uint8Array } | undefined,
  right: { kind: number; payload: Uint8Array } | undefined,
): boolean {
  return Boolean(left && right && left.kind === right.kind && equalBytes(left.payload, right.payload));
}

function classifyActivity(
  record: ArchiveRecordModel,
  ownedInputValue: bigint,
  ownedOutputValue: bigint,
  context: ArchiveScanContext,
): Pick<ShieldedActivityRecord, 'actionKind' | 'amount' | 'direction'> | null {
  if (ownedInputValue === 0n && ownedOutputValue === 0n) return null;

  let direction: ShieldedActivityRecord['direction'];
  let amount: bigint;
  if (ownedOutputValue > ownedInputValue) {
    direction = 'inflow';
    amount = ownedOutputValue - ownedInputValue;
  } else if (ownedInputValue > ownedOutputValue) {
    direction = 'outflow';
    amount = ownedInputValue - ownedOutputValue;
  } else {
    direction = 'internal';
    amount = 0n;
  }

  let actionKind: ShieldedActivityRecord['actionKind'];
  if (record.actionKind === ActionKind.Withdraw) {
    actionKind = 'withdraw';
  } else if (
    record.actionKind === ActionKind.Deposit &&
    addressMatches(record.depositSource, context.accountAddress)
  ) {
    actionKind = 'deposit';
  } else {
    actionKind = 'transfer';
  }
  return { actionKind, amount: amount.toString(), direction };
}

export async function scanArchiveRecords(
  input: ScanArchiveRecordsInput,
): Promise<ScanArchiveRecordsResult> {
  if (input.expectedPriorRecordHash.length !== 32) {
    throw new Error('Expected prior record hash must be 32 bytes');
  }

  const tree = input.initialTree ? cloneTree(input.initialTree) : await createEmptyTree();
  const notes = (input.existingNotes ?? []).map(cloneNote);
  const notesByCommitment = new Map(notes.map(note => [note.commitment, note]));
  const nullifiersByCommitment = new Map<string, string>();
  const notesByNullifier = new Map<string, ShieldedNoteRecord>();
  const activities: ShieldedActivityRecord[] = [];
  const spentNullifierHexes: string[] = [];
  let expectedPriorRecordHash = input.expectedPriorRecordHash.slice();
  let expectedFinalTreeRoot: Uint8Array | undefined;

  for (const note of notes) {
    const nullifier = computeNullifier(
      input.context.contextField,
      input.viewingKey.nk,
      decodeHex32(note.rho, 'Note rho'),
      BigInt(note.leafIndex),
      decodeHex32(note.commitment, 'Note commitment'),
    );
    const nullifierHex = hex(nullifier);
    nullifiersByCommitment.set(note.commitment, nullifierHex);
    notesByNullifier.set(nullifierHex, note);
  }

  for (const record of input.records) {
    if (record.actionIndex * 2 !== record.startingLeafIndex) {
      throw new Error('Archive action sequence mismatch');
    }
    if (record.startingLeafIndex !== tree.nextIndex) {
      throw new Error('Archive leaf position mismatch');
    }
    const expectedActionField = computeActionField(
      actionFromRecord(record, input.context.protocolVersion),
      input.context.networkId,
      input.context.realmId,
      input.context.poolId,
    );
    const assetField = computeAssetField(record.asset);
    const assetContractId = StrKey.encodeContract(record.asset.payload);
    const recordHash = computeRecordHash(
      record,
      input.context.protocolVersion,
      expectedPriorRecordHash,
    );

    let ownedInputValue = 0n;
    for (const nullifier of record.nullifiers) {
      if (isZero(nullifier)) continue;
      const nullifierHex = hex(nullifier);
      const spentNote = notesByNullifier.get(nullifierHex);
      if (!spentNote) continue;
      if (spentNote.status === 'spent') throw new Error('Owned note was spent more than once');
      ownedInputValue += BigInt(spentNote.value);
      spentNote.status = 'spent';
      spentNote.spentInActionIndex = record.actionIndex;
      delete spentNote.reservedAt;
      spentNullifierHexes.push(nullifierHex);
    }

    let ownedOutputValue = 0n;
    let receivedMemoHex: string | undefined;
    for (const [outputIndex, output] of record.outputs.entries()) {
      if (isZero(output.cm)) continue;
      const note = await openRecipientEnvelope(
        input.viewingKey.hpkePrivateKey,
        output.recipientEnvelope,
        input.context.contextHash,
        input.context.contextField,
        assetField,
        output.cm,
        record.actionNonce,
        outputIndex,
        input.viewingKey.baseOwnerCommitment,
      );
      if (!note) continue;

      const commitment = hex(output.cm);
      if (notesByCommitment.has(commitment)) throw new Error('Duplicate owned note commitment');
      const memoHex = hex(note.memo.slice(0, note.memoLength));
      const recovered: ShieldedNoteRecord = {
        id: commitment,
        commitment,
        value: note.value.toString(),
        assetContractId,
        diversifier: hex(note.diversifier),
        ownerCommitment: hex(note.ownerCommitment),
        leafIndex: record.startingLeafIndex + outputIndex,
        actionIndex: record.actionIndex,
        rho: hex(note.rho),
        memoHex,
        senderFingerprintHex: '',
        status: 'unspent',
        createdAt: input.ledgerClosedAt?.[record.ledgerSequence] ?? 0,
      };
      const nullifier = computeNullifier(
        input.context.contextField,
        input.viewingKey.nk,
        note.rho,
        BigInt(recovered.leafIndex),
        output.cm,
      );
      const nullifierHex = hex(nullifier);
      notes.push(recovered);
      notesByCommitment.set(commitment, recovered);
      notesByNullifier.set(nullifierHex, recovered);
      nullifiersByCommitment.set(commitment, nullifierHex);
      ownedOutputValue += note.value;
      if (memoHex) receivedMemoHex ??= memoHex;
    }

    for (const output of record.outputs) await appendFrontier(tree, output.cm);
    expectedFinalTreeRoot = record.treeRootAfter;
    const classification = classifyActivity(record, ownedInputValue, ownedOutputValue, input.context);
    if (classification) {
      activities.push({
        id: hex(expectedActionField),
        actionIndex: record.actionIndex,
        assetContractId,
        ...classification,
        timestamp: input.ledgerClosedAt?.[record.ledgerSequence] ?? 0,
        nullifiers: record.nullifiers.filter(nullifier => !isZero(nullifier)).map(hex),
        outputCommitments: record.outputs.filter(output => !isZero(output.cm)).map(output => hex(output.cm)),
        ...(classification.actionKind === 'transfer' &&
          classification.direction === 'inflow' &&
          receivedMemoHex
          ? { memoHex: receivedMemoHex }
          : {}),
      });
    }
    expectedPriorRecordHash = Uint8Array.from(recordHash);
  }

  if (expectedFinalTreeRoot) {
    const recoveredRoot = await refreshTreeRoot(tree);
    if (!equalBytes(recoveredRoot, expectedFinalTreeRoot)) {
      throw new Error('Archive tree root mismatch');
    }
  }

  return {
    notes,
    activities,
    tree,
    lastRecordHash: expectedPriorRecordHash,
    spentNullifierHexes,
    nullifiersByCommitment,
  };
}
