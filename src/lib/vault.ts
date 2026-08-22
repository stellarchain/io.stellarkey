import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { decryptString, encryptString, randomHex, type EncryptedPayload } from "./crypto";
import {
  generateMnemonic,
  keypairFromMnemonicIndex,
  normalizeMnemonic,
  stellarAccountPath,
  validateMnemonic,
} from "./hd";
import type { AccountMeta, StoredAccount, VaultFile } from "./types";

const VAULT_KEY = "polaris.vault.v1";
const NETWORK_KEY = "polaris.network.v1";
const AUTOLOCK_KEY = "polaris.autolock.v1";
const BIOMETRICS_KEY = "polaris.biometrics.v1";
const TRASH_KEY = "polaris.trash.v1";

let sessionPassword: string | null = null;
let sessionMnemonic: string | null = null;
const sessionSecrets = new Map<string, string>();

export class VaultLockedError extends Error {
  constructor(message = "Vault is locked") {
    super(message);
    this.name = "VaultLockedError";
  }
}

export function loadNetworkPref(): "testnet" | "mainnet" {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem(NETWORK_KEY) : null;
  return stored === "mainnet" ? "mainnet" : "testnet";
}

export function saveNetworkPref(network: "testnet" | "mainnet"): void {
  window.localStorage.setItem(NETWORK_KEY, network);
}

export function loadAutoLockPref(): number {
  if (typeof window === "undefined") return 15 * 60 * 1000;
  const stored = window.localStorage.getItem(AUTOLOCK_KEY);
  if (!stored) return 15 * 60 * 1000;
  const val = parseInt(stored, 10);
  return Number.isNaN(val) ? 15 * 60 * 1000 : val;
}

export function saveAutoLockPref(ms: number): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(AUTOLOCK_KEY, String(ms));
  }
}

export function loadBiometricsPref(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(BIOMETRICS_KEY) === "1";
}

export function saveBiometricsPref(enabled: boolean): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(BIOMETRICS_KEY, enabled ? "1" : "0");
  }
}

export function canUseBiometrics(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
}

function readVault(): VaultFile | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VaultFile;
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.accounts)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persist(vault: VaultFile): void {
  window.localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
}

export function loadVault(): VaultFile | null {
  return readVault();
}

export function hasDeletedVault(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(TRASH_KEY));
}

export function wipeVault(): void {
  const current = readVault();
  if (current && typeof window !== "undefined") {
    window.localStorage.setItem(TRASH_KEY, JSON.stringify(current));
  }
  lockVault();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(VAULT_KEY);
  }
}

export async function restoreDeletedVault(password: string): Promise<VaultFile> {
  if (typeof window === "undefined") throw new Error("No window context");
  const raw = window.localStorage.getItem(TRASH_KEY);
  if (!raw) throw new Error("No deleted wallet backup found in trash.");

  const trashVault = JSON.parse(raw) as VaultFile;
  persist(trashVault);
  window.localStorage.removeItem(TRASH_KEY);
  return unlockVault(password);
}

export function permanentlyDeleteTrash(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(TRASH_KEY);
  }
}

export function lockVault(): void {
  sessionPassword = null;
  sessionMnemonic = null;
  sessionSecrets.clear();
}

export function isUnlocked(): boolean {
  return sessionPassword !== null;
}

export function getSecretKey(accountId: string): string {
  const s = sessionSecrets.get(accountId);
  if (!s) {
    throw new VaultLockedError(
      `Secret key for account ${accountId} is not available in the current session. Vault may be locked.`,
    );
  }
  return s;
}

function stripSecret(account: StoredAccount): AccountMeta {
  return {
    id: account.id,
    label: account.label,
    publicKey: account.publicKey,
    createdAt: account.createdAt,
    ...(account.index !== undefined ? { index: account.index, path: account.path } : {}),
  };
}

export interface InitializeOptions {
  label?: string;
  mnemonic?: string;
  secret?: string;
}

export async function initializeVault(
  password: string,
  opts: InitializeOptions = {},
): Promise<{ account: AccountMeta; revealed: string }> {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  if (opts.secret) {
    const trimmed = opts.secret.trim();
    if (!validateStellarSecret(trimmed)) {
      throw new Error("Invalid Stellar secret key (must start with 'S' and be 56 chars)");
    }
    const kp = Keypair.fromSecret(trimmed);
    const encSecret = await encryptString(trimmed, password);
    const account: StoredAccount = {
      id: randomHex(8),
      label: opts.label?.trim() || "Imported Account",
      publicKey: kp.publicKey(),
      createdAt: Date.now(),
      secret: encSecret,
    };
    const vault: VaultFile = {
      version: 1,
      accounts: [account],
      activeAccountId: account.id,
    };
    persist(vault);
    sessionPassword = password;
    sessionMnemonic = null;
    sessionSecrets.set(account.id, trimmed);
    return { account: stripSecret(account), revealed: trimmed };
  }

  const rawMnemonic = opts.mnemonic ? normalizeMnemonic(opts.mnemonic) : await generateMnemonic();
  if (!(await validateMnemonic(rawMnemonic))) {
    throw new Error("Invalid 12-word BIP39 recovery phrase");
  }

  return createDerivedVault(password, rawMnemonic, opts.label);
}

