import {
  IndexedDbEncryptedRecordDriver,
  type EncryptedRecordDriver,
} from '../../../lib/indexed-db';
import {
  commitPrivateBalanceState,
  loadPrivateBalanceState,
  type PrivateRecordDriver,
  type PrivateStorageContext,
} from './storage';
import type { PrivateBalanceDurableState } from './types';

const SENSITIVE_PREFIX = 'private:sensitive:v1:';
const MAX_RECORDS = 4_096;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const HEX_32 = /^[0-9a-f]{64}$/;

export interface PrivateBalanceBackupRecord {
  key: string;
  value: string;
}

export interface PrivateBalanceBackupArchive {
  schemaVersion: 1;
  records: PrivateBalanceBackupRecord[];
}

interface BackupRecordDriver extends PrivateRecordDriver {
  readPrefix(prefix: string): Promise<Map<string, string>>;
  replacePrefixVerified(prefix: string, entries: ReadonlyMap<string, string>): Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseContextKey(key: string): PrivateStorageContext {
  const parts = key.split(':');
  if (
    parts.length !== 9 ||
    parts[0] !== 'private' ||
    parts[1] !== 'sensitive' ||
    parts[2] !== 'v1' ||
    parts[8] !== 'state'
  ) {
    throw new Error('Private Balance backup contains an invalid sensitive record key.');
  }
  const [networkId, realmId, poolId, accountId, deploymentBindingHash] = parts.slice(3, 8);
  if (
    !HEX_32.test(networkId) ||
    !HEX_32.test(realmId) ||
    !HEX_32.test(poolId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(accountId) ||
    !HEX_32.test(deploymentBindingHash)
  ) {
    throw new Error('Private Balance backup record context is invalid.');
  }
  return { networkId, realmId, poolId, accountId, deploymentBindingHash };
}

function validateEncryptedRecord(value: string): void {
  if (new TextEncoder().encode(value).byteLength > MAX_RECORD_BYTES) {
    throw new Error('Private Balance backup record exceeds the size limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Private Balance backup record envelope is malformed.');
  }
  if (!isObject(parsed) || !isObject(parsed.crypto)) {
    throw new Error('Private Balance backup record envelope is malformed.');
  }
  if (
    parsed.kind !== 'stellarkey-private-balance-state' ||
    parsed.version !== 1 ||
    !Number.isSafeInteger(parsed.revision) ||
    (parsed.revision as number) < 0 ||
    typeof parsed.crypto.iv !== 'string' ||
    parsed.crypto.iv.length === 0 ||
    typeof parsed.crypto.ciphertext !== 'string' ||
    parsed.crypto.ciphertext.length === 0
  ) {
    throw new Error('Private Balance backup record envelope is unsupported.');
  }
}

export function decodePrivateBalanceBackupArchive(
  input: string | unknown,
): PrivateBalanceBackupArchive {
  let value = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error('Private Balance backup archive exceeds the size limit.');
    }
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error('Private Balance backup archive is malformed.');
    }
  }
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.records)) {
    throw new Error('Private Balance backup archive schema is unsupported.');
  }
  if (value.records.length > MAX_RECORDS) {
    throw new Error('Private Balance backup archive contains too many records.');
  }
  const seen = new Set<string>();
  const records = value.records.map(candidate => {
    if (!isObject(candidate) || typeof candidate.key !== 'string' || typeof candidate.value !== 'string') {
      throw new Error('Private Balance backup archive contains an invalid record.');
    }
    parseContextKey(candidate.key);
    validateEncryptedRecord(candidate.value);
    if (seen.has(candidate.key)) throw new Error('Private Balance backup archive contains duplicate records.');
    seen.add(candidate.key);
    return { key: candidate.key, value: candidate.value };
  });
  const encodedSize = records.reduce(
    (total, record) => total + record.key.length + record.value.length,
    0,
  );
  if (encodedSize > MAX_ARCHIVE_BYTES) {
    throw new Error('Private Balance backup archive exceeds the size limit.');
  }
  return { schemaVersion: 1, records };
}

export async function exportPrivateBalanceBackupArchive(
  driver: Pick<EncryptedRecordDriver, 'readPrefix'> = new IndexedDbEncryptedRecordDriver(),
): Promise<PrivateBalanceBackupArchive> {
  const records = [...await driver.readPrefix(SENSITIVE_PREFIX)]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value }));
  return decodePrivateBalanceBackupArchive({ schemaVersion: 1, records });
}

class StagingDriver implements BackupRecordDriver {
  public readonly records: Map<string, string>;

  public constructor(records: Map<string, string>) {
    this.records = records;
  }

