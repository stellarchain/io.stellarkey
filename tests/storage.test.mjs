import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    "stellarkey.vault.v1",
    "stellarkey.network.v1",
    "stellarkey.autolock.v1",
    "stellarkey.contacts.v1",
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

test("full wallet reset also removes every private-payment IndexedDB record", () => {
  const source = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");
  const reset = source.split("const resetWallet = useCallback")[1]?.split("useEffect(() => {")[0] ?? "";
  assert.ok(
    reset.indexOf("wipeVault()") >= 0 &&
      reset.indexOf("wipeVault()") < reset.indexOf("getMerchantRepository().clear()"),
    "reset must revoke the session and erase the vault before fallible IndexedDB cleanup",
  );
  assert.match(reset, /getMerchantRepository\(\)\.clear\(\)/);
  assert.match(reset, /IndexedDbEncryptedRecordDriver\(\)\.removePrefix\("private:"\)/);
  assert.match(reset, /sessionStorage\.clear\(\)/);
  assert.match(reset, /serviceWorker\.getRegistrations\(\)/);
  assert.match(reset, /registration\.unregister\(\)/);
  assert.match(reset, /caches\.keys\(\)/);
  assert.match(reset, /caches\.delete\(name\)/);
  assert.match(reset, /location\.reload\(\)/);
});

test("auto-lock covers the live onboarding vault session and uses a monotonic clock", () => {
  const source = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");
  const autoLock = source.split("const lockVaultAndReset")[1]?.split("const pollPendingRef")[0] ?? "";
  assert.match(autoLock, /phase === "empty" && isUnlocked\(\)/);
  assert.match(autoLock, /performance\.now\(\)/);
  assert.doesNotMatch(autoLock, /Date\.now\(\)/);
  assert.match(autoLock, /closePaperWalletPrints\(\)/);
});

test("every user-controlled JSON file is bounded before file.text", () => {
  for (const path of [
    "src/components/Onboarding.tsx",
    "src/components/BackupWizardModal.tsx",
    "src/components/AddressBookPage.tsx",
    "src/components/SettingsPage.tsx",
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /readBoundedTextFile/);
    assert.doesNotMatch(source, /await file\.text\(\)/);
  }
});

test("corrupt ancillary contacts do not block unlock and are never rewritten", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const alice = Keypair.random().publicKey();
  const password = "correct horse battery staple";
  const { initializeVault, isUnlocked, lockVault, unlockVault } = await import("../src/lib/vault.ts");
  await initializeVault(password, { secret: Keypair.random().secret() });
  lockVault();
  localStorage.setItem(
    "stellarkey.contacts.v1",
    JSON.stringify([null, {}, { name: "Alice", address: alice }, { name: 7, address: null }]),
  );

  const { loadContacts, saveContact } = await import("../src/lib/contacts.ts");
  await assert.rejects(() => loadContacts(), /locked/i);

  const raw = localStorage.getItem("stellarkey.contacts.v1");
  await unlockVault(password);
  assert.equal(isUnlocked(), true);
  assert.equal(localStorage.getItem("stellarkey.contacts.v1"), raw);
  await assert.rejects(() => loadContacts(), /contacts.*unsupported|unsupported.*contacts/i);
  await assert.rejects(
    () => saveContact({ name: "Alice", address: alice }),
    /contacts.*unsupported|unsupported.*contacts/i,
  );
});

test("a reset epoch invalidates backup restore before it can replace storage", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const {
    exportVaultBackup,
    initializeVault,
    invalidateWalletLifecycle,
    loadVault,
    restoreVaultBackup,
  } = await import("../src/lib/vault.ts");
  await initializeVault("correct horse battery staple", {
    secret: Keypair.random().secret(),
  });
  const backup = await exportVaultBackup("correct horse battery staple");
  const identity = loadVault().accounts[0].publicKey;

  const restoring = restoreVaultBackup(backup, "correct horse battery staple");
  invalidateWalletLifecycle();
  await assert.rejects(restoring, /reset|cancelled|changed/i);
  assert.equal(loadVault().accounts[0].publicKey, identity);
});

test("wallet reset broadcasts intent and invalidates restore before fallible cleanup", () => {
  const source = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");
  const reset = source.split("const resetWallet = useCallback")[1]?.split("useEffect(() => {")[0] ?? "";
  assert.ok(reset.indexOf("invalidateWalletLifecycle()") >= 0);
  assert.ok(reset.indexOf('post("wallet-reset")') >= 0);
  assert.ok(reset.indexOf('post("wallet-reset")') < reset.indexOf("getMerchantRepository().clear()"));
});

