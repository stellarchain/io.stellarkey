import type { EncryptedPayload, RawKeyEncryptedPayload } from "./crypto";
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
  /** v1 legacy password payload, or v3 master-key payload for imported secrets. */
  secret?: EncryptedPayload | RawKeyEncryptedPayload;
  /** Track-only: no secret key exists for this account */
  watchOnly?: boolean;
  /** Hardware wallet backing (Ledger or Trezor) */
  hardware?: "ledger" | "trezor";
}

export interface VaultFile {
  version: 1 | 2 | 3;
  /** v3: a random vault master key wrapped by the password-derived key. */
  wrappedMasterKey?: EncryptedPayload;
  /** v3: merchant storage authority wrapped by the same random master key. */
  wrappedMerchantKey?: RawKeyEncryptedPayload;
  mnemonic?: EncryptedPayload | RawKeyEncryptedPayload;
  /**
   * Legacy password canary for v1 hardware/watch-only vaults. v3 verifies by
   * authenticating the wrapped master key instead.
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

export type { NetworkKey, EncryptedPayload, RawKeyEncryptedPayload };

export interface AssetBalance {
  key: string;
  code: string;
  issuer: string | null;
  balance: string;
  sellingLiabilities: string;
  limit: string | null;
  isNative: boolean;
}

export interface ActivitySwapLeg {
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
}

export interface ActivitySwap {
  debit: ActivitySwapLeg;
  credit: ActivitySwapLeg;
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
  /** Present only when the active account both paid and received in one path payment. */
  swap?: ActivitySwap;
}
