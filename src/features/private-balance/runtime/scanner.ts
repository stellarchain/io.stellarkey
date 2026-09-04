import {
  ActionKind,
  appendFrontier,
  computeActionField,
  computeAssetField,
  computeNullifier,
  computeRecordHash,
  createEmptyTree,
  decodeOutgoingPlaintext,
  deriveOutgoingAad,
  derivePrivateAddressDeploymentTag,
  encodePrivateAddress,
  openOutgoingEnvelope,
  openRecipientEnvelope,
  refreshTreeRoot,
  type ActionModel,
  type ArchiveRecordModel,
  type FullViewingKey,
  type MerkleTree,
} from '@stellarkey/private-balance';
import { StrKey } from '@stellar/stellar-sdk';
import { sha256 } from '@noble/hashes/sha2.js';
import type { ShieldedActivityRecord, ShieldedNoteRecord } from './types';
import { privateAddressFingerprint } from './receive';

export interface ArchiveScanContext {
  protocolVersion: number;
  networkId: Uint8Array;
  realmId: Uint8Array;
  poolId: Uint8Array;
  contextHash: Uint8Array;
  contextField: Uint8Array;
  deploymentBindingHash: Uint8Array;
  addressPrefix: 'tskpay_' | 'skpay_';
  assets: Array<{ index: number; contractId: string }>;
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

const duplicateNoteIdDomain = new TextEncoder().encode('StellarKey private note v1');

function duplicateNoteId(commitment: Uint8Array, leafIndex: number): string {
  if (!Number.isSafeInteger(leafIndex) || leafIndex < 0) {
    throw new Error('Private note leaf index is invalid');
  }
  const leaf = new Uint8Array(8);
  new DataView(leaf.buffer).setBigUint64(0, BigInt(leafIndex), false);
  const input = new Uint8Array(duplicateNoteIdDomain.length + commitment.length + leaf.length);
  input.set(duplicateNoteIdDomain, 0);
  input.set(commitment, duplicateNoteIdDomain.length);
  input.set(leaf, duplicateNoteIdDomain.length + commitment.length);
  return hex(sha256(input));
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
    assetIndex: record.assetIndex,
    asset: record.asset,
    actionNonce: record.actionNonce,
    anchorRoot: record.anchorRoot,
    nullifiers: record.nullifiers,
    outputs: record.outputs,
    publicValue: record.publicValue,
    depositSource: record.depositSource,
    publicRecipient: record.publicRecipient,
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
  recoveredOutgoingValue: bigint,
  context: ArchiveScanContext,
): Pick<ShieldedActivityRecord, 'actionKind' | 'amount' | 'direction'> | null {
  if (ownedInputValue === 0n && ownedOutputValue === 0n) {
    return record.actionKind === ActionKind.PrivateTransfer && recoveredOutgoingValue > 0n
      ? { actionKind: 'transfer', amount: recoveredOutgoingValue.toString(), direction: 'outflow' }
      : null;
  }

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

export const SCAN_ENVELOPE_BATCH_SIZE = 8;

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function mapInBoundedBatches<T, R>(
  values: readonly T[],
  batchSize: number,
  map: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error('Private scan batch size must be a positive safe integer');
  }
  const results: R[] = [];
  for (let offset = 0; offset < values.length; offset += batchSize) {
    const batch = values.slice(offset, offset + batchSize);
    results.push(...await Promise.all(
      batch.map((value, index) => map(value, offset + index)),
    ));
    if (offset + batchSize < values.length) await yieldToEventLoop();
  }
  return results;
}

export async function scanArchiveRecords(
  input: ScanArchiveRecordsInput,
): Promise<ScanArchiveRecordsResult> {
  if (input.expectedPriorRecordHash.length !== 32) {
    throw new Error('Expected prior record hash must be 32 bytes');
  }

  const tree = input.initialTree ? cloneTree(input.initialTree) : await createEmptyTree();
  const notes = (input.existingNotes ?? []).map(cloneNote);
  const usedNoteIds = new Set(notes.map(note => note.id));
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
    nullifiersByCommitment.set(note.id, nullifierHex);
    notesByNullifier.set(nullifierHex, note);
  }

