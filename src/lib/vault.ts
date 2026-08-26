import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  decryptString,
  deriveEncryptionKeyBytes,
  encryptString,
  randomHex,
  type EncryptedPayload,
} from "./crypto";
import {
  generateMnemonic,
  keypairFromMnemonicIndex,
  normalizeMnemonic,
  stellarAccountPath,
  validateMnemonic,
} from "./hd";
import type { AccountMeta, StoredAccount, VaultFile } from "./types";
import type { StorageLoadResult } from "./storage-load";
import { requireWebCrypto } from "./web-crypto";

const VAULT_KEY = "polaris.vault.v1";
const NETWORK_KEY = "polaris.network.v1";
const AUTOLOCK_KEY = "polaris.autolock.v1";
const BIOMETRICS_KEY = "polaris.biometrics.v1";
const TRASH_KEY = "polaris.trash.v1";

let sessionPassword: string | null = null;
let sessionMnemonic: string | null = null;
let sessionMerchantKey: Uint8Array | null = null;
const sessionSecrets = new Map<string, string>();

function merchantKeyContext(vault: VaultFile): string {
  const encryptionSalt = vault.mnemonic?.salt
    ?? vault.passwordCheck?.salt
    ?? vault.accounts.find((account) => account.secret)?.secret?.salt;
  // Older hardware/watch-only vaults may predate the password canary. Their
  // first public key is stable and still separates their KDF from other vaults.
  return encryptionSalt ?? vault.accounts[0].publicKey;
}

async function establishVaultSession(password: string, vault: VaultFile): Promise<void> {
  sessionMerchantKey?.fill(0);
  sessionMerchantKey = await deriveEncryptionKeyBytes(
    password,
    `merchant-store:${merchantKeyContext(vault)}`,
  );
  sessionPassword = password;
}

export function getMerchantEncryptionKey(): Uint8Array {
  if (!sessionMerchantKey || !sessionPassword) throw new VaultLockedError();
  return sessionMerchantKey.slice();
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id) return false;
  if (typeof value.label !== "string") return false;
  if (typeof value.publicKey !== "string" || !StrKey.isValidEd25519PublicKey(value.publicKey)) {
    return false;
  }
  if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return false;
  if (value.emoji !== undefined && typeof value.emoji !== "string") return false;
  if (
    value.index !== undefined &&
    (typeof value.index !== "number" || !Number.isSafeInteger(value.index) || value.index < 0)
  ) {
    return false;
  }
  if (value.path !== undefined && typeof value.path !== "string") return false;
  if (value.secret !== undefined && !isEncryptedPayload(value.secret)) return false;
  if (value.watchOnly !== undefined && typeof value.watchOnly !== "boolean") return false;
  if (value.hardware !== undefined && value.hardware !== "ledger" && value.hardware !== "trezor") {
    return false;
  }
  return true;
}

function decodeVault(value: unknown): VaultFile | null {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return null;
  if (!Array.isArray(value.accounts) || value.accounts.length === 0) return null;
  if (!value.accounts.every(isStoredAccount)) return null;
  if (value.archivedAccounts !== undefined) {
    if (!Array.isArray(value.archivedAccounts) || !value.archivedAccounts.every(isStoredAccount)) {
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
  if (value.mnemonic !== undefined && !isEncryptedPayload(value.mnemonic)) return null;
  if (value.passwordCheck !== undefined && !isEncryptedPayload(value.passwordCheck)) return null;
  return value as unknown as VaultFile;
}

export function loadVaultResult(): StorageLoadResult<VaultFile> {
  if (typeof window === "undefined") return { kind: "absent" };
  const raw = window.localStorage.getItem(VAULT_KEY);
  if (!raw) return { kind: "absent" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.version === "number" && parsed.version > 2) {
      return {
        kind: "future",
        raw,
        version: parsed.version,
        message: `This wallet was created by a newer app version (${parsed.version}).`,
      };
    }
    const vault = decodeVault(parsed);
    return vault
      ? { kind: "ready", value: vault }
      : { kind: "corrupt", raw, message: "The encrypted wallet record is incomplete or malformed." };
  } catch {
    return { kind: "corrupt", raw, message: "The encrypted wallet record is not valid JSON." };
  }
}

function readVault(): VaultFile | null {
  const result = loadVaultResult();
  return result.kind === "ready" ? result.value : null;
}

function persist(vault: VaultFile): void {
  window.localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
}

export function loadVault(): VaultFile | null {
  return readVault();
}

function assertVaultCreationAllowed(): void {
  const result = loadVaultResult();
  if (result.kind === "corrupt" || result.kind === "future") {
    throw new Error("Existing wallet data needs recovery before a new wallet can be created.");
  }
}

export function hasDeletedVault(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(TRASH_KEY));
}

