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

  async readPrefix(prefix) {
    return new Map([...this.records].filter(([key]) => key.startsWith(prefix)));
  }

  async compareAndSet(key, expectedRevision, value) {
    const current = this.records.get(key) ?? null;
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    this.records.set(key, value);
    return { ok: true, current: value };
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

test('public cache retains only contiguous verified commitment chunks', async () => {
  const driver = new MemoryDriver();
  await storePrivateBalanceCommitmentChunk(context, 0, [commitment(1), commitment(2)], driver);
  await storePrivateBalanceCommitmentChunk(context, 2, [commitment(3), commitment(4)], driver);

  assert.deepEqual(
    (await loadPrivateBalanceCommitments(context, driver)).map(value => value[0]),
    [1, 2, 3, 4],
  );
  const serialized = [...driver.records.values()].join('');
  assert.doesNotMatch(serialized, /account|owner|memo|note|activity|private address/i);
  assert.ok([...driver.records.keys()].every(key =>
    key.startsWith(`private:cache:v1:${context.networkId}:${context.realmId}:${context.poolId}:`)));

  const expected = await MerkleNodeStore.fromCommitments([
    commitment(1), commitment(2), commitment(3), commitment(4),
  ]);
  const rebuilt = await MerkleNodeStore.fromCommitments(
    await loadPrivateBalanceCommitments(context, driver),
  );
  assert.equal(rebuilt.nextIndex, 4);
  assert.deepEqual(rebuilt.currentRoot, expected.currentRoot);
});

test('the unused verified Merkle store loader stays deleted', () => {
  assert.equal('loadVerifiedPrivateBalanceMerkleStore' in publicCache, false);
});

test('public cache fails closed on gaps, overlaps, malformed bytes, or tampering', async () => {
  const driver = new MemoryDriver();
  await assert.rejects(
    () => storePrivateBalanceCommitmentChunk(context, 1, [commitment(1)], driver),
    /contiguous/i,
  );
  await storePrivateBalanceCommitmentChunk(context, 0, [commitment(1)], driver);
  await assert.rejects(
    () => storePrivateBalanceCommitmentChunk(context, 0, [commitment(2)], driver),
    /contiguous/i,
  );
  await assert.rejects(
    () => storePrivateBalanceCommitmentChunk(context, 1, [new Uint8Array(31)], driver),
    /32 bytes/i,
  );
  const [key] = driver.records.keys();
  driver.records.set(key, '{"kind":"commitments","startIndex":0,"commitments":["secret"]}');
  await assert.rejects(() => loadPrivateBalanceCommitments(context, driver), /invalid/i);
});

test('public cache reset removes only the selected pool namespace', async () => {
  const driver = new MemoryDriver();
  const other = { ...context, poolId: '04'.repeat(32) };
  await storePrivateBalanceCommitmentChunk(context, 0, [commitment(1)], driver);
  await storePrivateBalanceCommitmentChunk(other, 0, [commitment(2)], driver);

  await clearPrivateBalancePublicCache(context, driver);
  assert.deepEqual(await loadPrivateBalanceCommitments(context, driver), []);
  assert.equal((await loadPrivateBalanceCommitments(other, driver))[0][0], 2);
});
