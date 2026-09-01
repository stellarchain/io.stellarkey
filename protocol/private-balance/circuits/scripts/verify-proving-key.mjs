#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePowersOfTau } from './powers-of-tau.mjs';

const circuitsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(circuitsDir, 'build');
const r1csPath = join(buildDir, 'action.r1cs');
const ptauPath = join(buildDir, 'pot15_final.ptau');
const zkeyPath = join(buildDir, 'action_dev.zkey');

ensurePowersOfTau(ptauPath);
const verification = spawnSync(
  'npx',
  ['--no-install', 'snarkjs', 'zkey', 'verify', r1csPath, ptauPath, zkeyPath],
  { cwd: circuitsDir, stdio: 'inherit' },
);
if (verification.status === 0) {
  console.log('✓ Proving key matches the pinned circuit and Powers-of-Tau transcript.');
} else {
  const manifestPath = join(
    circuitsDir,
    '../../../public/protocol/private-balance/v1/manifest.json',
  );
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.status !== 'development' || manifest.release?.zkeyVerified !== false) {
    throw new Error('The published Private Balance proving key failed provenance verification.');
  }
  console.warn(
    '⚠ The development proving key is not bound to the pinned transcript. ' +
    'It remains quarantined and unavailable in production builds.',
  );
}
