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
});
