export interface RecordDriverCompareResult {
  ok: boolean;
  current: string | null;
}

export interface EncryptedRecordDriver {
  read(key: string): Promise<string | null>;
  putVerified(key: string, value: string): Promise<string>;
  compareAndSet(
    key: string,
    expectedRevision: number | null,
    value: string,
  ): Promise<RecordDriverCompareResult>;
  remove(key: string): Promise<void>;
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

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
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

  async compareAndSet(
    key: string,
    expectedRevision: number | null,
    value: string,
  ): Promise<RecordDriverCompareResult> {
    const database = await this.database();
    const transaction = openTransaction(database, "readwrite");
    const completed = transactionResult(transaction);
    const records = transaction.objectStore(STORE_NAME);
    const existing = await requestResult(records.get(key) as IDBRequest<StoredRecord | undefined>);
    const current = existing?.value ?? null;
    if (revisionOf(current) !== expectedRevision) {
      await completed;
      return { ok: false, current };
    }
    await requestResult(records.put({ key, value }));
    const stored = await requestResult(records.get(key) as IDBRequest<StoredRecord | undefined>);
    if (stored?.value !== value) {
      transaction.abort();
      throw new Error("IndexedDB did not retain the merchant commit.");
    }
    await completed;
    return { ok: true, current: stored.value };
  }

  async remove(key: string): Promise<void> {
    const database = await this.database();
    const transaction = openTransaction(database, "readwrite");
    const completed = transactionResult(transaction);
    await requestResult(transaction.objectStore(STORE_NAME).delete(key));
    await completed;
  }
}
