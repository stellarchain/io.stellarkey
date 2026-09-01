#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePowersOfTau } from './powers-of-tau.mjs';

const circuitsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(circuitsDir, 'build');
const r1csPath = join(buildDir, 'action.r1cs');
const ptauPath = join(buildDir, 'pot15_final.ptau');
const zkeyPath = join(buildDir, 'action_dev.zkey');
const vkPath = join(buildDir, 'verification_key.json');

if (!existsSync(buildDir)) {
  mkdirSync(buildDir, { recursive: true });
}

ensurePowersOfTau(ptauPath);

console.log('Generating Groth16 development zkey...');
execFileSync('npx', ['snarkjs', 'groth16', 'setup', r1csPath, ptauPath, zkeyPath], {
  cwd: circuitsDir,
  stdio: 'inherit',
});

console.log('Exporting verification key JSON...');
execFileSync('npx', ['snarkjs', 'zkey', 'export', 'verificationkey', zkeyPath, vkPath], {
  cwd: circuitsDir,
  stdio: 'inherit',
});

console.log('✓ Dev setup completed successfully.');
