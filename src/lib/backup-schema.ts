import { StrKey } from "@stellar/stellar-sdk";
import type { EncryptedPayload, RawKeyEncryptedPayload } from "./crypto";
import type { StoredAccount, VaultFile } from "./types";
import { isEncryptedMerchantRecordArchive } from "./merchant/record-crypto";

export interface BackupSettings {
  network: "testnet" | "mainnet";
  fiatCurrency: string | null;
  autoLockMs: number | null;
  privacy: boolean;
  sound: boolean;
  merchantMode?: {
    enabled: boolean;
    configured: boolean;
  };
}

export interface FullBackupPayload {
  exportedAt: string;
  vault: VaultFile;
  contacts: Array<{ name: string; address: string; favorite?: boolean }>;
  settings?: BackupSettings;
  txNotes: Record<string, unknown>;
  merchantStore?: string | null;
  privateBalanceStore?: string | null;
}

const FIAT_CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"]);
const MAX_ACCOUNTS = 1_000;
const MAX_CONTACTS = 5_000;
const MAX_MERCHANT_ARCHIVE_CHARS = 32 * 1024 * 1024;
export const MAX_ACCOUNT_LABEL_CHARS = 256;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isEncryptedPayloadValue(value: unknown): value is EncryptedPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.salt === "string" && value.salt.length > 0 &&
    typeof value.iv === "string" && value.iv.length > 0 &&
    typeof value.ciphertext === "string" && value.ciphertext.length > 0
  );
}

export function isRawKeyEncryptedPayloadValue(value: unknown): value is RawKeyEncryptedPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.iv === "string" && value.iv.length > 0 &&
    typeof value.ciphertext === "string" && value.ciphertext.length > 0 &&
    value.salt === undefined
  );
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)) return false;
  if (
    typeof value.label !== "string" ||
    value.label.length > MAX_ACCOUNT_LABEL_CHARS
  ) return false;
  if (typeof value.publicKey !== "string" || !StrKey.isValidEd25519PublicKey(value.publicKey)) {
    return false;
  }
  if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return false;
  if (value.emoji !== undefined && (typeof value.emoji !== "string" || value.emoji.length > 32)) return false;
  if (
    value.index !== undefined &&
    (typeof value.index !== "number" || !Number.isSafeInteger(value.index) || value.index < 0)
  ) {
    return false;
  }
  if (value.path !== undefined && (typeof value.path !== "string" || value.path.length > 128)) return false;
  if (
    value.secret !== undefined &&
    !isRawKeyEncryptedPayloadValue(value.secret)
  ) return false;
  if (value.watchOnly !== undefined && typeof value.watchOnly !== "boolean") return false;
  if (value.hardware !== undefined && value.hardware !== "ledger" && value.hardware !== "trezor") {
    return false;
  }
  return true;
}

export function decodeVaultFile(value: unknown): VaultFile | null {
  if (!isRecord(value) || value.version !== 3) {
    return null;
  }
  if (
    !Array.isArray(value.accounts) ||
    value.accounts.length === 0 ||
    value.accounts.length > MAX_ACCOUNTS
  ) return null;
  if (
    value.revision !== undefined &&
    (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)
  ) {
    return null;
  }
  if (!value.accounts.every(isStoredAccount)) {
    return null;
  }
  if (value.archivedAccounts !== undefined) {
    if (
      !Array.isArray(value.archivedAccounts) ||
      value.archivedAccounts.length > MAX_ACCOUNTS ||
      !value.archivedAccounts.every(isStoredAccount)
    ) {
      return null;
    }
  }
  if (value.activeAccountId !== null && typeof value.activeAccountId !== "string") return null;
  if (
    typeof value.activeAccountId === "string" &&
    !value.accounts.some((account) => account.id === value.activeAccountId)
  ) {
    return null;
  }
  if (
    value.mnemonic !== undefined &&
    !isRawKeyEncryptedPayloadValue(value.mnemonic)
  ) return null;
  if (!isEncryptedPayloadValue(value.wrappedMasterKey)) return null;
  if (!isRawKeyEncryptedPayloadValue(value.wrappedMerchantKey)) {
    return null;
  }
  if (
    value.requirePasswordForSigning !== undefined &&
    typeof value.requirePasswordForSigning !== "boolean"
  ) {
    return null;
  }
  return value as unknown as VaultFile;
}

