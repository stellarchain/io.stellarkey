import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk";
import { zeroKey } from "../src/lib/vault-keys.ts";

class MemoryStorage {
  #items = new Map();
  get length() { return this.#items.size; }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

function passkeyDependencies(storage) {
  const credentialId = new Uint8Array([11, 22, 33, 44]);
  const prfOutput = new Uint8Array(32).fill(91);
  const credential = (registration = false) => ({
    type: "public-key",
    rawId: credentialId.slice().buffer,
    getClientExtensionResults: () => registration
      ? { prf: { enabled: true, results: { first: prfOutput.slice().buffer } } }
      : { prf: { results: { first: prfOutput.slice().buffer } } },
  });
  return {
    credentials: {
      create: async () => credential(true),
      get: async () => credential(false),
    },
    secureContext: true,
    storage,
  };
}

const password = "correct horse battery staple";

test("new software vaults reject weak passwords at the storage boundary", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { initializeVault, lockVault } = await import("../src/lib/vault.ts");
  lockVault();
  const source = Keypair.random();

  for (const candidate of ["password123", "aaaaaaaaaaaaaaaa", "Aurora!27"]) {
    await assert.rejects(
      () => initializeVault(candidate, { secret: source.secret() }),
      /password|characters|predictable|common/i,
    );
  }
  assert.equal(localStorage.getItem("stellarkey.vault.v1"), null);
});

test("new wallets persist a password-wrapped v3 master key without plaintext secrets", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { initializeVault, lockVault } = await import("../src/lib/vault.ts");
  lockVault();
  const source = Keypair.random();

  const result = await initializeVault(password, { secret: source.secret() });
  const stored = JSON.parse(localStorage.getItem("stellarkey.vault.v1"));

  assert.equal(stored.version, 3);
  assert.ok(stored.wrappedMasterKey?.salt);
  assert.ok(stored.wrappedMasterKey?.ciphertext);
  assert.ok(stored.wrappedMerchantKey?.ciphertext);
  assert.equal(stored.accounts[0].publicKey, source.publicKey());
  assert.equal(result.account.publicKey, source.publicKey());
  assert.equal(JSON.stringify(stored).includes(source.secret()), false);
  assert.deepEqual(Object.keys(stored.accounts[0].secret).sort(), ["ciphertext", "iv"]);
});

test("new wallets persist the explicit per-signature password policy", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const {
    initializeVault,
    isSigningPasswordRequired,
    lockVault,
  } = await import("../src/lib/vault.ts");
  lockVault();

  await initializeVault(password, {
    secret: Keypair.random().secret(),
    requirePasswordForSigning: true,
  });

  const stored = JSON.parse(localStorage.getItem("stellarkey.vault.v1"));
  assert.equal(stored.requirePasswordForSigning, true);
  assert.equal(isSigningPasswordRequired(), true);
});

test("existing vault records without a signing policy default safely to disabled", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const {
    initializeVault,
    isSigningPasswordRequired,
    loadVaultResult,
    lockVault,
  } = await import("../src/lib/vault.ts");
  lockVault();

  await initializeVault(password, { secret: Keypair.random().secret() });
  const stored = JSON.parse(localStorage.getItem("stellarkey.vault.v1"));
  delete stored.requirePasswordForSigning;
  localStorage.setItem("stellarkey.vault.v1", JSON.stringify(stored));

  assert.equal(loadVaultResult().kind, "ready");
  assert.equal(isSigningPasswordRequired(), false);
});

test("disabling signing password confirmation requires the current password", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const {
    initializeVault,
    isSigningPasswordRequired,
    lockVault,
    setSigningPasswordRequired,
  } = await import("../src/lib/vault.ts");
  lockVault();

  await initializeVault(password, {
    secret: Keypair.random().secret(),
    requirePasswordForSigning: true,
  });
  await assert.rejects(
    () => setSigningPasswordRequired(false, "wrong password"),
    /incorrect password/i,
  );
  assert.equal(isSigningPasswordRequired(), true);

  await setSigningPasswordRequired(false, password);
  assert.equal(isSigningPasswordRequired(), false);

  await setSigningPasswordRequired(true);
  assert.equal(isSigningPasswordRequired(), true);
});

