import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('private recovery and contract paths fold the Merkle root only at verification boundaries', () => {
  const scanner = readFileSync('src/features/private-balance/runtime/scanner.ts', 'utf8');
  const contract = readFileSync('protocol/private-balance/contracts/pool/src/contract.rs', 'utf8');

  assert.match(scanner, /appendFrontier/);
  assert.match(scanner, /refreshTreeRoot/);
  assert.doesNotMatch(scanner, /applyArchiveRecord/);
  assert.match(contract, /EMPTY_ROOTS/);
  assert.match(contract, /append_leaf_to_frontier/);
  assert.match(contract, /compute_tree_root/);
  assert.doesNotMatch(contract, /fn compute_empty_roots/);
});
