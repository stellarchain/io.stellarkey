import { equalBytes } from '@noble/ciphers/utils.js';
import { isPrivateIndex, stringifyPrivateIndices, parsePrivateIndices } from './indices';
import {
  EMPTY_ROOTS,
  TREE_ARITY,
  TREE_CAPACITY,
  TREE_DEPTH,
  TREE_FRONTIER_SIZE,
  hashMerkleNode,
  type MerklePathWitness,
} from '@stellarkey/private-balance';
import {
  IndexedDbEncryptedRecordDriver,
  type EncryptedRecordDriver,
} from '../../../lib/indexed-db';
import type { PrivateBalancePublicCacheContext } from './public-cache';

const CHECKPOINT_KIND = 'public-merkle-checkpoint';
const NODE_KIND = 'public-merkle-node';
const RECORD_VERSION = 2;

export type PrivateBalanceMerkleCacheDriver = Pick<
  EncryptedRecordDriver,
  'read' | 'compareAndSetMany' | 'removePrefix'
>;

export interface ExpectedPrivateBalanceMerkleCheckpoint {
  deploymentBindingHash: string;
  cursor: bigint;
  transcriptHead: string;
  commitmentCount: bigint;
  root: string;
  frontier: string[];
}

export interface VerifiedPrivateBalanceMerkleBatch {
  deploymentBindingHash: Uint8Array;
  priorCursor: bigint;
  cursor: bigint;
  transcriptHead: Uint8Array;
  startIndex: bigint;
  commitments: readonly Uint8Array[];
  expectedRoot: Uint8Array;
  expectedFrontier: readonly Uint8Array[];
}

interface MerkleCheckpointRecord {
  kind: typeof CHECKPOINT_KIND;
  version: typeof RECORD_VERSION;
  revision: number;
  deploymentBindingHash: string;
  cursor: bigint;
  transcriptHead: string;
  commitmentCount: bigint;
  root: string;
  frontier: string[];
}

interface MerkleNodeRecord {
  kind: typeof NODE_KIND;
  version: typeof RECORD_VERSION;
  revision: 0;
  level: number;
  index: bigint;
  value: string;
}

let defaultDriver: PrivateBalanceMerkleCacheDriver | null = null;

function driver(candidate?: PrivateBalanceMerkleCacheDriver): PrivateBalanceMerkleCacheDriver {
  defaultDriver ??= new IndexedDbEncryptedRecordDriver();
  return candidate ?? defaultDriver;
}

function hex32(value: Uint8Array, name: string): string {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error(`${name} must be exactly 32 bytes`);
  }
  return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
}

