import assert from 'node:assert/strict';
import test from 'node:test';
import * as publicCache from '../src/features/private-balance/runtime/public-cache.ts';
import {
  clearPrivateBalancePublicCache,
  loadPrivateBalanceCommitments,
  storePrivateBalanceCommitmentChunk,
} from '../src/features/private-balance/runtime/public-cache.ts';
import { MerkleNodeStore } from '@stellarkey/private-balance';

class MemoryDriver {
  records = new Map();
  work = { requests: 0, records: 0, readBytes: 0, writes: 0, writeBytes: 0 };

  readValue(key) {
    this.work.requests += 1;
    const value = this.records.get(key) ?? null;
    if (value !== null) {
      this.work.records += 1;
      this.work.readBytes += Buffer.byteLength(value);
    }
    return value;
  }

  async read(key) { return this.readValue(key); }

  async readPrefix(prefix) {
    return this.readPrefixValue(prefix);
  }

  readPrefixValue(prefix) {
    this.work.requests += 1;
    const result = new Map([...this.records].filter(([key]) => key.startsWith(prefix)));
    this.work.records += result.size;
    this.work.readBytes += [...result.values()].reduce((sum, raw) => sum + Buffer.byteLength(raw), 0);
    return result;
  }

  put(key, value) {
    this.work.writes += 1;
    this.work.writeBytes += Buffer.byteLength(value);
    this.records.set(key, value);
  }

  async compareAndSet(key, expectedRevision, value) {
    const current = this.readValue(key);
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    this.put(key, value);
    return { ok: true, current: this.readValue(key) };
  }

  async compareAndSetMany(key, expectedRevision, entries, removeKeys = [], expectedPrefix, expectedRecords) {
    const expected = new Map(expectedRecords);
    const current = this.readValue(key);
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    if (expectedPrefix) {
      const actual = this.readPrefixValue(expectedPrefix.prefix);
      if (actual.size !== expectedPrefix.entries.size || [...expectedPrefix.entries].some(([key, value]) => actual.get(key) !== value)) {
        return { ok: false, current };
      }
    }
    for (const [entryKey, raw] of expected) {
      if (this.readValue(entryKey) !== raw) return { ok: false, current };
    }
    for (const key of removeKeys) if (!entries.has(key)) this.records.delete(key);
    for (const [key, value] of entries) this.put(key, value);
    for (const [key, value] of entries) assert.equal(this.readValue(key), value);
    return { ok: true, current: entries.get(key) ?? null };
  }

  async replacePrefixVerified(prefix, entries, removeKeys = [], guard = {}, expectedRecords) {
    guard.signal?.throwIfAborted();
    guard.assertActive?.();
    for (const [key, raw] of expectedRecords ?? []) {
      if (this.readValue(key) !== raw) throw new Error('Records changed before removal');
    }
    for (const key of [...this.records.keys()]) if (key.startsWith(prefix)) this.records.delete(key);
    for (const key of removeKeys) this.records.delete(key);
    for (const [key, value] of entries) this.put(key, value);
    for (const [key, value] of entries) assert.equal(this.readValue(key), value);
  }

  async removePrefix(prefix) {
    for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key);
  }
}

const context = {
  networkId: '01'.repeat(32),
  realmId: '02'.repeat(32),
  poolId: '03'.repeat(32),
};
const commitment = value => new Uint8Array(32).fill(value);
const namespace = (version = 2) => `private:cache:v${version}:${context.networkId}:${context.realmId}:${context.poolId}:`;
const checkpointKey = () => `${namespace()}checkpoint`;
const leafKey = index => `${namespace()}commitments:${index.toString().padStart(39, '0')}`;
const legacyKey = () => `${namespace(1)}commitments:${'0'.repeat(39)}`;
const legacyRaw = () => JSON.stringify({ kind: 'public-commitment-chunk', version: 1, revision: 0, startIndex: '0',
  commitments: [Buffer.from(commitment(1)).toString('hex')] });
const append = (driver, index, values) => publicCache.recordVerifiedPrivateBalanceCommitments(context, BigInt(index), values.map(commitment), driver);
const sameRecords = (left, right) => left.size === right.size && [...left].every(([key, raw]) => right.get(key) === raw);

