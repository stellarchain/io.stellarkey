import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export const POWERS_OF_TAU_SHA256 =
  '489be9e5ac65d524f7b1685baac8a183c6e77924fdb73d2b8105e335f277895d';
export const POWERS_OF_TAU_URL =
  'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau';

export function assertPowersOfTau(path) {
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== POWERS_OF_TAU_SHA256) {
    throw new Error(
      `Powers-of-Tau transcript hash mismatch: expected ${POWERS_OF_TAU_SHA256}, got ${actual}.`,
    );
  }
}

export function ensurePowersOfTau(path) {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    console.log('Downloading the pinned Powers-of-Tau transcript...');
    execFileSync(
      'curl',
      ['--fail', '--silent', '--show-error', '--location', '--output', path, POWERS_OF_TAU_URL],
      { stdio: 'inherit' },
    );
  }
  try {
    assertPowersOfTau(path);
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
}