export function wipeVault(): void {
  lockVault();
  if (typeof window !== "undefined") {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && (key.startsWith("polaris.") || key.startsWith("wallet."))) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
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
  sessionMerchantKey?.fill(0);
  sessionMerchantKey = null;
  sessionPassword = null;
  sessionMnemonic = null;
  sessionSecrets.clear();
}

/** Wipe in-memory secrets after a full-vault restore (old ids no longer exist) */
export function clearSessionSecrets(): void {
  sessionMerchantKey?.fill(0);
  sessionMerchantKey = null;
  sessionSecrets.clear();
  sessionMnemonic = null;
  sessionPassword = null;
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
    ...(account.hardware ? { hardware: account.hardware } : {}),
    ...(account.watchOnly || account.hardware === "ledger" ? { watchOnly: true } : {}),
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
  assertVaultCreationAllowed();
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
    await establishVaultSession(password, vault);
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

  await establishVaultSession(password, vault);
  sessionMnemonic = mnemonic;
  sessionSecrets.set(account.id, kp0.secret());

  return { account: stripSecret(account), revealed: mnemonic };
}

/**
 * Create a vault containing ONLY a hardware-wallet account — no mnemonic, no
 * local secrets. A password canary is stored so unlock can still verify the
 * password cryptographically.
 */
