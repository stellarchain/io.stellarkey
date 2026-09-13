import assert from 'node:assert/strict';
import test from 'node:test';
import { TREE_CAPACITY, TREE_DEPTH, EMPTY_ROOTS, createEmptyTree, appendCommitment } from '@stellarkey/private-balance';
import { parsePrivateIndex, stringifyPrivateIndices, parsePrivateIndices, privateBatchLength } from '../src/features/private-balance/runtime/indices.ts';
import { recordVerifiedPrivateBalanceMerkleBatch, loadPrivateBalanceMerkleCheckpoint, loadPrivateBalanceMerklePaths } from '../src/features/private-balance/runtime/merkle-cache.ts';
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

const context = { networkId: '01'.repeat(32), realmId: '02'.repeat(32), poolId: '03'.repeat(32) };
const namespace = `private:merkle:v2:${context.networkId}:${context.realmId}:${context.poolId}:`;
const checkpointKey = `${namespace}checkpoint`;
const binding = new Uint8Array(32).fill(9);

test('canonical u128 indices round trip without accepting rounded numbers or noncanonical text', () => {
  const index = (1n << 127n) + 1n;
  assert.equal(parsePrivateIndex(index.toString()), index);
  assert.deepEqual(parsePrivateIndices(stringifyPrivateIndices({ index }), ['index']), { index });
  for (const bad of [Number(index), '01', '-1', '1.0', '1e3', ((1n << 128n)).toString(), '9'.repeat(500)]) {
    assert.throws(() => parsePrivateIndex(bad), /index/);
  }
  assert.equal(privateBatchLength(index, 200), 200);
  assert.equal(privateBatchLength(7n, 200), 7);
});

async function seedCheckpoint(storage, count) {
  const tree = await createEmptyTree();
  tree.nextIndex = count;
  const checkpoint = { kind: 'public-merkle-checkpoint', version: 2, revision: 0,
    deploymentBindingHash: hex(binding), cursor: (1n << 80n), transcriptHead: '07'.repeat(32),
    commitmentCount: count, root: hex(tree.currentRoot), frontier: tree.frontier.map(hex) };
  // Synthetic zero-leaf forest: only used to exercise exact sparse arithmetic.
  storage.records.set(checkpointKey, stringifyPrivateIndices(checkpoint));
  return { tree, checkpoint };
}

test('an exit advances the authenticated cache cursor at full capacity without adding leaves', async () => {
  const storage = new MemoryDriver();
  const { tree, checkpoint } = await seedCheckpoint(storage, TREE_CAPACITY);
  const batch = { deploymentBindingHash: binding, priorCursor: checkpoint.cursor, cursor: checkpoint.cursor + 1n,
    transcriptHead: new Uint8Array(32).fill(8), startIndex: TREE_CAPACITY, commitments: [],
    expectedRoot: tree.currentRoot, expectedFrontier: tree.frontier };
  await recordVerifiedPrivateBalanceMerkleBatch(context, batch, storage);
  const after = await loadPrivateBalanceMerkleCheckpoint(context, storage);
  assert.equal(after.cursor, checkpoint.cursor + 1n);
  assert.equal(after.commitmentCount, TREE_CAPACITY);
  assert.equal(after.root, checkpoint.root);
  assert.equal(storage.records.size, 1);
  const before = new Map(storage.records);
  await assert.rejects(recordVerifiedPrivateBalanceMerkleBatch(context,
    { ...batch, priorCursor: batch.cursor, cursor: batch.cursor + 1n, expectedRoot: new Uint8Array(32).fill(1) }, storage), /root/);
  assert.deepEqual(storage.records, before);
});

test('the cache preserves the final carry and serializes large indices exactly', async () => {
  const storage = new MemoryDriver();
  const { tree, checkpoint } = await seedCheckpoint(storage, TREE_CAPACITY - 1n);
  const leaf = new Uint8Array(32); leaf[31] = 1;
  await appendCommitment(tree, leaf);
  await recordVerifiedPrivateBalanceMerkleBatch(context, {
    deploymentBindingHash: binding, priorCursor: checkpoint.cursor, cursor: checkpoint.cursor + 1n,
    transcriptHead: new Uint8Array(32).fill(8), startIndex: TREE_CAPACITY - 1n, commitments: [leaf],
    expectedRoot: tree.currentRoot, expectedFrontier: tree.frontier,
  }, storage);
  const after = await loadPrivateBalanceMerkleCheckpoint(context, storage);
  assert.equal(after.commitmentCount, TREE_CAPACITY);
  assert.equal(after.root, hex(tree.currentRoot));
  const encoded = JSON.parse(storage.records.get(checkpointKey));
  assert.equal(encoded.commitmentCount, TREE_CAPACITY.toString());
  assert.equal(typeof encoded.cursor, 'string');
  // Seed the zero sibling subtrees for a full path, then authenticate the path.
  const position = TREE_CAPACITY - 1n;
  for (let level = 0; level < TREE_DEPTH; level++) {
    const current = position / (3n ** BigInt(level));
    for (const sibling of [current - 2n, current - 1n]) {
      const key = `${namespace}node:${String(level).padStart(2, '0')}:${String(sibling).padStart(39, '0')}`;
      storage.records.set(key, stringifyPrivateIndices({ kind: 'public-merkle-node', version: 2, revision: 0,
        level, index: sibling, value: hex(EMPTY_ROOTS[level]) }));
    }
  }
  const [path] = await loadPrivateBalanceMerklePaths(context, after, [position], storage);
  assert.deepEqual(path.root, tree.currentRoot);
  assert.equal(path.leafIndex, position);
});
