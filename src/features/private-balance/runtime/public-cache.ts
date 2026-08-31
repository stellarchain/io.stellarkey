import {
  IndexedDbEncryptedRecordDriver,
  type EncryptedRecordDriver,
} from '../../../lib/indexed-db';

const RECORD_KIND = 'public-commitment-chunk';
const RECORD_VERSION = 1;
const MAX_COMMITMENTS_PER_CHUNK = 256;

export interface PrivateBalancePublicCacheContext {
  networkId: string;
  realmId: string;
  poolId: string;
}

export type PrivateBalancePublicCacheDriver = Pick<
  EncryptedRecordDriver,
  'readPrefix' | 'compareAndSet' | 'removePrefix'
>;

interface CommitmentChunkRecord {
  kind: typeof RECORD_KIND;
  version: typeof RECORD_VERSION;
  revision: 0;
  startIndex: number;
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
    'private:cache:v1',
    hexContext(context.networkId, 'network ID'),
    hexContext(context.realmId, 'realm ID'),
    hexContext(context.poolId, 'pool ID'),
    '',
  ].join(':');
}

function chunkKey(context: PrivateBalancePublicCacheContext, startIndex: number): string {
  return `${prefix(context)}commitments:${startIndex.toString().padStart(16, '0')}`;
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

function decodeChunk(raw: string): CommitmentChunkRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Private Balance public cache record is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Private Balance public cache record is invalid');
  }
  const record = value as Partial<CommitmentChunkRecord>;
  if (
    record.kind !== RECORD_KIND ||
    record.version !== RECORD_VERSION ||
    record.revision !== 0 ||
    !safeIndex(record.startIndex) ||
    !Array.isArray(record.commitments) ||
    record.commitments.length === 0 ||
    record.commitments.length > MAX_COMMITMENTS_PER_CHUNK
  ) {
    throw new Error('Private Balance public cache record is invalid');
  }
  for (const commitment of record.commitments) decodeCommitment(commitment);
  return record as CommitmentChunkRecord;
}

export async function loadPrivateBalanceCommitments(
  context: PrivateBalancePublicCacheContext,
  candidate?: PrivateBalancePublicCacheDriver,
): Promise<Uint8Array[]> {
  const namespace = prefix(context);
  const records = await driver(candidate).readPrefix(`${namespace}commitments:`);
  const chunks = [...records.entries()]
    .map(([key, raw]) => ({ key, record: decodeChunk(raw) }))
    .sort((left, right) => left.record.startIndex - right.record.startIndex);
  const commitments: Uint8Array[] = [];
  for (const { key, record } of chunks) {
    if (key !== chunkKey(context, record.startIndex) || record.startIndex !== commitments.length) {
      throw new Error('Private Balance public cache commitment chunks are not contiguous');
    }
    commitments.push(...record.commitments.map(decodeCommitment));
  }
  return commitments;
}

export async function storePrivateBalanceCommitmentChunk(
  context: PrivateBalancePublicCacheContext,
  startIndex: number,
  commitments: readonly Uint8Array[],
  candidate?: PrivateBalancePublicCacheDriver,
): Promise<void> {
  if (!safeIndex(startIndex)) {
    throw new Error('Private Balance public cache start index is invalid');
  }
  if (commitments.length === 0 || commitments.length > MAX_COMMITMENTS_PER_CHUNK) {
    throw new Error(`Private Balance public cache chunk must contain 1-${MAX_COMMITMENTS_PER_CHUNK} commitments`);
  }
  const existing = await loadPrivateBalanceCommitments(context, candidate);
  if (startIndex !== existing.length) {
    throw new Error('Private Balance public cache writes must be contiguous');
  }
  const record: CommitmentChunkRecord = {
    kind: RECORD_KIND,
    version: RECORD_VERSION,
    revision: 0,
    startIndex,
    commitments: commitments.map((value, index) =>
      hexCommitment(value, `Private Balance public commitment ${index}`)),
  };
  const result = await driver(candidate).compareAndSet(
    chunkKey(context, startIndex),
    null,
    JSON.stringify(record),
  );
  if (!result.ok) {
    throw new Error('Private Balance public cache changed in another wallet session');
  }
}

export async function recordVerifiedPrivateBalanceCommitments(
  context: PrivateBalancePublicCacheContext,
  startIndex: number,
  commitments: readonly Uint8Array[],
  candidate?: PrivateBalancePublicCacheDriver,
): Promise<void> {
  if (!safeIndex(startIndex) || commitments.length === 0) {
    throw new Error('Verified Private Balance commitment range is invalid');
  }
  const existing = await loadPrivateBalanceCommitments(context, candidate);
  if (existing.length < startIndex) {
    throw new Error('Private Balance public cache has a gap before verified commitments');
  }
  const overlap = Math.min(existing.length - startIndex, commitments.length);
  for (let index = 0; index < overlap; index += 1) {
    if (!equalBytes(existing[startIndex + index], commitments[index])) {
      throw new Error('Private Balance public cache conflicts with verified commitments');
    }
  }
  const missing = commitments.slice(overlap);
  if (missing.length === 0) return;
  if (existing.length !== startIndex + overlap) {
    throw new Error('Private Balance public cache overlaps a noncontiguous verified range');
  }
  for (let offset = 0; offset < missing.length; offset += MAX_COMMITMENTS_PER_CHUNK) {
    const chunk = missing.slice(offset, offset + MAX_COMMITMENTS_PER_CHUNK);
    await storePrivateBalanceCommitmentChunk(
      context,
      existing.length + offset,
      chunk,
      candidate,
    );
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export function clearPrivateBalancePublicCache(
  context: PrivateBalancePublicCacheContext,
  candidate?: PrivateBalancePublicCacheDriver,
): Promise<void> {
  return driver(candidate).removePrefix(prefix(context));
}
