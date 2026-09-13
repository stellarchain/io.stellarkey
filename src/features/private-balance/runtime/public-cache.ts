import { isPrivateIndex, privateBatchLength, stringifyPrivateIndices, parsePrivateIndices } from './indices';
import {
  IndexedDbEncryptedRecordDriver,
  type EncryptedRecordDriver,
  type RecordDriverExpectedPrefix,
} from '../../../lib/indexed-db';
import { sha256 } from '@noble/hashes/sha2.js';
import { clearPrivateBalanceMerkleCache } from './merkle-cache';

const RECORD_KIND = 'public-commitment-chunk';
const MAX_COMMITMENTS_PER_CHUNK = 256;

export interface PrivateBalancePublicCacheContext {
  networkId: string;
  realmId: string;
  poolId: string;
}

export type PrivateBalancePublicCacheDriver = Pick<
  EncryptedRecordDriver,
  'read' | 'readPrefix' | 'compareAndSetMany' | 'replacePrefixVerified' | 'removePrefix'
>;

interface AppendCheckpoint {
  kind: 'public-commitment-checkpoint';
  version: 2;
  revision: number;
  generation: string;
  count: bigint;
  digest: string;
}

interface AppendBasis {
  checkpoint: AppendCheckpoint;
  raw: string | null;
  tail: string | null;
  expected: Map<string, string | null>;
  writes: Map<string, string>;
  expectedPrefix?: RecordDriverExpectedPrefix;
}

// This is a cache consistency anchor, never chain authority. Sync still verifies
// the canonical transcript and Merkle root. Retain only a fixed-size public tail.
const validated = new WeakMap<PrivateBalancePublicCacheDriver, Map<string, Pick<AppendBasis, 'checkpoint' | 'raw' | 'tail'>>>();
const EMPTY_DIGEST = '00'.repeat(32);

interface CommitmentChunkRecord {
  kind: typeof RECORD_KIND;
  version: 2;
  revision: 0;
  startIndex: bigint;
  commitments: string[];
}

let defaultDriver: PrivateBalancePublicCacheDriver | null = null;

function driver(candidate?: PrivateBalancePublicCacheDriver): PrivateBalancePublicCacheDriver {
  defaultDriver ??= new IndexedDbEncryptedRecordDriver();
  return candidate ?? defaultDriver;
}

function hexContext(value: string, name: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`Private Balance public cache ${name} must be 32-byte lowercase hex`);
  }
  return value;
}

function prefix(context: PrivateBalancePublicCacheContext): string {
  return [
    'private:cache:v2',
    hexContext(context.networkId, 'network ID'),
    hexContext(context.realmId, 'realm ID'),
    hexContext(context.poolId, 'pool ID'),
    '',
  ].join(':');
}

function chunkKey(context: PrivateBalancePublicCacheContext, startIndex: bigint): string {
  return `${prefix(context)}commitments:${startIndex.toString().padStart(39, '0')}`;
}

function safeIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function hexCommitment(value: Uint8Array, name: string): string {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error(`${name} must be exactly 32 bytes`);
  }
  return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
}

function decodeCommitment(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('Private Balance public cache commitment is invalid');
  }
  return Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}

function decodeCheckpoint(raw: string): AppendCheckpoint {
  let record: Partial<AppendCheckpoint>;
  try { record = parsePrivateIndices(raw, ['count', 'startIndex']) as Partial<AppendCheckpoint>; } catch { throw new Error('Private Balance public cache checkpoint is invalid'); }
  if (!record || record.kind !== 'public-commitment-checkpoint' || record.version !== 2 ||
    !safeIndex(record.revision) || !isPrivateIndex(record.count) ||
    typeof record.generation !== 'string' || !/^[0-9a-f-]{36}$/.test(record.generation) ||
    typeof record.digest !== 'string' || !/^[0-9a-f]{64}$/.test(record.digest)) {
    throw new Error('Private Balance public cache checkpoint is invalid');
  }
  return record as AppendCheckpoint;
}

function emptyCheckpoint(): AppendCheckpoint {
  return { kind: 'public-commitment-checkpoint', version: 2, revision: 0,
    generation: crypto.randomUUID(), count: 0n, digest: EMPTY_DIGEST };
}

function nextDigest(digest: string, index: bigint, commitment: string): string {
  return hexCommitment(sha256(new TextEncoder().encode(
    `stellarkey-public-cache-v2:${digest}:${index}:${commitment}`,
  )), 'Public cache digest');
}

function leafRaw(index: bigint, commitment: string): string {
  return stringifyPrivateIndices({ kind: RECORD_KIND, version: 2, revision: 0, startIndex: index, commitments: [commitment] });
}