export async function initializeHardwareVault(
  password: string,
  account: {
    publicKey: string;
    path: string;
    index: number;
    device: "ledger" | "trezor";
    label?: string;
  },
): Promise<{ account: AccountMeta }> {
  assertVaultCreationAllowed();
  if (account.device !== "trezor") {
    throw new Error("Ledger is not supported in this build. No account was imported.");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (!isValidPublicAddress(account.publicKey)) {
    throw new Error("Invalid Stellar address read from device.");
  }
  const stored: StoredAccount = {
    id: randomHex(8),
    label: account.label?.trim() || (account.device === "trezor" ? "Trezor 1" : "Ledger 1"),
    publicKey: account.publicKey,
    createdAt: Date.now(),
    index: account.index,
    path: account.path,
    hardware: account.device,
  };
  const vault: VaultFile = {
    version: 1,
    passwordCheck: await encryptString("polaris-vault-ok", password),
    accounts: [stored],
    activeAccountId: stored.id,
  };
  persist(vault);
  await establishVaultSession(password, vault);
  sessionMnemonic = null;
  return { account: stripSecret(stored) };
}

export async function unlockVault(password: string): Promise<VaultFile> {
  const vault = readVault();
  if (!vault || vault.accounts.length === 0) {
    throw new Error("No wallet found. Please create or import one.");
  }
  requireWebCrypto();

  sessionSecrets.clear();
  sessionMnemonic = null;
  sessionMerchantKey?.fill(0);
  sessionMerchantKey = null;
  sessionPassword = null;

  if (vault.version === 2 && vault.mnemonic) {
    let mnemonic: string;
    try {
      mnemonic = await decryptString(vault.mnemonic, password);
    } catch {
      throw new Error("Incorrect password.");
    }
    sessionMnemonic = mnemonic;
    await establishVaultSession(password, vault);

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
  const firstWithSecret = vault.accounts.find((a) => a.secret);
  if (!firstAcc) {
    throw new Error("Corrupt vault: no accounts found");
  }
  if (!firstWithSecret) {
    // Hardware / watch-only vaults hold no encrypted key material — verify
    // against the password canary written at creation when one exists.
    if (vault.passwordCheck) {
      try {
        await decryptString(vault.passwordCheck, password);
      } catch {
        throw new Error("Incorrect password.");
      }
    }
    await establishVaultSession(password, vault);
    return vault;
  }
  const firstSecret = firstWithSecret.secret;
  if (!firstSecret) {
    throw new Error("Corrupt vault: no encrypted key found");
  }
  try {
    const s0 = await decryptString(firstSecret, password);
    sessionSecrets.set(firstWithSecret.id, s0);
  } catch {
    throw new Error("Incorrect password.");
  }

  for (const acc of vault.accounts) {
    if (acc.id === firstWithSecret.id) continue;
    if (acc.secret) {
      try {
        const s = await decryptString(acc.secret, password);
        sessionSecrets.set(acc.id, s);
      } catch {
        // Skip
      }
    }
  }

  await establishVaultSession(password, vault);
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

/**
 * Add a hardware-backed account (Ledger or Trezor).
 * Public key is stored for balance/activity indexing; transactions
 * are signed on the physical hardware device.
 */
export async function addHardwareAccount(params: {
  publicKey: string;
  device: "ledger" | "trezor";
  path: string;
  label?: string;
  index?: number;
}): Promise<AccountMeta> {
  const { publicKey, device, path, label, index } = params;
  if (device !== "trezor") {
    throw new Error("Ledger is not supported in this build. No account was imported.");
  }
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
    throw new Error("This hardware address is already in your wallet.");
  }

  const account: StoredAccount = {
    id: randomHex(8),
    label: label?.trim() || `Trezor ${(index ?? 0) + 1}`,
    emoji: "🛡️",
    publicKey: pk,
    createdAt: Date.now(),
    hardware: device,
    path,
    index,
  };
  vault.accounts.push(account);
  vault.activeAccountId = account.id;
  persist(vault);
  return stripSecret(account);
}

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

/* ------------------------------------------------------------------ */
/* Full wallet backup. v2 encrypts the ENTIRE payload — vault,         */
/* contacts, settings, tx notes — with the wallet password; only the   */
/* envelope marker stays plaintext. Legacy v1 plaintext backups still  */
/* restore (vault only).                                               */
/* ------------------------------------------------------------------ */

const BACKUP_KIND = "stellar-wallet-backup";
const CONTACTS_KEY = "polaris.contacts.v1";
const PRIVACY_KEY = "polaris.privacy.v1";
const SOUND_KEY = "wallet.sound.v1";
const CURRENCY_KEY = "wallet.currency.v1";
const TX_NOTES_KEY = "wallet.tx-notes.v1";
const MERCHANT_STORE_KEY = "wallet.merchant.v2";

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EncryptedPayload>;
  return (
    typeof candidate.salt === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.ciphertext === "string"
  );
}

interface TxNoteEnvelope {
  version: 2;
  crypto: EncryptedPayload;
}

function isTxNoteEnvelope(value: unknown): value is TxNoteEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TxNoteEnvelope>;
  return candidate.version === 2 && isEncryptedPayload(candidate.crypto);
}

async function writePrivateTxNotes(
  notes: Record<string, string>,
  password: string,
): Promise<void> {
  const envelope: TxNoteEnvelope = {
    version: 2,
    crypto: await encryptString(JSON.stringify(notes), password),
  };
  window.localStorage.setItem(TX_NOTES_KEY, JSON.stringify(envelope));
}

