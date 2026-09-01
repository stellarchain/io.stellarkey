#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePowersOfTau } from './powers-of-tau.mjs';

const circuitsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(circuitsDir, 'build');
const r1csPath = join(buildDir, 'action.r1cs');
const ptauPath = join(buildDir, 'pot15_final.ptau');
const zkeyPath = join(buildDir, 'action_dev.zkey');

ensurePowersOfTau(ptauPath);
execFileSync(
  'npx',
  ['--no-install', 'snarkjs', 'zkey', 'verify', r1csPath, ptauPath, zkeyPath],
  { cwd: circuitsDir, stdio: 'inherit' },
);
console.log('✓ Proving key matches the pinned circuit and Powers-of-Tau transcript.');