function decodeHex32(value: unknown, name: string): Uint8Array {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${name} must be 32-byte lowercase hex`);
  }
  return Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}

function safeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function contextHex(value: string, name: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`Private Balance Merkle cache ${name} must be 32-byte lowercase hex`);
  }
  return value;
}

function prefix(context: PrivateBalancePublicCacheContext): string {
  return [
    'private:merkle:v2',
    contextHex(context.networkId, 'network ID'),
    contextHex(context.realmId, 'realm ID'),
    contextHex(context.poolId, 'pool ID'),
    '',
  ].join(':');
}

function checkpointKey(context: PrivateBalancePublicCacheContext): string {
  return `${prefix(context)}checkpoint`;
}

function nodeKey(context: PrivateBalancePublicCacheContext, level: number, index: bigint): string {
  return `${prefix(context)}node:${level.toString().padStart(2, '0')}:${index.toString().padStart(39, '0')}`;
}

function decodeCheckpoint(raw: string): MerkleCheckpointRecord {
  let value: unknown;
  try {
    value = parsePrivateIndices(raw, ['cursor', 'commitmentCount', 'index']);
  } catch {
    throw new Error('Private Balance Merkle checkpoint is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Private Balance Merkle checkpoint is invalid');
  }
  const record = value as Partial<MerkleCheckpointRecord>;
  if (
    record.kind !== CHECKPOINT_KIND ||
    record.version !== RECORD_VERSION ||
    !safeInteger(record.revision) ||
    !isPrivateIndex(record.cursor) ||
    (!isPrivateIndex(record.commitmentCount) || record.commitmentCount > TREE_CAPACITY) ||
    !Array.isArray(record.frontier) ||
    record.frontier.length !== TREE_FRONTIER_SIZE
  ) {
    throw new Error('Private Balance Merkle checkpoint is invalid');
  }
  decodeHex32(record.deploymentBindingHash, 'Merkle deployment binding hash');
  decodeHex32(record.transcriptHead, 'Merkle transcript head');
  decodeHex32(record.root, 'Merkle root');
  record.frontier.forEach((node, index) =>
    decodeHex32(node, `Merkle frontier ${index}`));
  return record as MerkleCheckpointRecord;
}

function decodeNode(raw: string, level: number, index: bigint): Uint8Array {
  let value: unknown;
  try {
    value = parsePrivateIndices(raw, ['cursor', 'commitmentCount', 'index']);
  } catch {
    throw new Error('Private Balance Merkle node is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Private Balance Merkle node is invalid');
  }
  const record = value as Partial<MerkleNodeRecord>;
  if (
    record.kind !== NODE_KIND ||
    record.version !== RECORD_VERSION ||
    record.revision !== 0 ||
    record.level !== level ||
    record.index !== index
  ) {
    throw new Error('Private Balance Merkle node is invalid');
  }
  return decodeHex32(record.value, 'Merkle node');
}

function serializeNode(level: number, index: bigint, value: Uint8Array): string {
  const record: MerkleNodeRecord = {
    kind: NODE_KIND,
    version: RECORD_VERSION,
    revision: 0,
    level,
    index,
    value: hex32(value, 'Merkle node'),
  };
  return stringifyPrivateIndices(record);
}

function checkpointMatches(
  checkpoint: MerkleCheckpointRecord,
  expected: ExpectedPrivateBalanceMerkleCheckpoint,
): boolean {
  return (
    checkpoint.deploymentBindingHash === expected.deploymentBindingHash &&
    checkpoint.cursor === expected.cursor &&
    checkpoint.transcriptHead === expected.transcriptHead &&
    checkpoint.commitmentCount === expected.commitmentCount &&
    checkpoint.root === expected.root &&
    checkpoint.frontier.length === expected.frontier.length &&
    checkpoint.frontier.every((value, index) => value === expected.frontier[index])
  );
}

function validateExpectedCheckpoint(expected: ExpectedPrivateBalanceMerkleCheckpoint): void {
  decodeHex32(expected.deploymentBindingHash, 'Expected Merkle deployment binding hash');
  decodeHex32(expected.transcriptHead, 'Expected Merkle transcript head');
  decodeHex32(expected.root, 'Expected Merkle root');
  if (
    !isPrivateIndex(expected.cursor) ||
    (!isPrivateIndex(expected.commitmentCount) || expected.commitmentCount > TREE_CAPACITY) ||
    expected.frontier.length !== TREE_FRONTIER_SIZE
  ) {
    throw new Error('Expected Private Balance Merkle checkpoint is invalid');
  }
  expected.frontier.forEach((node, index) =>
    decodeHex32(node, `Expected Merkle frontier ${index}`));
}

export async function recordVerifiedPrivateBalanceMerkleBatch(
  context: PrivateBalancePublicCacheContext,
  batch: VerifiedPrivateBalanceMerkleBatch,
  candidate?: PrivateBalanceMerkleCacheDriver,
): Promise<void> {
  if (
    !isPrivateIndex(batch.priorCursor) ||
    !isPrivateIndex(batch.cursor) ||
    batch.cursor <= batch.priorCursor ||
    (!isPrivateIndex(batch.startIndex) || batch.startIndex > TREE_CAPACITY) ||
    batch.startIndex + BigInt(batch.commitments.length) > TREE_CAPACITY ||
    batch.expectedFrontier.length !== TREE_FRONTIER_SIZE
  ) {
    throw new Error('Verified Private Balance Merkle batch is invalid');
  }
  const deploymentBindingHash = hex32(batch.deploymentBindingHash, 'Deployment binding hash');
  const transcriptHead = hex32(batch.transcriptHead, 'Transcript head');
  const expectedRoot = hex32(batch.expectedRoot, 'Expected Merkle root');
  const expectedFrontier = batch.expectedFrontier.map((node, index) =>
    hex32(node, `Expected Merkle frontier ${index}`));
  const cache = driver(candidate);
  const key = checkpointKey(context);
  const currentRaw = await cache.read(key);
  const current = currentRaw === null ? null : decodeCheckpoint(currentRaw);

  const completedExpectation: ExpectedPrivateBalanceMerkleCheckpoint = {
    deploymentBindingHash,
    cursor: batch.cursor,
    transcriptHead,
    commitmentCount: batch.startIndex + BigInt(batch.commitments.length),
    root: expectedRoot,
    frontier: expectedFrontier,
  };
  if (current && checkpointMatches(current, completedExpectation)) return;
  if (
    (current === null && (batch.startIndex !== 0n || batch.priorCursor !== 0n)) ||
    (current !== null && (
      current.deploymentBindingHash !== deploymentBindingHash ||
      current.cursor !== batch.priorCursor ||
      current.commitmentCount !== batch.startIndex
    ))
  ) {
    throw new Error('Private Balance Merkle checkpoint is not contiguous');
  }

  const frontier = current
    ? current.frontier.map((node, index) => decodeHex32(node, `Merkle frontier ${index}`))
    : Array.from({ length: TREE_FRONTIER_SIZE }, (_, index) => (
      EMPTY_ROOTS[Math.floor(index / (TREE_ARITY - 1))].slice()
    ));
  const entries = new Map<string, string>();
  let count = batch.startIndex;
  let root: Uint8Array = current ? decodeHex32(current.root, 'Merkle root') : EMPTY_ROOTS[TREE_DEPTH].slice();

  for (const commitment of batch.commitments) {
    hex32(commitment, 'Private Balance commitment');
    let currentNode: Uint8Array = commitment.slice();
    let nodeIndex = count;
    entries.set(nodeKey(context, 0, nodeIndex), serializeNode(0, nodeIndex, currentNode));

    let level = 0;
    for (;;) {
      const position = Number(nodeIndex % 3n);
      const offset = level * (TREE_ARITY - 1);
      if (position < TREE_ARITY - 1) {
        frontier[offset + position] = currentNode.slice();
        break;
      }
      currentNode = hashMerkleNode([
        frontier[offset],
        frontier[offset + 1],
        currentNode,
      ]);
      nodeIndex = nodeIndex / 3n;
      level += 1;
      entries.set(
        nodeKey(context, level, nodeIndex),
        serializeNode(level, nodeIndex, currentNode),
      );
      if (level === TREE_DEPTH) break;
    }
    count += 1n;
    if (count === TREE_CAPACITY) { root = currentNode; continue; }

    let folded: Uint8Array = EMPTY_ROOTS[0].slice();
    let width = count;
    let enteredPopulatedBranch = false;
    for (let foldLevel = 0; foldLevel < TREE_DEPTH; foldLevel += 1) {
      const position = Number(width % 3n);
      const offset = foldLevel * (TREE_ARITY - 1);
      if (position !== 0) {
        enteredPopulatedBranch = true;
        folded = position === 1
          ? hashMerkleNode([frontier[offset], folded, EMPTY_ROOTS[foldLevel]])
          : hashMerkleNode([frontier[offset], frontier[offset + 1], folded]);
      } else {
        folded = hashMerkleNode([
          folded,
          EMPTY_ROOTS[foldLevel],
          EMPTY_ROOTS[foldLevel],
        ]);
      }
      if (enteredPopulatedBranch && foldLevel + 1 < TREE_DEPTH) {
        const partialIndex = (count - 1n) / 3n ** BigInt(foldLevel + 1);
        entries.set(
          nodeKey(context, foldLevel + 1, partialIndex),
          serializeNode(foldLevel + 1, partialIndex, folded),
        );
      }
      width = width / 3n;
    }
    root = folded;
  }

  if (!equalBytes(root, batch.expectedRoot)) {
    throw new Error('Verified Private Balance Merkle root does not match the archive');
  }
  for (let index = 0; index < TREE_FRONTIER_SIZE; index += 1) {
    if (!equalBytes(frontier[index], batch.expectedFrontier[index])) {
      throw new Error('Verified Private Balance Merkle frontier does not match the archive');
    }
  }

  const next: MerkleCheckpointRecord = {
    kind: CHECKPOINT_KIND,
    version: RECORD_VERSION,
    revision: (current?.revision ?? -1) + 1,
    ...completedExpectation,
  };
  entries.set(key, stringifyPrivateIndices(next));
  const stored = await cache.compareAndSetMany(
    key,
    current?.revision ?? null,
    entries,
  );
  if (!stored.ok) {
    throw new Error('Private Balance Merkle cache changed in another wallet session');
  }
}

export async function loadPrivateBalanceMerklePaths(
  context: PrivateBalancePublicCacheContext,
  expected: ExpectedPrivateBalanceMerkleCheckpoint,
  leafIndices: readonly bigint[],
  candidate?: Pick<EncryptedRecordDriver, 'read'>,
): Promise<MerklePathWitness[]> {
  validateExpectedCheckpoint(expected);
  if (
    leafIndices.length < 1 ||
    leafIndices.length > 2 ||
    new Set(leafIndices).size !== leafIndices.length ||
    leafIndices.some(index => !isPrivateIndex(index) || index >= expected.commitmentCount)
  ) {
    throw new Error('Private Balance Merkle path request is invalid');
  }
  const cache = candidate ?? driver();
  const rawCheckpoint = await cache.read(checkpointKey(context));
  if (rawCheckpoint === null) throw new Error('Private Balance Merkle checkpoint is missing');
  const checkpoint = decodeCheckpoint(rawCheckpoint);
  if (!checkpointMatches(checkpoint, expected)) {
    throw new Error('Private Balance Merkle checkpoint does not match verified state');
  }

  const loadedNodes = new Map<string, Uint8Array>();
  const readNode = async (level: number, index: bigint): Promise<Uint8Array> => {
    const key = nodeKey(context, level, index);
    const cached = loadedNodes.get(key);
    if (cached) return cached.slice();
    const raw = await cache.read(key);
    if (raw === null) throw new Error('Private Balance Merkle node is missing');
    const node = decodeNode(raw, level, index);
    loadedNodes.set(key, node);
    return node.slice();
  };

  const expectedRoot = decodeHex32(expected.root, 'Expected Merkle root');
  const paths: MerklePathWitness[] = [];
  for (const leafIndex of leafIndices) {
    const leaf = await readNode(0, leafIndex);
    const siblings: [Uint8Array, Uint8Array][] = [];
    const positions: number[] = [];
    let current: Uint8Array = leaf.slice();
    for (let level = 0; level < TREE_DEPTH; level += 1) {
      const currentIndex = leafIndex / 3n ** BigInt(level);
      const position = Number(currentIndex % 3n);
      const firstChildIndex = currentIndex - BigInt(position);
      const resolvedChildren = await Promise.all([0, 1, 2].map(
        async childPosition => {
          if (childPosition === position) return current;
          const childIndex = firstChildIndex + BigInt(childPosition);
          const childStart = childIndex * 3n ** BigInt(level);
          return childStart >= expected.commitmentCount
            ? EMPTY_ROOTS[level].slice()
            : readNode(level, childIndex);
        },
      )) as [Uint8Array, Uint8Array, Uint8Array];
      siblings.push(
        resolvedChildren.filter((_, childPosition) => childPosition !== position) as [
          Uint8Array,
          Uint8Array,
        ],
      );
      positions.push(position);
      current = hashMerkleNode(resolvedChildren);
    }
    if (!equalBytes(current, expectedRoot)) {
      throw new Error('Private Balance Merkle path does not match verified checkpoint');
    }
    paths.push({ leaf, leafIndex, siblings, positions, root: current });
  }
  return paths;
}

export async function loadPrivateBalanceMerkleCheckpoint(
  context: PrivateBalancePublicCacheContext,
  candidate?: Pick<EncryptedRecordDriver, 'read'>,
): Promise<ExpectedPrivateBalanceMerkleCheckpoint | null> {
  const raw = await (candidate ?? driver()).read(checkpointKey(context));
  if (raw === null) return null;
  const checkpoint = decodeCheckpoint(raw);
  return {
    deploymentBindingHash: checkpoint.deploymentBindingHash,
    cursor: checkpoint.cursor,
    transcriptHead: checkpoint.transcriptHead,
    commitmentCount: checkpoint.commitmentCount,
    root: checkpoint.root,
    frontier: [...checkpoint.frontier],
  };
}

export async function requirePrivateBalanceMerkleCheckpoint(
  context: PrivateBalancePublicCacheContext,
  expected: ExpectedPrivateBalanceMerkleCheckpoint,
  candidate?: Pick<EncryptedRecordDriver, 'read'>,
): Promise<void> {
  validateExpectedCheckpoint(expected);
  const current = await loadPrivateBalanceMerkleCheckpoint(context, candidate);
  if (!current || stringifyPrivateIndices(current) !== stringifyPrivateIndices(expected)) {
    throw new Error('Private Balance Merkle checkpoint does not match verified state');
  }
}

export async function rebuildPrivateBalanceMerkleCache(
  context: PrivateBalancePublicCacheContext,
  expected: ExpectedPrivateBalanceMerkleCheckpoint,
  commitments: readonly Uint8Array[],
  candidate?: PrivateBalanceMerkleCacheDriver,
): Promise<void> {
  validateExpectedCheckpoint(expected);
  if (BigInt(commitments.length) !== expected.commitmentCount) {
    throw new Error('Private Balance Merkle rebuild commitments do not match the checkpoint');
  }
  await clearPrivateBalanceMerkleCache(context, candidate);
  await recordVerifiedPrivateBalanceMerkleBatch(context, {
    deploymentBindingHash: decodeHex32(
      expected.deploymentBindingHash,
      'Expected Merkle deployment binding hash',
    ),
    priorCursor: 0n,
    cursor: expected.cursor,
    transcriptHead: decodeHex32(expected.transcriptHead, 'Expected Merkle transcript head'),
    startIndex: 0n,
    commitments,
    expectedRoot: decodeHex32(expected.root, 'Expected Merkle root'),
    expectedFrontier: expected.frontier.map((node, index) =>
      decodeHex32(node, `Expected Merkle frontier ${index}`)),
  }, candidate);
}

export function clearPrivateBalanceMerkleCache(
  context: PrivateBalancePublicCacheContext,
  candidate?: Pick<EncryptedRecordDriver, 'removePrefix'>,
): Promise<void> {
  return (candidate ?? driver()).removePrefix(prefix(context));
}