async function readPrivateTxNotes(password: string): Promise<Record<string, string>> {
  const stored = readLocalJson(TX_NOTES_KEY);
  if (stored === null) return {};
  if (isTxNoteEnvelope(stored)) {
    try {
      const decoded = JSON.parse(await decryptString(stored.crypto, password)) as unknown;
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return {};
      return Object.fromEntries(
        Object.entries(decoded).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    } catch {
      throw new Error("Private transaction notes could not be decrypted.");
    }
  }

  // One-time migration from the legacy plaintext map and the short-lived
  // per-note encrypted format.
  const legacy = stored && typeof stored === "object" && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)
    : {};
  const notes: Record<string, string> = {};
  for (const [hash, value] of Object.entries(legacy)) {
    if (typeof value === "string") notes[hash] = value;
    else if (isEncryptedPayload(value)) {
      try {
        notes[hash] = await decryptString(value, password);
      } catch {
        // Skip only the corrupt legacy record; valid notes are still migrated.
      }
    }
  }
  await writePrivateTxNotes(notes, password);
  return notes;
}

export async function loadPrivateTxNote(transactionHash: string): Promise<string> {
  const password = sessionPassword;
  if (!password) throw new VaultLockedError();
  const notes = await readPrivateTxNotes(password);
  return notes[transactionHash] ?? "";
}

export async function savePrivateTxNote(
  transactionHash: string,
  note: string,
): Promise<void> {
  const password = sessionPassword;
  if (!password) throw new VaultLockedError();
  const key = transactionHash.trim();
  if (!key) throw new Error("Transaction hash is required.");
  const notes = await readPrivateTxNotes(password);
  const value = note.trim();
  if (value) notes[key] = value;
  else delete notes[key];
  await writePrivateTxNotes(notes, password);
}

interface BackupSettings {
  network: "testnet" | "mainnet";
  fiatCurrency: string | null;
  autoLockMs: number | null;
  biometrics: boolean;
  privacy: boolean;
  sound: boolean;
}

interface FullBackupPayload {
  exportedAt: string;
  vault: VaultFile;
  contacts: unknown[];
  settings?: BackupSettings;
  txNotes: Record<string, unknown>;
  merchantStore?: string | null;
}

export interface VaultRestoreResult {
  accountCount: number;
  hasMnemonic: boolean;
  contactCount: number;
}

export interface VaultBackupInfo {
  accountCount: number;
  contactCount: number;
  hasMnemonic: boolean;
  hasSettings: boolean;
  hasMerchantArchive: boolean;
  exportedAt?: string;
}

function readLocalJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** True when the file is a valid v2 fully-encrypted backup envelope. */
export function isEncryptedBackup(json: string): boolean {
  try {
    const p = JSON.parse(json) as { kind?: string; version?: number; crypto?: unknown };
    return p.kind === BACKUP_KIND && p.version === 2 && Boolean(p.crypto);
  } catch {
    return false;
  }
}

async function decodeBackup(
  json: string,
  password?: string,
): Promise<{ payload: FullBackupPayload }> {
  let parsed: {
    kind?: string;
    version?: number;
    crypto?: EncryptedPayload;
  };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Not a valid backup file.");
  }
  if (parsed.kind !== BACKUP_KIND) {
    throw new Error("This file is not a Wallet backup.");
  }
  if (parsed.version !== 2 || !parsed.crypto) {
    throw new Error(
      "This backup uses the legacy plaintext format, which is no longer supported. Create a fresh encrypted backup from the source wallet.",
    );
  }
  if (!password) {
    throw new Error("This backup is encrypted — enter its password first.");
  }
  requireWebCrypto();
  let plaintext: string;
  try {
    plaintext = await decryptString(parsed.crypto, password);
  } catch {
    throw new Error("Incorrect password for this backup file.");
  }
  const payload = JSON.parse(plaintext) as FullBackupPayload;
  if (!payload.vault) throw new Error("Backup contains no wallet data.");
  return { payload };
}

/** Summarize a backup file (requires the backup password). */
export async function inspectVaultBackup(
  json: string,
  password?: string,
): Promise<VaultBackupInfo> {
  const { payload } = await decodeBackup(json, password);
  return {
    accountCount: Array.isArray(payload.vault.accounts) ? payload.vault.accounts.length : 0,
    contactCount: Array.isArray(payload.contacts) ? payload.contacts.length : 0,
    hasMnemonic: Boolean(payload.vault.mnemonic),
    hasSettings: Boolean(payload.settings),
    hasMerchantArchive: typeof payload.merchantStore === "string" && Boolean(payload.merchantStore),
    exportedAt: payload.exportedAt || undefined,
  };
}