test("restored contacts are encrypted before the restored vault is exposed", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const password = "correct horse battery staple";
  const contact = { name: "Private Payee", address: Keypair.random().publicKey() };
  const {
    exportVaultBackup,
    initializeVault,
    lockVault,
    restoreVaultBackup,
    unlockVault,
  } = await import("../src/lib/vault.ts");
  const { loadContacts, saveContact } = await import("../src/lib/contacts.ts");

  await initializeVault(password, { secret: Keypair.random().secret() });
  await saveContact(contact);
  const backup = await exportVaultBackup(password);
  await restoreVaultBackup(backup, password);

  const stored = localStorage.getItem("stellarkey.contacts.v1");
  assert.ok(stored);
  assert.doesNotMatch(stored, /Private Payee/);
  assert.equal(stored.includes(contact.address), false);
  await assert.rejects(() => loadContacts(), /locked/i);

  await unlockVault(password);
  assert.deepEqual(await loadContacts(), [{ ...contact, favorite: false }]);
  lockVault();
});

test("contact persistence enforces the same bounded visible-name policy as the editor", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const { initializeVault } = await import("../src/lib/vault.ts");
  const { saveContact, validateContact } = await import("../src/lib/contacts.ts");
  const address = Keypair.random().publicKey();
  await initializeVault("correct horse battery staple", { secret: Keypair.random().secret() });

  for (const name of ["x".repeat(25), "Alice\u202e@example.com", "Ali\u200bce"]) {
    assert.ok(validateContact(name, address));
    await assert.rejects(
      () => saveContact({ name, address }),
      /invalid name|24 characters|unsupported character/i,
    );
  }
});

test("backup inspection identifies the wallet before destructive restore", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const {
    exportVaultBackup,
    initializeVault,
    inspectVaultBackup,
  } = await import("../src/lib/vault.ts");
  const password = "correct horse battery staple";
  const secret = Keypair.random().secret();
  const publicKey = Keypair.fromSecret(secret).publicKey();
  await initializeVault(password, { secret });

  const info = await inspectVaultBackup(await exportVaultBackup(password), password);
  assert.equal(info.primaryAccountPublicKey, publicKey);
});

test("full wallet backup preserves the validated Merchant Mode bootstrap state", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const { exportVaultBackup, initializeVault, restoreVaultBackup } = await import("../src/lib/vault.ts");
  const password = "correct horse battery staple";

  await initializeVault(password, { secret: Keypair.random().secret() });
  localStorage.setItem(
    "stellarkey.merchant-bootstrap.v1",
    JSON.stringify({ version: 1, enabled: true, configured: true }),
  );
  const backup = await exportVaultBackup(password);
  localStorage.setItem(
    "stellarkey.merchant-bootstrap.v1",
    JSON.stringify({ version: 1, enabled: false, configured: false }),
  );

  await restoreVaultBackup(backup, password);

  assert.deepEqual(
    JSON.parse(localStorage.getItem("stellarkey.merchant-bootstrap.v1")),
    { version: 1, enabled: true, configured: true },
  );
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

test("journal-less private activity notes survive a verified backup round trip", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const {
    exportVaultBackup,
    initializeVault,
    inspectVaultBackup,
    loadPrivateTxNote,
    restoreVaultBackup,
    savePrivateTxNote,
    unlockVault,
  } = await import("../src/lib/vault.ts");
  const password = "correct horse battery staple";
  const noteKey = `private:testnet-private-pool-v2:${"ab".repeat(32)}`;
  await initializeVault(password, { secret: Keypair.random().secret() });
  await savePrivateTxNote(noteKey, "Received privately");

  const backup = await exportVaultBackup(password);
  const info = await inspectVaultBackup(backup, password);
  assert.deepEqual(info.warnings, []);
  await restoreVaultBackup(backup, password);
  await unlockVault(password);

  assert.equal(await loadPrivateTxNote(noteKey), "Received privately");
  await assert.rejects(
    () => savePrivateTxNote("not a transaction identifier", "must not persist"),
    /transaction.*identifier/i,
  );
});

