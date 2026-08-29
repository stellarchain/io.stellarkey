import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";

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
  failNextBatchCompare = false;
  readCalls = 0;
  readPrefixCalls = 0;
  readPrefixes = [];
  lastBatch = { puts: 0, removes: 0, bytes: 0 };

  async read(key) {
    this.readCalls += 1;
    return this.records.get(key) ?? null;
  }

  async putVerified(key, value) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.records.set(key, value);
    return value;
  }

  async readPrefix(prefix) {
    this.readPrefixCalls += 1;
    this.readPrefixes.push(prefix);
    return new Map([...this.records].filter(([key]) => key.startsWith(prefix)));
  }

  async putManyVerified(entries) {
    if (this.failWrites) throw new Error("quota exceeded");
    const before = new Map(this.records);
    try {
      for (const [key, value] of entries) this.records.set(key, value);
      this.lastBatch = {
        puts: entries.size,
        removes: 0,
        bytes: [...entries.values()].reduce((total, value) => total + value.length, 0),
      };
    } catch (error) {
      this.records = before;
      throw error;
    }
  }

  async compareAndSetMany(key, expectedRevision, entries, removeKeys = [], expectedPrefix) {
    if (this.failWrites) throw new Error("quota exceeded");
    if (this.failNextBatchCompare) {
      this.failNextBatchCompare = false;
      throw new Error("switch failed");
    }
    const current = this.records.get(key) ?? null;
    const currentRevision = current === null ? null : JSON.parse(current).revision;
    if (currentRevision !== expectedRevision) return { ok: false, current };
    if (expectedPrefix) {
      const actual = new Map(
        [...this.records].filter(([entryKey]) => entryKey.startsWith(expectedPrefix.prefix)),
      );
      if (
        actual.size !== expectedPrefix.entries.size ||
        [...expectedPrefix.entries].some(([entryKey, value]) => actual.get(entryKey) !== value)
      ) {
        return { ok: false, current };
      }
    }
    const before = new Map(this.records);
    try {
      for (const removeKey of removeKeys) this.records.delete(removeKey);
      for (const [entryKey, value] of entries) this.records.set(entryKey, value);
      this.lastBatch = {
        puts: entries.size,
        removes: removeKeys.length,
        bytes: [...entries.values()].reduce((total, value) => total + value.length, 0),
      };
      return { ok: true, current: this.records.get(key) ?? null };
    } catch (error) {
      this.records = before;
      throw error;
    }
  }

  async replacePrefixVerified(prefix, entries, removeKeys = []) {
    if (this.failWrites) throw new Error("quota exceeded");
    for (const key of [...this.records.keys()]) {
      if (key.startsWith(prefix)) this.records.delete(key);
    }
    for (const key of removeKeys) this.records.delete(key);
    for (const [key, value] of entries) this.records.set(key, value);
  }

  async removePrefix(prefix) {
    for (const key of [...this.records.keys()]) {
      if (key.startsWith(prefix)) this.records.delete(key);
    }
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

test("the merchant repository ignores POC monolithic storage", async () => {
  const { MerchantRepository } = await import("../src/lib/merchant/repository.ts");
  const raw = JSON.stringify({ version: 2, plaintext: "POC merchant data" });
  const localStorage = memoryStorage({ "wallet.merchant.v2": raw });
  globalThis.window = { localStorage };
  const driver = new MemoryRecordDriver();
  const repository = new MerchantRepository(driver);

  const result = await repository.load(KEY);

  assert.equal(result.kind, "absent");
  assert.equal(localStorage.getItem("wallet.merchant.v2"), raw);
  assert.equal(await driver.read(repository.recordKey), null);
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
    staffId: null,
    staffName: "Owner",
    terminalName: "Till",
    createdAt: old,
    paidAt: old,
    stockAppliedAt: old,
    stockExceptions: [],
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

test("record-level commits rewrite only metadata and the changed history record", async () => {
  const { MerchantRepository } = await import("../src/lib/merchant/repository.ts");
  globalThis.window = { localStorage: memoryStorage() };
  const driver = new MemoryRecordDriver();
  const repository = new MerchantRepository(driver);
  const order = (index) => ({
    id: `order-${index}`,
    number: 1000 + index,
    reference: `ORDER${index}`,
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
    staffId: null,
    staffName: "Owner",
    terminalName: "Till",
    createdAt: index + 1,
    paidAt: index + 1,
    stockAppliedAt: index + 1,
    stockExceptions: [],
    payerAddress: null,
    note: null,
  });
  const initial = {
    ...emptyStore(),
    revision: 1,
    writerId: "tab-a",
    updatedAt: 10,
    settings: { ...emptyStore().settings, recordRetentionMonths: null },
    orders: Array.from({ length: 2_000 }, (_, index) => order(index)),
  };
  const committed = await repository.commit(initial, KEY, null);
  const changed = {
    ...committed,
    revision: 2,
    updatedAt: 20,
    orders: committed.orders.map((entry, index) =>
      index === 1_500 ? { ...entry, note: "Changed once" } : entry),
  };

  await repository.commit(changed, KEY, 1);

  assert.equal(driver.lastBatch.puts, 2, "one metadata and one order record should change");
  assert.ok(driver.lastBatch.bytes < 20_000, "update bytes must not scale with retained history");
  const loaded = await repository.load(KEY);
  assert.equal(loaded.kind, "ready");
  assert.equal(loaded.value.orders[1_500].note, "Changed once");
  assert.equal(loaded.value.orders.length, 2_000);
});

test("ordinary local commits reuse the authenticated snapshot without loading retained history", async () => {
  const { MerchantRepository } = await import("../src/lib/merchant/repository.ts");
  globalThis.window = { localStorage: memoryStorage() };
  const driver = new MemoryRecordDriver();
  const repository = new MerchantRepository(driver);
  const first = { ...emptyStore(), revision: 1, writerId: "tab-a", updatedAt: 10 };
  const committed = await repository.commit(first, KEY, null);
  driver.readCalls = 0;
  driver.readPrefixCalls = 0;
  driver.readPrefixes = [];

  const basis = await repository.loadCommitBasis(KEY);

  assert.equal(basis.kind, "ready");
  assert.equal(basis.value, committed);
  assert.equal(driver.readCalls, 1, "the metadata record should be checked once");
  assert.equal(driver.readPrefixCalls, 0, "retained history must not be loaded for a local write");
});

test("an external revision forces a complete authenticated repository reload", async () => {
  const { MerchantRepository } = await import("../src/lib/merchant/repository.ts");
  globalThis.window = { localStorage: memoryStorage() };
  const driver = new MemoryRecordDriver();
  const local = new MerchantRepository(driver);
  const external = new MerchantRepository(driver);
  const first = { ...emptyStore(), revision: 1, writerId: "tab-a", updatedAt: 10 };
  await local.commit(first, KEY, null);
  assert.equal((await external.load(KEY)).kind, "ready");
  await external.commit({ ...first, revision: 2, writerId: "tab-b", updatedAt: 20 }, KEY, 1);
  driver.readCalls = 0;
  driver.readPrefixCalls = 0;
  driver.readPrefixes = [];

  const basis = await local.loadCommitBasis(KEY);

  assert.equal(basis.kind, "ready");
  assert.equal(basis.value.revision, 2);
  assert.equal(
    driver.readPrefixes.filter((prefix) => prefix === local.dataPrefix).length,
    1,
    "external state must reload and authenticate every retained record",
  );
});

test("an atomic local commit rejects same-revision encrypted row tampering", async () => {
  const {
    MerchantRepository,
    MerchantRepositoryConflictError,
  } = await import("../src/lib/merchant/repository.ts");
  globalThis.window = { localStorage: memoryStorage() };
  const driver = new MemoryRecordDriver();
  const repository = new MerchantRepository(driver);
  const first = {
    ...emptyStore(),
    revision: 1,
    writerId: "tab-a",
    updatedAt: 10,
    catalogue: [{ ...emptyStore().catalogue[0], name: "Authenticated item" }],
  };
  const committed = await repository.commit(first, KEY, null);
  const [rowKey, raw] = [...await driver.readPrefix(repository.dataPrefix)][0];
  driver.records.set(rowKey, `${raw.slice(0, -1)}!`);

  assert.equal((await repository.loadCommitBasis(KEY)).kind, "ready");
  await assert.rejects(
    repository.commit({ ...committed, revision: 2, updatedAt: 20 }, KEY, 1),
    MerchantRepositoryConflictError,
  );
  assert.equal(JSON.parse(driver.records.get(repository.recordKey)).revision, 1);
});

test("encrypted archive export authenticates every retained merchant row", async () => {
  const { MerchantRepository } = await import("../src/lib/merchant/repository.ts");
  globalThis.window = { localStorage: memoryStorage() };
  const driver = new MemoryRecordDriver();
  const repository = new MerchantRepository(driver);
  await repository.commit({
    ...emptyStore(),
    revision: 1,
    writerId: "tab-a",
    updatedAt: 10,
  }, KEY, null);
  const [rowKey, raw] = [...await driver.readPrefix(repository.dataPrefix)][0];
  driver.records.set(rowKey, `${raw.slice(0, -1)}!`);

  await assert.rejects(repository.exportEncryptedArchive(KEY), /authenticated|corrupt/i);
});

test("IndexedDB prefix reads use a bounded key range instead of scanning the store", () => {
  const source = readFileSync(new URL("../src/lib/indexed-db.ts", import.meta.url), "utf8");
  const method = source.slice(source.indexOf("async readPrefix"), source.indexOf("async putVerified"));

  assert.match(method, /IDBKeyRange\.bound\(prefix, `\$\{prefix\}\\uffff`\)/);
  assert.match(method, /getAll\(range\)/);
  assert.doesNotMatch(method, /getAll\(\)/);
});

test("record archives export and restore every encrypted record without plaintext", async () => {
  const { MerchantRepository } = await import("../src/lib/merchant/repository.ts");
  globalThis.window = { localStorage: memoryStorage() };
  const sourceDriver = new MemoryRecordDriver();
  const source = new MerchantRepository(sourceDriver);
  const store = {
    ...emptyStore(),
    revision: 1,
    writerId: "tab-a",
    updatedAt: 10,
    settings: {
      ...emptyStore().settings,
      profile: { ...emptyStore().settings.profile, name: "Private Coffee" },
      recordRetentionMonths: null,
    },
    customers: [{
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      name: "Private Customer",
      firstSeenAt: 1,
      lastSeenAt: 1,
      orderCount: 0,
      lifetimeMinor: 0,
      averageMinor: 0,
      preferredAsset: { code: "XLM", issuer: null },
      sourceIds: [],
      loyalty: null,
      note: null,
    }],
  };
  await source.commit(store, KEY, null);
  const archive = await source.exportEncryptedArchive(KEY);

  assert.match(archive, /stellarkey-merchant-record-archive/);
  assert.doesNotMatch(archive, /Private Coffee/);
  assert.doesNotMatch(archive, /Private Customer/);
  assert.doesNotMatch(archive, /GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF/);

  const restored = new MerchantRepository(new MemoryRecordDriver());
  await restored.importEncryptedArchive(archive);
  const loaded = await restored.load(KEY);
  assert.equal(loaded.kind, "ready");
  assert.equal(loaded.value.settings.profile.name, "Private Coffee");
  assert.equal(loaded.value.customers[0].name, "Private Customer");
});

test("missing encrypted history fails closed instead of loading a partial store", async () => {
  const { MerchantRepository } = await import("../src/lib/merchant/repository.ts");
  globalThis.window = { localStorage: memoryStorage() };
  const driver = new MemoryRecordDriver();
  const source = new MerchantRepository(driver);
  await source.commit({
    ...emptyStore(),
    revision: 1,
    writerId: "tab-a",
    updatedAt: 10,
  }, KEY, null);
  const data = await driver.readPrefix(source.dataPrefix);
  driver.records.delete(data.keys().next().value);

  const loaded = await new MerchantRepository(driver).load(KEY);
  assert.equal(loaded.kind, "corrupt");
  assert.match(loaded.message, /could not be decrypted|authenticated/i);
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
