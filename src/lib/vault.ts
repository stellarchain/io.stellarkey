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

export function wipeVault(): void {
  lockVault();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(VAULT_KEY);
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
  vault.accounts = vault.accounts.filter((a) => a.id !== accountId);
  if (vault.activeAccountId === accountId) {
    vault.activeAccountId = vault.accounts[0].id;
  }
  sessionSecrets.delete(accountId);
  persist(vault);
  return vault;
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

const KEYSTORE_FORMAT = "polaris-keystore/v1";

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
  if (!parsed || parsed.format !== KEYSTORE_FORMAT || !parsed.crypto) {
    throw new Error("Invalid Polaris keystore format");
  }
  const secret = await decryptString(parsed.crypto, keystorePassword);
  return addStoredAccount({ secret });
}
