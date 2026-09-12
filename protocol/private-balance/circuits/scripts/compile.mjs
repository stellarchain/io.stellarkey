#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const circuitsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const productionBuildDir = join(circuitsDir, 'build');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

const benchmarkCurve = argumentValue('--benchmark-curve');
const benchmarkOutput = argumentValue('--output');
if ((benchmarkCurve === null) !== (benchmarkOutput === null)) {
  throw new Error('--benchmark-curve and --output must be provided together.');
}
if (benchmarkCurve !== null && !['bn128', 'bls12381'].includes(benchmarkCurve)) {
  throw new Error('--benchmark-curve must be bn128 or bls12381.');
}

const buildDir = benchmarkOutput === null ? productionBuildDir : resolve(benchmarkOutput);
if (benchmarkOutput !== null) {
  const fromProduction = relative(productionBuildDir, buildDir);
  if (fromProduction === '' || (!fromProduction.startsWith('..') && !isAbsolute(fromProduction))) {
    throw new Error('Curve benchmark output must stay outside the production build directory.');
  }
  if (existsSync(buildDir) && readdirSync(buildDir).length > 0) {
    throw new Error('Curve benchmark output directory must be new or empty.');
  }
}

if (!existsSync(buildDir)) {
  mkdirSync(buildDir, { recursive: true });
}

const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };

try {
  const primeArguments = benchmarkCurve === null ? [] : ['--prime', benchmarkCurve];
  console.log(`Compiling action.circom${benchmarkCurve ? ` for ${benchmarkCurve}` : ''} with circom...`);
  execFileSync(
    'circom',
    [
      join(circuitsDir, 'circom/action.circom'),
      '--r1cs',
      '--wasm',
      '--O2',
      ...primeArguments,
      '-o',
      buildDir,
    ],
    { env, stdio: 'inherit' },
  );
  console.log('Compiling gadgets_helper.circom with circom...');
  execFileSync(
    'circom',
    [
      join(circuitsDir, 'circom/gadgets_helper.circom'),
      '--wasm',
      '--O2',
      ...primeArguments,
      '-o',
      buildDir,
    ],
    { env, stdio: 'inherit' },
  );
  console.log('✓ Compilation completed successfully.');
} catch (err) {
  console.error('Compilation failed:', err);
  process.exit(1);
}