  public async read(key: string): Promise<string | null> {
    return this.records.get(key) ?? null;
  }

  public async readPrefix(prefix: string): Promise<Map<string, string>> {
    return new Map([...this.records].filter(([key]) => key.startsWith(prefix)));
  }

  public async compareAndSet(
    key: string,
    expectedRevision: number | null,
    value: string,
  ): Promise<{ ok: boolean; current: string | null }> {
    const current = this.records.get(key) ?? null;
    let revision: number | null | undefined = null;
    if (current !== null) {
      try {
        const parsed = JSON.parse(current) as { revision?: unknown };
        revision = Number.isSafeInteger(parsed.revision) ? parsed.revision as number : undefined;
      } catch {
        revision = undefined;
      }
    }
    if (revision !== expectedRevision) return { ok: false, current };
    this.records.set(key, value);
    return { ok: true, current: value };
  }

  public async replacePrefixVerified(
    prefix: string,
    entries: ReadonlyMap<string, string>,
  ): Promise<void> {
    for (const key of [...this.records.keys()]) if (key.startsWith(prefix)) this.records.delete(key);
    for (const [key, value] of entries) this.records.set(key, value);
  }

  public async removePrefix(prefix: string): Promise<void> {
    await this.replacePrefixVerified(prefix, new Map());
  }
}

export async function preparePrivateBalanceBackupArchive(input: {
  archive: string | unknown;
  resolveStorageKey: (context: PrivateStorageContext) => Promise<Uint8Array>;
  validateContext: (
    context: PrivateStorageContext,
    state: PrivateBalanceDurableState,
  ) => Promise<void>;
  now?: () => number;
}): Promise<PrivateBalanceBackupArchive> {
  const archive = decodePrivateBalanceBackupArchive(input.archive);
  const staged = new StagingDriver(new Map(archive.records.map(record => [record.key, record.value])));
  const now = input.now?.() ?? Date.now();
  if (!Number.isFinite(now) || now < 0) throw new Error('Private Balance restore timestamp is invalid.');

  for (const record of archive.records) {
    const context = parseContextKey(record.key);
    const storageKey = await input.resolveStorageKey(context);
    try {
      if (!(storageKey instanceof Uint8Array) || storageKey.length !== 32) {
        throw new Error('Private Balance restore storage key is invalid.');
      }
      const state = await loadPrivateBalanceState(context, storageKey, staged);
      if (!state) throw new Error('Private Balance backup record is missing from staging.');
      await input.validateContext(context, state);
      const preProofNoteIds = new Set(
        state.buildReservations.flatMap(reservation => reservation.reservedNoteIds),
      );
      const requiresReconciliation: PrivateBalanceDurableState = {
        ...state,
        revision: state.revision + 1,
        account: {
          ...state.account,
          syncStatus: 'never',
          updatedAt: now,
        },
        notes: state.notes.map(note => preProofNoteIds.has(note.id)
          ? { ...note, status: 'unspent' as const, reservedAt: undefined }
          : { ...note }),
        buildReservations: [],
      };
      await commitPrivateBalanceState(
        context,
        storageKey,
        requiresReconciliation,
        state.revision,
        staged,
      );
    } finally {
      storageKey.fill(0);
    }
  }

  return decodePrivateBalanceBackupArchive({
    schemaVersion: 1,
    records: [...await staged.readPrefix(SENSITIVE_PREFIX)]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, value })),
  });
}

export async function replacePrivateBalanceBackupArchive(
  archive: string | unknown,
  driver: Pick<EncryptedRecordDriver, 'replacePrefixVerified'> = new IndexedDbEncryptedRecordDriver(),
): Promise<void> {
  const decoded = decodePrivateBalanceBackupArchive(archive);
  await driver.replacePrefixVerified(
    SENSITIVE_PREFIX,
    new Map(decoded.records.map(record => [record.key, record.value])),
  );
}

export async function restorePrivateBalanceBackupArchive(input: {
  archive: string | unknown;
  driver?: BackupRecordDriver;
  resolveStorageKey: (context: PrivateStorageContext) => Promise<Uint8Array>;
  validateContext: (
    context: PrivateStorageContext,
    state: PrivateBalanceDurableState,
  ) => Promise<void>;
  now?: () => number;
}): Promise<{ restoredContexts: number }> {
  const prepared = await preparePrivateBalanceBackupArchive(input);
  await replacePrivateBalanceBackupArchive(
    prepared,
    input.driver ?? new IndexedDbEncryptedRecordDriver(),
  );
  return { restoredContexts: prepared.records.length };
}
