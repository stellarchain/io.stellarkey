import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  #items = new Map();

  get length() {
    return this.#items.size;
  }

  key(index) {
    return [...this.#items.keys()][index] ?? null;
  }

  getItem(key) {
    return this.#items.get(key) ?? null;
  }

  setItem(key, value) {
    this.#items.set(key, String(value));
  }

  removeItem(key) {
    this.#items.delete(key);
  }

  clear() {
    this.#items.clear();
  }
}

test("destructive reset removes every wallet-owned storage key and preserves unrelated data", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };

  const walletKeys = [
    "polaris.vault.v1",
    "polaris.trash.v1",
    "polaris.network.v1",
    "polaris.autolock.v1",
    "polaris.contacts.v1",
    "wallet.tx-notes.v1",
    "wallet.asset-logos.v1",
    "wallet.price-alerts.v1",
  ];
  for (const key of walletKeys) localStorage.setItem(key, key.endsWith("vault.v1") ? JSON.stringify({ version: 1, accounts: [], activeAccountId: null }) : "data");
  localStorage.setItem("unrelated.application", "keep");

  const { wipeVault } = await import("../src/lib/vault.ts");
  wipeVault();

  for (const key of walletKeys) assert.equal(localStorage.getItem(key), null, `${key} was not erased`);
  assert.equal(localStorage.getItem("unrelated.application"), "keep");
});

test("corrupt contact records cannot crash address comparisons", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const alice = Keypair.random().publicKey();
  const bob = Keypair.random().publicKey();
  localStorage.setItem(
    "polaris.contacts.v1",
    JSON.stringify([null, {}, { name: "Alice", address: alice }, { name: 7, address: null }]),
  );

  const { loadContacts, saveContact } = await import("../src/lib/contacts.ts");
  assert.deepEqual(loadContacts(), [{ name: "Alice", address: alice, favorite: false }]);
  assert.doesNotThrow(() => saveContact({ name: "Bob", address: bob }));
  assert.equal(loadContacts().length, 2);
});

test("private transaction notes are encrypted at rest and require an unlocked vault", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const {
    initializeVault,
    getMerchantEncryptionKey,
    loadPrivateTxNote,
    lockVault,
    savePrivateTxNote,
  } = await import("../src/lib/vault.ts");
  await initializeVault("correct horse battery staple", { secret: Keypair.random().secret() });

  await savePrivateTxNote("deadbeef", "Invoice 104 — confidential");
  const stored = localStorage.getItem("wallet.tx-notes.v1");
  assert.ok(stored);
  assert.equal(stored.includes("Invoice 104"), false);
  assert.equal(await loadPrivateTxNote("deadbeef"), "Invoice 104 — confidential");

  lockVault();
  await assert.rejects(() => loadPrivateTxNote("deadbeef"), /locked/i);
  assert.throws(() => getMerchantEncryptionKey(), /locked/i);
});

test("merchant session keys are unique to each vault even when passwords match", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const {
    getMerchantEncryptionKey,
    initializeVault,
    wipeVault,
  } = await import("../src/lib/vault.ts");
  const password = "same password across separate vaults";

  await initializeVault(password, { secret: Keypair.random().secret() });
  const firstKey = getMerchantEncryptionKey();
  wipeVault();
  await initializeVault(password, { secret: Keypair.random().secret() });
  const secondKey = getMerchantEncryptionKey();

  assert.notDeepEqual(firstKey, secondKey);
});

test("vault loading distinguishes absent, corrupt, and future data without overwriting it", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { loadVaultResult } = await import("../src/lib/vault.ts");

  assert.deepEqual(loadVaultResult(), { kind: "absent" });

  localStorage.setItem("polaris.vault.v1", "{not-json");
  const corrupt = loadVaultResult();
  assert.equal(corrupt.kind, "corrupt");
  assert.equal(corrupt.raw, "{not-json");
  assert.equal(localStorage.getItem("polaris.vault.v1"), "{not-json");

  const futureRaw = JSON.stringify({ version: 99, accounts: [] });
  localStorage.setItem("polaris.vault.v1", futureRaw);
  const future = loadVaultResult();
  assert.equal(future.kind, "future");
  assert.equal(future.version, 99);
  assert.equal(future.raw, futureRaw);
  assert.equal(localStorage.getItem("polaris.vault.v1"), futureRaw);
});

test("vault validation rejects malformed account entries before UI mapping", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { loadVaultResult } = await import("../src/lib/vault.ts");
  localStorage.setItem(
    "polaris.vault.v1",
    JSON.stringify({ version: 1, accounts: [null], activeAccountId: null }),
  );
  assert.equal(loadVaultResult().kind, "corrupt");
});

test("wallet creation refuses to overwrite recoverable invalid data", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const raw = "{recover-me";
  localStorage.setItem("polaris.vault.v1", raw);
  const { initializeVault } = await import("../src/lib/vault.ts");

  await assert.rejects(
    () => initializeVault("correct horse battery staple"),
    /needs recovery/i,
  );
  assert.equal(localStorage.getItem("polaris.vault.v1"), raw);
});

