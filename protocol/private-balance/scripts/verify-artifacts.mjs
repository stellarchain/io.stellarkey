#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const manifestPath = join(process.cwd(), 'protocol/private-balance/manifests/development.json');
const buildDir = join(process.cwd(), 'protocol/private-balance/circuits/build');

if (!existsSync(manifestPath)) {
  console.error('Manifest development.json does not exist');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function sha(file) {
  return createHash('sha256').update(readFileSync(join(buildDir, file))).digest('hex');
}

assertMatch('r1csSha256', sha('action.r1cs'), manifest.artifacts.r1csSha256);
assertMatch('wasmSha256', sha('action_js/action.wasm'), manifest.artifacts.wasmSha256);
assertMatch('zkeySha256', sha('action_dev.zkey'), manifest.artifacts.zkeySha256);
assertMatch('vkBinSha256', sha('verifying-key.bin'), manifest.artifacts.vkBinSha256);
assertMatch('vkJsonSha256', sha('verification_key.json'), manifest.artifacts.vkJsonSha256);

function assertMatch(name, actual, expected) {
  if (actual !== expected) {
    console.error(`Mismatch for ${name}:\n  Actual:   ${actual}\n  Expected: ${expected}`);
    process.exit(1);
  }
}

console.log('✓ All development artifacts match manifest development.json.');
