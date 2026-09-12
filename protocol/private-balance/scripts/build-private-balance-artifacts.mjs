#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const checkReproducible = process.argv.includes('--check-reproducible');
const STELLAR_CLI_VERSION = '27.0.0';
if (checkReproducible) assertCanonicalReproductionHost();
const circomVersion = execFileSync('circom', ['--version'], { encoding: 'utf8' }).trim();
if (circomVersion !== 'circom compiler 2.2.3') {
  throw new Error(`Expected circom compiler 2.2.3, got ${circomVersion}.`);
}
const stellarVersion = execFileSync('stellar', ['--version'], { encoding: 'utf8' })
  .match(/^stellar ([^\s]+)/)?.[1];
if (stellarVersion !== STELLAR_CLI_VERSION) {
  throw new Error(`Expected Stellar CLI ${STELLAR_CLI_VERSION}, got ${stellarVersion ?? 'unknown'}.`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertCanonicalReproductionHost() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('Exact artifact reproduction requires the canonical macOS ARM64 host.');
  }
  const rustHost = execFileSync('rustc', ['+1.97.1', '--version', '--verbose'], { encoding: 'utf8' })
    .match(/^host: (\S+)$/m)?.[1];
  if (rustHost !== 'aarch64-apple-darwin') {
    throw new Error('Exact artifact reproduction requires the canonical macOS ARM64 Rust host.');
  }
}

function run(file, args, options = {}) {
  execFileSync(file, args, { cwd: root, stdio: 'inherit', ...options });
}

function buildPool(outputDirectory, options = {}) {
  const args = [
    'contract',
    'build',
    '--manifest-path',
    'protocol/private-balance/Cargo.toml',
    '--package',
    'private-balance-pool',
    '--locked',
    '--optimize=false',
  ];
  if (outputDirectory) args.push('--out-dir', outputDirectory);
  // Cargo resolves toolchains from its working directory, not --manifest-path.
  // This entrypoint runs at the app root, outside the protocol's toolchain file.
  run('stellar', args, {
    ...options,
    env: { ...process.env, ...options.env, RUSTUP_TOOLCHAIN: '1.97.1' },
  });
}

if (!checkReproducible) {
  run('npm', ['--prefix', 'protocol/private-balance/circuits', 'run', 'compile']);
  run('npm', ['--prefix', 'protocol/private-balance/circuits', 'run', 'setup:dev']);
  run('npm', ['--prefix', 'protocol/private-balance/circuits', 'run', 'export:vk']);
  buildPool();
  run(process.execPath, ['protocol/private-balance/scripts/generate-manifest.mjs']);
  run(process.execPath, ['protocol/private-balance/scripts/generate-clients.mjs']);
  run('npm', ['--prefix', 'protocol/private-balance/packages/browser', 'run', 'build']);
  run(process.execPath, ['protocol/private-balance/scripts/generate-conformance-vectors.mjs']);
  run(process.execPath, ['protocol/private-balance/scripts/generate-proof-vectors.mjs']);
  process.exit(0);
}

const first = mkdtempSync(join(tmpdir(), 'stellarkey-repro-a-'));
const second = mkdtempSync(join(tmpdir(), 'stellarkey-repro-b-'));
try {
  for (const output of [first, second]) {
    const circuitOutput = join(output, 'circuit');
    const poolOutput = join(output, 'pool');
    mkdirSync(circuitOutput, { recursive: true });
    mkdirSync(poolOutput, { recursive: true });
    run('circom', [
      'protocol/private-balance/circuits/circom/action.circom',
      '--r1cs',
      '--wasm',
      '--O2',
      '-o',
      circuitOutput,
    ]);
    buildPool(poolOutput, {
      env: { ...process.env, CARGO_TARGET_DIR: join(output, 'cargo-target') },
    });
  }

  const pairs = [
    ['circuit R1CS', 'circuit/action.r1cs'],
    ['circuit witness Wasm', 'circuit/action_js/action.wasm'],
    ['pool contract Wasm', 'pool/private_balance_pool.wasm'],
  ];
  for (const [label, path] of pairs) {
    const left = sha256(join(first, path));
    const right = sha256(join(second, path));
    if (left !== right) throw new Error(`${label} is not reproducible: ${left} != ${right}`);
    console.log(`✓ ${label}: ${left}`);
  }
  const trackedPoolHash = sha256(join(root, 'public/protocol/private-balance/v1/pool.wasm'));
  const rebuiltPoolHash = sha256(join(
    first,
    'pool/private_balance_pool.wasm',
  ));
  if (trackedPoolHash !== rebuiltPoolHash) {
    throw new Error(`Shipped pool Wasm is stale: ${trackedPoolHash} != ${rebuiltPoolHash}`);
  }
  console.log('✓ Deterministic Private Balance artifacts rebuild byte-identically.');
} finally {
  rmSync(first, { recursive: true, force: true });
  rmSync(second, { recursive: true, force: true });
}