function pauseBefore(driver, method) {
  const original = driver[method];
  let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  driver[method] = async function (...args) {
    driver[method] = original;
    entered(); await gate;
    return original.apply(this, args);
  };
  return { waiting, release };
}

test('routine verified appends use linear record reads and serialized bytes', async (t) => {
  const samples = [];
  for (const count of [10, 20, 40]) {
    const driver = new MemoryDriver();
    for (let index = 0; index < count; index += 1) {
      await publicCache.recordVerifiedPrivateBalanceCommitments(context, BigInt(index), [commitment(index + 1)], driver);
    }
    samples.push({ count, ...driver.work });
  }
  t.diagnostic(JSON.stringify(samples));
  for (const sample of samples) {
    assert.ok(sample.records <= sample.count * 12, 'append reads must be bounded per new commitment');
    assert.ok(sample.readBytes <= sample.count * 4_000, 'append read bytes must be bounded per new commitment');
    assert.ok(sample.writes <= sample.count * 3, 'append writes must be bounded per new commitment');
    assert.ok(sample.writeBytes <= sample.count * 1_000, 'append write bytes must be bounded per new commitment');
  }
  for (let index = 1; index < samples.length; index += 1) {
    for (const metric of ['records', 'readBytes', 'writes', 'writeBytes']) {
      assert.ok(samples[index][metric] <= samples[index - 1][metric] * 2.2,
        `doubling appends must scale ${metric} linearly`);
    }
  }
});

test('alternating tabs validate only the new range after each tab warms', async (t) => {
  const samples = [];
  for (const count of [10, 20, 40]) {
    const first = new MemoryDriver();
    const second = new MemoryDriver();
    second.records = first.records;
    second.work = first.work;
    for (let index = 0; index < count; index += 1) await append(index % 2 ? second : first, index, [index + 1]);
    samples.push({ count, ...first.work });
  }
  t.diagnostic(JSON.stringify(samples));
  for (const sample of samples) {
    assert.ok(sample.records <= sample.count * 14, 'cross-tab append record reads must remain bounded');
    assert.ok(sample.readBytes <= sample.count * 5_000, 'cross-tab append bytes must remain bounded');
    assert.ok(sample.writeBytes <= sample.count * 1_000, 'cross-tab append writes must remain bounded');
  }
  for (let index = 1; index < samples.length; index += 1) for (const metric of ['records', 'readBytes', 'writes', 'writeBytes']) {
    assert.ok(samples[index][metric] <= samples[index - 1][metric] * 2.3, `cross-tab ${metric} must scale linearly`);
  }
});

test('verified overlap is checked, duplicate ranges are idempotent, and gaps fail closed', async () => {
  const driver = new MemoryDriver();
  await append(driver, 0, [1, 2, 3]);
  const before = new Map(driver.records);
  await append(driver, 1, [2, 3]);
  assert.equal(sameRecords(driver.records, before), true);
  await append(driver, 2, [3, 4]);
  await assert.rejects(append(driver, 1, [9]), /conflict/i);
  await assert.rejects(append(driver, 5, [6]), /gap|contiguous/i);
  assert.deepEqual((await loadPrivateBalanceCommitments(context, driver)).map(value => value[0]), [1, 2, 3, 4]);
});

test('append snapshots caller-owned bytes before awaiting storage', async () => {
  const driver = new MemoryDriver();
  const values = [commitment(1)];
  const pending = publicCache.recordVerifiedPrivateBalanceCommitments(context, BigInt(0), values, driver);
  values[0].fill(9); values.push(commitment(10));
  await pending;
  assert.deepEqual((await loadPrivateBalanceCommitments(context, driver)).map(value => value[0]), [1]);
});

test('append, load and reset keep the context captured before their first await', async () => {
  for (const operation of ['append', 'load', 'reset']) {
    const driver = new MemoryDriver();
    const mutable = { ...context };
    driver.records.set(legacyKey(), legacyRaw());
    const deferred = pauseBefore(driver, operation === 'load' ? 'readPrefix' : 'read');
    const pending = operation === 'append'
      ? publicCache.recordVerifiedPrivateBalanceCommitments(mutable, BigInt(1), [commitment(2)], driver)
      : operation === 'load'
        ? loadPrivateBalanceCommitments(mutable, driver)
        : publicCache.clearPrivateBalanceCommitmentCache(mutable, driver);
    await deferred.waiting;
    mutable.poolId = '04'.repeat(32);
    deferred.release();
    if (operation === 'load') assert.equal((await pending).length, 1);
    else {
      await pending;
      assert.ok(driver.records.has(checkpointKey()), 'original context must receive the checkpoint');
      assert.equal((await loadPrivateBalanceCommitments(context, driver)).length, operation === 'append' ? 2 : 0);
    }
    assert.equal([...driver.records.keys()].some(key => key.includes(`:${mutable.poolId}:`)), false);
  }
});