async function createDerivedVault(
  password: string,
  mnemonic: string,
  label?: string,
): Promise<{ account: AccountMeta; revealed: string }> {
  const encMnemonic = await encryptString(mnemonic, password);
  const kp0 = await keypairFromMnemonicIndex(mnemonic, 0);
  const account: StoredAccount = {
    id: randomHex(8),
    label: label?.trim() || "Main Account",
    publicKey: kp0.publicKey(),
    createdAt: Date.now(),
    index: 0,
    path: stellarAccountPath(0),
  };
  const vault: VaultFile = {
    version: 2,
    mnemonic: encMnemonic,
    accounts: [account],
    activeAccountId: account.id,
  };
  persist(vault);

  sessionPassword = password;
  sessionMnemonic = mnemonic;
  sessionSecrets.set(account.id, kp0.secret());

  return { account: stripSecret(account), revealed: mnemonic };
}

export async function unlockVault(password: string): Promise<VaultFile> {
  const vault = readVault();
  if (!vault || vault.accounts.length === 0) {
    throw new Error("No wallet found. Please create or import one.");
  }

  sessionSecrets.clear();
  sessionMnemonic = null;
  sessionPassword = null;

  if (vault.version === 2 && vault.mnemonic) {
    let mnemonic: string;
    try {
      mnemonic = await decryptString(vault.mnemonic, password);
    } catch {
      throw new Error("Incorrect password.");
    }
    sessionMnemonic = mnemonic;
    sessionPassword = password;

    for (const acc of vault.accounts) {
      if (acc.index !== undefined) {
        const kp = await keypairFromMnemonicIndex(mnemonic, acc.index);
        sessionSecrets.set(acc.id, kp.secret());
      } else if (acc.secret) {
        try {
          const s = await decryptString(acc.secret, password);
          sessionSecrets.set(acc.id, s);
        } catch {
          // Skip if individually failed
        }
      }
    }
    return vault;
  }

  const firstAcc = vault.accounts[0];
  if (!firstAcc?.secret) {
    throw new Error("Corrupt vault: no encrypted key found");
  }
  try {
    const s0 = await decryptString(firstAcc.secret, password);
    sessionSecrets.set(firstAcc.id, s0);
  } catch {
    throw new Error("Incorrect password.");
  }

  for (const acc of vault.accounts.slice(1)) {
    if (acc.secret) {
      try {
        const s = await decryptString(acc.secret, password);
        sessionSecrets.set(acc.id, s);
      } catch {
        // Skip
      }
    }
  }

  sessionPassword = password;
  return vault;
}

export async function revealSecret(accountId: string, password: string): Promise<string> {
  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  const acc = vault.accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error("Account not found");

  if (vault.version === 2 && vault.mnemonic && acc.index !== undefined) {
    const m = await decryptString(vault.mnemonic, password);
    const kp = await keypairFromMnemonicIndex(m, acc.index);
    return kp.secret();
  }

  if (acc.secret) {
    return decryptString(acc.secret, password);
  }

  throw new Error("Cannot reveal secret for this account");
}

export async function revealMnemonic(password: string): Promise<string> {
  const vault = readVault();
  if (!vault || !vault.mnemonic) {
    throw new Error("This wallet does not use a recovery phrase (imported secret key only).");
  }
  return decryptString(vault.mnemonic, password);
}

export function hasMnemonic(): boolean {
  const vault = readVault();
  return Boolean(vault?.mnemonic);
}

