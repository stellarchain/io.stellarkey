#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const circuitsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(circuitsDir, 'build');

if (!existsSync(buildDir)) {
  mkdirSync(buildDir, { recursive: true });
}

const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };

try {
  console.log('Compiling action.circom with circom...');
  execFileSync(
    'circom',
    [join(circuitsDir, 'circom/action.circom'), '--r1cs', '--wasm', '--O2', '-o', buildDir],
    { env, stdio: 'inherit' },
  );
  console.log('Compiling gadgets_helper.circom with circom...');
  execFileSync(
    'circom',
    [join(circuitsDir, 'circom/gadgets_helper.circom'), '--wasm', '--O2', '-o', buildDir],
    { env, stdio: 'inherit' },
  );
  console.log('✓ Compilation completed successfully.');
} catch (err) {
  console.error('Compilation failed:', err);
  process.exit(1);
}
