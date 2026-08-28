import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  decryptString,
  deriveEncryptionKeyBytes,
  encryptString,
  randomHex,
  type EncryptedPayload,
  type RawKeyEncryptedPayload,
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
import {
  decodeFullBackupPayload,
  decodeVaultFile,
  isEncryptedPayloadValue,
  isRawKeyEncryptedPayloadValue,
  isRecord,
  type FullBackupPayload,
} from "./backup-schema";
import { getMerchantRepository } from "./merchant/repository";
import { writeMerchantBootstrapState } from "./merchant/bootstrap";
import { validateNewVaultPassword } from "./password-strength";
import { replaceBackupStorage } from "./backup-storage";
import {
  createVaultMasterKey,
  decryptVaultBytes,
  decryptVaultString,
  encryptVaultBytes,
  encryptVaultString,
  unwrapVaultMasterKey,
  wrapVaultMasterKey,
  zeroKey,
} from "./vault-keys";
import {
  PASSKEY_RECORD_KEY,
  loadPasskeyRecord,
  registerPasskeyMasterKey,
  removePasskeyRecord,
  unwrapPasskeyMasterKey,
  type PasskeyDependencies,
  type PasskeyStorage,
} from "./passkey-prf";

const VAULT_KEY = "polaris.vault.v1";
const NETWORK_KEY = "polaris.network.v1";
const AUTOLOCK_KEY = "polaris.autolock.v1";

let sessionMasterKey: Uint8Array | null = null;
let sessionMerchantKey: Uint8Array | null = null;

type VaultV3 = VaultFile & {
  version: 3;
  wrappedMasterKey: EncryptedPayload;
  wrappedMerchantKey: RawKeyEncryptedPayload;
  mnemonic?: RawKeyEncryptedPayload;
};

function isVaultV3(vault: VaultFile): vault is VaultV3 {
  return vault.version === 3 && Boolean(vault.wrappedMasterKey);
}

function requireSessionMasterKey(): Uint8Array {
  if (!sessionMasterKey) throw new VaultLockedError();
  return sessionMasterKey;
}

async function establishVaultSession(
  masterKey: Uint8Array,
  vault: VaultV3,
): Promise<void> {
  const merchantKey = await decryptVaultBytes(vault.wrappedMerchantKey, masterKey);
  if (merchantKey.byteLength !== 32) {
    zeroKey(merchantKey);
    throw new Error("Encrypted merchant key is invalid.");
  }
  zeroKey(sessionMasterKey);
  zeroKey(sessionMerchantKey);
  sessionMasterKey = masterKey.slice();
  sessionMerchantKey = merchantKey;
}

