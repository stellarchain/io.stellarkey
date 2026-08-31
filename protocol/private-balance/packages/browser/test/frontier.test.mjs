import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMAIN_MERKLE,
  appendCommitment,
  appendFrontier,
  bigintTo32Bytes,
  createEmptyTree,
  getEmptyRoots,
  p2,
  poseidonDomainField,
  refreshTreeRoot,
} from '../dist/index.js';

const hex = value => Buffer.from(value).toString('hex');

test('pinned Merkle constants match the canonical Poseidon derivation', async () => {
  assert.equal(
    hex(poseidonDomainField(DOMAIN_MERKLE)),
    '285ff678051587f58b4061d5cae6418f89d9e2dcfeda99a8f3aaf4faa5370e28',
  );
  const roots = await getEmptyRoots();
  assert.equal(roots.length, 33);
  assert.equal(hex(roots[32]), '047585958785546e518e72d1bbfb7c573205c35c332e0b876f60218918401a59');
  for (let level = 0; level < 32; level += 1) {
    assert.deepEqual(p2(DOMAIN_MERKLE, [roots[level], roots[level]]), roots[level + 1]);
  }
});

test('300 frontier appends match the legacy root with 328 total hashes', async () => {
  const leaves = Array.from({ length: 300 }, (_, index) => bigintTo32Bytes(BigInt(index + 1)));
  const legacy = await createEmptyTree();
  for (const leaf of leaves) await appendCommitment(legacy, leaf);

  const frontier = await createEmptyTree();
  let hashes = 0;
  const countedHash = (left, right) => {
    hashes += 1;
    return p2(DOMAIN_MERKLE, [left, right]);
  };
  for (const leaf of leaves) await appendFrontier(frontier, leaf, countedHash);
  assert.equal(hashes, 296, 'frontier sweep should hash only completed left siblings');
  const root = await refreshTreeRoot(frontier, countedHash);

  assert.equal(hashes, 328, 'one final root fold adds exactly TREE_DEPTH hashes');
  assert.equal(frontier.nextIndex, 300);
  assert.deepEqual(root, legacy.currentRoot);
  assert.deepEqual(frontier.currentRoot, legacy.currentRoot);
});
