import type { StorageLoadResult } from "../storage-load";
import {
  IndexedDbEncryptedRecordDriver,
  type EncryptedRecordDriver,
} from "../indexed-db";
import {
  decryptMerchantRecord,
  encryptMerchantRecord,
  isEncryptedMerchantRecordArchive,
  isEncryptedMerchantRecordEnvelope,
  type EncryptedMerchantRecordArchive,
  type EncryptedMerchantRecordEnvelope,
} from "./record-crypto";
import {
  decodeMerchantStore,
  prune,
} from "./storage";
import type { MerchantStore } from "./types";

const RECORD_ROOT_PREFIX = "merchant.records.v1:";
const RECORD_META_KEY = `${RECORD_ROOT_PREFIX}meta`;
const RECORD_DATA_PREFIX = `${RECORD_ROOT_PREFIX}data:`;

const RECORD_COLLECTIONS = [
  "catalogue",
  "modifierGroups",
  "orders",
  "charges",
  "refunds",
  "unmatched",
  "paymentReconciliations",
  "staff",
  "shifts",
  "invoices",
  "counterCodes",
  "counterPayments",
  "customers",
  "adjustments",
  "refundRequests",
  "peripherals",
  "exportRecords",
] as const;

type RecordCollection = (typeof RECORD_COLLECTIONS)[number];

interface MerchantRecordPayload {
  schema: 1;
  collection: RecordCollection;
  identity: string;
  position: number;
  value: unknown;
}

interface MerchantMetadataPayload {
  schema: 1;
  store: Record<string, unknown>;
  recordCounts: Record<RecordCollection, number>;
}

interface PersistedRecordState {
  storageKey: string;
  raw: string;
  payload: MerchantRecordPayload;
  fingerprint: string;
}

interface RepositorySnapshot {
  store: MerchantStore;
  metaRaw: string;
  records: Map<string, PersistedRecordState>;
}

interface BuiltRecordSet {
  all: Map<string, string>;
  puts: Map<string, string>;
  removeKeys: string[];
  snapshot: RepositorySnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRecordCollection(value: unknown): value is RecordCollection {
  return typeof value === "string" && (RECORD_COLLECTIONS as readonly string[]).includes(value);
}

function identityFor(collection: RecordCollection, value: unknown): string {
  if (!isRecord(value)) throw new Error(`Merchant ${collection} record is invalid.`);
  const identity = collection === "customers" ? value.address : value.id;
  if (typeof identity !== "string" || !identity) {
    throw new Error(`Merchant ${collection} record has no stable identity.`);
  }
  return identity;
}

function recordFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function encryptionMetadata(store: MerchantStore) {
  return {
    revision: store.revision,
    writerId: store.writerId,
    updatedAt: store.updatedAt,
  };
}

function metadataPayload(store: MerchantStore): MerchantMetadataPayload {
  const metadata = { ...store } as unknown as Record<string, unknown>;
  const recordCounts = {} as Record<RecordCollection, number>;
  for (const collection of RECORD_COLLECTIONS) {
    const records = store[collection] as unknown[];
    recordCounts[collection] = records.length;
    delete metadata[collection];
  }
  return { schema: 1, store: metadata, recordCounts };
}

function previousCollection(
  snapshot: RepositorySnapshot | null,
  collection: RecordCollection,
): Map<string, PersistedRecordState> {
  const records = new Map<string, PersistedRecordState>();
  if (!snapshot) return records;
  for (const state of snapshot.records.values()) {
    if (state.payload.collection === collection) records.set(state.payload.identity, state);
  }
  return records;
}

function opaqueDataKey(existing: ReadonlyMap<string, string>): string {
  let storageKey = "";
  do {
    storageKey = `${RECORD_DATA_PREFIX}${randomToken()}`;
  } while (existing.has(storageKey));
  return storageKey;
}

/** Keep stable positions for existing records; new runs consume only the gap around them. */
function collectionPositions(
  identities: readonly string[],
  previous: ReadonlyMap<string, PersistedRecordState>,
): number[] {
  const positions = identities.map((identity) => previous.get(identity)?.payload.position ?? null);
  let prior = Number.NEGATIVE_INFINITY;
  let existingOrderIsStable = true;
  for (const position of positions) {
    if (position === null) continue;
    if (!Number.isFinite(position) || position <= prior) {
      existingOrderIsStable = false;
      break;
    }
    prior = position;
  }
  if (!existingOrderIsStable) return identities.map((_, index) => index);

  let cursor = 0;
  while (cursor < positions.length) {
    if (positions[cursor] !== null) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < positions.length && positions[cursor] === null) cursor += 1;
    const count = cursor - start;
    const left = start > 0 ? positions[start - 1] : null;
    const right = cursor < positions.length ? positions[cursor] : null;
    for (let offset = 0; offset < count; offset += 1) {
      if (left !== null && right !== null) {
        positions[start + offset] = left + ((right - left) * (offset + 1)) / (count + 1);
      } else if (left !== null) {
        positions[start + offset] = left + offset + 1;
      } else if (right !== null) {
        positions[start + offset] = right - count + offset;
      } else {
        positions[start + offset] = offset;
      }
    }
  }
  const resolved = positions as number[];
  if (resolved.some((position, index) =>
    !Number.isFinite(position) || (index > 0 && position <= resolved[index - 1]))) {
    return identities.map((_, index) => index);
  }
  return resolved;
}