function isContact(value: unknown): value is FullBackupPayload["contacts"][number] {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 256) return false;
  if (typeof value.address !== "string" || !StrKey.isValidEd25519PublicKey(value.address.trim())) {
    return false;
  }
  return value.favorite === undefined || typeof value.favorite === "boolean";
}

function isBackupSettings(value: unknown): value is BackupSettings {
  if (!isRecord(value)) return false;
  if (value.network !== "testnet" && value.network !== "mainnet") return false;
  if (
    value.fiatCurrency !== null &&
    (typeof value.fiatCurrency !== "string" || !FIAT_CURRENCIES.has(value.fiatCurrency))
  ) {
    return false;
  }
  if (
    value.autoLockMs !== null &&
    (typeof value.autoLockMs !== "number" ||
      !Number.isSafeInteger(value.autoLockMs) ||
      value.autoLockMs < 0)
  ) {
    return false;
  }
  if (
    value.merchantMode !== undefined &&
    (
      !isRecord(value.merchantMode) ||
      typeof value.merchantMode.enabled !== "boolean" ||
      typeof value.merchantMode.configured !== "boolean"
    )
  ) {
    return false;
  }
  return (
    typeof value.privacy === "boolean" &&
    typeof value.sound === "boolean"
  );
}

function isTxNotes(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return value.version === 3 && isRawKeyEncryptedPayloadValue(value.crypto);
}

function isPrivateBalanceStore(value: string): boolean {
  if (value.length > 32 * 1024 * 1024) return false;
  try {
    const archive: unknown = JSON.parse(value);
    if (!isRecord(archive) || archive.schemaVersion !== 1 || !Array.isArray(archive.records)) {
      return false;
    }
    return archive.records.length <= 4_096 && archive.records.every(record =>
      isRecord(record) &&
      typeof record.key === "string" &&
      record.key.startsWith("private:sensitive:v1:") &&
      typeof record.value === "string" &&
      record.value.length <= 16 * 1024 * 1024
    );
  } catch {
    return false;
  }
}

export function decodeFullBackupPayload(value: unknown): FullBackupPayload | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(value.exportedAt))
  ) {
    return null;
  }
  const vault = decodeVaultFile(value.vault);
  if (!vault) return null;
  if (
    !Array.isArray(value.contacts) ||
    value.contacts.length > MAX_CONTACTS ||
    !value.contacts.every(isContact)
  ) return null;
  if (value.settings !== undefined && !isBackupSettings(value.settings)) return null;
  if (!isTxNotes(value.txNotes)) return null;
  if (
    value.merchantStore !== undefined &&
    value.merchantStore !== null &&
    typeof value.merchantStore !== "string"
  ) {
    return null;
  }
  if (typeof value.merchantStore === "string") {
    if (value.merchantStore.length > MAX_MERCHANT_ARCHIVE_CHARS) return null;
    try {
      const merchantArchive: unknown = JSON.parse(value.merchantStore);
      if (!isEncryptedMerchantRecordArchive(merchantArchive)) return null;
    } catch {
      return null;
    }
  }
  if (
    value.privateBalanceStore !== undefined &&
    value.privateBalanceStore !== null &&
    (typeof value.privateBalanceStore !== "string" || !isPrivateBalanceStore(value.privateBalanceStore))
  ) {
    return null;
  }
  return {
    exportedAt: value.exportedAt,
    vault,
    contacts: value.contacts,
    settings: value.settings,
    txNotes: value.txNotes,
    merchantStore: value.merchantStore,
    privateBalanceStore: value.privateBalanceStore,
  };
}
