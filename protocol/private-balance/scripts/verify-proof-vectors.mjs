#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const protocolDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const circuitsDir = join(protocolDir, 'circuits');
const snarkjs = require(join(circuitsDir, 'node_modules/snarkjs/build/main.cjs'));
const verificationKey = JSON.parse(readFileSync(
  join(circuitsDir, 'build/verification_key.json'),
  'utf8',
));
const manifest = JSON.parse(readFileSync(
  join(protocolDir, 'manifests/development.json'),
  'utf8',
));
const vectors = JSON.parse(readFileSync(join(protocolDir, 'vectors/proofs-v1.json'), 'utf8'));
const publicInputs = manifest?.constants?.publicInputs;

if (vectors.schemaVersion !== 1 || vectors.protocolVersion !== 1 || !Array.isArray(vectors.proofs)) {
  throw new Error('Private proof vectors have an unsupported schema.');
}
if (!Number.isSafeInteger(publicInputs) || publicInputs <= 0) {
  throw new Error('Private development manifest has an invalid public-input count.');
}

const requiredKinds = new Set(['Deposit', 'PrivateTransfer', 'Withdraw']);
for (const item of vectors.proofs) {
  if (!item || typeof item.name !== 'string' || !requiredKinds.has(item.actionKind)) {
    throw new Error('Private proof vector metadata is invalid.');
  }
  if (!Array.isArray(item.publicSignals) || item.publicSignals.length !== publicInputs || !item.proof) {
    throw new Error(`Private proof vector ${item.name} has an invalid proof shape.`);
  }
  if (!await snarkjs.groth16.verify(verificationKey, item.publicSignals, item.proof)) {
    throw new Error(`Private proof vector ${item.name} does not verify against the current key.`);
  }
  requiredKinds.delete(item.actionKind);
}

if (requiredKinds.size !== 0) {
  throw new Error(`Private proof vectors are missing: ${[...requiredKinds].join(', ')}.`);
}

console.log(`✓ ${vectors.proofs.length} proof vectors verify against the current Groth16 key.`);
process.exit(0);