export function getMerchantEncryptionKey(): Uint8Array {
  if (!sessionMerchantKey || !sessionMasterKey) throw new VaultLockedError();
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

export function loadVaultResult(): StorageLoadResult<VaultFile> {
  if (typeof window === "undefined") return { kind: "absent" };
  const raw = window.localStorage.getItem(VAULT_KEY);
  if (!raw) return { kind: "absent" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.version === "number" && parsed.version > 3) {
      return {
        kind: "future",
        raw,
        version: parsed.version,
        message: `This wallet was created by a newer app version (${parsed.version}).`,
      };
    }
    const vault = decodeVaultFile(parsed);
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
  const serialized = JSON.stringify(vault);
  window.localStorage.setItem(VAULT_KEY, serialized);
  if (window.localStorage.getItem(VAULT_KEY) !== serialized) {
    throw new Error("Browser storage did not retain the encrypted vault.");
  }
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

export function lockVault(): void {
  sessionMasterKey?.fill(0);
  sessionMerchantKey?.fill(0);
  sessionMasterKey = null;
  sessionMerchantKey = null;
}

/** Wipe in-memory secrets after a full-vault restore (old ids no longer exist) */
export function clearSessionSecrets(): void {
  sessionMasterKey?.fill(0);
  sessionMerchantKey?.fill(0);
  sessionMasterKey = null;
  sessionMerchantKey = null;
}

export function isUnlocked(): boolean {
  return sessionMasterKey !== null;
}

async function decryptAccountSecret(
  vault: VaultV3,
  account: StoredAccount,
  masterKey: Uint8Array,
): Promise<string> {
  if (account.index !== undefined && vault.mnemonic) {
    let mnemonic = await decryptVaultString(vault.mnemonic, masterKey);
    try {
      const keypair = await keypairFromMnemonicIndex(mnemonic, account.index);
      if (keypair.publicKey() !== account.publicKey) {
        throw new Error("Derived secret does not match this account's public address.");
      }
      return keypair.secret();
    } finally {
      mnemonic = "";
    }
  }
  if (account.secret && isRawKeyEncryptedPayloadValue(account.secret)) {
    const secret = await decryptVaultString(account.secret, masterKey);
    if (Keypair.fromSecret(secret).publicKey() !== account.publicKey) {
      throw new Error("Encrypted secret does not match this account's public address.");
    }
    return secret;
  }
  throw new Error("Cannot access secret for this account");
}

export async function withSecretKey<T>(
  accountId: string,
  operation: (secret: string) => T | Promise<T>,
): Promise<T> {
  const masterKey = requireSessionMasterKey();
  const vault = readVault();
  if (!vault || !isVaultV3(vault)) throw new Error("Vault migration is required.");
  const account = vault.accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("Account not found");
  let secret = await decryptAccountSecret(vault, account, masterKey);
  try {
    return await operation(secret);
  } finally {
    secret = "";
  }
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

async function createVaultProtection(password: string): Promise<{
  masterKey: Uint8Array;
  wrappedMasterKey: EncryptedPayload;
  wrappedMerchantKey: RawKeyEncryptedPayload;
}> {
  const masterKey = createVaultMasterKey();
  const merchantKey = createVaultMasterKey();
  try {
    return {
      masterKey,
      wrappedMasterKey: await wrapVaultMasterKey(masterKey, password),
      wrappedMerchantKey: await encryptVaultBytes(merchantKey, masterKey),
    };
  } catch (error) {
    zeroKey(masterKey);
    throw error;
  } finally {
    zeroKey(merchantKey);
  }
}

export async function initializeVault(
  password: string,
  opts: InitializeOptions = {},
): Promise<{ account: AccountMeta; revealed: string }> {
  assertVaultCreationAllowed();
  const passwordPolicy = validateNewVaultPassword(password);
  if (!passwordPolicy.valid) throw new Error(passwordPolicy.message ?? "Choose a stronger password.");

  if (opts.secret) {
    const trimmed = opts.secret.trim();
    if (!validateStellarSecret(trimmed)) {
      throw new Error("Invalid Stellar secret key (must start with 'S' and be 56 chars)");
    }
    const kp = Keypair.fromSecret(trimmed);
    const protection = await createVaultProtection(password);
    const { masterKey } = protection;
    try {
      const account: StoredAccount = {
        id: randomHex(8),
        label: opts.label?.trim() || "Imported Account",
        publicKey: kp.publicKey(),
        createdAt: Date.now(),
        secret: await encryptVaultString(trimmed, masterKey),
      };
      const vault: VaultFile = {
        version: 3,
        wrappedMasterKey: protection.wrappedMasterKey,
        wrappedMerchantKey: protection.wrappedMerchantKey,
        accounts: [account],
        activeAccountId: account.id,
      };
      persist(vault);
      writeMerchantBootstrapState({ enabled: false, configured: false });
      await establishVaultSession(masterKey, vault as VaultV3);
      return { account: stripSecret(account), revealed: trimmed };
    } finally {
      zeroKey(masterKey);
    }
  }

  const rawMnemonic = opts.mnemonic ? normalizeMnemonic(opts.mnemonic) : await generateMnemonic();
  if (!(await validateMnemonic(rawMnemonic))) {
    throw new Error("Invalid BIP-39 recovery phrase");
  }

  return createDerivedVault(password, rawMnemonic, opts.label);
}

async function createDerivedVault(
  password: string,
  mnemonic: string,
  label?: string,
): Promise<{ account: AccountMeta; revealed: string }> {
  const kp0 = await keypairFromMnemonicIndex(mnemonic, 0);
  const protection = await createVaultProtection(password);
  const { masterKey } = protection;
  try {
    const account: StoredAccount = {
      id: randomHex(8),
      label: label?.trim() || "Main Account",
      publicKey: kp0.publicKey(),
      createdAt: Date.now(),
      index: 0,
      path: stellarAccountPath(0),
    };
    const vault: VaultFile = {
      version: 3,
      wrappedMasterKey: protection.wrappedMasterKey,
      wrappedMerchantKey: protection.wrappedMerchantKey,
      mnemonic: await encryptVaultString(mnemonic, masterKey),
      accounts: [account],
      activeAccountId: account.id,
    };
    persist(vault);
    writeMerchantBootstrapState({ enabled: false, configured: false });
    await establishVaultSession(masterKey, vault as VaultV3);
    return { account: stripSecret(account), revealed: mnemonic };
  } finally {
    zeroKey(masterKey);
  }
}

/**
 * Create a vault containing ONLY a hardware-wallet account — no mnemonic and
 * no local signing secret. The password-wrapped random master key authenticates
 * unlock even though there is no account secret to decrypt.
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
  const passwordPolicy = validateNewVaultPassword(password);
  if (!passwordPolicy.valid) throw new Error(passwordPolicy.message ?? "Choose a stronger password.");
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
  const protection = await createVaultProtection(password);
  const { masterKey } = protection;
  try {
    const vault: VaultFile = {
      version: 3,
      wrappedMasterKey: protection.wrappedMasterKey,
      wrappedMerchantKey: protection.wrappedMerchantKey,
      accounts: [stored],
      activeAccountId: stored.id,
    };
    persist(vault);
    writeMerchantBootstrapState({ enabled: false, configured: false });
    await establishVaultSession(masterKey, vault as VaultV3);
    return { account: stripSecret(stored) };
  } finally {
    zeroKey(masterKey);
  }
}

function legacyMerchantKeyContext(vault: VaultFile): string {
  if (vault.mnemonic && isEncryptedPayloadValue(vault.mnemonic)) return vault.mnemonic.salt;
  if (vault.passwordCheck) return vault.passwordCheck.salt;
  const secret = [...vault.accounts, ...(vault.archivedAccounts ?? [])]
    .find((account) => account.secret && isEncryptedPayloadValue(account.secret))
    ?.secret;
  return secret && isEncryptedPayloadValue(secret) ? secret.salt : vault.accounts[0].publicKey;
}

async function migrateLegacyVault(vault: VaultFile, password: string): Promise<{
  vault: VaultV3;
  masterKey: Uint8Array;
}> {
  let mnemonic: string | null = null;
  const allAccounts = [...vault.accounts, ...(vault.archivedAccounts ?? [])];
  const secrets = new Map<string, string>();
  try {
    if (vault.mnemonic && isEncryptedPayloadValue(vault.mnemonic)) {
      mnemonic = await decryptString(vault.mnemonic, password);
    } else {
      const firstSecret = allAccounts.find(
        (account) => account.secret && isEncryptedPayloadValue(account.secret),
      )?.secret;
      if (firstSecret && isEncryptedPayloadValue(firstSecret)) {
        await decryptString(firstSecret, password);
      } else if (vault.passwordCheck) {
        await decryptString(vault.passwordCheck, password);
      } else {
        throw new Error("Legacy vault has no password verifier.");
      }
    }
  } catch {
    throw new Error("Incorrect password.");
  }

  for (const account of allAccounts) {
    if (account.secret && isEncryptedPayloadValue(account.secret)) {
      let secret: string;
      try {
        secret = await decryptString(account.secret, password);
      } catch {
        throw new Error(`Encrypted key for ${account.label} could not be migrated.`);
      }
      if (Keypair.fromSecret(secret).publicKey() !== account.publicKey) {
        throw new Error(`Encrypted key for ${account.label} does not match its public address.`);
      }
      secrets.set(account.id, secret);
    } else if (account.index !== undefined && mnemonic) {
      const derived = await keypairFromMnemonicIndex(mnemonic, account.index);
      if (derived.publicKey() !== account.publicKey) {
        throw new Error(`Derived key for ${account.label} does not match its public address.`);
      }
    }
  }

  const masterKey = createVaultMasterKey();
  const merchantKey = await deriveEncryptionKeyBytes(
    password,
    `merchant-store:${legacyMerchantKeyContext(vault)}`,
  );
  try {
    const migrateAccounts = async (accounts: StoredAccount[]): Promise<StoredAccount[]> =>
      Promise.all(accounts.map(async (account) => ({
        ...account,
        ...(secrets.has(account.id)
          ? { secret: await encryptVaultString(secrets.get(account.id) as string, masterKey) }
          : { secret: undefined }),
      })));
    const wrappedMasterKey = await wrapVaultMasterKey(masterKey, password);
    const migrated: VaultV3 = {
      version: 3,
      wrappedMasterKey,
      wrappedMerchantKey: await encryptVaultBytes(merchantKey, masterKey),
      ...(mnemonic ? { mnemonic: await encryptVaultString(mnemonic, masterKey) } : {}),
      accounts: await migrateAccounts(vault.accounts),
      ...(vault.archivedAccounts
        ? { archivedAccounts: await migrateAccounts(vault.archivedAccounts) }
        : {}),
      activeAccountId: vault.activeAccountId,
    };
    const previous = window.localStorage.getItem(VAULT_KEY);
    try {
      persist(migrated);
    } catch (error) {
      try {
        if (previous === null) window.localStorage.removeItem(VAULT_KEY);
        else window.localStorage.setItem(VAULT_KEY, previous);
      } catch {
        throw new Error("Vault migration failed and browser storage could not be rolled back.");
      }
      throw error;
    }
    return { vault: migrated, masterKey };
  } catch (error) {
    zeroKey(masterKey);
    throw error;
  } finally {
    zeroKey(merchantKey);
    mnemonic = null;
    secrets.clear();
  }
}

async function masterKeyForPassword(vault: VaultFile, password: string): Promise<{
  vault: VaultV3;
  masterKey: Uint8Array;
}> {
  if (!isVaultV3(vault)) return migrateLegacyVault(vault, password);
  try {
    return { vault, masterKey: await unwrapVaultMasterKey(vault.wrappedMasterKey, password) };
  } catch {
    throw new Error("Incorrect password.");
  }
}

export async function verifyVaultPassword(password: string): Promise<void> {
  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  const unlocked = await masterKeyForPassword(vault, password);
  zeroKey(unlocked.masterKey);
}

export async function unlockVault(password: string): Promise<VaultFile> {
  const vault = readVault();
  if (!vault || vault.accounts.length === 0) {
    throw new Error("No wallet found. Please create or import one.");
  }
  requireWebCrypto();
  lockVault();
  const unlocked = await masterKeyForPassword(vault, password);
  try {
    await migratePrivateTxNotes(password, unlocked.masterKey);
    await establishVaultSession(unlocked.masterKey, unlocked.vault);
    return unlocked.vault;
  } finally {
    zeroKey(unlocked.masterKey);
  }
}

/**
 * Add an origin-bound, device-local WebAuthn PRF wrapper around the existing
 * vault master key. The password is still required for recovery and exports.
 */
export async function enablePasskeyUnlock(
  password: string,
  dependencies?: PasskeyDependencies,
): Promise<void> {
  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  requireWebCrypto();
  const unlocked = await masterKeyForPassword(vault, password);
  try {
    await migratePrivateTxNotes(password, unlocked.masterKey);
    await registerPasskeyMasterKey(unlocked.masterKey, dependencies);
  } finally {
    zeroKey(unlocked.masterKey);
  }
}

/** Unlock v3 vault state with the locally registered platform passkey. */
export async function unlockVaultWithPasskey(
  dependencies?: PasskeyDependencies,
): Promise<VaultFile> {
  const vault = readVault();
  if (!vault || vault.accounts.length === 0) {
    throw new Error("No wallet found. Please create or import one.");
  }
  if (!isVaultV3(vault)) {
    throw new Error("Unlock with your password once before enabling a passkey.");
  }
  requireWebCrypto();
  lockVault();
  const masterKey = await unwrapPasskeyMasterKey(undefined, dependencies);
  try {
    // AES-GCM authentication of wrappedMerchantKey proves that the passkey
    // unwrapped the exact master key belonging to this vault.
    await establishVaultSession(masterKey, vault);
    return vault;
  } finally {
    zeroKey(masterKey);
  }
}

export function hasPasskeyUnlock(storage?: PasskeyStorage): boolean {
  if (!storage && typeof window === "undefined") return false;
  return Boolean(loadPasskeyRecord(storage));
}

export async function removePasskeyUnlock(
  password: string,
  storage?: PasskeyStorage,
): Promise<void> {
  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  requireWebCrypto();
  const verified = await masterKeyForPassword(vault, password);
  try {
    if (!storage && typeof window === "undefined") return;
    removePasskeyRecord(storage);
  } finally {
    zeroKey(verified.masterKey);
  }
}

export async function revealSecret(accountId: string, password: string): Promise<string> {
  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  const unlocked = await masterKeyForPassword(vault, password);
  try {
    const acc = unlocked.vault.accounts.find((a) => a.id === accountId);
    if (!acc) throw new Error("Account not found");
    return await decryptAccountSecret(unlocked.vault, acc, unlocked.masterKey);
  } finally {
    zeroKey(unlocked.masterKey);
  }
}

export async function revealMnemonic(password: string): Promise<string> {
  const vault = readVault();
  if (!vault || !vault.mnemonic) {
    throw new Error("This wallet does not use a recovery phrase (imported secret key only).");
  }
  const unlocked = await masterKeyForPassword(vault, password);
  try {
    if (!unlocked.vault.mnemonic) throw new Error("This wallet does not use a recovery phrase.");
    return await decryptVaultString(unlocked.vault.mnemonic, unlocked.masterKey);
  } finally {
    zeroKey(unlocked.masterKey);
  }
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
  const masterKey = requireSessionMasterKey();
  if (!isVaultV3(vault)) throw new Error("Vault migration is required.");

  if (opts.secret) {
    const trimmed = opts.secret.trim();
    if (!validateStellarSecret(trimmed)) {
      throw new Error("Invalid Stellar secret key");
    }
    const kp = Keypair.fromSecret(trimmed);
    const enc = await encryptVaultString(trimmed, masterKey);
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
    return stripSecret(account);
  }

  if (!vault.mnemonic) {
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

  let mnemonic = await decryptVaultString(vault.mnemonic, masterKey);
  const kp = await keypairFromMnemonicIndex(mnemonic, nextIndex);
  mnemonic = "";
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
  requireSessionMasterKey();

  const targetIdx = (vault.archivedAccounts ?? []).findIndex((a) => a.id === accountId);
  if (targetIdx === -1 || !vault.archivedAccounts) {
    throw new Error("Archived account not found");
  }

  const [account] = vault.archivedAccounts.splice(targetIdx, 1);
  vault.accounts.push(account);
  vault.activeAccountId = account.id;
  persist(vault);

  return stripSecret(account);
}

export async function restoreAccountByIndex(
  index: number,
  label?: string,
): Promise<AccountMeta> {
  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  const masterKey = requireSessionMasterKey();
  if (!isVaultV3(vault) || !vault.mnemonic) throw new Error("Wallet has no recovery phrase");

  const existing = vault.accounts.find((a) => a.index === index);
  if (existing) return stripSecret(existing);

  let mnemonic = await decryptVaultString(vault.mnemonic, masterKey);
  const kp = await keypairFromMnemonicIndex(mnemonic, index);
  mnemonic = "";
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

/* ------------------------------------------------------------------ */
/* Full wallet backup. Envelope v2 encrypts the ENTIRE payload — vault, */
/* contacts, settings, tx notes, and merchant archive — with the wallet */
/* password; only the envelope marker stays plaintext. Legacy plaintext */
/* envelope v1 files are deliberately rejected.                         */
/* ------------------------------------------------------------------ */

const BACKUP_KIND = "stellar-wallet-backup";
const CONTACTS_KEY = "polaris.contacts.v1";
const PRIVACY_KEY = "polaris.privacy.v1";
const SOUND_KEY = "wallet.sound.v1";
const CURRENCY_KEY = "wallet.currency.v1";
const TX_NOTES_KEY = "wallet.tx-notes.v1";
const MERCHANT_STORE_KEY = "wallet.merchant.v2";

interface TxNoteEnvelope {
  version: 3;
  crypto: RawKeyEncryptedPayload;
}

function isTxNoteEnvelope(value: unknown): value is TxNoteEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TxNoteEnvelope>;
  return candidate.version === 3 && isRawKeyEncryptedPayloadValue(candidate.crypto);
}

async function writePrivateTxNotes(
  notes: Record<string, string>,
  masterKey: Uint8Array,
): Promise<void> {
  const envelope: TxNoteEnvelope = {
    version: 3,
    crypto: await encryptVaultString(JSON.stringify(notes), masterKey),
  };
  window.localStorage.setItem(TX_NOTES_KEY, JSON.stringify(envelope));
}

function decodeNotes(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function readPrivateTxNotes(masterKey: Uint8Array): Promise<Record<string, string>> {
  const stored = readLocalJson(TX_NOTES_KEY);
  if (stored === null) return {};
  if (isTxNoteEnvelope(stored)) {
    try {
      return decodeNotes(JSON.parse(await decryptVaultString(stored.crypto, masterKey)) as unknown);
    } catch {
      throw new Error("Private transaction notes could not be decrypted.");
    }
  }
  throw new Error("Private transaction notes require vault migration.");
}

async function migratePrivateTxNotes(password: string, masterKey: Uint8Array): Promise<void> {
  const stored = readLocalJson(TX_NOTES_KEY);
  if (stored === null || isTxNoteEnvelope(stored)) return;
  if (
    isRecord(stored) &&
    stored.version === 2 &&
    isEncryptedPayloadValue(stored.crypto)
  ) {
    try {
      const notes = decodeNotes(JSON.parse(await decryptString(stored.crypto, password)) as unknown);
      await writePrivateTxNotes(notes, masterKey);
      return;
    } catch {
      throw new Error("Private transaction notes could not be migrated.");
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
    else if (isEncryptedPayloadValue(value)) {
      try {
        notes[hash] = await decryptString(value, password);
      } catch {
        // Skip only the corrupt legacy record; valid notes are still migrated.
      }
    }
  }
  await writePrivateTxNotes(notes, masterKey);
}

export async function loadPrivateTxNote(transactionHash: string): Promise<string> {
  const masterKey = requireSessionMasterKey();
  const notes = await readPrivateTxNotes(masterKey);
  return notes[transactionHash] ?? "";
}

export async function savePrivateTxNote(
  transactionHash: string,
  note: string,
): Promise<void> {
  const masterKey = requireSessionMasterKey();
  const key = transactionHash.trim();
  if (!key) throw new Error("Transaction hash is required.");
  const notes = await readPrivateTxNotes(masterKey);
  const value = note.trim();
  if (value) notes[key] = value;
  else delete notes[key];
  await writePrivateTxNotes(notes, masterKey);
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
    return p.kind === BACKUP_KIND && p.version === 2 && isEncryptedPayloadValue(p.crypto);
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
  if (parsed.version !== 2 || !isEncryptedPayloadValue(parsed.crypto)) {
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
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext);
  } catch {
    throw new Error("The decrypted backup payload is malformed.");
  }
  const payload = decodeFullBackupPayload(decoded);
  if (!payload) throw new Error("The decrypted backup payload is malformed or invalid.");
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
export async function exportVaultBackup(password: string): Promise<string> {
  const storedVault = readVault();
  if (!storedVault) throw new Error("No wallet to back up.");
  const verified = await masterKeyForPassword(storedVault, password);
  zeroKey(verified.masterKey);
  const vault = readVault();
  if (!vault) throw new Error("No wallet to back up.");

  const contactsRaw = readLocalJson(CONTACTS_KEY);
  const notesRaw = readLocalJson(TX_NOTES_KEY);
  const autoLockRaw = window.localStorage.getItem(AUTOLOCK_KEY);
  let merchantKey: Uint8Array | null = null;
  let merchantStore: string | null;
  try {
    merchantKey = typeof indexedDB === "undefined" ? null : getMerchantEncryptionKey();
    merchantStore = typeof indexedDB === "undefined"
      ? window.localStorage.getItem(MERCHANT_STORE_KEY)
      : await getMerchantRepository().exportEncryptedArchive(merchantKey!)
        ?? window.localStorage.getItem(MERCHANT_STORE_KEY);
  } finally {
    zeroKey(merchantKey);
  }
  const payload: FullBackupPayload = {
    exportedAt: new Date().toISOString(),
    vault,
    contacts: Array.isArray(contactsRaw) ? contactsRaw : [],
    settings: {
      network: loadNetworkPref(),
      fiatCurrency: window.localStorage.getItem(CURRENCY_KEY),
      autoLockMs: autoLockRaw !== null ? Number(autoLockRaw) : null,
      privacy: window.localStorage.getItem(PRIVACY_KEY) === "1",
      sound: window.localStorage.getItem(SOUND_KEY) !== "0",
    },
    txNotes:
      notesRaw && typeof notesRaw === "object" && !Array.isArray(notesRaw)
        ? (notesRaw as Record<string, unknown>)
        : {},
    merchantStore,
  };
  const crypto = await encryptString(JSON.stringify(payload), password);
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
  const restoreKeys = [
    VAULT_KEY,
    NETWORK_KEY,
    AUTOLOCK_KEY,
    CONTACTS_KEY,
    PRIVACY_KEY,
    SOUND_KEY,
    CURRENCY_KEY,
    TX_NOTES_KEY,
    MERCHANT_STORE_KEY,
    PASSKEY_RECORD_KEY,
  ];
  const merchantRepository = typeof indexedDB === "undefined" ? null : getMerchantRepository();
  const writes = new Map<string, string | null>([
    [VAULT_KEY, JSON.stringify(vault)],
    [CONTACTS_KEY, JSON.stringify(payload.contacts)],
    [TX_NOTES_KEY, JSON.stringify(payload.txNotes)],
    [MERCHANT_STORE_KEY, merchantRepository ? null : payload.merchantStore || null],
  ]);
  // A passkey wraps one exact vault master key and is never portable in a
  // backup, so replacing the vault must revoke the previous local wrapper.
  writes.set(PASSKEY_RECORD_KEY, null);
  if (payload.settings) {
    const settings = payload.settings;
    writes.set(NETWORK_KEY, settings.network);
    writes.set(CURRENCY_KEY, settings.fiatCurrency);
    writes.set(AUTOLOCK_KEY, settings.autoLockMs === null ? null : String(settings.autoLockMs));
    writes.set(PRIVACY_KEY, settings.privacy ? "1" : "0");
    writes.set(SOUND_KEY, settings.sound ? "1" : "0");
  }
  await replaceBackupStorage({
    storage: window.localStorage,
    keys: restoreKeys,
    writes,
    archive: merchantRepository
      ? {
          read: () => merchantRepository.snapshotEncryptedArchive(),
          replace: async (value) => {
            if (value) await merchantRepository.importEncryptedArchive(value);
            else await merchantRepository.clear();
          },
        }
      : null,
    archiveValue: payload.merchantStore ?? null,
  });
  lockVault();

  return {
    accountCount: vault.accounts.length,
    hasMnemonic: Boolean(vault.mnemonic),
    contactCount: Array.isArray(payload.contacts) ? payload.contacts.length : 0,
  };
}


export async function exportKeystoreWithPassword(
  accountId: string,
  password: string,
): Promise<string | null> {
  const vault = readVault();
  const acc = vault?.accounts.find((a) => a.id === accountId);
  if (!acc || acc.watchOnly || acc.hardware) return null;

  let secret = await revealSecret(accountId, password);
  try {
    const enc = await encryptString(secret, password);
    const payload: KeystoreFile = {
      format: KEYSTORE_FORMAT,
      version: 1,
      address: acc.publicKey,
      crypto: enc,
      exportedAt: Date.now(),
    };
    return JSON.stringify(payload, null, 2);
  } finally {
    secret = "";
  }
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