/**
 * Export the ENTIRE wallet — vault (all accounts + mnemonic), contacts,
 * settings, private tx notes, and the encrypted merchant archive — as a
 * single AES-256-GCM encrypted file, locked by the wallet password. No
 * plaintext metadata is ever written.
 */
export async function exportVaultBackup(): Promise<string> {
  const vault = readVault();
  if (!vault) throw new Error("No wallet to back up.");
  if (!sessionPassword) throw new VaultLockedError();

  const contactsRaw = readLocalJson(CONTACTS_KEY);
  const notesRaw = readLocalJson(TX_NOTES_KEY);
  const autoLockRaw = window.localStorage.getItem(AUTOLOCK_KEY);
  const payload: FullBackupPayload = {
    exportedAt: new Date().toISOString(),
    vault,
    contacts: Array.isArray(contactsRaw) ? contactsRaw : [],
    settings: {
      network: loadNetworkPref(),
      fiatCurrency: window.localStorage.getItem(CURRENCY_KEY),
      autoLockMs: autoLockRaw !== null ? Number(autoLockRaw) : null,
      biometrics: false,
      privacy: window.localStorage.getItem(PRIVACY_KEY) === "1",
      sound: window.localStorage.getItem(SOUND_KEY) !== "0",
    },
    txNotes:
      notesRaw && typeof notesRaw === "object" && !Array.isArray(notesRaw)
        ? (notesRaw as Record<string, unknown>)
        : {},
    merchantStore: window.localStorage.getItem(MERCHANT_STORE_KEY),
  };
  const crypto = await encryptString(JSON.stringify(payload), sessionPassword);
  return JSON.stringify({ kind: BACKUP_KIND, version: 2, crypto }, null, 2);
}

/**
 * Restore a full wallet from a backup file. Replaces any existing wallet —
 * the caller must confirm with the user first. v2 backups need the backup's
 * password (they are fully encrypted) and also restore contacts, settings
 * and tx notes. The restored wallet stays locked afterwards.
 */
export async function restoreVaultBackup(
  json: string,
  password?: string,
): Promise<VaultRestoreResult> {
  const { payload } = await decodeBackup(json, password);
  const vault = payload.vault;
  if (
    (vault.version !== 1 && vault.version !== 2) ||
    !Array.isArray(vault.accounts) ||
    vault.accounts.length === 0
  ) {
    throw new Error("Backup contains no recoverable accounts.");
  }
  persist(vault);
  window.localStorage.removeItem(TRASH_KEY);
  lockVault();

  // Full-wallet restore — overwrite the satellite stores too
  window.localStorage.setItem(CONTACTS_KEY, JSON.stringify(payload.contacts ?? []));
  window.localStorage.setItem(TX_NOTES_KEY, JSON.stringify(payload.txNotes ?? {}));
  if (typeof payload.merchantStore === "string" && payload.merchantStore) {
    window.localStorage.setItem(MERCHANT_STORE_KEY, payload.merchantStore);
  } else {
    window.localStorage.removeItem(MERCHANT_STORE_KEY);
  }
  if (payload.settings) {
    const s = payload.settings;
    window.localStorage.setItem(NETWORK_KEY, s.network);
    if (s.fiatCurrency) window.localStorage.setItem(CURRENCY_KEY, s.fiatCurrency);
    if (s.autoLockMs !== null) {
      window.localStorage.setItem(AUTOLOCK_KEY, String(s.autoLockMs));
    }
    window.localStorage.removeItem(BIOMETRICS_KEY);
    window.localStorage.setItem(PRIVACY_KEY, s.privacy ? "1" : "0");
    window.localStorage.setItem(SOUND_KEY, s.sound ? "1" : "0");
  }

  return {
    accountCount: vault.accounts.length,
    hasMnemonic: Boolean(vault.mnemonic),
    contactCount: Array.isArray(payload.contacts) ? payload.contacts.length : 0,
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
