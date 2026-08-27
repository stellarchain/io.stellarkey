import assert from "node:assert/strict";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import { encryptMerchantStore } from "../src/lib/merchant/crypto.ts";

const KEY = new Uint8Array(32).fill(17);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

class MemoryRecordDriver {
  records = new Map();
  failWrites = false;

  async read(key) {
    return this.records.get(key) ?? null;
  }

  async putVerified(key, value) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.records.set(key, value);
    return value;
  }

  async compareAndSet(key, expectedRevision, value) {
    if (this.failWrites) throw new Error("quota exceeded");
    const current = this.records.get(key) ?? null;
    const currentRevision = current === null ? null : JSON.parse(current).revision;
    if (currentRevision !== expectedRevision) return { ok: false, current };
    this.records.set(key, value);
    return { ok: true, current: value };
  }

  async remove(key) {
    this.records.delete(key);
  }
}

test("merchant migration copies, verifies, then removes the localStorage envelope", async () => {
  const storage = await import("../src/lib/merchant/storage.ts");
  const { MerchantRepository } = await import("../src/lib/merchant/repository.ts");
  const store = {
    ...emptyStore(),
    revision: 4,
    writerId: "legacy-tab",
    updatedAt: 100,
    settings: {
      ...emptyStore().settings,
      profile: { ...emptyStore().settings.profile, name: "Indexed Coffee" },
    },
  };
  const raw = JSON.stringify(encryptMerchantStore(store, KEY));
  const localStorage = memoryStorage({ [storage.MERCHANT_STORAGE_KEY]: raw });
  globalThis.window = { localStorage };
  const driver = new MemoryRecordDriver();
  const repository = new MerchantRepository(driver);

  const result = await repository.load(KEY);

  assert.equal(result.kind, "ready");
  assert.equal(result.value.settings.profile.name, "Indexed Coffee");
  assert.equal(await driver.read(repository.recordKey), raw);
  assert.equal(localStorage.getItem(storage.MERCHANT_STORAGE_KEY), null);
});

test("failed IndexedDB migration preserves the recoverable localStorage source", async () => {
  const storage = await import("../src/lib/merchant/storage.ts");
  const { MerchantRepository } = await import("../src/lib/merchant/repository.ts");
  const store = { ...emptyStore(), revision: 1, writerId: "legacy-tab", updatedAt: 10 };
  const raw = JSON.stringify(encryptMerchantStore(store, KEY));
  const localStorage = memoryStorage({ [storage.MERCHANT_STORAGE_KEY]: raw });
  globalThis.window = { localStorage };
  const driver = new MemoryRecordDriver();
  driver.failWrites = true;
  const repository = new MerchantRepository(driver);

  await assert.rejects(() => repository.load(KEY), /quota|migrat|storage/i);
  assert.equal(localStorage.getItem(storage.MERCHANT_STORAGE_KEY), raw);
});

test("merchant repository commits revisions transactionally and rejects stale writers", async () => {
  const { MerchantRepository, MerchantRepositoryConflictError } = await import(
    "../src/lib/merchant/repository.ts"
  );
  globalThis.window = { localStorage: memoryStorage() };
  const driver = new MemoryRecordDriver();
  const repository = new MerchantRepository(driver);
  const first = { ...emptyStore(), revision: 1, writerId: "tab-a", updatedAt: 10 };
  const second = { ...first, revision: 2, writerId: "tab-a", updatedAt: 20 };

  await repository.commit(first, KEY, null);
  await assert.rejects(
    () => repository.commit(second, KEY, null),
    (error) => error instanceof MerchantRepositoryConflictError,
  );
  await repository.commit(second, KEY, 1);
  assert.equal((await repository.load(KEY)).value.revision, 2);
});

test("IndexedDB commits preserve unlimited merchant retention", async () => {
  const { MerchantRepository } = await import("../src/lib/merchant/repository.ts");
  globalThis.window = { localStorage: memoryStorage() };
  const driver = new MemoryRecordDriver();
  const repository = new MerchantRepository(driver);
  const old = Date.now() - 900 * 86_400_000;
  const oldOrder = {
    id: "old-order",
    number: 1001,
    reference: "OLD1001",
    network: "testnet",
    status: "paid",
    lines: [],
    totals: {
      grossMinor: 100,
      discountMinor: 0,
      tipMinor: 0,
      netMinor: 100,
      taxByRate: {},
      taxMinor: 0,
      totalMinor: 100,
    },
    currency: "GBP",
    tender: [],
    adjustments: [],
    staffId: null,
    staffName: "Owner",
    terminalName: "Till",
    createdAt: old,
    paidAt: old,
    stockAppliedAt: old,
    payerAddress: null,
    note: null,
  };
  const store = {
    ...emptyStore(),
    revision: 1,
    writerId: "tab-a",
    updatedAt: 10,
    settings: { ...emptyStore().settings, recordRetentionMonths: null },
    orders: [oldOrder],
  };

  await repository.commit(store, KEY, null);
  const loaded = await repository.load(KEY);
  assert.equal(loaded.kind, "ready");
  assert.equal(loaded.value.orders[0].id, "old-order");
});

test("storage health reports persistence and quota without a backend", async () => {
  const { inspectStorageHealth } = await import("../src/lib/storage-health.ts");
  const health = await inspectStorageHealth({
    persisted: async () => true,
    estimate: async () => ({ usage: 1024, quota: 4096 }),
  });

  assert.deepEqual(health, {
    persistence: "persistent",
    usage: 1024,
    quota: 4096,
    usageRatio: 0.25,
  });
});
