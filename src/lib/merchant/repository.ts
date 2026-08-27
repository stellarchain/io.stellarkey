import type { StorageLoadResult } from "../storage-load";
import {
  IndexedDbEncryptedRecordDriver,
  type EncryptedRecordDriver,
} from "../indexed-db";
import {
  decryptMerchantStore,
  encryptMerchantStore,
  isEncryptedMerchantEnvelope,
} from "./crypto";
import {
  decodeMerchantStore,
  MERCHANT_LEGACY_STORAGE_KEY,
  MERCHANT_STORAGE_KEY,
  prune,
} from "./storage";
import type { MerchantStore } from "./types";

export class MerchantRepositoryConflictError extends Error {
  readonly currentRaw: string | null;

  constructor(currentRaw: string | null) {
    super("Merchant data changed in another tab.");
    this.name = "MerchantRepositoryConflictError";
    this.currentRaw = currentRaw;
  }
}

export class MerchantRepository {
  readonly recordKey = "merchant.primary.v1";
  private readonly driver: EncryptedRecordDriver;

  constructor(driver: EncryptedRecordDriver) {
    this.driver = driver;
  }

  private decodeEncrypted(raw: string, key: Uint8Array): StorageLoadResult<MerchantStore> {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isEncryptedMerchantEnvelope(parsed)) {
        return {
          kind: "corrupt",
          raw,
          message: "Encrypted merchant data uses an unsupported envelope.",
        };
      }
      const decoded = decodeMerchantStore(decryptMerchantStore(parsed, key));
      if (
        !decoded ||
        decoded.revision !== parsed.revision ||
        decoded.writerId !== parsed.writerId ||
        decoded.updatedAt !== parsed.updatedAt
      ) {
        throw new Error("Merchant envelope metadata does not match its payload.");
      }
      return { kind: "ready", value: decoded };
    } catch {
      return {
        kind: "corrupt",
        raw,
        message: "Encrypted merchant data could not be decrypted or authenticated.",
      };
    }
  }

  private legacySource(key: Uint8Array): StorageLoadResult<MerchantStore> & { sourceRaw?: string } {
    if (typeof window === "undefined") return { kind: "absent" };
    const currentRaw = window.localStorage.getItem(MERCHANT_STORAGE_KEY);
    const legacyRaw = window.localStorage.getItem(MERCHANT_LEGACY_STORAGE_KEY);
    const raw = currentRaw ?? legacyRaw;
    if (raw === null) return { kind: "absent" };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isEncryptedMerchantEnvelope(parsed)) {
        const decoded = this.decodeEncrypted(raw, key);
        return decoded.kind === "ready" ? { ...decoded, sourceRaw: raw } : decoded;
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        "version" in parsed &&
        typeof parsed.version === "number" &&
        parsed.version > 2
      ) {
        return {
          kind: "future",
          raw,
          version: parsed.version,
          message: `Merchant data uses a newer schema (${parsed.version}).`,
        };
      }
      const decoded = decodeMerchantStore(parsed);
      return decoded
        ? { kind: "ready", value: decoded, sourceRaw: raw }
        : {
            kind: "corrupt",
            raw,
            message: "Merchant data is incomplete or uses an unsupported schema.",
          };
    } catch {
      return { kind: "corrupt", raw, message: "Merchant data is not valid JSON." };
    }
  }

  async load(key: Uint8Array): Promise<StorageLoadResult<MerchantStore>> {
    const indexedRaw = await this.driver.read(this.recordKey);
    if (indexedRaw !== null) return this.decodeEncrypted(indexedRaw, key);

    const source = this.legacySource(key);
    if (source.kind !== "ready") return source;
    const encryptedRaw = (() => {
      const raw = source.sourceRaw;
      if (raw) {
        try {
          if (isEncryptedMerchantEnvelope(JSON.parse(raw))) return raw;
        } catch {
          // The ready decoder already proved the source; re-encrypt below.
        }
      }
      return JSON.stringify(encryptMerchantStore(prune(source.value), key));
    })();

    const storedRaw = await this.driver.putVerified(this.recordKey, encryptedRaw);
    const verified = this.decodeEncrypted(storedRaw, key);
    if (verified.kind !== "ready") {
      throw new Error("Merchant data migration could not be verified in IndexedDB.");
    }
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(MERCHANT_STORAGE_KEY);
      window.localStorage.removeItem(MERCHANT_LEGACY_STORAGE_KEY);
    }
    return verified;
  }

  async commit(
    store: MerchantStore,
    key: Uint8Array,
    expectedRevision: number | null,
  ): Promise<MerchantStore> {
    const retained = prune(store);
    const raw = JSON.stringify(encryptMerchantStore(retained, key));
    const result = await this.driver.compareAndSet(this.recordKey, expectedRevision, raw);
    if (!result.ok) throw new MerchantRepositoryConflictError(result.current);
    if (result.current === null) throw new Error("IndexedDB did not return the committed record.");
    const verified = this.decodeEncrypted(result.current, key);
    if (verified.kind !== "ready") {
      throw new Error("IndexedDB merchant commit could not be verified.");
    }
    return verified.value;
  }

  async exportEncryptedArchive(): Promise<string | null> {
    return this.driver.read(this.recordKey);
  }

  async importEncryptedArchive(raw: string): Promise<void> {
    const parsed: unknown = JSON.parse(raw);
    if (!isEncryptedMerchantEnvelope(parsed)) {
      throw new Error("Merchant recovery archive is invalid.");
    }
    await this.driver.putVerified(this.recordKey, raw);
  }

  async clear(): Promise<void> {
    await this.driver.remove(this.recordKey);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(MERCHANT_STORAGE_KEY);
      window.localStorage.removeItem(MERCHANT_LEGACY_STORAGE_KEY);
    }
  }
}

let repository: MerchantRepository | null = null;

export function getMerchantRepository(): MerchantRepository {
  repository ??= new MerchantRepository(new IndexedDbEncryptedRecordDriver());
  return repository;
}
