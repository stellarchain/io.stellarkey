#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const wasmPath = join(
  root,
  'public/protocol/private-balance/v1/pool.wasm',
);
const outputDir = join(root, 'protocol/private-balance/generated/pool-client');
const stellarVersion = execFileSync('stellar', ['--version'], { encoding: 'utf8' });
if (!stellarVersion.startsWith('stellar 27.0.0 ')) {
  throw new Error(`Expected Stellar CLI 27.0.0, got ${stellarVersion.split('\n')[0]}.`);
}

if (!existsSync(wasmPath)) {
  throw new Error('Generate the immutable pool.wasm artifact before generating contract bindings.');
}

execFileSync('stellar', [
  'contract',
  'bindings',
  'typescript',
  '--wasm',
  wasmPath,
  '--output-dir',
  outputDir,
  '--overwrite',
], { stdio: 'inherit' });

const packagePath = join(outputDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.name = '@stellarkey/private-balance-pool-client';
packageJson.private = true;
packageJson.dependencies['@stellar/stellar-sdk'] = '17.0.1';
packageJson.devDependencies.typescript = '6.0.3';
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log('✓ Generated and dependency-pinned Private Balance pool bindings.');
