import { encodeDomain, encodeU16Be, encodeU32Be, encodeU64Be } from './encoding.js';
import { equalBytes, sha256Bytes } from './hash.js';
import { OutputPackageModel } from './action.js';
import { MerkleTree, appendFrontier, refreshTreeRoot } from './tree.js';

export const DOMAIN_ARCHIVE_RECORD = 'SKSB_ARCHIVE_RECORD_V1';
export const DOMAIN_ARCHIVE_GENESIS = 'SKSB_ARCHIVE_GENESIS_V1';

export interface ArchiveRecordModel {
  actionIndex: number;
  ledgerSequence: number;
  startingLeafIndex: number;
  actionKind: number;
  asset: { kind: number; payload: Uint8Array };
  actionNonce: Uint8Array;
  anchorRoot: Uint8Array;
  treeRootAfter: Uint8Array;
  nullifiers: [Uint8Array, Uint8Array];
  outputs: [OutputPackageModel, OutputPackageModel];
  publicValue: bigint;
  depositSource?: { kind: number; payload: Uint8Array };
  publicRecipient?: { kind: number; payload: Uint8Array };
  relayerFee: bigint;
  relayer?: { kind: number; payload: Uint8Array };
}

function encodeOptionalAddress(
  addr: { kind: number; payload: Uint8Array } | undefined,
  out: number[],
): void {
  if (!addr) {
    out.push(0);
    for (let index = 0; index < 33; index += 1) out.push(0);
    return;
  }
  if ((addr.kind !== 0 && addr.kind !== 1) || addr.payload.length !== 32) {
    throw new Error('Invalid canonical address');
  }
  out.push(1, addr.kind, ...addr.payload);
}

function requireLength(name: string, bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) throw new Error(`${name} must be ${length} bytes`);
}

function requireRecordWidths(record: ArchiveRecordModel): void {
  if (record.asset.kind !== 1 || record.asset.payload.length !== 32) {
    throw new Error('Archive asset must be a canonical contract address');
  }
  for (const [name, bytes, length] of [
    ['Action nonce', record.actionNonce, 32],
    ['Anchor root', record.anchorRoot, 32],
    ['Tree root', record.treeRootAfter, 32],
    ['Nullifier 0', record.nullifiers[0], 32],
    ['Nullifier 1', record.nullifiers[1], 32],
    ['Output 0 commitment', record.outputs[0].cm, 32],
    ['Output 0 envelope', record.outputs[0].recipientEnvelope, 181],
    ['Output 1 commitment', record.outputs[1].cm, 32],
    ['Output 1 envelope', record.outputs[1].recipientEnvelope, 181],
  ] as const) requireLength(name, bytes, length);
}

export function computeRecordHash(
  record: ArchiveRecordModel,
  protocolVersion: number,
  priorRecordHash: Uint8Array,
): Uint8Array {
  requireRecordWidths(record);
  requireLength('Prior record hash', priorRecordHash, 32);
  const bytes: number[] = [];
  encodeDomain(DOMAIN_ARCHIVE_RECORD, bytes);
  encodeU16Be(protocolVersion, bytes);
  encodeU32Be(record.actionIndex, bytes);
  encodeU32Be(record.ledgerSequence, bytes);
  encodeU32Be(record.startingLeafIndex, bytes);
  bytes.push(record.actionKind);
  bytes.push(record.asset.kind, ...record.asset.payload);
  bytes.push(...record.actionNonce, ...record.anchorRoot, ...record.treeRootAfter);
  bytes.push(...record.nullifiers[0], ...record.nullifiers[1]);
  bytes.push(...record.outputs[0].cm, ...record.outputs[0].recipientEnvelope);
  bytes.push(...record.outputs[1].cm, ...record.outputs[1].recipientEnvelope);
  encodeU64Be(record.publicValue, bytes);
  encodeU64Be(record.relayerFee, bytes);
  encodeOptionalAddress(record.relayer, bytes);
  encodeOptionalAddress(record.depositSource, bytes);
  encodeOptionalAddress(record.publicRecipient, bytes);
  bytes.push(...priorRecordHash);
  return sha256Bytes(Uint8Array.from(bytes));
}

export function computeGenesisRecordHash(
  contextHash: Uint8Array,
  deploymentBindingHash: Uint8Array,
): Uint8Array {
  requireLength('Context hash', contextHash, 32);
  requireLength('Deployment binding hash', deploymentBindingHash, 32);
  const bytes: number[] = [];
  encodeDomain(DOMAIN_ARCHIVE_GENESIS, bytes);
  bytes.push(...contextHash, ...deploymentBindingHash);
  return sha256Bytes(Uint8Array.from(bytes));
}

export async function applyArchiveRecord(
  tree: MerkleTree,
  record: ArchiveRecordModel,
): Promise<Uint8Array> {
  if (record.startingLeafIndex !== tree.nextIndex) throw new Error('Archive leaf position mismatch');
  const nextTree: MerkleTree = {
    nextIndex: tree.nextIndex,
    frontier: tree.frontier.map(node => node.slice()),
    currentRoot: tree.currentRoot.slice(),
  };
  for (const output of record.outputs) await appendFrontier(nextTree, output.cm);
  const root = await refreshTreeRoot(nextTree);
  if (!equalBytes(root, record.treeRootAfter)) throw new Error('Archive tree root mismatch');
  tree.nextIndex = nextTree.nextIndex;
  tree.frontier = nextTree.frontier;
  tree.currentRoot = nextTree.currentRoot;
  return root;
}