test('legacy chunks migrate once without deleting legacy or encrypted discovery records', async () => {
  const driver = new MemoryDriver();
  driver.records.set(legacyKey(), legacyRaw());
  driver.records.set(`${namespace(1)}stealth-discovery`, 'synthetic-encrypted-discovery');
  assert.equal((await loadPrivateBalanceCommitments(context, driver)).length, 1);
  await append(driver, 1, [2]);
  assert.ok(driver.records.has(checkpointKey()), 'append must create a v2 checkpoint');
  assert.equal(driver.records.get(legacyKey()), legacyRaw());
  await publicCache.clearPrivateBalanceCommitmentCache(context, driver);
  assert.deepEqual(await loadPrivateBalanceCommitments(context, driver), []);
  assert.equal(driver.records.get(legacyKey()), legacyRaw());
  assert.equal(driver.records.get(`${namespace(1)}stealth-discovery`), 'synthetic-encrypted-discovery');
  await append(driver, 0, [3]);
  assert.deepEqual((await loadPrivateBalanceCommitments(context, driver)).map(value => value[0]), [3]);
});

test('a legacy import atomically rejects changes to its original raw prefix', async () => {
  const driver = new MemoryDriver();
  driver.records.set(legacyKey(), legacyRaw());
  const deferred = pauseBefore(driver, 'compareAndSetMany');
  const pending = append(driver, 1, [2]);
  const rejected = assert.rejects(pending, /changed|conflict/i);
  await deferred.waiting;
  driver.records.set(`${namespace(1)}commitments:0000000000000001`, legacyRaw());
  deferred.release(); await rejected;
  assert.equal(driver.records.has(checkpointKey()), false);
});

for (const target of ['checkpoint', 'chunk']) test(`cold rebuild rejects corrupt ${target} and never falls back to legacy`, async () => {
  const driver = new MemoryDriver();
  driver.records.set(legacyKey(), legacyRaw());
  await append(driver, 1, [2, 3]);
  const key = target === 'checkpoint' ? checkpointKey() : leafKey(1);
  driver.records.set(key, '{"revision":0,"invalid":true}');
  const cold = new MemoryDriver(); cold.records = driver.records;
  await assert.rejects(loadPrivateBalanceCommitments(context, cold), /invalid|corrupt/i);
  await assert.rejects(append(cold, 3, [4]), /invalid|corrupt/i);
  await publicCache.clearPrivateBalanceCommitmentCache(context, cold);
  assert.deepEqual(await loadPrivateBalanceCommitments(context, cold), []);
});

test('warm append detects changed tail and verified overlap records', async () => {
  for (const index of [0, 2]) {
    const driver = new MemoryDriver();
    await append(driver, 0, [1, 2, 3]);
    driver.records.set(leafKey(index), 'synthetic-corrupt');
    await assert.rejects(append(driver, index === 0 ? 0 : 3, index === 0 ? [1, 2, 3, 4] : [4]), /invalid|conflict|changed/i);
  }
});

for (const target of ['leaf', 'count-smaller', 'count-larger', 'digest']) test(`cold validation rejects valid-shape ${target} corruption`, async () => {
  const driver = new MemoryDriver();
  await append(driver, 0, [1, 2, 3]);
  if (target === 'leaf') {
    const raw = JSON.parse(driver.records.get(leafKey(0)));
    raw.commitments[0] = Buffer.from(commitment(9)).toString('hex');
    driver.records.set(leafKey(0), JSON.stringify(raw));
  } else {
    const checkpoint = JSON.parse(driver.records.get(checkpointKey()));
    if (target === 'digest') checkpoint.digest = 'ff'.repeat(32);
    else checkpoint.count = (BigInt(checkpoint.count) + (target === 'count-smaller' ? -1n : 1n)).toString();
    driver.records.set(checkpointKey(), JSON.stringify(checkpoint));
  }
  const cold = new MemoryDriver(); cold.records = driver.records;
  await assert.rejects(loadPrivateBalanceCommitments(context, cold), /corrupt/i);
  await assert.rejects(append(cold, 3, [4]), /corrupt/i);
});

