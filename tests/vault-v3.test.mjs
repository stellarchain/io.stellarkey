import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk";
import { deriveEncryptionKeyBytes, encryptString } from "../src/lib/crypto.ts";
import { generateMnemonic, keypairFromMnemonicIndex, stellarAccountPath } from "../src/lib/hd.ts";
import { zeroKey } from "../src/lib/vault-keys.ts";

class MemoryStorage {
  #items = new Map();
  get length() { return this.#items.size; }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

const password = "correct horse battery staple";

test("new wallets persist a password-wrapped v3 master key without plaintext secrets", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { initializeVault, lockVault } = await import("../src/lib/vault.ts");
  lockVault();
  const source = Keypair.random();

  const result = await initializeVault(password, { secret: source.secret() });
  const stored = JSON.parse(localStorage.getItem("polaris.vault.v1"));

  assert.equal(stored.version, 3);
  assert.ok(stored.wrappedMasterKey?.salt);
  assert.ok(stored.wrappedMasterKey?.ciphertext);
  assert.ok(stored.wrappedMerchantKey?.ciphertext);
  assert.equal(stored.accounts[0].publicKey, source.publicKey());
  assert.equal(result.account.publicKey, source.publicKey());
  assert.equal(JSON.stringify(stored).includes(source.secret()), false);
  assert.deepEqual(Object.keys(stored.accounts[0].secret).sort(), ["ciphertext", "iv"]);
});

test("legacy password-encrypted wallets migrate only after successful unlock", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { lockVault, unlockVault, withSecretKey } = await import("../src/lib/vault.ts");
  lockVault();
  const source = Keypair.random();
  const legacy = {
    version: 1,
    accounts: [{
      id: "legacy-account",
      label: "Legacy",
      publicKey: source.publicKey(),
      createdAt: 1,
      secret: await encryptString(source.secret(), password),
    }],
    activeAccountId: "legacy-account",
  };
  localStorage.setItem("polaris.vault.v1", JSON.stringify(legacy));

  await assert.rejects(() => unlockVault("wrong password"), /incorrect password/i);
  assert.equal(JSON.parse(localStorage.getItem("polaris.vault.v1")).version, 1);

  const unlocked = await unlockVault(password);
  assert.equal(unlocked.version, 3);
  assert.equal(unlocked.accounts[0].publicKey, source.publicKey());
  assert.equal(JSON.parse(localStorage.getItem("polaris.vault.v1")).version, 3);
  assert.equal(await withSecretKey("legacy-account", (secret) => secret), source.secret());
});

test("legacy merchant encryption authority remains usable after vault migration", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { getMerchantEncryptionKey, lockVault, unlockVault } = await import("../src/lib/vault.ts");
  lockVault();
  const source = Keypair.random();
  const encryptedSecret = await encryptString(source.secret(), password);
  localStorage.setItem("polaris.vault.v1", JSON.stringify({
    version: 1,
    accounts: [{
      id: "merchant-legacy",
      label: "Merchant",
      publicKey: source.publicKey(),
      createdAt: 1,
      secret: encryptedSecret,
    }],
    activeAccountId: "merchant-legacy",
  }));
  const legacyMerchantKey = await deriveEncryptionKeyBytes(
    password,
    `merchant-store:${encryptedSecret.salt}`,
  );

  await unlockVault(password);
  const migratedMerchantKey = getMerchantEncryptionKey();
  assert.deepEqual(migratedMerchantKey, legacyMerchantKey);
  legacyMerchantKey.fill(0);
  migratedMerchantKey.fill(0);
});