function buildRecordSet(
  store: MerchantStore,
  key: Uint8Array,
  previous: RepositorySnapshot | null,
): BuiltRecordSet {
  const metadata = encryptionMetadata(store);
  const metaRaw = JSON.stringify(
    encryptMerchantRecord(metadataPayload(store), key, RECORD_META_KEY, metadata),
  );
  const all = new Map<string, string>([[RECORD_META_KEY, metaRaw]]);
  const puts = new Map<string, string>([[RECORD_META_KEY, metaRaw]]);
  const persisted = new Map<string, PersistedRecordState>();

  for (const collection of RECORD_COLLECTIONS) {
    const values = store[collection] as unknown[];
    const identities = values.map((value) => identityFor(collection, value));
    if (new Set(identities).size !== identities.length) {
      throw new Error(`Merchant ${collection} contains duplicate record identities.`);
    }
    const previousRecords = previousCollection(previous, collection);
    const positions = collectionPositions(identities, previousRecords);
    values.forEach((value, index) => {
      const identity = identities[index];
      const fingerprint = recordFingerprint(value);
      const old = previousRecords.get(identity);
      const storageKey = old?.storageKey ?? opaqueDataKey(all);
      const payload: MerchantRecordPayload = {
        schema: 1,
        collection,
        identity,
        position: positions[index],
        value,
      };
      const unchanged = old &&
        old.fingerprint === fingerprint &&
        old.payload.position === payload.position;
      const raw = unchanged
        ? old.raw
        : JSON.stringify(encryptMerchantRecord(payload, key, storageKey, metadata));
      all.set(storageKey, raw);
      persisted.set(storageKey, { storageKey, raw, payload, fingerprint });
      if (!unchanged) puts.set(storageKey, raw);
    });
  }

  const removeKeys = previous
    ? [...previous.records.keys()].filter((storageKey) => !persisted.has(storageKey))
    : [];
  return {
    all,
    puts,
    removeKeys,
    snapshot: { store, metaRaw, records: persisted },
  };
}