test('warm cross-tab advancement rejects a forged delta digest', async () => {
  const driver = new MemoryDriver();
  await append(driver, 0, [1]);
  const other = new MemoryDriver(); other.records = driver.records;
  await append(other, 1, [2]);
  const checkpoint = JSON.parse(driver.records.get(checkpointKey()));
  checkpoint.digest = 'ff'.repeat(32);
  driver.records.set(checkpointKey(), JSON.stringify(checkpoint));
  await assert.rejects(append(driver, 2, [3]), /corrupt/i);
});

for (const range of ['tail', 'overlap']) test(`atomic append detects ${range} mutation after validation`, async () => {
  const driver = new MemoryDriver();
  await append(driver, 0, [1, 2, 3]);
  const deferred = pauseBefore(driver, 'compareAndSetMany');
  const pending = range === 'tail' ? append(driver, 3, [4]) : append(driver, 0, [1, 2, 3, 4]);
  const rejected = assert.rejects(pending, /changed/i);
  await deferred.waiting;
  const key = leafKey(range === 'tail' ? 2 : 0);
  const raw = JSON.parse(driver.records.get(key));
  raw.commitments[0] = Buffer.from(commitment(9)).toString('hex');
  driver.records.set(key, JSON.stringify(raw));
  const before = new Map(driver.records);
  deferred.release(); await rejected;
  assert.equal(sameRecords(driver.records, before), true);
});

test('full retained validation detects an old changed leaf outside routine append overlap', async () => {
  const driver = new MemoryDriver();
  await append(driver, 0, [1, 2, 3]);
  const raw = JSON.parse(driver.records.get(leafKey(0)));
  raw.commitments[0] = Buffer.from(commitment(9)).toString('hex');
  driver.records.set(leafKey(0), JSON.stringify(raw));
  // The routine path checks only its tail/overlap; a rebuild checks all history.
  await append(driver, 3, [4]);
  await assert.rejects(loadPrivateBalanceCommitments(context, driver), /corrupt/i);
});

for (const missing of ['checkpoint', 'leaf']) test(`v2 ${missing} deletion cannot load a partial or legacy history`, async () => {
  const driver = new MemoryDriver();
  driver.records.set(legacyKey(), legacyRaw());
  await append(driver, 1, [2, 3]);
  driver.records.delete(missing === 'checkpoint' ? checkpointKey() : leafKey(1));
  const cold = new MemoryDriver(); cold.records = driver.records;
  await assert.rejects(loadPrivateBalanceCommitments(context, cold), /invalid|contiguous/i);
  await assert.rejects(append(cold, 3, [4]), /invalid|contiguous/i);
});

for (const race of ['append', 'reset', 'same-revision']) test(`atomic append rejects concurrent ${race}`, async () => {
  const driver = new MemoryDriver();
  await append(driver, 0, [1]);
  const deferred = pauseBefore(driver, 'compareAndSetMany');
  const pending = append(driver, 1, [2]);
  const rejected = assert.rejects(pending, /changed|conflict/i);
  await deferred.waiting;
  if (race === 'append') await append(driver, 1, [3]);
  else if (race === 'reset') {
    await publicCache.clearPrivateBalanceCommitmentCache(context, driver);
    await append(driver, 0, [1]);
  } else {
    const raw = JSON.parse(driver.records.get(checkpointKey()));
    driver.records.set(checkpointKey(), JSON.stringify({ ...raw, generation: crypto.randomUUID() }));
  }
  const before = new Map(driver.records);
  deferred.release(); await rejected;
  assert.equal(sameRecords(driver.records, before), true);
});

