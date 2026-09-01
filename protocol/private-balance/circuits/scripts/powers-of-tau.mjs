import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export const POWERS_OF_TAU_SHA256 =
  '3ef2ecc5b75d687048cf2d59195119b42fb07c5af639c5f283d84bfa69829e7f';
export const POWERS_OF_TAU_URL =
  'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau';

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
