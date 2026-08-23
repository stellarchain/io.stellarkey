import type { EncryptedPayload } from "./crypto";
import type { NetworkKey } from "./stellar";

export interface StoredAccount {
  id: string;
  label: string;
  emoji?: string;
  publicKey: string;
  createdAt: number;
  /** v2: derived from the vault mnemonic at this SLIP-0010 index */
  index?: number;
  path?: string;
  /** v1 legacy: individually encrypted secret key */
  secret?: EncryptedPayload;
  /** Track-only: no secret key exists for this account */
  watchOnly?: boolean;
  /** Hardware wallet backing (Ledger or Trezor) */
  hardware?: "ledger" | "trezor";
}

export interface VaultFile {
  version: 1 | 2;
  mnemonic?: EncryptedPayload;
  /**
   * Password canary for vaults holding no secret key material (hardware /
   * watch-only): lets unlock verify the password even with nothing to decrypt.
   */
  passwordCheck?: EncryptedPayload;
  accounts: StoredAccount[];
  archivedAccounts?: StoredAccount[];
  activeAccountId: string | null;
}

export interface AccountMeta {
  id: string;
  label: string;
  emoji?: string;
  publicKey: string;
  createdAt: number;
  index?: number;
  path?: string;
  watchOnly?: boolean;
  hardware?: "ledger" | "trezor";
}

export type { NetworkKey, EncryptedPayload };

export interface AssetBalance {
  key: string;
  code: string;
  issuer: string | null;
  balance: string;
  sellingLiabilities: string;
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
  assetIssuer: string | null;
  counterparty: string | null;
  hash: string;
  createdAt: string;
  successful: boolean;
}
