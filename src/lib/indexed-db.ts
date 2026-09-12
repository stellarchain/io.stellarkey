export interface RecordDriverCompareResult {
  ok: boolean;
  current: string | null;
}

export interface RecordDriverExpectedPrefix {
  prefix: string;
  entries: ReadonlyMap<string, string>;
}

export interface RecordDriverGuard {
  signal?: AbortSignal;
  assertActive?(): void;
}

function assertRecordAuthority(guard: RecordDriverGuard): void {
  guard.signal?.throwIfAborted();
  guard.assertActive?.();
  guard.signal?.throwIfAborted();
}

export interface EncryptedRecordDriver {
  read(key: string): Promise<string | null>;
  readPrefix(prefix: string): Promise<Map<string, string>>;
  putVerified(key: string, value: string): Promise<string>;
  putManyVerified(entries: ReadonlyMap<string, string>): Promise<void>;
  compareAndSet(
    key: string,
    expectedRevision: number | null,
    value: string,
    guard?: RecordDriverGuard,
  ): Promise<RecordDriverCompareResult>;
  compareAndSetMany(
    key: string,
    expectedRevision: number | null,
    entries: ReadonlyMap<string, string>,
    removeKeys?: readonly string[],
    expectedPrefix?: RecordDriverExpectedPrefix,
    expectedRecords?: ReadonlyMap<string, string | null>,
  ): Promise<RecordDriverCompareResult>;
  replacePrefixVerified(
    prefix: string,
    entries: ReadonlyMap<string, string>,
    removeKeys?: readonly string[],
    guard?: RecordDriverGuard,
    expectedRecords?: ReadonlyMap<string, string | null>,
  ): Promise<void>;
  remove(key: string): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
}

interface StoredRecord {
  key: string;
  value: string;
}

const DATABASE_NAME = "wallet.local.v1";
const STORE_NAME = "encrypted-records";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionResult(transaction: IDBTransaction, drainAbort = false): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => {
      // A guarded operation must drain the rollback, not just the request error.
      if (!drainAbort) reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    };
  });
}

function revisionOf(raw: string | null): number | null | undefined {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { revision?: unknown };
    return Number.isSafeInteger(parsed.revision) && (parsed.revision as number) >= 0
      ? (parsed.revision as number)
      : undefined;
  } catch {
    return undefined;
  }
}

function openTransaction(
  database: IDBDatabase,
  mode: IDBTransactionMode,
): IDBTransaction {
  if (mode === "readonly") return database.transaction(STORE_NAME, mode);
  try {
    return database.transaction(STORE_NAME, mode, { durability: "strict" });
  } catch {
    // Older WebKit versions support IndexedDB transactions but not the
    // durability option. Transaction completion still remains the commit gate.
    return database.transaction(STORE_NAME, mode);
  }
}