test("backup restore omits malformed optional transaction notes with a warning", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const { decryptString, encryptString } = await import("../src/lib/crypto.ts");
  const {
    encryptVaultString,
    unwrapVaultMasterKey,
    zeroKey,
  } = await import("../src/lib/vault-keys.ts");
  const {
    exportVaultBackup,
    initializeVault,
    inspectVaultBackup,
    loadPrivateTxNote,
    restoreVaultBackup,
    unlockVault,
  } = await import("../src/lib/vault.ts");
  const password = "correct horse battery staple";
  const validKey = `private:testnet-private-pool-v2:${"cd".repeat(32)}`;
  await initializeVault(password, { secret: Keypair.random().secret() });
  const backup = JSON.parse(await exportVaultBackup(password));
  const payload = JSON.parse(await decryptString(backup.crypto, password));
  const masterKey = await unwrapVaultMasterKey(payload.vault.wrappedMasterKey, password);
  try {
    payload.txNotes = {
      version: 3,
      crypto: await encryptVaultString(JSON.stringify({
        [validKey]: "Keep this note",
        "unknown optional key": "Drop this note",
        deadbeef: 42,
      }), masterKey),
    };
  } finally {
    zeroKey(masterKey);
  }
  backup.crypto = await encryptString(JSON.stringify(payload), password);
  const raw = JSON.stringify(backup);

  const info = await inspectVaultBackup(raw, password);
  assert.equal(info.warnings.length, 1);
  assert.match(info.warnings[0], /2 private transaction notes.*omitted/i);
  const restored = await restoreVaultBackup(raw, password);
  assert.deepEqual(restored.warnings, info.warnings);
  await unlockVault(password);

  assert.equal(await loadPrivateTxNote(validKey), "Keep this note");
  assert.equal(await loadPrivateTxNote("deadbeef"), "");
});

test("backup export refuses an unreadable encrypted transaction-note store", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const { exportVaultBackup, initializeVault } = await import("../src/lib/vault.ts");
  const password = "correct horse battery staple";
  await initializeVault(password, { secret: Keypair.random().secret() });
  localStorage.setItem("wallet.tx-notes.v1", JSON.stringify({
    version: 3,
    crypto: { iv: "invalid", ciphertext: "invalid" },
  }));

  await assert.rejects(() => exportVaultBackup(password), /transaction notes|backup.*validate/i);
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

  localStorage.setItem("stellarkey.vault.v1", "{not-json");
  const corrupt = loadVaultResult();
  assert.equal(corrupt.kind, "corrupt");
  assert.equal(corrupt.raw, "{not-json");
  assert.equal(localStorage.getItem("stellarkey.vault.v1"), "{not-json");

  const futureRaw = JSON.stringify({ version: 99, accounts: [] });
  localStorage.setItem("stellarkey.vault.v1", futureRaw);
  const future = loadVaultResult();
  assert.equal(future.kind, "future");
  assert.equal(future.version, 99);
  assert.equal(future.raw, futureRaw);
  assert.equal(localStorage.getItem("stellarkey.vault.v1"), futureRaw);
});

test("vault loading reports unavailable browser storage instead of throwing", async () => {
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new DOMException("Storage access was denied", "SecurityError");
      },
    },
  };
  const { loadVaultResult } = await import("../src/lib/vault.ts");

  const result = loadVaultResult();

  assert.equal(result.kind, "unavailable");
  assert.match(result.message, /browser storage/i);
});

test("vault validation rejects malformed account entries before UI mapping", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { loadVaultResult } = await import("../src/lib/vault.ts");
  localStorage.setItem(
    "stellarkey.vault.v1",
    JSON.stringify({ version: 1, accounts: [null], activeAccountId: null }),
  );
  assert.equal(loadVaultResult().kind, "corrupt");
});