test('a reset generation fences append ABA even when count and revision recur', async () => {
  const driver = new MemoryDriver();
  await append(driver, 0, [1]);
  await append(driver, 1, [2]);
  const before = JSON.parse(driver.records.get(checkpointKey()));
  const deferred = pauseBefore(driver, 'compareAndSetMany');
  const pending = append(driver, 2, [3]);
  const rejected = assert.rejects(pending, /changed/i);
  await deferred.waiting;
  await publicCache.clearPrivateBalanceCommitmentCache(context, driver);
  await append(driver, 0, [1, 2]);
  const after = JSON.parse(driver.records.get(checkpointKey()));
  assert.equal(after.count, before.count);
  assert.equal(after.revision, before.revision);
  assert.notEqual(after.generation, before.generation);
  deferred.release(); await rejected;
  assert.equal((await loadPrivateBalanceCommitments(context, driver)).length, 2);
});

test('reset is fenced against an append that wins after its read', async () => {
  const driver = new MemoryDriver();
  await append(driver, 0, [1]);
  const deferred = pauseBefore(driver, 'replacePrefixVerified');
  const pending = publicCache.clearPrivateBalanceCommitmentCache(context, driver);
  const rejected = assert.rejects(pending, /changed/i);
  await deferred.waiting;
  await append(driver, 1, [2]);
  deferred.release(); await rejected;
  assert.equal((await loadPrivateBalanceCommitments(context, driver)).length, 2);
});

test('public cache retains only contiguous verified commitment chunks', async () => {
  const driver = new MemoryDriver();
  await storePrivateBalanceCommitmentChunk(context, 0n, [commitment(1), commitment(2)], driver);
  await storePrivateBalanceCommitmentChunk(context, 2n, [commitment(3), commitment(4)], driver);

  assert.deepEqual(
    (await loadPrivateBalanceCommitments(context, driver)).map(value => value[0]),
    [1, 2, 3, 4],
  );
  const serialized = [...driver.records.values()].join('');
  assert.doesNotMatch(serialized, /account|owner|memo|note|activity|private address/i);
  assert.ok([...driver.records.keys()].every(key =>
    key.startsWith(namespace())));

  const expected = await MerkleNodeStore.fromCommitments([
    commitment(1), commitment(2), commitment(3), commitment(4),
  ]);
  const rebuilt = await MerkleNodeStore.fromCommitments(
    await loadPrivateBalanceCommitments(context, driver),
  );
  assert.equal(rebuilt.nextIndex, 4n);
  assert.deepEqual(rebuilt.currentRoot, expected.currentRoot);
});

test('the unused verified Merkle store loader stays deleted', () => {
  assert.equal('loadVerifiedPrivateBalanceMerkleStore' in publicCache, false);
});

test('public cache fails closed on gaps, overlaps, malformed bytes, or tampering', async () => {
  const driver = new MemoryDriver();
  await assert.rejects(
    () => storePrivateBalanceCommitmentChunk(context, 1n, [commitment(1)], driver),
    /contiguous/i,
  );
  await storePrivateBalanceCommitmentChunk(context, 0n, [commitment(1)], driver);
  await assert.rejects(
    () => storePrivateBalanceCommitmentChunk(context, 0n, [commitment(2)], driver),
    /contiguous/i,
  );
  await assert.rejects(
    () => storePrivateBalanceCommitmentChunk(context, 1n, [new Uint8Array(31)], driver),
    /32 bytes/i,
  );
  const [key] = driver.records.keys();
  driver.records.set(key, '{"kind":"commitments","startIndex":0,"commitments":["secret"]}');
  await assert.rejects(() => loadPrivateBalanceCommitments(context, driver), /invalid/i);
});

test('public cache reset removes only the selected pool namespace', async () => {
  const driver = new MemoryDriver();
  const other = { ...context, poolId: '04'.repeat(32) };
  await storePrivateBalanceCommitmentChunk(context, 0n, [commitment(1)], driver);
  await storePrivateBalanceCommitmentChunk(other, 0n, [commitment(2)], driver);
  const merkleKey = `private:merkle:v2:${context.networkId}:${context.realmId}:${context.poolId}:checkpoint`;
  driver.records.set(merkleKey, '{"revision":0}');

  await clearPrivateBalancePublicCache(context, driver);
  assert.deepEqual(await loadPrivateBalanceCommitments(context, driver), []);
  assert.equal(driver.records.has(merkleKey), false);
  assert.equal((await loadPrivateBalanceCommitments(other, driver))[0][0], 2);
});
