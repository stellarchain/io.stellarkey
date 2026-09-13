import test from 'node:test';
import assert from 'node:assert/strict';
import { Forest, rootFromPath, recover, recordHash } from './model.mjs';

test('automatic rollover preserves membership across private subtrees', () => {
  const tree = new Forest(1, 2);
  tree.append([11n, 12n, 13n]);
  tree.append([21n, 22n, 23n]);
  for (const position of [0n, 3n]) {
    const path = tree.path(position);
    assert.equal(rootFromPath(path.leaf, position, path.siblings), tree.root);
    assert.equal(path.subtree, position / 3n);
  }
  assert.equal(tree.next, 6n);
});

test('capacity rejection is atomic; full-input exit needs no slots', () => {
  const tree = new Forest(1, 1);
  for (let i = 0; i < 3; i++) tree.append([BigInt(i * 3 + 1), BigInt(i * 3 + 2), BigInt(i * 3 + 3)]);
  const before = tree.checkpoint();
  assert.throws(() => tree.append([31n, 32n, 33n]), /capacity/);
  assert.deepEqual(tree.checkpoint(), before);
  const exit = tree.record(4, [], [100n, 101n]);
  assert.equal(tree.root, BigInt(before.root));
  assert.equal(tree.next, 9n);
  assert.equal(exit.index, '0');
  assert.throws(() => tree.record(4, [], [100n, 102n]), /spent/);
  assert.throws(() => tree.record(4, [1n, 2n, 3n], [103n, 104n]), /outputs/);
});

test('positions beyond JS safe integer and u64 remain exact', () => {
  const tree = new Forest(17, 47);
  const position = (1n << 80n) + 123n;
  // Fixture-only sparse population; not a public append or recovery entrypoint.
  tree.setSyntheticLeaf(position, 12345n);
  const path = tree.path(position);
  assert.equal(rootFromPath(path.leaf, position, path.siblings), tree.root);
  assert.notEqual(rootFromPath(path.leaf, position + 1n, path.siblings), tree.root);
  assert.equal(path.subtree * 3n ** 17n + path.localPosition, position);
});

test('archive replay authenticates rollover, exits and the final checkpoint', () => {
  const tree = new Forest(1, 2);
  const records = [tree.record(1, [11n, 12n, 13n], [91n, 92n]), tree.record(2, [21n, 22n, 23n], [93n, 94n]), tree.record(4, [], [95n, 96n])];
  assert.deepEqual(recover(1, 2, records, tree.checkpoint()).checkpoint(), tree.checkpoint());
  for (const field of ['start', 'root', 'previous', 'index']) {
    const corrupt = structuredClone(records);
    corrupt[1][field] = '999';
    corrupt[1].hash = recordHash(corrupt[1]);
    assert.throws(() => recover(1, 2, corrupt, tree.checkpoint()));
  }
  assert.throws(() => recover(1, 2, records.slice(0, 2), tree.checkpoint()), /checkpoint/);
  assert.throws(() => recover(1, 2, [...records, records[2]], tree.checkpoint()));
});

test('root and path substitution fail; invalid append inputs cannot partially mutate', () => {
  const tree = new Forest(1, 2);
  tree.append([11n, 12n, 13n]);
  const before = tree.checkpoint();
  assert.throws(() => tree.append([21n, -1n, 23n]), /field/);
  assert.deepEqual(tree.checkpoint(), before);
  const path = tree.path(0n);
  path.siblings[1][0] += 1n;
  assert.notEqual(rootFromPath(path.leaf, 0n, path.siblings), tree.root);
  assert.throws(() => new Forest(17, 145), /depth/);
});

test('encrypted recovery payloads are authenticated by the archive checkpoint', () => {
  const first = new Forest(1, 1), second = new Forest(1, 1);
  const a = first.record(1, [11n, 12n, 13n], [91n, 92n], ['aa', 'bb', 'cc']);
  const b = second.record(1, [11n, 12n, 13n], [91n, 92n], ['aa', 'bb', 'dd']);
  assert.notEqual(a.hash, b.hash, 'ciphertext changes must alter the authenticated transcript');
});
