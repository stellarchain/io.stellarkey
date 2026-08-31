import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  decryptString,
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
import {
  MERCHANT_BOOTSTRAP_STORAGE_KEY,
  readMerchantBootstrapState,
  writeMerchantBootstrapState,
} from "./merchant/bootstrap";
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

const VAULT_KEY = "stellarkey.vault.v1";
const NETWORK_KEY = "stellarkey.network.v1";
const AUTOLOCK_KEY = "stellarkey.autolock.v1";

let sessionMasterKey: Uint8Array | null = null;
let sessionMerchantKey: Uint8Array | null = null;

function requireSessionMasterKey(): Uint8Array {
  if (!sessionMasterKey) throw new VaultLockedError();
  return sessionMasterKey;
}

async function establishVaultSession(
  masterKey: Uint8Array,
  vault: VaultFile,
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
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(VAULT_KEY);
  } catch {
    return {
      kind: "unavailable",
      raw: "",
      message: "Browser storage is unavailable. Allow site storage for StellarKey, then try again.",
    };
  }
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
      : {
          kind: "corrupt",
          raw,
          message: "The encrypted wallet record is incomplete or uses an unsupported POC format.",
        };
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

function replacePersistedVault(previous: VaultFile, next: VaultFile): void {
  const previousSerialized = JSON.stringify(previous);
  try {
    persist(next);
  } catch (error) {
    try {
      window.localStorage.setItem(VAULT_KEY, previousSerialized);
    } catch {
      // The original persistence error remains authoritative. The next load
      // still validates the record before granting any vault authority.
    }
    throw error;
  }
}

export function loadVault(): VaultFile | null {
  return readVault();
}

function assertVaultCreationAllowed(): void {
  const result = loadVaultResult();
  if (result.kind !== "absent" && result.kind !== "ready") {
    throw new Error("Existing wallet data needs recovery before a new wallet can be created.");
  }
}

export function wipeVault(): void {
  lockVault();
  if (typeof window !== "undefined") {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && (key.startsWith("stellarkey.") || key.startsWith("wallet."))) keys.push(key);
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
  vault: VaultFile,
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
  if (!vault) throw new Error("No vault found");
  const account = vault.accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("Account not found");
  let secret = await decryptAccountSecret(vault, account, masterKey);
  try {
    return await operation(secret);
  } finally {
    secret = "";
  }
}