export async function addStoredAccount(
  opts: { secret?: string; label?: string } = {},
): Promise<AccountMeta> {
  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  if (!sessionPassword) throw new VaultLockedError();

  if (opts.secret) {
    const trimmed = opts.secret.trim();
    if (!validateStellarSecret(trimmed)) {
      throw new Error("Invalid Stellar secret key");
    }
    const kp = Keypair.fromSecret(trimmed);
    const enc = await encryptString(trimmed, sessionPassword);
    const account: StoredAccount = {
      id: randomHex(8),
      label: opts.label?.trim() || `Imported #${vault.accounts.length + 1}`,
      publicKey: kp.publicKey(),
      createdAt: Date.now(),
      secret: enc,
    };
    vault.accounts.push(account);
    vault.activeAccountId = account.id;
    persist(vault);
    sessionSecrets.set(account.id, trimmed);
    return stripSecret(account);
  }

  if (!sessionMnemonic || !vault.mnemonic) {
    throw new Error(
      "This wallet cannot derive new accounts automatically because it was created from an imported secret key. You can still import another secret key.",
    );
  }

  let nextIndex = 0;
  for (const a of vault.accounts) {
    if (a.index !== undefined && a.index >= nextIndex) {
      nextIndex = a.index + 1;
    }
  }

  const kp = await keypairFromMnemonicIndex(sessionMnemonic, nextIndex);
  const account: StoredAccount = {
    id: randomHex(8),
    label: opts.label?.trim() || `Account ${nextIndex + 1}`,
    publicKey: kp.publicKey(),
    createdAt: Date.now(),
    index: nextIndex,
    path: stellarAccountPath(nextIndex),
  };

  vault.accounts.push(account);
  vault.activeAccountId = account.id;
  persist(vault);
  sessionSecrets.set(account.id, kp.secret());
  return stripSecret(account);
}

export function removeStoredAccount(accountId: string): VaultFile | null {
  const vault = readVault();
  if (!vault) return null;
  if (vault.accounts.length <= 1) {
    throw new Error("Cannot remove the only account in the wallet");
  }

  const target = vault.accounts.find((a) => a.id === accountId);
  if (target) {
    if (!vault.archivedAccounts) vault.archivedAccounts = [];
    vault.archivedAccounts.push(target);
  }

  vault.accounts = vault.accounts.filter((a) => a.id !== accountId);
  if (vault.activeAccountId === accountId) {
    vault.activeAccountId = vault.accounts[0].id;
  }
  sessionSecrets.delete(accountId);
  persist(vault);
  return vault;
}

export function updateAccountLabel(accountId: string, newLabel: string): VaultFile | null {
  const vault = readVault();
  if (!vault) return null;
  const acc = vault.accounts.find((a) => a.id === accountId);
  if (!acc) return null;
  acc.label = newLabel.trim() || acc.label;
  persist(vault);
  return vault;
}


/**
 * Add a watch-only account: tracks an existing public key with no secret.
 * Balances and activity are visible; signing is impossible by design.
 */
export async function addWatchOnlyAccount(
  publicKey: string,
  label?: string,
): Promise<AccountMeta> {
  if (!StrKey.isValidEd25519PublicKey(publicKey.trim())) {
    throw new Error("Invalid Stellar public key");
  }
  const vault = readVault();
  if (!vault) throw new Error("No vault found");

  const pk = publicKey.trim();
  if (
    vault.accounts.some((a) => a.publicKey === pk) ||
    (vault.archivedAccounts ?? []).some((a) => a.publicKey === pk)
  ) {
    throw new Error("This address is already in your wallet.");
  }

  const account: StoredAccount = {
    id: randomHex(8),
    label: label?.trim() || `Watch ${vault.accounts.length + 1}`,
    publicKey: pk,
    createdAt: Date.now(),
    watchOnly: true,
  };
  vault.accounts.push(account);
  vault.activeAccountId = account.id;
  persist(vault);
  return stripSecret(account);
}

export function getArchivedAccounts(): AccountMeta[] {
  const vault = readVault();
  return (vault?.archivedAccounts ?? []).map(stripSecret);
}

export async function restoreArchivedAccount(accountId: string): Promise<AccountMeta> {
  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  if (!sessionPassword) throw new VaultLockedError();

  const targetIdx = (vault.archivedAccounts ?? []).findIndex((a) => a.id === accountId);
  if (targetIdx === -1 || !vault.archivedAccounts) {
    throw new Error("Archived account not found");
  }

  const [account] = vault.archivedAccounts.splice(targetIdx, 1);
  vault.accounts.push(account);
  vault.activeAccountId = account.id;
  persist(vault);

  if (account.index !== undefined && sessionMnemonic) {
    const kp = await keypairFromMnemonicIndex(sessionMnemonic, account.index);
    sessionSecrets.set(account.id, kp.secret());
  } else if (account.secret) {
    const s = await decryptString(account.secret, sessionPassword);
    sessionSecrets.set(account.id, s);
  }

  return stripSecret(account);
}