test("wallet creation refuses to overwrite recoverable invalid data", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const raw = "{recover-me";
  localStorage.setItem("stellarkey.vault.v1", raw);
  const { initializeVault } = await import("../src/lib/vault.ts");

  await assert.rejects(
    () => initializeVault("correct horse battery staple"),
    /needs recovery/i,
  );
  assert.equal(localStorage.getItem("stellarkey.vault.v1"), raw);
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
      vault: JSON.parse(localStorage.getItem("stellarkey.vault.v1")),
      contacts: [null],
      settings: {
        network: "mainnet",
        fiatCurrency: "USD",
        autoLockMs: 900_000,
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

test("backup inspection opens every nested signing credential", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const { decryptString, encryptString } = await import("../src/lib/crypto.ts");
  const {
    addStoredAccount,
    exportVaultBackup,
    initializeVault,
    inspectVaultBackup,
  } = await import("../src/lib/vault.ts");
  const password = "correct horse battery staple";
  await initializeVault(password, { secret: Keypair.random().secret() });
  await addStoredAccount({ secret: Keypair.random().secret() });
  const backup = JSON.parse(await exportVaultBackup(password));
  const payload = JSON.parse(await decryptString(backup.crypto, password));
  [payload.vault.accounts[0].secret, payload.vault.accounts[1].secret] = [
    payload.vault.accounts[1].secret,
    payload.vault.accounts[0].secret,
  ];
  backup.crypto = await encryptString(JSON.stringify(payload), password);

  await assert.rejects(
    () => inspectVaultBackup(JSON.stringify(backup), password),
    /could not unlock or validate/i,
  );
});

test("full wallet restore rolls every storage key back when a write fails", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { Keypair } = await import("@stellar/stellar-sdk");
  const { exportVaultBackup, initializeVault, restoreVaultBackup } = await import("../src/lib/vault.ts");
  const password = "correct horse battery staple";
  await initializeVault(password, { secret: Keypair.random().secret() });
  const backup = await exportVaultBackup(password);

  const targetKeys = [
    "stellarkey.vault.v1",
    "stellarkey.network.v1",
    "stellarkey.autolock.v1",
    "stellarkey.contacts.v1",
    "stellarkey.privacy.v1",
    "wallet.sound.v1",
    "wallet.currency.v1",
    "wallet.tx-notes.v1",
    "wallet.merchant.v2",
    "wallet.passkey-prf.v1",
  ];
  const targetVault = JSON.parse(localStorage.getItem("stellarkey.vault.v1"));
  targetVault.accounts[0].label = "Keep this wallet";
  localStorage.setItem("stellarkey.vault.v1", JSON.stringify(targetVault));
  localStorage.setItem("stellarkey.network.v1", "testnet");
  localStorage.setItem("stellarkey.autolock.v1", "1234");
  localStorage.setItem("stellarkey.contacts.v1", "before-contacts");
  localStorage.setItem("stellarkey.privacy.v1", "1");
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

test("full wallet restore rolls localStorage and IndexedDB back together", async () => {
  const { replaceBackupStorage } = await import("../src/lib/backup-storage.ts");
  const localStorage = new MemoryStorage();
  localStorage.setItem("stellarkey.vault.v1", "vault-before");
  localStorage.setItem("stellarkey.contacts.v1", "contacts-before");

  const indexedArchive = {
    value: "merchant-before",
    failNextReplace: true,
    async read() {
      return this.value;
    },
    async replace(value) {
      this.value = value;
      if (this.failNextReplace) {
        this.failNextReplace = false;
        throw new Error("injected IndexedDB failure after mutation");
      }
    },
  };

  await assert.rejects(
    () => replaceBackupStorage({
      storage: localStorage,
      keys: ["stellarkey.vault.v1", "stellarkey.contacts.v1"],
      writes: new Map([
        ["stellarkey.vault.v1", "vault-from-backup"],
        ["stellarkey.contacts.v1", "contacts-from-backup"],
      ]),
      archive: indexedArchive,
      archiveValue: "merchant-from-backup",
    }),
    /previous wallet was restored unchanged.*injected IndexedDB failure/i,
  );

  assert.equal(localStorage.getItem("stellarkey.vault.v1"), "vault-before");
  assert.equal(localStorage.getItem("stellarkey.contacts.v1"), "contacts-before");
  assert.equal(indexedArchive.value, "merchant-before");
});

test("full wallet restore rolls back every asynchronous archive in reverse order", async () => {
  const { replaceBackupStorage } = await import("../src/lib/backup-storage.ts");
  const localStorage = new MemoryStorage();
  localStorage.setItem("stellarkey.vault.v1", "vault-before");
  const first = {
    value: "first-before",
    async read() { return this.value; },
    async replace(value) { this.value = value; },
  };
  const second = {
    value: "second-before",
    fail: true,
    async read() { return this.value; },
    async replace(value) {
      this.value = value;
      if (this.fail) {
        this.fail = false;
        throw new Error("second archive failed after mutation");
      }
    },
  };

  await assert.rejects(
    () => replaceBackupStorage({
      storage: localStorage,
      keys: ["stellarkey.vault.v1"],
      writes: new Map([["stellarkey.vault.v1", "vault-after"]]),
      archives: [
        { archive: first, value: "first-after" },
        { archive: second, value: "second-after" },
      ],
    }),
    /previous wallet was restored unchanged.*second archive failed/i,
  );
  assert.equal(localStorage.getItem("stellarkey.vault.v1"), "vault-before");
  assert.equal(first.value, "first-before");
  assert.equal(second.value, "second-before");
});
