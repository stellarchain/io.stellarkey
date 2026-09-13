import test from 'node:test';
import assert from 'node:assert/strict';
import { TREE_CAPACITY, TREE_DEPTH, EMPTY_ROOTS, createEmptyTree, appendCommitment, hashMerkleNode, MerkleNodeStore } from '../dist/tree.js';
import { computeNullifier } from '../dist/note.js';
import { bigintTo32Bytes } from '../dist/field.js';

test('global positions retain their bits beyond JavaScript and u64 boundaries', async () => {
  assert.equal(TREE_DEPTH, 64);
  assert.equal(TREE_CAPACITY, 3n ** 64n);
  const tree = await createEmptyTree();
  let position = 3n ** 41n;
  tree.nextIndex = position;
  const leaf = bigintTo32Bytes(1n);
  let expected = leaf;
  for (let level = 0; level < TREE_DEPTH; level++) {
    const children = [EMPTY_ROOTS[level], EMPTY_ROOTS[level]];
    children.splice(Number(position % 3n), 0, expected);
    expected = hashMerkleNode(children);
    position /= 3n;
  }
  assert.deepEqual(await appendCommitment(tree, leaf), expected);
  assert.equal(tree.nextIndex, 3n ** 41n + 1n);
});

test('last append carries to the root, then fails without changing the full tree', async () => {
  const tree = await createEmptyTree();
  tree.nextIndex = TREE_CAPACITY - 1n;
  const leaf = bigintTo32Bytes(1n);
  let expected = leaf;
  for (let level = 0; level < TREE_DEPTH; level++) expected = hashMerkleNode([EMPTY_ROOTS[level], EMPTY_ROOTS[level], expected]);
  assert.deepEqual(await appendCommitment(tree, leaf), expected);
  const full = structuredClone(tree);
  await assert.rejects(appendCommitment(tree, leaf), /full/);
  assert.deepEqual(tree, full);
});

test('nullifiers bind global position; sparse paths use exact indices', async () => {
  const args = [1n, 2n, 3n].map(bigintTo32Bytes);
  const leaf = bigintTo32Bytes(4n);
  const base = computeNullifier(...args, 7n, leaf);
  for (const bit of [32n, 53n, 64n, 100n]) assert.notDeepEqual(computeNullifier(...args, 7n + (1n << bit), leaf), base);
  const store = await MerkleNodeStore.fromCommitments([leaf, bigintTo32Bytes(5n)]);
  const path = await store.getPath(1n);
  assert.equal(path.leafIndex, 1n);
  assert.equal(path.positions.length, 64);
  assert.deepEqual(path.root, store.currentRoot);
  await assert.rejects(store.getPath(1), /present/);
});
