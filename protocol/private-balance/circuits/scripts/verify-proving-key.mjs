#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensurePowersOfTau } from './powers-of-tau.mjs';

const circuitsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(circuitsDir, 'build');
const r1csPath = join(buildDir, 'action.r1cs');
const ptauPath = join(buildDir, 'ppot_0080_17.ptau');
const zkeyPath = join(buildDir, 'action_dev.zkey');

export function verifyProvingKey({
  ensureTranscript = ensurePowersOfTau,
  execute = execFileSync,
  stdio = 'inherit',
} = {}) {
  ensureTranscript(ptauPath);
  execute(
    'npx',
    ['--no-install', 'snarkjs', 'zkey', 'verify', r1csPath, ptauPath, zkeyPath],
    { cwd: circuitsDir, stdio },
  );
  return true;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  verifyProvingKey();
  console.log('✓ Proving key matches the pinned circuit and Powers-of-Tau transcript.');
}
