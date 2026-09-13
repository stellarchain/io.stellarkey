import { stringifyPrivateIndices } from '../src/features/private-balance/runtime/indices.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MerkleNodeStore } from '@stellarkey/private-balance';
import {
  loadPrivateBalanceMerklePaths,
  rebuildPrivateBalanceMerkleCache,
  recordVerifiedPrivateBalanceMerkleBatch,
  requirePrivateBalanceMerkleCheckpoint,
} from '../src/features/private-balance/runtime/merkle-cache.ts';

const bytes = value => new Uint8Array(32).fill(value);
const hex = value => Buffer.from(value).toString('hex');

class MemoryDriver {
  records = new Map();
  reads = [];
  prefixReads = 0;

  async read(key) {
    this.reads.push(key);
    return this.records.get(key) ?? null;
  }

  async readPrefix(prefix) {
    this.prefixReads += 1;
    return new Map([...this.records].filter(([key]) => key.startsWith(prefix)));
  }

  async compareAndSetMany(key, expectedRevision, entries, removeKeys = [], expectedPrefix, expectedRecords) {
    const current = this.records.get(key) ?? null;
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    if (expectedPrefix) {
      const actual = new Map([...this.records].filter(([key]) => key.startsWith(expectedPrefix.prefix)));
      if (actual.size !== expectedPrefix.entries.size || [...expectedPrefix.entries].some(([key, value]) => actual.get(key) !== value)) {
        return { ok: false, current };
      }
    }
    if ([...expectedRecords ?? []].some(([key, raw]) => (this.records.get(key) ?? null) !== raw)) return { ok: false, current };
    for (const key of removeKeys) if (!entries.has(key)) this.records.delete(key);
    for (const [entryKey, value] of entries) this.records.set(entryKey, value);
    for (const [entryKey, value] of entries) assert.equal(this.records.get(entryKey), value);
    return { ok: true, current: entries.get(key) ?? null };
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

function expected(checkpoint) {
  return {
    deploymentBindingHash: '09'.repeat(32),
    cursor: checkpoint.cursor,
    transcriptHead: hex(checkpoint.transcriptHead),
    commitmentCount: BigInt(checkpoint.commitments.length),
    root: hex(checkpoint.store.currentRoot),
    frontier: checkpoint.frontier.map(hex),
  };
}

test('incremental Merkle cache appends without reading old commitments and returns exact paths', async () => {
  const driver = new MemoryDriver();
  const commitments = Array.from({ length: 19 }, (_, index) => bytes(index + 1));
  const store = await MerkleNodeStore.empty();
  const frontier = (await import('@stellarkey/private-balance')).createEmptyTree().then(tree => tree);
  const tree = await frontier;

  for (const [batchIndex, batch] of [commitments.slice(0, 7), commitments.slice(7)].entries()) {
    for (const commitment of batch) {
      await store.append(commitment);
      const { appendFrontier } = await import('@stellarkey/private-balance');
      await appendFrontier(tree, commitment);
    }
    const { refreshTreeRoot } = await import('@stellarkey/private-balance');
    await refreshTreeRoot(tree);
    const startIndex = batchIndex === 0 ? 0n : 7n;
    await recordVerifiedPrivateBalanceMerkleBatch(context, {
      deploymentBindingHash: bytes(9),
      priorCursor: BigInt(batchIndex),
      cursor: BigInt(batchIndex + 1),
      transcriptHead: bytes(20 + batchIndex),
      startIndex,
      commitments: batch,
      expectedRoot: store.currentRoot,
      expectedFrontier: tree.frontier,
    }, driver);
  }

  driver.reads = [];
  driver.prefixReads = 0;
  const paths = await loadPrivateBalanceMerklePaths(context, expected({
    cursor: 2n,
    transcriptHead: bytes(21),
    commitments,
    store,
    frontier: tree.frontier,
  }), [2n, 18n], driver);
  assert.equal(paths.length, 2);
  for (const [pathIndex, leafIndex] of [2n, 18n].entries()) {
    const oracle = await store.getPath(leafIndex);
    assert.deepEqual(paths[pathIndex], oracle);
  }
  assert.equal(driver.prefixReads, 0, 'spend paths must not enumerate pool history');
  assert.ok(driver.reads.length <= 259, `two paths should use bounded reads, got ${driver.reads.length}`);
});

test('Merkle cache rejects every authenticated checkpoint field mutation', async () => {
  const driver = new MemoryDriver();
  const store = await MerkleNodeStore.fromCommitments([bytes(1), bytes(2)]);
  const { createEmptyTree, appendFrontier, refreshTreeRoot } = await import('@stellarkey/private-balance');
  const tree = await createEmptyTree();
  await appendFrontier(tree, bytes(1));
  await appendFrontier(tree, bytes(2));
  await refreshTreeRoot(tree);
  await recordVerifiedPrivateBalanceMerkleBatch(context, {
    deploymentBindingHash: bytes(9),
    priorCursor: 0n,
    cursor: 1n,
    transcriptHead: bytes(10),
    startIndex: 0n,
    commitments: [bytes(1), bytes(2)],
    expectedRoot: store.currentRoot,
    expectedFrontier: tree.frontier,
  }, driver);
  const baseline = expected({
    cursor: 1n,
    transcriptHead: bytes(10),
    commitments: [bytes(1), bytes(2)],
    store,
    frontier: tree.frontier,
  });
  const mutations = [
    { deploymentBindingHash: '08'.repeat(32) },
    { cursor: '2' },
    { transcriptHead: '0b'.repeat(32) },
    { commitmentCount: '3' },
    { root: '0c'.repeat(32) },
    { frontier: baseline.frontier.map((value, index) => index === 0 ? '0d'.repeat(32) : value) },
  ];
  const checkpointKey = [...driver.records.keys()].find(key => key.endsWith(':checkpoint'));
  assert.ok(checkpointKey);
  for (const mutation of mutations) {
    const checkpoint = JSON.parse(driver.records.get(checkpointKey));
    Object.assign(checkpoint, mutation);
    driver.records.set(checkpointKey, stringifyPrivateIndices(checkpoint));
    await assert.rejects(
      () => requirePrivateBalanceMerkleCheckpoint(context, baseline, driver),
      /checkpoint/i,
    );
    await rebuildPrivateBalanceMerkleCache(context, baseline, [bytes(1), bytes(2)], driver);
    await requirePrivateBalanceMerkleCheckpoint(context, baseline, driver);
  }
});