function archiveRaw(
  meta: Pick<EncryptedMerchantRecordEnvelope, "revision" | "writerId" | "updatedAt">,
  records: ReadonlyMap<string, string>,
): string {
  const archive: EncryptedMerchantRecordArchive = {
    kind: "stellarkey-merchant-record-archive",
    version: 1,
    revision: meta.revision,
    writerId: meta.writerId,
    updatedAt: meta.updatedAt,
    records: Object.fromEntries([...records].sort(([left], [right]) => left.localeCompare(right))),
  };
  return JSON.stringify(archive);
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class MerchantRepositoryConflictError extends Error {
  readonly currentRaw: string | null;

  constructor(currentRaw: string | null) {
    super("Merchant data changed in another tab.");
    this.name = "MerchantRepositoryConflictError";
    this.currentRaw = currentRaw;
  }
}

export class MerchantRepository {
  readonly recordKey = RECORD_META_KEY;
  readonly dataPrefix = RECORD_DATA_PREFIX;
  private readonly driver: EncryptedRecordDriver;
  private snapshot: RepositorySnapshot | null = null;

  constructor(driver: EncryptedRecordDriver) {
    this.driver = driver;
  }

  private decodeRecordSet(
    metaRaw: string,
    recordRaws: ReadonlyMap<string, string>,
    key: Uint8Array,
  ): StorageLoadResult<MerchantStore> {
    let metaEnvelope: EncryptedMerchantRecordEnvelope | null = null;
    try {
      const parsedMeta: unknown = JSON.parse(metaRaw);
      if (!isEncryptedMerchantRecordEnvelope(parsedMeta)) {
        if (
          isRecord(parsedMeta) &&
          parsedMeta.kind === "stellarkey-merchant-record" &&
          typeof parsedMeta.version === "number" &&
          parsedMeta.version > 1
        ) {
          return {
            kind: "future",
            raw: metaRaw,
            version: parsedMeta.version,
            message: `Merchant records use a newer schema (${parsedMeta.version}).`,
          };
        }
        throw new Error("Merchant metadata envelope is invalid.");
      }
      metaEnvelope = parsedMeta;
      const decryptedMeta = decryptMerchantRecord(parsedMeta, key, RECORD_META_KEY);
      if (
        !isRecord(decryptedMeta) ||
        decryptedMeta.schema !== 1 ||
        !isRecord(decryptedMeta.store) ||
        !isRecord(decryptedMeta.recordCounts)
      ) {
        throw new Error("Merchant metadata payload is invalid.");
      }
      const metadata = decryptedMeta as unknown as MerchantMetadataPayload;
      const collections = Object.fromEntries(
        RECORD_COLLECTIONS.map((collection) => [collection, []]),
      ) as unknown as Record<RecordCollection, Array<{ position: number; value: unknown }>>;
      const persisted = new Map<string, PersistedRecordState>();

      for (const [storageKey, raw] of recordRaws) {
        const parsed: unknown = JSON.parse(raw);
        if (!isEncryptedMerchantRecordEnvelope(parsed)) {
          throw new Error("Merchant history envelope is invalid.");
        }
        if (parsed.revision > parsedMeta.revision) {
          throw new Error("Merchant history is newer than its metadata.");
        }
        const decrypted = decryptMerchantRecord(parsed, key, storageKey);
        if (
          !isRecord(decrypted) ||
          decrypted.schema !== 1 ||
          !isRecordCollection(decrypted.collection) ||
          typeof decrypted.identity !== "string" ||
          !decrypted.identity ||
          typeof decrypted.position !== "number" ||
          !Number.isFinite(decrypted.position) ||
          !storageKey.startsWith(RECORD_DATA_PREFIX) ||
          identityFor(decrypted.collection, decrypted.value) !== decrypted.identity
        ) {
          throw new Error("Merchant history payload is invalid.");
        }
        const payload = decrypted as unknown as MerchantRecordPayload;
        if (persisted.has(storageKey)) throw new Error("Merchant history contains a duplicate record.");
        persisted.set(storageKey, {
          storageKey,
          raw,
          payload,
          fingerprint: recordFingerprint(payload.value),
        });
        collections[payload.collection].push({ position: payload.position, value: payload.value });
      }

      const candidate: Record<string, unknown> = { ...metadata.store };
      for (const collection of RECORD_COLLECTIONS) {
        if (collection in metadata.store) throw new Error("Merchant metadata contains history rows.");
        const expected = metadata.recordCounts[collection];
        if (!Number.isSafeInteger(expected) || expected < 0) {
          throw new Error("Merchant metadata record count is invalid.");
        }
        const records = collections[collection].sort((left, right) => left.position - right.position);
        if (records.length !== expected) throw new Error("Merchant history record count does not match.");
        for (let index = 1; index < records.length; index += 1) {
          if (records[index].position <= records[index - 1].position) {
            throw new Error("Merchant history record order is ambiguous.");
          }
        }
        candidate[collection] = records.map((record) => record.value);
      }
      const decoded = decodeMerchantStore(candidate);
      if (
        !decoded ||
        decoded.revision !== parsedMeta.revision ||
        decoded.writerId !== parsedMeta.writerId ||
        decoded.updatedAt !== parsedMeta.updatedAt
      ) {
        throw new Error("Merchant metadata does not match its records.");
      }
      this.snapshot = { store: decoded, metaRaw, records: persisted };
      return { kind: "ready", value: decoded };
    } catch {
      const raw = metaEnvelope
        ? archiveRaw(metaEnvelope, new Map([[RECORD_META_KEY, metaRaw], ...recordRaws]))
        : metaRaw;
      return {
        kind: "corrupt",
        raw,
        message: "Encrypted merchant records could not be decrypted or authenticated.",
      };
    }
  }

  async load(key: Uint8Array): Promise<StorageLoadResult<MerchantStore>> {
    const metaRaw = await this.driver.read(RECORD_META_KEY);
    if (metaRaw !== null) {
      return this.decodeRecordSet(metaRaw, await this.driver.readPrefix(RECORD_DATA_PREFIX), key);
    }
    this.snapshot = null;
    return { kind: "absent" };
  }

  /**
   * Resolve the persisted basis for a local commit without decrypting the full
   * retained history when the metadata bytes still match our authenticated
   * snapshot. Any external write or same-revision corruption changes those
   * bytes and falls back to the complete fail-closed load path.
   */
  async loadCommitBasis(key: Uint8Array): Promise<StorageLoadResult<MerchantStore>> {
    const metaRaw = await this.driver.read(RECORD_META_KEY);
    if (this.snapshot && metaRaw === this.snapshot.metaRaw) {
      return { kind: "ready", value: this.snapshot.store };
    }
    if (metaRaw === null && this.snapshot === null) {
      return { kind: "absent" };
    }
    return this.load(key);
  }

  async commit(
    store: MerchantStore,
    key: Uint8Array,
    expectedRevision: number | null,
  ): Promise<MerchantStore> {
    if (expectedRevision !== null && this.snapshot?.store.revision !== expectedRevision) {
      const current = await this.load(key);
      if (current.kind !== "ready" || current.value.revision !== expectedRevision) {
        throw new MerchantRepositoryConflictError(
          current.kind === "ready" ? this.snapshot?.metaRaw ?? null : null,
        );
      }
    }
    const retained = prune(store);
    const built = buildRecordSet(retained, key, this.snapshot);
    const result = await this.driver.compareAndSetMany(
      RECORD_META_KEY,
      expectedRevision,
      built.puts,
      built.removeKeys,
      this.snapshot
        ? {
            prefix: RECORD_DATA_PREFIX,
            entries: new Map(
              [...this.snapshot.records].map(([storageKey, state]) => [storageKey, state.raw]),
            ),
          }
        : undefined,
    );
    if (!result.ok) throw new MerchantRepositoryConflictError(result.current);
    if (result.current === null) throw new Error("IndexedDB did not return committed merchant metadata.");
    const verifiedMeta: unknown = JSON.parse(result.current);
    if (!isEncryptedMerchantRecordEnvelope(verifiedMeta)) {
      throw new Error("IndexedDB merchant metadata could not be verified.");
    }
    const decodedMeta = decryptMerchantRecord(verifiedMeta, key, RECORD_META_KEY);
    if (!isRecord(decodedMeta) || decodedMeta.schema !== 1) {
      throw new Error("IndexedDB merchant commit could not be verified.");
    }
    this.snapshot = built.snapshot;
    return retained;
  }

  async exportEncryptedArchive(key: Uint8Array): Promise<string | null> {
    const metaRaw = await this.driver.read(RECORD_META_KEY);
    if (metaRaw === null) return null;
    const parsed: unknown = JSON.parse(metaRaw);
    if (!isEncryptedMerchantRecordEnvelope(parsed)) {
      throw new Error("Merchant recovery metadata is invalid.");
    }
    const dataRecords = await this.driver.readPrefix(RECORD_DATA_PREFIX);
    const decoded = this.decodeRecordSet(metaRaw, dataRecords, key);
    if (decoded.kind !== "ready") {
      throw new Error("Merchant recovery data is corrupt or could not be authenticated.");
    }
    return archiveRaw(parsed, new Map([[RECORD_META_KEY, metaRaw], ...dataRecords]));
  }

  /** Capture exact ciphertext only for failure-atomic restore rollback. */
  async snapshotEncryptedArchive(): Promise<string | null> {
    const metaRaw = await this.driver.read(RECORD_META_KEY);
    if (metaRaw === null) return null;
    const parsed: unknown = JSON.parse(metaRaw);
    if (!isEncryptedMerchantRecordEnvelope(parsed)) {
      throw new Error("Merchant recovery metadata is invalid.");
    }
    const dataRecords = await this.driver.readPrefix(RECORD_DATA_PREFIX);
    return archiveRaw(parsed, new Map([[RECORD_META_KEY, metaRaw], ...dataRecords]));
  }

  async importEncryptedArchive(raw: string): Promise<void> {
    const parsed: unknown = JSON.parse(raw);
    if (!isEncryptedMerchantRecordArchive(parsed)) {
      throw new Error("Merchant recovery archive is invalid.");
    }
    const records = new Map(Object.entries(parsed.records));
    const metaRaw = records.get(RECORD_META_KEY);
    if (!metaRaw || [...records.keys()].some((storageKey) =>
      storageKey !== RECORD_META_KEY && !storageKey.startsWith(RECORD_DATA_PREFIX))) {
      throw new Error("Merchant recovery archive contains unsupported records.");
    }
    const meta: unknown = JSON.parse(metaRaw);
    if (
      !isEncryptedMerchantRecordEnvelope(meta) ||
      meta.revision !== parsed.revision ||
      meta.writerId !== parsed.writerId ||
      meta.updatedAt !== parsed.updatedAt
    ) {
      throw new Error("Merchant recovery archive metadata does not match.");
    }
    await this.driver.replacePrefixVerified(RECORD_ROOT_PREFIX, records);
    this.snapshot = null;
  }

  async clear(): Promise<void> {
    await this.driver.replacePrefixVerified(RECORD_ROOT_PREFIX, new Map());
    this.snapshot = null;
  }
}

export function isSupportedEncryptedMerchantArchive(value: unknown): boolean {
  return isEncryptedMerchantRecordArchive(value);
}

let repository: MerchantRepository | null = null;

export function getMerchantRepository(): MerchantRepository {
  repository ??= new MerchantRepository(new IndexedDbEncryptedRecordDriver());
  return repository;
}
