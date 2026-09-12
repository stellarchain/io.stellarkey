import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export const POWERS_OF_TAU_SHA256 =
  '3ca1149e9349b22b0ee0649399cfb787677129b7b1189d1899fc0d615d9583db';
export const POWERS_OF_TAU_URL =
  'https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_14.ptau';

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