test("v2 mnemonic wallets migrate without changing any derived account identity", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { lockVault, unlockVault, withSecretKey } = await import("../src/lib/vault.ts");
  lockVault();
  const mnemonic = await generateMnemonic();
  const first = await keypairFromMnemonicIndex(mnemonic, 0);
  const second = await keypairFromMnemonicIndex(mnemonic, 1);
  localStorage.setItem("polaris.vault.v1", JSON.stringify({
    version: 2,
    mnemonic: await encryptString(mnemonic, password),
    accounts: [first, second].map((keypair, index) => ({
      id: `derived-${index}`,
      label: `Account ${index + 1}`,
      publicKey: keypair.publicKey(),
      createdAt: index + 1,
      index,
      path: stellarAccountPath(index),
    })),
    activeAccountId: "derived-0",
  }));

  const unlocked = await unlockVault(password);
  assert.equal(unlocked.version, 3);
  assert.deepEqual(unlocked.accounts.map((account) => account.publicKey), [
    first.publicKey(),
    second.publicKey(),
  ]);
  assert.equal(
    await withSecretKey("derived-1", (secret) => Keypair.fromSecret(secret).publicKey()),
    second.publicKey(),
  );
});

test("secret access is scoped to one async operation and lock zeroes session authority", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { initializeVault, isUnlocked, lockVault, withSecretKey } = await import(
    "../src/lib/vault.ts"
  );
  lockVault();
  const source = Keypair.random();
  const { account } = await initializeVault(password, { secret: source.secret() });

  assert.equal(isUnlocked(), true);
  assert.equal(await withSecretKey(account.id, async (secret) => Keypair.fromSecret(secret).publicKey()), source.publicKey());
  lockVault();
  assert.equal(isUnlocked(), false);
  await assert.rejects(() => withSecretKey(account.id, () => null), /locked/i);
});

test("encrypted account payloads stay bound to their public identities", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { addStoredAccount, initializeVault, lockVault, withSecretKey } = await import(
    "../src/lib/vault.ts"
  );
  lockVault();
  const first = Keypair.random();
  const second = Keypair.random();
  const initialized = await initializeVault(password, { secret: first.secret() });
  const added = await addStoredAccount({ secret: second.secret() });
  const stored = JSON.parse(localStorage.getItem("polaris.vault.v1"));
  const firstStored = stored.accounts.find((account) => account.id === initialized.account.id);
  const secondStored = stored.accounts.find((account) => account.id === added.id);
  [firstStored.secret, secondStored.secret] = [secondStored.secret, firstStored.secret];
  localStorage.setItem("polaris.vault.v1", JSON.stringify(stored));

  await assert.rejects(
    () => withSecretKey(initialized.account.id, () => null),
    /does not match.*public address/i,
  );
});

test("password-sensitive exports verify the password at the point of use", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { exportVaultBackup, initializeVault, lockVault, revealSecret } = await import(
    "../src/lib/vault.ts"
  );
  lockVault();
  const source = Keypair.random();
  const { account } = await initializeVault(password, { secret: source.secret() });

  await assert.rejects(() => exportVaultBackup("wrong password"), /incorrect password/i);
  await assert.rejects(() => revealSecret(account.id, "wrong password"), /incorrect password/i);
  assert.equal(await revealSecret(account.id, password), source.secret());
  assert.match(await exportVaultBackup(password), /stellar-wallet-backup/);
});

test("wallet runtime retains only key bytes, never passwords, mnemonics, or account secrets", () => {
  const vault = readFileSync(new URL("../src/lib/vault.ts", import.meta.url), "utf8");
  const walletHook = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");
  const merchantHook = readFileSync(new URL("../src/hooks/useMerchant.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(vault, /sessionPassword|sessionMnemonic|sessionSecrets/);
  assert.doesNotMatch(walletHook, /getSecretKey/);
  assert.match(vault, /sessionMasterKey\?\.fill\(0\)/);
  assert.match(walletHook, /withSecretKey/);
  assert.ok((merchantHook.match(/key\.fill\(0\)/g) ?? []).length >= 3);

  const key = new Uint8Array([1, 2, 3, 4]);
  zeroKey(key);
  assert.deepEqual(key, new Uint8Array(4));
});