export async function restoreAccountByIndex(
  index: number,
  label?: string,
): Promise<AccountMeta> {
  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  if (!sessionMnemonic) throw new Error("Wallet has no recovery phrase in memory");

  const existing = vault.accounts.find((a) => a.index === index);
  if (existing) return stripSecret(existing);

  const kp = await keypairFromMnemonicIndex(sessionMnemonic, index);
  const account: StoredAccount = {
    id: randomHex(8),
    label: label?.trim() || `Account ${index + 1}`,
    publicKey: kp.publicKey(),
    createdAt: Date.now(),
    index,
    path: stellarAccountPath(index),
  };

  vault.accounts.push(account);
  vault.activeAccountId = account.id;
  persist(vault);
  sessionSecrets.set(account.id, kp.secret());
  return stripSecret(account);
}

export function setActiveStoredAccount(accountId: string): VaultFile | null {
  const vault = readVault();
  if (!vault) return null;
  if (!vault.accounts.some((a) => a.id === accountId)) return null;
  vault.activeAccountId = accountId;
  persist(vault);
  return vault;
}

export function validateStellarSecret(secret: string): boolean {
  return StrKey.isValidEd25519SecretSeed(secret.trim());
}

export function isValidPublicAddress(addr: string): boolean {
  return StrKey.isValidEd25519PublicKey(addr.trim());
}

export function looksLikeMnemonic(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length === 12 || words.length === 24;
}

const KEYSTORE_FORMAT = "wallet-keystore/v1";

export interface KeystoreFile {
  format: string;
  version: number;
  address: string;
  crypto: EncryptedPayload;
  exportedAt: number;
}

export function exportKeystore(accountId: string): string | null {
  const vault = readVault();
  if (!vault) return null;
  const acc = vault.accounts.find((a) => a.id === accountId);
  if (!acc || !acc.secret) return null;

  const payload: KeystoreFile = {
    format: KEYSTORE_FORMAT,
    version: 1,
    address: acc.publicKey,
    crypto: acc.secret,
    exportedAt: Date.now(),
  };
  return JSON.stringify(payload, null, 2);
}


/**
 * Export the ENTIRE encrypted vault (all accounts + mnemonic) as a portable
 * JSON backup. The file is already password-encrypted at rest — no plaintext
 * secrets are ever written.
 */
export function exportVaultBackup(): string {
  const vault = readVault();
  if (!vault) throw new Error("No wallet to back up.");
  const payload = {
    kind: "stellar-wallet-backup",
    exportedAt: new Date().toISOString(),
    network: loadNetworkPref(),
    vault,
  };
  return JSON.stringify(payload, null, 2);
}

export interface VaultRestoreResult {
  accountCount: number;
  hasMnemonic: boolean;
}

/**
 * Restore a full vault from a backup file. Replaces any existing wallet —
 * the caller must confirm with the user first. The restored wallet stays
 * locked; unlocking requires the ORIGINAL password of the backup.
 */
export function restoreVaultBackup(json: string): VaultRestoreResult {
  let parsed: {
    kind?: string;
    vault?: VaultFile;
  };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    throw new Error("Not a valid backup file.");
  }
  if (parsed.kind !== "stellar-wallet-backup" || !parsed.vault) {
    throw new Error("This file is not a Wallet backup.");
  }
  const vault = parsed.vault;
  if (
    (vault.version !== 1 && vault.version !== 2) ||
    !Array.isArray(vault.accounts) ||
    vault.accounts.length === 0
  ) {
    throw new Error("Backup contains no recoverable accounts.");
  }
  // Move any current wallet to trash so restore is itself reversible
  const current = readVault();
  if (current) {
    window.localStorage.setItem(TRASH_KEY, JSON.stringify(current));
  }
  persist(vault);
  sessionSecrets.clear();
  sessionMnemonic = null;
  return {
    accountCount: vault.accounts.length,
    hasMnemonic: Boolean(vault.mnemonic),
  };
}

export async function exportKeystoreUnlocked(accountId: string): Promise<string | null> {
  const secret = sessionSecrets.get(accountId);
  const vault = readVault();
  const acc = vault?.accounts.find((a) => a.id === accountId);
  if (!secret || !acc || !sessionPassword) return null;

  const enc = await encryptString(secret, sessionPassword);
  const payload: KeystoreFile = {
    format: KEYSTORE_FORMAT,
    version: 1,
    address: acc.publicKey,
    crypto: enc,
    exportedAt: Date.now(),
  };
  return JSON.stringify(payload, null, 2);
}

export async function importKeystore(
  json: string,
  keystorePassword: string,
): Promise<AccountMeta> {
  const parsed = JSON.parse(json) as KeystoreFile;
  if (
    !parsed ||
    (parsed.format !== KEYSTORE_FORMAT && parsed.format !== "polaris-keystore/v1") ||
    !parsed.crypto
  ) {
    throw new Error("Invalid Wallet keystore format");
  }
  const secret = await decryptString(parsed.crypto, keystorePassword);
  return addStoredAccount({ secret });
}