test("full encrypted backups round-trip the encrypted merchant archive", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const { emptyStore } = await import("../src/lib/merchant/defaults.ts");
  const { saveMerchantStore, MERCHANT_STORAGE_KEY } = await import("../src/lib/merchant/storage.ts");
  const {
    exportVaultBackup,
    getMerchantEncryptionKey,
    initializeVault,
    restoreVaultBackup,
  } = await import("../src/lib/vault.ts");
  const password = "correct horse battery staple";
  await initializeVault(password, { secret: Keypair.random().secret() });
  const store = {
    ...emptyStore(),
    settings: {
      ...emptyStore().settings,
      profile: { ...emptyStore().settings.profile, name: "Backup Coffee" },
    },
  };
  assert.equal(saveMerchantStore(store, getMerchantEncryptionKey()), true);
  const originalMerchant = localStorage.getItem(MERCHANT_STORAGE_KEY);

  const backup = await exportVaultBackup(password);
  localStorage.removeItem(MERCHANT_STORAGE_KEY);
  localStorage.setItem("wallet.passkey-prf.v1", "wrapper-for-replaced-vault");
  await restoreVaultBackup(backup, password);

  assert.equal(localStorage.getItem(MERCHANT_STORAGE_KEY), originalMerchant);
  assert.equal(localStorage.getItem("wallet.passkey-prf.v1"), null);
  assert.doesNotMatch(backup, /Backup Coffee/);
});

test("encrypted backups reject malformed decrypted payloads before restore", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const { encryptString } = await import("../src/lib/crypto.ts");
  const { initializeVault, inspectVaultBackup } = await import("../src/lib/vault.ts");
  const password = "correct horse battery staple";
  await initializeVault(password, { secret: Keypair.random().secret() });

  const crypto = await encryptString(
    JSON.stringify({
      exportedAt: new Date().toISOString(),
      vault: JSON.parse(localStorage.getItem("polaris.vault.v1")),
      contacts: [null],
      settings: {
        network: "mainnet",
        fiatCurrency: "USD",
        autoLockMs: 900_000,
        biometrics: false,
        privacy: false,
        sound: true,
      },
      txNotes: {},
      merchantStore: null,
    }),
    password,
  );
  const backup = JSON.stringify({ kind: "stellar-wallet-backup", version: 2, crypto });

  await assert.rejects(
    () => inspectVaultBackup(backup, password),
    /malformed|invalid/i,
  );
});

test("full wallet restore rolls every storage key back when a write fails", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const { exportVaultBackup, initializeVault, restoreVaultBackup } = await import("../src/lib/vault.ts");
  const password = "correct horse battery staple";
  await initializeVault(password, { secret: Keypair.random().secret() });
  localStorage.setItem("polaris.contacts.v1", "[]");
  const backup = await exportVaultBackup(password);

  const targetKeys = [
    "polaris.vault.v1",
    "polaris.trash.v1",
    "polaris.network.v1",
    "polaris.autolock.v1",
    "polaris.biometrics.v1",
    "polaris.contacts.v1",
    "polaris.privacy.v1",
    "wallet.sound.v1",
    "wallet.currency.v1",
    "wallet.tx-notes.v1",
    "wallet.merchant.v2",
    "wallet.passkey-prf.v1",
  ];
  const targetVault = JSON.parse(localStorage.getItem("polaris.vault.v1"));
  targetVault.accounts[0].label = "Keep this wallet";
  localStorage.setItem("polaris.vault.v1", JSON.stringify(targetVault));
  localStorage.setItem("polaris.trash.v1", "recoverable-trash");
  localStorage.setItem("polaris.network.v1", "testnet");
  localStorage.setItem("polaris.autolock.v1", "1234");
  localStorage.setItem("polaris.biometrics.v1", "1");
  localStorage.setItem("polaris.contacts.v1", "before-contacts");
  localStorage.setItem("polaris.privacy.v1", "1");
  localStorage.setItem("wallet.sound.v1", "0");
  localStorage.setItem("wallet.currency.v1", "GBP");
  localStorage.setItem("wallet.tx-notes.v1", "before-notes");
  localStorage.setItem("wallet.merchant.v2", "before-merchant");
  localStorage.setItem("wallet.passkey-prf.v1", "before-passkey-wrapper");
  const before = new Map(targetKeys.map((key) => [key, localStorage.getItem(key)]));

  const setItem = localStorage.setItem.bind(localStorage);
  let injected = false;
  localStorage.setItem = (key, value) => {
    if (key === "wallet.tx-notes.v1" && !injected) {
      injected = true;
      throw new Error("quota exceeded");
    }
    setItem(key, value);
  };

  await assert.rejects(() => restoreVaultBackup(backup, password), /restore|quota/i);
  for (const key of targetKeys) {
    assert.equal(localStorage.getItem(key), before.get(key), `${key} was not rolled back`);
  }
});