function decodeLeaf(raw: string | null, index: bigint): string {
  let record: Omit<Partial<CommitmentChunkRecord>, 'version'> & { version?: number };
  try { record = parsePrivateIndices(raw ?? 'null', ['startIndex']) as typeof record; } catch { throw new Error('Private Balance public cache chunk is invalid'); }
  if (!record || record.kind !== RECORD_KIND || record.version !== 2 || record.revision !== 0 ||
    record.startIndex !== index || !Array.isArray(record.commitments) || record.commitments.length !== 1) {
    throw new Error('Private Balance public cache chunk is invalid');
  }
  decodeCommitment(record.commitments[0]);
  return record.commitments[0];
}

function decodeRetained(context: PrivateBalancePublicCacheContext, records: Map<string, string>): {
  checkpoint: AppendCheckpoint; raw: string; tail: string | null; commitments: Uint8Array[];
} {
  const raw = records.get(`${prefix(context)}checkpoint`);
  if (raw === undefined) throw new Error('Private Balance public cache checkpoint is invalid');
  const checkpoint = decodeCheckpoint(raw);
  // Enumerated records, not an unauthenticated count, define retained history.
  const leaves = [...records].filter(([key]) => key !== `${prefix(context)}checkpoint`)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const commitments: Uint8Array[] = [];
  let digest = EMPTY_DIGEST;
  for (const [offset, [key, value]] of leaves.entries()) {
    const index = BigInt(offset);
    if (key !== chunkKey(context, index)) throw new Error('Private Balance public cache chunks are not contiguous');
    const commitment = decodeLeaf(value, index);
    digest = nextDigest(digest, index, commitment);
    commitments.push(decodeCommitment(commitment));
  }
  if (checkpoint.count !== BigInt(commitments.length) || checkpoint.digest !== digest) {
    throw new Error('Private Balance public cache checkpoint is corrupt');
  }
  return { checkpoint, raw, tail: leaves.at(-1)?.[1] ?? null, commitments };
}

export async function loadPrivateBalanceCommitments(
  context: PrivateBalancePublicCacheContext,
  candidate?: PrivateBalancePublicCacheDriver,
): Promise<Uint8Array[]> {
  context = { ...context };
  const storage = driver(candidate);
  const records = await storage.readPrefix(prefix(context));
  if (records.size > 0) return decodeRetained(context, records).commitments;
  return [];
}

async function appendBasis(context: PrivateBalancePublicCacheContext, storage: PrivateBalancePublicCacheDriver): Promise<AppendBasis> {
  const namespace = prefix(context);
  const key = `${namespace}checkpoint`;
  const raw = await storage.read(key);
  const prior = validated.get(storage)?.get(namespace);
  if (raw !== null) {
    const checkpoint = decodeCheckpoint(raw);
    if (prior?.raw === raw || (prior && prior.checkpoint.generation === checkpoint.generation &&
      checkpoint.count > prior.checkpoint.count && checkpoint.revision > prior.checkpoint.revision)) {
      const expected = new Map<string, string | null>([[key, raw]]);
      let digest = prior.checkpoint.digest;
      let tail = prior.tail;
      if (prior.checkpoint.count > 0n) expected.set(chunkKey(context, prior.checkpoint.count - 1n), tail);
      for (let index = prior.checkpoint.count; index < checkpoint.count; index += 1n) {
        tail = await storage.read(chunkKey(context, index));
        const commitment = decodeLeaf(tail, index);
        digest = nextDigest(digest, index, commitment);
        expected.set(chunkKey(context, index), tail);
      }
      if (digest !== checkpoint.digest) throw new Error('Private Balance public cache checkpoint is corrupt');
      return { checkpoint, raw, tail, expected, writes: new Map() };
    }
  }
  // Cold readers and reset/recovery paths validate the complete retained set once.
  const records = await storage.readPrefix(namespace);
  if (records.size > 0) {
    const retained = decodeRetained(context, records);
    return { ...retained, expected: new Map([[key, retained.raw]]), writes: new Map(),
      expectedPrefix: { prefix: namespace, entries: records } };
  }
  const checkpoint = emptyCheckpoint();
  return { checkpoint, raw: null, tail: null, writes: new Map(), expected: new Map([[key, null]]),
    expectedPrefix: { prefix: namespace, entries: records } };
}

export async function storePrivateBalanceCommitmentChunk(
  context: PrivateBalancePublicCacheContext,
  startIndex: bigint,
  commitments: readonly Uint8Array[],
  candidate?: PrivateBalancePublicCacheDriver,
): Promise<void> {
  if (!isPrivateIndex(startIndex)) {
    throw new Error('Private Balance public cache start index is invalid');
  }
  if (commitments.length === 0 || commitments.length > MAX_COMMITMENTS_PER_CHUNK) {
    throw new Error(`Private Balance public cache chunk must contain 1-${MAX_COMMITMENTS_PER_CHUNK} commitments`);
  }
  return appendRange(context, startIndex, commitments, candidate, false);
}

