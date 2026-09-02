import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TREE_DEPTH,
  TREE_FRONTIER_SIZE,
  appendCommitment,
  appendFrontier,
  bigintTo32Bytes,
  createEmptyTree,
  getEmptyRoots,
  hashMerkleNode,
  refreshTreeRoot,
} from '../dist/index.js';

const hex = value => Buffer.from(value).toString('hex');

test('ternary empty roots match the canonical three-input Poseidon2 derivation', async () => {
  const roots = await getEmptyRoots();
  assert.equal(TREE_DEPTH, 17);
  assert.equal(roots.length, TREE_DEPTH + 1);
  for (let level = 0; level < TREE_DEPTH; level += 1) {
    assert.deepEqual(
      hashMerkleNode([roots[level], roots[level], roots[level]]),
      roots[level + 1],
    );
  }
});

test('300 ternary frontier appends match full updates with 165 total hashes', async () => {
  const leaves = Array.from({ length: 300 }, (_, index) => bigintTo32Bytes(BigInt(index + 1)));
  const legacy = await createEmptyTree();
  for (const leaf of leaves) await appendCommitment(legacy, leaf);

  const frontier = await createEmptyTree();
  let hashes = 0;
  const countedHash = children => {
    hashes += 1;
    return hashMerkleNode(children);
  };
  for (const leaf of leaves) await appendFrontier(frontier, leaf, countedHash);
  assert.equal(hashes, 148, 'frontier sweep should hash only completed ternary groups');
  const root = await refreshTreeRoot(frontier, countedHash);

  assert.equal(hashes, 165, 'one final root fold adds exactly TREE_DEPTH hashes');
  assert.equal(frontier.nextIndex, 300);
  assert.equal(frontier.frontier.length, TREE_FRONTIER_SIZE);
  assert.deepEqual(root, legacy.currentRoot);
  assert.deepEqual(frontier.currentRoot, legacy.currentRoot);
});