  const registry = input.context.assets.map(asset => {
    if (!Number.isSafeInteger(asset.index) || asset.index < 0 || asset.index > 0xffff_ffff) {
      throw new Error('Private asset registry index is invalid');
    }
    if (!StrKey.isValidContract(asset.contractId)) {
      throw new Error('Private asset registry contract is invalid');
    }
    const payload = new Uint8Array(StrKey.decodeContract(asset.contractId));
    return {
      ...asset,
      payload,
      assetField: computeAssetField({ kind: 1, payload }),
    };
  });
  if (
    new Set(registry.map(asset => asset.index)).size !== registry.length
    || new Set(registry.map(asset => asset.contractId)).size !== registry.length
  ) {
    throw new Error('Private asset registry contains duplicate entries');
  }

  for (const [recordOffset, record] of input.records.entries()) {
    if (record.actionIndex * 3 !== record.startingLeafIndex) {
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
    const recordHash = computeRecordHash(
      record,
      input.context.protocolVersion,
      expectedPriorRecordHash,
    );

    let candidates = registry;
    if (record.actionKind !== ActionKind.PrivateTransfer) {
      const boundaryAsset = registry.find(asset => asset.index === record.assetIndex);
      if (
        !boundaryAsset
        || !record.asset
        || record.asset.kind !== 1
        || !equalBytes(boundaryAsset.payload, record.asset.payload)
      ) {
        throw new Error('Archive boundary asset does not match the authenticated registry');
      }
      candidates = [boundaryAsset];
    } else if (record.asset || record.assetIndex !== undefined) {
      throw new Error('Archive private transfer exposes an asset');
    }

    const envelopeTrials = await mapInBoundedBatches(
      record.outputs,
      SCAN_ENVELOPE_BATCH_SIZE,
      async (output, outputIndex) => {
        for (const candidate of candidates) {
          const note = await openRecipientEnvelope(
            input.viewingKey.hpkePrivateKey,
            output.recipientEnvelope,
            input.context.contextHash,
            input.context.contextField,
            candidate.assetField,
            output.cm,
            record.actionNonce,
            outputIndex,
            input.viewingKey.baseOwnerCommitment,
          );
          const outgoingBytes = await openOutgoingEnvelope(
            input.viewingKey.outgoingViewingKey,
            output.recipientEnvelope.slice(5, 37),
            output.outgoingEnvelope,
            deriveOutgoingAad(
              input.context.deploymentBindingHash,
              input.context.contextHash,
              candidate.assetField,
              output.cm,
              record.actionNonce,
              outputIndex,
            ),
          );
          if (note || outgoingBytes) {
            if (note && note.assetIndex !== candidate.index) {
              outgoingBytes?.fill(0);
              throw new Error('Recovered note asset index does not match its authenticated asset');
            }
            return { note, outgoingBytes, asset: candidate };
          }
        }
        return { note: null, outgoingBytes: null, asset: null };
      },
    );

    try {
    let ownedInputValue = 0n;
    let activityAsset: (typeof registry)[number] | undefined = candidates.length === 1
      ? candidates[0]
      : undefined;
    const useActivityAsset = (index: number, contractId: string) => {
      const candidate = registry.find(asset => asset.index === index && asset.contractId === contractId);
      if (!candidate) throw new Error('Recovered private asset is not in the authenticated registry');
      if (activityAsset && activityAsset.index !== candidate.index) {
        throw new Error('Private action mixed multiple assets');
      }
      activityAsset = candidate;
    };
    for (const nullifier of record.nullifiers) {
      const nullifierHex = hex(nullifier);
      const spentNote = notesByNullifier.get(nullifierHex);
      if (!spentNote) continue;
      if (spentNote.status === 'spent') throw new Error('Owned note was spent more than once');
      useActivityAsset(spentNote.assetIndex, spentNote.assetContractId);
      ownedInputValue += BigInt(spentNote.value);
      spentNote.status = 'spent';
      spentNote.spentInActionIndex = record.actionIndex;
      delete spentNote.reservedAt;
      spentNullifierHexes.push(nullifierHex);
    }

    let ownedOutputValue = 0n;
    let receivedMemoHex: string | undefined;
    const recoveredRecipients: Array<{ fingerprint: string; memoHex?: string; value: bigint }> = [];
    for (const [outputIndex, output] of record.outputs.entries()) {
      const { note, outgoingBytes, asset } = envelopeTrials[outputIndex];
      const ownedRealOutput = Boolean(note && note.flags === 0);
      if (note && note.flags === 0) {
        if (!asset) throw new Error('Recovered note is missing its registry asset');
        useActivityAsset(asset.index, asset.contractId);
        const commitment = hex(output.cm);
        const leafIndex = record.startingLeafIndex + outputIndex;
        const noteId = usedNoteIds.has(commitment)
          ? duplicateNoteId(output.cm, leafIndex)
          : commitment;
        if (usedNoteIds.has(noteId)) {
          throw new Error('Private note identity collision');
        }
        const memoHex = hex(note.memo.slice(0, note.memoLength));
        const recovered: ShieldedNoteRecord = {
          id: noteId,
          commitment,
          value: note.value.toString(),
          assetIndex: asset.index,
          assetContractId: asset.contractId,
          diversifier: hex(note.diversifier),
          ownerCommitment: hex(note.ownerCommitment),
          leafIndex,
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
        usedNoteIds.add(noteId);
        notesByNullifier.set(nullifierHex, recovered);
        nullifiersByCommitment.set(noteId, nullifierHex);
        ownedOutputValue += note.value;
        if (memoHex) receivedMemoHex ??= memoHex;
      }

      if (outgoingBytes) {
        try {
          if (!ownedRealOutput) {
            const outgoing = decodeOutgoingPlaintext(outgoingBytes);
            if (!asset || outgoing.assetIndex !== asset.index) {
              throw new Error('Recovered outgoing asset index does not match its authenticated asset');
            }
            if (outgoing.flags === 0) {
              useActivityAsset(asset.index, asset.contractId);
              const address = encodePrivateAddress({
                deploymentTag: derivePrivateAddressDeploymentTag(
                  input.context.deploymentBindingHash,
                ),
                diversifier: outgoing.diversifier,
                ownerCommitment: outgoing.ownerCommitment,
                hpkePublicKey: outgoing.recipientHpkePublicKey,
              }, input.context.addressPrefix);
              const memoHex = hex(outgoing.memo.slice(0, outgoing.memoLength));
              recoveredRecipients.push({
                fingerprint: privateAddressFingerprint(address),
                ...(memoHex ? { memoHex } : {}),
                value: outgoing.value,
              });
            }
          }
        } finally {
          outgoingBytes.fill(0);
        }
      }
    }

    for (const output of record.outputs) await appendFrontier(tree, output.cm);
    expectedFinalTreeRoot = record.treeRootAfter;
    const recoveredOutgoingValue = recoveredRecipients.reduce(
      (total, recipient) => total + recipient.value,
      0n,
    );
    const classification = classifyActivity(
      record,
      ownedInputValue,
      ownedOutputValue,
      recoveredOutgoingValue,
      input.context,
    );
    if (classification) {
      if (!activityAsset) throw new Error('Private activity asset could not be recovered');
      activities.push({
        id: hex(expectedActionField),
        actionIndex: record.actionIndex,
        assetIndex: activityAsset.index,
        assetContractId: activityAsset.contractId,
        ...classification,
        timestamp: input.ledgerClosedAt?.[record.ledgerSequence] ?? 0,
        nullifiers: record.nullifiers.map(hex),
        outputCommitments: record.outputs.map(output => hex(output.cm)),
        ...(classification.actionKind === 'transfer' &&
          classification.direction === 'outflow' &&
          recoveredRecipients.length === 1
          ? {
            recipientFingerprint: recoveredRecipients[0].fingerprint,
            ...(recoveredRecipients[0].memoHex
              ? { memoHex: recoveredRecipients[0].memoHex }
              : {}),
          }
          : {}),
        ...(classification.actionKind === 'transfer' &&
          classification.direction === 'inflow' &&
          receivedMemoHex
          ? { memoHex: receivedMemoHex }
          : {}),
      });
    }
    expectedPriorRecordHash = Uint8Array.from(recordHash);
    } finally {
      for (const trial of envelopeTrials) trial.outgoingBytes?.fill(0);
    }
    if ((recordOffset + 1) % SCAN_ENVELOPE_BATCH_SIZE === 0) await yieldToEventLoop();
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