function decodePrivacyContextHex(value: string, name: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${name} must be exactly 32 bytes of hexadecimal data.`);
  }
  return Uint8Array.from(
    value.match(/../g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
}

export async function withPrivacySessionRoot<T>(
  accountId: string,
  deploymentContext: {
    protocolVersion: number;
    networkId: string;
    realmId: string;
    poolContractId: string;
    deploymentBindingHash: string;
  },
  operation: (sessionRoot: Uint8Array, storageKey: Uint8Array) => T | Promise<T>,
): Promise<T> {
  return withSecretKey(accountId, async (secret) => {
    let rawSeed: Uint8Array | null = null;
    let sessionRoot: Uint8Array | null = null;
    let storageKey: Uint8Array | null = null;
    try {
      rawSeed = new Uint8Array(StrKey.decodeEd25519SecretSeed(secret));
      const networkId = decodePrivacyContextHex(deploymentContext.networkId, "Network ID");
      const realmId = decodePrivacyContextHex(deploymentContext.realmId, "Realm ID");
      const deploymentBindingHash = decodePrivacyContextHex(
        deploymentContext.deploymentBindingHash,
        "Deployment binding hash",
      );
      const poolId = new Uint8Array(StrKey.decodeContract(deploymentContext.poolContractId));
      const accountPublicKey = new Uint8Array(
        StrKey.decodeEd25519PublicKey(Keypair.fromSecret(secret).publicKey()),
      );
      const { derivePrivacySessionRoot, derivePrivateStorageKey } = await import(
        "@stellarkey/private-balance"
      );
      sessionRoot = derivePrivacySessionRoot(
        rawSeed,
        deploymentContext.protocolVersion,
        networkId,
        realmId,
        poolId,
        accountPublicKey,
      );
      storageKey = derivePrivateStorageKey(
        sessionRoot,
        deploymentBindingHash,
      );
      return await operation(sessionRoot, storageKey);
    } finally {
      if (rawSeed?.byteLength) {
        rawSeed.fill(0);
      }
      if (sessionRoot?.byteLength) {
        sessionRoot.fill(0);
      }
      if (storageKey?.byteLength) {
        storageKey.fill(0);
      }
    }
  });
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
  requirePasswordForSigning?: boolean;
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
        requirePasswordForSigning: opts.requirePasswordForSigning ?? false,
      };
      persist(vault);
      writeMerchantBootstrapState({ enabled: false, configured: false });
      await writePrivateContacts([], masterKey);
      await writePrivateTxNotes({}, masterKey);
      await establishVaultSession(masterKey, vault);
      return { account: stripSecret(account), revealed: trimmed };
    } finally {
      zeroKey(masterKey);
    }
  }

  const rawMnemonic = opts.mnemonic ? normalizeMnemonic(opts.mnemonic) : await generateMnemonic();
  if (!(await validateMnemonic(rawMnemonic))) {
    throw new Error("Invalid BIP-39 recovery phrase");
  }

  return createDerivedVault(
    password,
    rawMnemonic,
    opts.label,
    opts.requirePasswordForSigning ?? false,
  );
}

async function createDerivedVault(
  password: string,
  mnemonic: string,
  label?: string,
  requirePasswordForSigning = false,
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
      requirePasswordForSigning,
    };
    persist(vault);
    writeMerchantBootstrapState({ enabled: false, configured: false });
    await writePrivateContacts([], masterKey);
    await writePrivateTxNotes({}, masterKey);
    await establishVaultSession(masterKey, vault);
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
  security: { requirePasswordForSigning?: boolean } = {},
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
      requirePasswordForSigning: security.requirePasswordForSigning ?? false,
    };
    persist(vault);
    writeMerchantBootstrapState({ enabled: false, configured: false });
    await writePrivateContacts([], masterKey);
    await writePrivateTxNotes({}, masterKey);
    await establishVaultSession(masterKey, vault);
    return { account: stripSecret(stored) };
  } finally {
    zeroKey(masterKey);
  }
}

async function masterKeyForPassword(vault: VaultFile, password: string): Promise<{
  vault: VaultFile;
  masterKey: Uint8Array;
}> {
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

export function isSigningPasswordRequired(): boolean {
  return readVault()?.requirePasswordForSigning === true;
}

export async function setSigningPasswordRequired(
  required: boolean,
  currentPassword?: string,
): Promise<void> {
  requireSessionMasterKey();
  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  if (vault.requirePasswordForSigning === required) return;

  if (!required) {
    if (!currentPassword) {
      throw new Error("Enter your current password to turn off signing confirmation.");
    }
    const verified = await masterKeyForPassword(vault, currentPassword);
    zeroKey(verified.masterKey);
  }

  replacePersistedVault(vault, {
    ...vault,
    requirePasswordForSigning: required,
  });
}

export async function changeVaultPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  requireSessionMasterKey();
  const passwordPolicy = validateNewVaultPassword(newPassword);
  if (!passwordPolicy.valid) {
    throw new Error(passwordPolicy.message ?? "Choose a stronger password.");
  }
  if (currentPassword === newPassword) {
    throw new Error("Choose a new password that is different from your current password.");
  }

  const vault = readVault();
  if (!vault) throw new Error("No vault found");
  const verified = await masterKeyForPassword(vault, currentPassword);
  try {
    const next: VaultFile = {
      ...vault,
      wrappedMasterKey: await wrapVaultMasterKey(verified.masterKey, newPassword),
    };
    replacePersistedVault(vault, next);
  } finally {
    zeroKey(verified.masterKey);
  }
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
    await readPrivateContacts(unlocked.masterKey);
    await readPrivateTxNotes(unlocked.masterKey);
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
    await readPrivateContacts(unlocked.masterKey);
    await readPrivateTxNotes(unlocked.masterKey);
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
  requireWebCrypto();
  lockVault();
  const masterKey = await unwrapPasskeyMasterKey(undefined, dependencies);
  try {
    // AES-GCM authentication of wrappedMerchantKey proves that the passkey
    // unwrapped the exact master key belonging to this vault.
    await readPrivateContacts(masterKey);
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
  if (!vault.mnemonic) throw new Error("Wallet has no recovery phrase");

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
const CONTACTS_KEY = "stellarkey.contacts.v1";
const PRIVACY_KEY = "stellarkey.privacy.v1";
const SOUND_KEY = "wallet.sound.v1";
const CURRENCY_KEY = "wallet.currency.v1";
const TX_NOTES_KEY = "wallet.tx-notes.v1";

interface PrivateContactsEnvelope {
  version: 3;
  crypto: RawKeyEncryptedPayload;
}

type PrivateContactRecord = FullBackupPayload["contacts"][number];

function isPrivateContactsEnvelope(value: unknown): value is PrivateContactsEnvelope {
  if (!isRecord(value)) return false;
  return value.version === 3 && isRawKeyEncryptedPayloadValue(value.crypto);
}

function normalizePrivateContact(value: unknown): PrivateContactRecord | null {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.address !== "string") {
    return null;
  }
  const name = value.name.trim();
  const address = value.address.trim();
  if (!name || !isValidPublicAddress(address)) return null;
  return { name, address, favorite: value.favorite === true };
}

function normalizePrivateContacts(value: unknown): PrivateContactRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizePrivateContact)
    .filter((contact): contact is PrivateContactRecord => contact !== null);
}

function decodeAuthenticatedContacts(plaintext: string): PrivateContactRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error("Encrypted contacts are malformed.");
  }
  if (!Array.isArray(parsed)) throw new Error("Encrypted contacts are malformed.");
  const contacts = normalizePrivateContacts(parsed);
  if (contacts.length !== parsed.length) throw new Error("Encrypted contacts are malformed.");
  return contacts;
}

async function encodePrivateContacts(
  contacts: PrivateContactRecord[],
  masterKey: Uint8Array,
): Promise<string> {
  const normalized = normalizePrivateContacts(contacts);
  if (normalized.length !== contacts.length) throw new Error("Contacts contain an invalid record.");
  const envelope: PrivateContactsEnvelope = {
    version: 3,
    crypto: await encryptVaultString(JSON.stringify(normalized), masterKey),
  };
  return JSON.stringify(envelope);
}

async function writePrivateContacts(
  contacts: PrivateContactRecord[],
  masterKey: Uint8Array,
): Promise<void> {
  const serialized = await encodePrivateContacts(contacts, masterKey);
  window.localStorage.setItem(CONTACTS_KEY, serialized);
  if (window.localStorage.getItem(CONTACTS_KEY) !== serialized) {
    throw new Error("Browser storage did not retain the encrypted contacts.");
  }
}

async function readPrivateContacts(masterKey: Uint8Array): Promise<PrivateContactRecord[]> {
  const stored = readLocalJson(CONTACTS_KEY);
  if (stored === null) return [];
  if (!isPrivateContactsEnvelope(stored)) {
    throw new Error("Private contacts use an unsupported POC format.");
  }
  try {
    return decodeAuthenticatedContacts(await decryptVaultString(stored.crypto, masterKey));
  } catch (error) {
    if (error instanceof Error && error.message === "Encrypted contacts are malformed.") throw error;
    throw new Error("Private contacts could not be decrypted.");
  }
}

export async function loadPrivateContactRecords(): Promise<PrivateContactRecord[]> {
  return readPrivateContacts(requireSessionMasterKey());
}

export async function savePrivateContactRecords(
  contacts: PrivateContactRecord[],
): Promise<void> {
  await writePrivateContacts(contacts, requireSessionMasterKey());
}

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
  throw new Error("Private transaction notes use an unsupported POC format.");
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
  hasPrivateBalanceArchive: boolean;
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
    hasPrivateBalanceArchive:
      typeof payload.privateBalanceStore === "string" && Boolean(payload.privateBalanceStore),
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
  let contacts: PrivateContactRecord[];
  try {
    contacts = await readPrivateContacts(verified.masterKey);
  } finally {
    zeroKey(verified.masterKey);
  }
  const vault = readVault();
  if (!vault) throw new Error("No wallet to back up.");

  const notesRaw = readLocalJson(TX_NOTES_KEY);
  const autoLockRaw = window.localStorage.getItem(AUTOLOCK_KEY);
  const merchantBootstrap = readMerchantBootstrapState();
  let merchantKey: Uint8Array | null = null;
  let merchantStore: string | null;
  let privateBalanceStore: string | null = null;
  try {
    merchantKey = typeof indexedDB === "undefined" ? null : getMerchantEncryptionKey();
    merchantStore = merchantKey
      ? await getMerchantRepository().exportEncryptedArchive(merchantKey)
      : null;
    if (typeof indexedDB !== "undefined") {
      const { exportPrivateBalanceBackupArchive } = await import(
        "@/features/private-balance/runtime/backup"
      );
      privateBalanceStore = JSON.stringify(await exportPrivateBalanceBackupArchive());
    }
  } finally {
    zeroKey(merchantKey);
  }
  const payload: FullBackupPayload = {
    exportedAt: new Date().toISOString(),
    vault,
    contacts,
    settings: {
      network: loadNetworkPref(),
      fiatCurrency: window.localStorage.getItem(CURRENCY_KEY),
      autoLockMs: autoLockRaw !== null ? Number(autoLockRaw) : null,
      privacy: window.localStorage.getItem(PRIVACY_KEY) === "1",
      sound: window.localStorage.getItem(SOUND_KEY) !== "0",
      ...(merchantBootstrap ? {
        merchantMode: {
          enabled: merchantBootstrap.enabled,
          configured: merchantBootstrap.configured,
        },
      } : {}),
    },
    txNotes:
      notesRaw && typeof notesRaw === "object" && !Array.isArray(notesRaw)
        ? (notesRaw as Record<string, unknown>)
        : {},
    merchantStore,
    privateBalanceStore,
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
  let encryptedContacts: string;
  let preparedPrivateBalanceStore: string | null = null;
  let masterKey: Uint8Array | null = null;
  try {
    masterKey = await unwrapVaultMasterKey(vault.wrappedMasterKey, password as string);
    encryptedContacts = await encodePrivateContacts(payload.contacts, masterKey);
    if (payload.privateBalanceStore) {
      if (typeof indexedDB === "undefined") {
        throw new Error("IndexedDB is required to restore this backup's Private Balance records.");
      }
      const { preparePrivateBalanceBackupArchive } = await import(
        "@/features/private-balance/runtime/backup"
      );
      const prepared = await preparePrivateBalanceBackupArchive({
        archive: payload.privateBalanceStore,
        resolveStorageKey: async context => {
          const account = vault.accounts.find(candidate => candidate.id === context.accountId);
          if (!account || account.watchOnly || account.hardware) {
            throw new Error("Private Balance backup references an unsupported wallet account.");
          }
          let secret = "";
          let rawSeed: Uint8Array | null = null;
          let sessionRoot: Uint8Array | null = null;
          try {
            secret = await decryptAccountSecret(vault, account, masterKey as Uint8Array);
            rawSeed = new Uint8Array(StrKey.decodeEd25519SecretSeed(secret));
            const { derivePrivacySessionRoot, derivePrivateStorageKey } = await import(
              "@stellarkey/private-balance"
            );
            sessionRoot = derivePrivacySessionRoot(
              rawSeed,
              1,
              decodePrivacyContextHex(context.networkId, "Network ID"),
              decodePrivacyContextHex(context.realmId, "Realm ID"),
              decodePrivacyContextHex(context.poolId, "Pool ID"),
              new Uint8Array(StrKey.decodeEd25519PublicKey(account.publicKey)),
            );
            return derivePrivateStorageKey(
              sessionRoot,
              decodePrivacyContextHex(
                context.deploymentBindingHash,
                "Deployment binding hash",
              ),
            );
          } finally {
            secret = "";
            rawSeed?.fill(0);
            sessionRoot?.fill(0);
          }
        },
        validateContext: async (context, state) => {
          if (
            state.checkpoint &&
            state.checkpoint.deploymentBindingHash !== context.deploymentBindingHash
          ) {
            throw new Error("Private Balance checkpoint deployment binding does not match.");
          }
        },
      });
      preparedPrivateBalanceStore = JSON.stringify(prepared);
    } else if (typeof indexedDB !== "undefined") {
      preparedPrivateBalanceStore = JSON.stringify({ schemaVersion: 1, records: [] });
    }
  } catch {
    throw new Error("The backup could not unlock or validate its encrypted wallet data.");
  } finally {
    zeroKey(masterKey);
  }
  const restoreKeys = [
    VAULT_KEY,
    NETWORK_KEY,
    AUTOLOCK_KEY,
    CONTACTS_KEY,
    PRIVACY_KEY,
    SOUND_KEY,
    CURRENCY_KEY,
    TX_NOTES_KEY,
    PASSKEY_RECORD_KEY,
    MERCHANT_BOOTSTRAP_STORAGE_KEY,
  ];
  const merchantRepository = typeof indexedDB === "undefined" ? null : getMerchantRepository();
  if (payload.merchantStore && !merchantRepository) {
    throw new Error("IndexedDB is required to restore this backup's merchant records.");
  }
  const privateBalanceArchive = typeof indexedDB === "undefined"
    ? null
    : await import("@/features/private-balance/runtime/backup");
  const writes = new Map<string, string | null>([
    [VAULT_KEY, JSON.stringify(vault)],
    [CONTACTS_KEY, encryptedContacts],
    [TX_NOTES_KEY, JSON.stringify(payload.txNotes)],
  ]);
  // A passkey wraps one exact vault master key and is never portable in a
  // backup, so replacing the vault must revoke the previous local wrapper.
  writes.set(PASSKEY_RECORD_KEY, null);
  writes.set(
    MERCHANT_BOOTSTRAP_STORAGE_KEY,
    payload.settings?.merchantMode
      ? JSON.stringify({ version: 1, ...payload.settings.merchantMode })
      : null,
  );
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
    archives: [
      ...(merchantRepository ? [{
        archive: {
          read: () => merchantRepository.snapshotEncryptedArchive(),
          replace: async (value: string | null) => {
            if (value) await merchantRepository.importEncryptedArchive(value);
            else await merchantRepository.clear();
          },
        },
        value: payload.merchantStore ?? null,
      }] : []),
      ...(privateBalanceArchive ? [{
        archive: {
          read: async () => JSON.stringify(
            await privateBalanceArchive.exportPrivateBalanceBackupArchive(),
          ),
          replace: async (value: string | null) => {
            await privateBalanceArchive.replacePrivateBalanceBackupArchive(
              value ?? { schemaVersion: 1, records: [] },
            );
          },
        },
        value: preparedPrivateBalanceStore,
      }] : []),
    ],
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
    parsed.format !== KEYSTORE_FORMAT ||
    !parsed.crypto
  ) {
    throw new Error("Invalid Wallet keystore format");
  }
  const secret = await decryptString(parsed.crypto, keystorePassword);
  return addStoredAccount({ secret });
}
