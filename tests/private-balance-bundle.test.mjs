import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { measurePrivateBalanceAssets, assertPrivateBalanceBudgets,
  PRIVATE_ARTIFACT_GZIP_BUDGET, PRIVATE_PEAK_CACHE_BUDGET } from '../scripts/check-bundle-budget.mjs';

const source = readFileSync(new URL('../scripts/check-bundle-budget.mjs', import.meta.url), 'utf8');

test('artifact budgets measure the actual compressed download and shared two-revision cache', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'stellarkey-artifact-budget-'));
  try {
    const artifactRoot = join(fixture, 'protocol/private-balance/v1');
    const chunks = join(fixture, '_next/static/chunks');
    mkdirSync(artifactRoot, { recursive: true });
    mkdirSync(chunks, { recursive: true });
    writeFileSync(join(chunks, 'feature.js'), 'PrivateBalanceProvider');
    writeFileSync(join(chunks, 'turbopack-worker.js'), 'generateProof');
    for (const file of ['manifest.json', 'circuit.wasm', 'circuit.zkey', 'circuit.zkey.pc', 'verification-key.json']) {
      copyFileSync(new URL(`../public/protocol/private-balance/v1/${file}`, import.meta.url), join(artifactRoot, file));
    }
    const files = ['circuit.wasm', 'circuit.zkey.pc', 'verification-key.json'];
    const bytes = files.map(file => readFileSync(join(artifactRoot, file)));
    const measurement = measurePrivateBalanceAssets(fixture);
    assert.deepEqual(measurement.artifacts.paths, files.map(file => `protocol/private-balance/v1/${file}`));
    assert.equal(measurement.artifacts.rawBytes, bytes.reduce((sum, value) => sum + value.byteLength, 0));
    assert.equal(measurement.artifacts.gzipBytes,
      bytes.reduce((sum, value) => sum + gzipSync(value, { level: 9 }).byteLength, 0));
    assert.equal(measurement.peakCacheBytes, measurement.artifacts.rawBytes * 2);
    assert.equal(PRIVATE_ARTIFACT_GZIP_BUDGET, 13_000_000);
    assert.equal(PRIVATE_PEAK_CACHE_BUDGET, 50_000_000);
    assert.doesNotThrow(() => assertPrivateBalanceBudgets(measurement));
    assert.throws(() => assertPrivateBalanceBudgets({ ...measurement, peakCacheBytes: 50_000_001 }), /cache:/);
    assert.throws(() => assertPrivateBalanceBudgets({ ...measurement,
      artifacts: { ...measurement.artifacts, gzipBytes: 13_000_001 } }), /artifacts:/);

    const manifest = JSON.parse(readFileSync(join(artifactRoot, 'manifest.json'), 'utf8'));
    manifest.artifacts.zkeyTransport.sha256 = '00'.repeat(32);
    writeFileSync(join(artifactRoot, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => measurePrivateBalanceAssets(fixture), /hash mismatch/i);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('release budgets cover private feature, worker, artifacts, and two-version cache peak', () => {
  for (const name of [
    'PRIVATE_FEATURE_JS_RAW_BUDGET',
    'PRIVATE_FEATURE_JS_GZIP_BUDGET',
    'PRIVATE_WORKER_JS_RAW_BUDGET',
    'PRIVATE_ARTIFACT_GZIP_BUDGET',
    'PRIVATE_PEAK_CACHE_BUDGET',
    'measurePrivateBalanceAssets',
    'assertPrivateBalanceBudgets',
  ]) assert.match(source, new RegExp(name));
  assert.match(source, /PrivateBalanceProvider/);
  assert.match(source, /turbopack-worker/);
  assert.match(source, /circuit\.wasm/);
  assert.match(source, /circuit\.zkey/);
});

test('the private pool runtime excludes arbitrary-precision integer dependencies', () => {
  const protocolManifest = readFileSync(
    new URL('../protocol/private-balance/crates/protocol/Cargo.toml', import.meta.url),
    'utf8',
  );
  const verifierManifest = readFileSync(
    new URL('../protocol/private-balance/crates/verifier/Cargo.toml', import.meta.url),
    'utf8',
  );
  const fieldSource = readFileSync(
    new URL('../protocol/private-balance/crates/protocol/src/field.rs', import.meta.url),
    'utf8',
  );
  const verifierSource = readFileSync(
    new URL('../protocol/private-balance/crates/verifier/src/verify.rs', import.meta.url),
    'utf8',
  );

  const runtimeSection = manifest => manifest.split('[dev-dependencies]')[0];
  assert.doesNotMatch(runtimeSection(protocolManifest), /num-bigint/u);
  assert.doesNotMatch(runtimeSection(verifierManifest), /num-bigint/u);
  assert.doesNotMatch(fieldSource, /BigUint|num_bigint/u);
  assert.doesNotMatch(verifierSource.split('#[cfg(test)]')[0], /BigUint|num_bigint/u);
});
