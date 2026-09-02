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

  async compareAndSetMany(key, expectedRevision, entries) {
    const current = this.records.get(key) ?? null;
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    for (const [entryKey, value] of entries) this.records.set(entryKey, value);
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
    commitmentCount: checkpoint.commitments.length,
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
    const startIndex = batchIndex === 0 ? 0 : 7;
    await recordVerifiedPrivateBalanceMerkleBatch(context, {
      deploymentBindingHash: bytes(9),
      priorCursor: batchIndex,
      cursor: batchIndex + 1,
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
    cursor: 2,
    transcriptHead: bytes(21),
    commitments,
    store,
    frontier: tree.frontier,
  }), [2, 18], driver);
  assert.equal(paths.length, 2);
  for (const [pathIndex, leafIndex] of [2, 18].entries()) {
    const oracle = await store.getPath(leafIndex);
    assert.deepEqual(paths[pathIndex], oracle);
  }
  assert.equal(driver.prefixReads, 0, 'spend paths must not enumerate pool history');
  assert.ok(driver.reads.length <= 67, `two paths should use bounded reads, got ${driver.reads.length}`);
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
    priorCursor: 0,
    cursor: 1,
    transcriptHead: bytes(10),
    startIndex: 0,
    commitments: [bytes(1), bytes(2)],
    expectedRoot: store.currentRoot,
    expectedFrontier: tree.frontier,
  }, driver);
  const baseline = expected({
    cursor: 1,
    transcriptHead: bytes(10),
    commitments: [bytes(1), bytes(2)],
    store,
    frontier: tree.frontier,
  });
  const mutations = [
    { deploymentBindingHash: '08'.repeat(32) },
    { cursor: 2 },
    { transcriptHead: '0b'.repeat(32) },
    { commitmentCount: 3 },
    { root: '0c'.repeat(32) },
    { frontier: baseline.frontier.map((value, index) => index === 0 ? '0d'.repeat(32) : value) },
  ];
  const checkpointKey = [...driver.records.keys()].find(key => key.endsWith(':checkpoint'));
  assert.ok(checkpointKey);
  for (const mutation of mutations) {
    const checkpoint = JSON.parse(driver.records.get(checkpointKey));
    Object.assign(checkpoint, mutation);
    driver.records.set(checkpointKey, JSON.stringify(checkpoint));
    await assert.rejects(
      () => requirePrivateBalanceMerkleCheckpoint(context, baseline, driver),
      /checkpoint/i,
    );
    await rebuildPrivateBalanceMerkleCache(context, baseline, [bytes(1), bytes(2)], driver);
    await requirePrivateBalanceMerkleCheckpoint(context, baseline, driver);
  }
});
