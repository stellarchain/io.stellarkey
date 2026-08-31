#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const trackedOutputs = [
  'protocol/private-balance/manifests/development.json',
  'public/protocol/private-balance/v1/manifest.json',
  'public/protocol/private-balance/v1/catalogue.json',
  'public/protocol/private-balance/v1/circuit.wasm',
  'public/protocol/private-balance/v1/circuit.zkey',
  'public/protocol/private-balance/v1/circuit.zkey.pc',
  'public/protocol/private-balance/v1/pool.wasm',
  'public/protocol/private-balance/v1/verification-key.json',
  'src/lib/private-balance-expected-manifest.ts',
  'src/lib/private-balance-expected-catalogue.ts',
  'protocol/private-balance/generated/pool-client',
  'protocol/private-balance/vectors/keys-v1.json',
  'protocol/private-balance/vectors/addresses-v1.json',
  'protocol/private-balance/vectors/notes-v1.json',
  'protocol/private-balance/vectors/encryption-v1.json',
  'protocol/private-balance/vectors/tree-v1.json',
  'protocol/private-balance/vectors/actions-v1.json',
  'protocol/private-balance/vectors/proofs-v1.json',
];

function filesAt(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => (
    filesAt(join(path, entry.name))
  ));
}

function snapshot() {
  const hashes = new Map();
  for (const output of trackedOutputs) {
    for (const file of filesAt(join(root, output))) {
      hashes.set(
        relative(root, file),
        createHash('sha256').update(readFileSync(file)).digest('hex'),
      );
    }
  }
  return hashes;
}

const before = snapshot();
execFileSync(process.execPath, ['protocol/private-balance/scripts/generate-manifest.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync(process.execPath, ['protocol/private-balance/scripts/generate-clients.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync('npm', ['--prefix', 'protocol/private-balance/packages/browser', 'run', 'build'], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync(process.execPath, ['protocol/private-balance/scripts/generate-conformance-vectors.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync(process.execPath, ['protocol/private-balance/scripts/verify-proof-vectors.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync(process.execPath, ['protocol/private-balance/scripts/verify-artifacts.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
const after = snapshot();
const names = new Set([...before.keys(), ...after.keys()]);
const changed = [...names].filter(name => before.get(name) !== after.get(name));
if (changed.length > 0) {
  throw new Error(`Generated Private Balance files are stale:\n${changed.join('\n')}`);
}
console.log('✓ Generated Private Balance files are current.');