export class IndexedDbEncryptedRecordDriver implements EncryptedRecordDriver {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is unavailable in this browser."));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab."));
    });
    return this.databasePromise;
  }

  async read(key: string): Promise<string | null> {
    const database = await this.database();
    const transaction = openTransaction(database, "readonly");
    const completed = transactionResult(transaction);
    const record = await requestResult(
      transaction.objectStore(STORE_NAME).get(key) as IDBRequest<StoredRecord | undefined>,
    );
    await completed;
    return record?.value ?? null;
  }

  async readPrefix(prefix: string): Promise<Map<string, string>> {
    const database = await this.database();
    const transaction = openTransaction(database, "readonly");
    const completed = transactionResult(transaction);
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const stored = await requestResult(
      transaction.objectStore(STORE_NAME).getAll(range) as IDBRequest<StoredRecord[]>,
    );
    await completed;
    return new Map(stored.map((record) => [record.key, record.value]));
  }

  async putVerified(key: string, value: string): Promise<string> {
    const database = await this.database();
    const transaction = openTransaction(database, "readwrite");
    const completed = transactionResult(transaction);
    const records = transaction.objectStore(STORE_NAME);
    await requestResult(records.put({ key, value }));
    const stored = await requestResult(records.get(key) as IDBRequest<StoredRecord | undefined>);
    if (stored?.value !== value) {
      transaction.abort();
      throw new Error("IndexedDB did not retain the encrypted record.");
    }
    await completed;
    return stored.value;
  }

  async putManyVerified(entries: ReadonlyMap<string, string>): Promise<void> {
    if (entries.size === 0) return;
    const database = await this.database();
    const transaction = openTransaction(database, "readwrite");
    const completed = transactionResult(transaction);
    const records = transaction.objectStore(STORE_NAME);
    for (const [key, value] of entries) {
      await requestResult(records.put({ key, value }));
    }
    for (const [key, value] of entries) {
      const stored = await requestResult(records.get(key) as IDBRequest<StoredRecord | undefined>);
      if (stored?.value !== value) {
        transaction.abort();
        throw new Error(`IndexedDB did not retain encrypted record ${key}.`);
      }
    }
    await completed;
  }

  async compareAndSet(
    key: string,
    expectedRevision: number | null,
    value: string,
    guard: RecordDriverGuard = {},
  ): Promise<RecordDriverCompareResult> {
    assertRecordAuthority(guard);
    const database = await this.database();
    assertRecordAuthority(guard);
    const transaction = openTransaction(database, "readwrite");
    const completed = transactionResult(transaction, true);
    // The abort event may precede a queued request rejection.
    void completed.catch(() => undefined);
    const abort = () => {
      try { transaction.abort(); } catch {
        // A transaction that has already committed cannot be undone.
      }
    };
    guard.signal?.addEventListener("abort", abort, { once: true });
    try {
      assertRecordAuthority(guard);
      const records = transaction.objectStore(STORE_NAME);
      const existing = await requestResult(records.get(key) as IDBRequest<StoredRecord | undefined>);
      assertRecordAuthority(guard);
      const current = existing?.value ?? null;
      if (revisionOf(current) !== expectedRevision) {
        await completed;
        assertRecordAuthority(guard);
        return { ok: false, current };
      }
      await requestResult(records.put({ key, value }));
      assertRecordAuthority(guard);
      const stored = await requestResult(records.get(key) as IDBRequest<StoredRecord | undefined>);
      assertRecordAuthority(guard);
      if (stored?.value !== value) throw new Error("IndexedDB did not retain the encrypted commit.");
      await completed;
      assertRecordAuthority(guard);
      return { ok: true, current: stored.value };
    } catch (error) {
      abort();
      await completed.catch(() => undefined);
      assertRecordAuthority(guard);
      throw error;
    } finally {
      guard.signal?.removeEventListener("abort", abort);
    }
  }

  async compareAndSetMany(
    key: string,
    expectedRevision: number | null,
    entries: ReadonlyMap<string, string>,
    removeKeys: readonly string[] = [],
    expectedPrefix?: RecordDriverExpectedPrefix,
    expectedRecords?: ReadonlyMap<string, string | null>,
  ): Promise<RecordDriverCompareResult> {
    // Bind the transaction to the exact caller snapshot before opening the DB.
    // Null expectations fence absence; revision alone cannot detect replacement.
    const expected = new Map(expectedRecords);
    const prefixSnapshot = expectedPrefix && {
      prefix: expectedPrefix.prefix, entries: new Map(expectedPrefix.entries),
    };
    const writes = new Map(entries);
    const removals = new Set(removeKeys);
    const database = await this.database();
    const transaction = openTransaction(database, "readwrite");
    const completed = transactionResult(transaction, true);
    void completed.catch(() => undefined);
    try {
      const records = transaction.objectStore(STORE_NAME);
      const existing = await requestResult(records.get(key) as IDBRequest<StoredRecord | undefined>);
      const current = existing?.value ?? null;
      if (revisionOf(current) !== expectedRevision) {
        await completed;
        return { ok: false, current };
      }
      if (prefixSnapshot) {
        const range = IDBKeyRange.bound(
          prefixSnapshot.prefix,
          `${prefixSnapshot.prefix}\uffff`,
        );
        const storedPrefix = await requestResult(
          records.getAll(range) as IDBRequest<StoredRecord[]>,
        );
        const actual = new Map(storedPrefix.map((record) => [record.key, record.value]));
        if (
          actual.size !== prefixSnapshot.entries.size ||
          [...prefixSnapshot.entries].some(([entryKey, value]) => actual.get(entryKey) !== value)
        ) {
          await completed;
          return { ok: false, current };
        }
      }
      for (const [entryKey, raw] of expected) {
        const stored = await requestResult(records.get(entryKey) as IDBRequest<StoredRecord | undefined>);
        if ((stored?.value ?? null) !== raw) {
          await completed;
          return { ok: false, current };
        }
      }
      for (const removeKey of removals) {
        if (!writes.has(removeKey)) await requestResult(records.delete(removeKey));
      }
      for (const [entryKey, value] of writes) {
        await requestResult(records.put({ key: entryKey, value }));
      }
      for (const [entryKey, value] of writes) {
        const stored = await requestResult(
          records.get(entryKey) as IDBRequest<StoredRecord | undefined>,
        );
        if (stored?.value !== value) {
          throw new Error("IndexedDB did not retain the complete record batch.");
        }
      }
      await completed;
      return { ok: true, current: writes.get(key) ?? null };
    } catch (error) {
      try { transaction.abort(); } catch { /* Already completed transactions cannot roll back. */ }
      await completed.catch(() => undefined);
      throw error;
    }
  }

  async replacePrefixVerified(
    prefix: string,
    entries: ReadonlyMap<string, string>,
    removeKeys: readonly string[] = [],
    guard: RecordDriverGuard = {},
    expectedRecords?: ReadonlyMap<string, string | null>,
  ): Promise<void> {
    assertRecordAuthority(guard);
    // Bind this removal to the caller's validated raw snapshot, including
    // absence. Copy before awaiting so later caller mutations cannot rebind it.
    const expected = expectedRecords === undefined ? undefined : new Map(expectedRecords);
    const database = await this.database();
    assertRecordAuthority(guard);
    const transaction = openTransaction(database, "readwrite");
    const completed = transactionResult(transaction, true);
    void completed.catch(() => undefined);
    const abort = () => {
      try { transaction.abort(); } catch { /* Already completed transactions cannot roll back. */ }
    };
    guard.signal?.addEventListener("abort", abort, { once: true });
    try {
      assertRecordAuthority(guard);
      const records = transaction.objectStore(STORE_NAME);
      const existing = await requestResult(records.getAll() as IDBRequest<StoredRecord[]>);
      assertRecordAuthority(guard);
      if (expected) {
        const current = new Map(existing.map(record => [record.key, record.value]));
        if ([...expected].some(([key, value]) => (current.has(key) ? current.get(key) : null) !== value)) {
          throw new Error("Encrypted records changed before removal. Refresh and try again.");
        }
      }
      for (const record of existing) {
        if (record.key.startsWith(prefix)) {
          await requestResult(records.delete(record.key));
          assertRecordAuthority(guard);
        }
      }
      for (const key of removeKeys) {
        await requestResult(records.delete(key));
        assertRecordAuthority(guard);
      }
      for (const [key, value] of entries) {
        await requestResult(records.put({ key, value }));
        assertRecordAuthority(guard);
      }
      const retained = await requestResult(records.getAll() as IDBRequest<StoredRecord[]>);
      assertRecordAuthority(guard);
      const actual = new Map(
        retained
          .filter((record) => record.key.startsWith(prefix))
          .map((record) => [record.key, record.value]),
      );
      const expectedPrefix = new Map(
        [...entries].filter(([key]) => key.startsWith(prefix)),
      );
      if (
        actual.size !== expectedPrefix.size ||
        [...expectedPrefix].some(([key, value]) => actual.get(key) !== value) ||
        [...entries].some(([key, value]) =>
          retained.find((record) => record.key === key)?.value !== value)
      ) throw new Error("IndexedDB did not retain the complete encrypted record set.");
      await completed;
      assertRecordAuthority(guard);
    } catch (error) {
      abort();
      await completed.catch(() => undefined);
      assertRecordAuthority(guard);
      throw error;
    } finally {
      guard.signal?.removeEventListener("abort", abort);
    }
  }

  async remove(key: string): Promise<void> {
    const database = await this.database();
    const transaction = openTransaction(database, "readwrite");
    const completed = transactionResult(transaction);
    await requestResult(transaction.objectStore(STORE_NAME).delete(key));
    await completed;
  }

  async removePrefix(prefix: string): Promise<void> {
    await this.replacePrefixVerified(prefix, new Map());
  }
}