test("changing the vault password re-wraps the same master key without invalidating secrets or passkeys", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const {
    changeVaultPassword,
    enablePasskeyUnlock,
    hasPasskeyUnlock,
    initializeVault,
    lockVault,
    unlockVault,
    unlockVaultWithPasskey,
    withSecretKey,
  } = await import("../src/lib/vault.ts");
  lockVault();
  const source = Keypair.random();
  const { account } = await initializeVault(password, { secret: source.secret() });
  const deps = passkeyDependencies(localStorage);
  await enablePasskeyUnlock(password, deps);
  const replacement = "violet glacier orbit lantern harbor";

  await assert.rejects(
    () => changeVaultPassword("wrong password", replacement),
    /incorrect password/i,
  );
  await unlockVault(password);

  await changeVaultPassword(password, replacement);
  assert.equal(hasPasskeyUnlock(localStorage), true);
  lockVault();
  await assert.rejects(() => unlockVault(password), /incorrect password/i);
  await unlockVault(replacement);
  assert.equal(await withSecretKey(account.id, (secret) => secret), source.secret());

  lockVault();
  await unlockVaultWithPasskey(deps);
  assert.equal(await withSecretKey(account.id, (secret) => secret), source.secret());
});

test("POC vault formats are rejected without modifying them", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { loadVaultResult, lockVault, unlockVault } = await import("../src/lib/vault.ts");
  lockVault();
  const source = Keypair.random();
  for (const version of [1, 2]) {
    const raw = JSON.stringify({
      version,
      accounts: [{
        id: `poc-${version}`,
        label: "POC wallet",
        publicKey: source.publicKey(),
        createdAt: 1,
      }],
      activeAccountId: `poc-${version}`,
    });
    localStorage.setItem("stellarkey.vault.v1", raw);

    const result = loadVaultResult();
    assert.equal(result.kind, "corrupt");
    assert.match(result.message, /unsupported|current/i);
    await assert.rejects(() => unlockVault(password), /no wallet found/i);
    assert.equal(localStorage.getItem("stellarkey.vault.v1"), raw);
  }
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
  const stored = JSON.parse(localStorage.getItem("stellarkey.vault.v1"));
  const firstStored = stored.accounts.find((account) => account.id === initialized.account.id);
  const secondStored = stored.accounts.find((account) => account.id === added.id);
  [firstStored.secret, secondStored.secret] = [secondStored.secret, firstStored.secret];
  localStorage.setItem("stellarkey.vault.v1", JSON.stringify(stored));

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

test("account keystores accept only the current format marker", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const {
    exportKeystoreWithPassword,
    importKeystore,
    initializeVault,
    lockVault,
  } = await import("../src/lib/vault.ts");
  lockVault();
  const { account } = await initializeVault(password, { secret: Keypair.random().secret() });
  const current = JSON.parse(await exportKeystoreWithPassword(account.id, password));
  current.format = "stellarkey-keystore/v1";

  await assert.rejects(
    () => importKeystore(JSON.stringify(current), password),
    /invalid.*keystore format/i,
  );
});

test("an optional local passkey unwraps the v3 master key while password fallback remains", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const {
    enablePasskeyUnlock,
    hasPasskeyUnlock,
    initializeVault,
    lockVault,
    removePasskeyUnlock,
    unlockVault,
    unlockVaultWithPasskey,
    withSecretKey,
  } = await import("../src/lib/vault.ts");
  lockVault();
  const source = Keypair.random();
  const { account } = await initializeVault(password, { secret: source.secret() });
  const deps = passkeyDependencies(localStorage);

  await enablePasskeyUnlock(password, deps);
  assert.equal(hasPasskeyUnlock(localStorage), true);
  assert.equal(localStorage.getItem("wallet.passkey-prf.v1").includes(password), false);

  lockVault();
  await unlockVaultWithPasskey(deps);
  assert.equal(await withSecretKey(account.id, (secret) => secret), source.secret());

  lockVault();
  await unlockVault(password);
  assert.equal(await withSecretKey(account.id, (secret) => secret), source.secret());

  await assert.rejects(
    () => removePasskeyUnlock("wrong password", localStorage),
    /incorrect password/i,
  );
  assert.equal(hasPasskeyUnlock(localStorage), true);

  await removePasskeyUnlock(password, localStorage);
  assert.equal(hasPasskeyUnlock(localStorage), false);
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
