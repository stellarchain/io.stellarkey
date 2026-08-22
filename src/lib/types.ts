import type { EncryptedPayload } from "./crypto";
import type { NetworkKey } from "./stellar";

export interface StoredAccount {
  id: string;
  label: string;
  publicKey: string;
  createdAt: number;
  /** v2: derived from the vault mnemonic at this SLIP-0010 index */
  index?: number;
  path?: string;
  /** v1 legacy: individually encrypted secret key */
  secret?: EncryptedPayload;
}

export interface VaultFile {
  version: 1 | 2;
  mnemonic?: EncryptedPayload;
  accounts: StoredAccount[];
  archivedAccounts?: StoredAccount[];
  activeAccountId: string | null;
}

export interface AccountMeta {
  id: string;
  label: string;
  publicKey: string;
  createdAt: number;
  index?: number;
  path?: string;
}

export type { NetworkKey, EncryptedPayload };

export interface AssetBalance {
  key: string;
  code: string;
  issuer: string | null;
  balance: string;
  limit: string | null;
  isNative: boolean;
}

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  direction: "in" | "out" | "neutral";
  amount: string | null;
  assetCode: string | null;
  counterparty: string | null;
  hash: string;
  createdAt: string;
  successful: boolean;
}