export async function recordVerifiedPrivateBalanceCommitments(
  context: PrivateBalancePublicCacheContext,
  startIndex: bigint,
  commitments: readonly Uint8Array[],
  candidate?: PrivateBalancePublicCacheDriver,
): Promise<void> {
  return appendRange(context, startIndex, commitments, candidate, true);
}

async function appendRange(
  context: PrivateBalancePublicCacheContext,
  startIndex: bigint,
  commitments: readonly Uint8Array[],
  candidate: PrivateBalancePublicCacheDriver | undefined,
  allowOverlap: boolean,
): Promise<void> {
  if (!isPrivateIndex(startIndex) || !isPrivateIndex(startIndex + BigInt(commitments.length))) {
    throw new Error('Verified Private Balance commitment range is invalid');
  }
  // readonly arrays do not freeze their Uint8Arrays: snapshot before any await.
  context = { ...context };
  const values = commitments.map(value => hexCommitment(value, 'Public commitment'));
  const storage = driver(candidate);
  const basis = await appendBasis(context, storage);
  const { checkpoint, writes, expected } = basis;
  if (!allowOverlap && startIndex !== checkpoint.count) throw new Error('Private Balance public cache writes must be contiguous');
  if (checkpoint.count < startIndex) {
    throw new Error('Private Balance public cache has a gap before verified commitments');
  }
  const overlap = privateBatchLength(checkpoint.count - startIndex, values.length);
  for (let index = 0; index < overlap; index += 1) {
    const key = chunkKey(context, startIndex + BigInt(index));
    const raw = writes.get(key) ?? expected.get(key) ?? await storage.read(key);
    if (decodeLeaf(raw, startIndex + BigInt(index)) !== values[index]) {
      throw new Error('Private Balance public cache conflicts with verified commitments');
    }
    if (!writes.has(key)) expected.set(key, raw);
  }
  const next = { ...checkpoint };
  let tail = basis.tail;
  for (let index = overlap; index < values.length; index += 1) {
    const leafIndex = startIndex + BigInt(index);
    const key = chunkKey(context, leafIndex);
    tail = leafRaw(leafIndex, values[index]);
    writes.set(key, tail);
    expected.set(key, null);
    next.digest = nextDigest(next.digest, leafIndex, values[index]);
    next.count += 1n;
  }
  const key = `${prefix(context)}checkpoint`;
  if (writes.size > 0 || basis.raw === null) {
    next.revision = basis.raw === null ? 0 : checkpoint.revision + 1;
    if (!safeIndex(next.revision)) throw new Error('Private Balance public cache revision is invalid');
    writes.set(key, stringifyPrivateIndices(next));
    // Every new record requires absence so a conflicting write is never overwritten.
    for (const entryKey of writes.keys()) if (!expected.has(entryKey)) expected.set(entryKey, null);
  }
  const result = await storage.compareAndSetMany(key, basis.raw === null ? null : checkpoint.revision,
    writes, [], basis.expectedPrefix, expected);
  if (!result.ok) throw new Error('Private Balance public cache changed in another wallet session');
  let snapshots = validated.get(storage);
  if (!snapshots) {
    snapshots = new Map();
    validated.set(storage, snapshots);
  }
  snapshots.set(prefix(context), { checkpoint: next, raw: writes.get(key) ?? basis.raw, tail });
}

export async function clearPrivateBalancePublicCache(
  context: PrivateBalancePublicCacheContext,
  candidate?: PrivateBalancePublicCacheDriver,
): Promise<void> {
  await Promise.all([
    clearPrivateBalanceCommitmentCache(context, candidate),
    clearPrivateBalanceMerkleCache(context, candidate),
  ]);
}

export async function clearPrivateBalanceCommitmentCache(
  context: PrivateBalancePublicCacheContext,
  candidate?: PrivateBalancePublicCacheDriver,
): Promise<void> {
  context = { ...context };
  const storage = driver(candidate);
  const namespace = prefix(context);
  const key = `${namespace}checkpoint`;
  const raw = await storage.read(key);
  const checkpoint = emptyCheckpoint();
  // A fresh generation fences reset/append ABA, including after corruption.
  await storage.replacePrefixVerified(namespace, new Map([[key, stringifyPrivateIndices(checkpoint)]]), [], {}, new Map([[key, raw]]));
  validated.get(storage)?.delete(namespace);
}
