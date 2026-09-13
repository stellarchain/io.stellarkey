import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createReleaseBundle } from '../scripts/create-release-artifact.mjs';

const artifactPath = 'protocol/private-balance/v1';
const publicArtifacts = new URL(`../public/${artifactPath}/`, import.meta.url);
const maxAssetBytes = 25 * 1024 * 1024;

function fixture(t, withProvingKey = false) {
  const root = mkdtempSync(join(tmpdir(), 'stellarkey-packaging-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outDir = join(root, 'out');
  mkdirSync(outDir);
  writeFileSync(join(outDir, 'index.html'), '<!doctype html><title>Static packaging fixture</title>');
  if (withProvingKey) {
    mkdirSync(join(outDir, artifactPath), { recursive: true });
    for (const name of ['manifest.json', 'circuit.zkey', 'circuit.zkey.pc']) {
      copyFileSync(new URL(name, publicArtifacts), join(outDir, artifactPath, name));
    }
  }
  return { outDir, artifactsDir: join(root, 'artifacts'), version: '1.0.1', commit: 'c'.repeat(40), sbom: { bomFormat: 'CycloneDX', specVersion: '1.6', version: 1 } };
}

test('release packaging ships the verified compressed key without the redundant raw key or Finder metadata', async t => {
  const options = fixture(t, true);
  writeFileSync(join(options.outDir, '.DS_Store'), 'Finder metadata');
  writeFileSync(join(options.outDir, artifactPath, '.DS_Store'), 'Nested Finder metadata');
  const result = await createReleaseBundle(options);
  const inventory = JSON.parse(readFileSync(result.inventoryPath, 'utf8'));
  assert.deepEqual(inventory.files.map(file => file.path), [
    'index.html', `${artifactPath}/circuit.zkey.pc`, `${artifactPath}/manifest.json`,
  ]);
  assert.ok(inventory.files.every(file => file.size <= maxAssetBytes));
  assert.ok(existsSync(join(options.outDir, artifactPath, 'circuit.zkey')), 'canonical build output is preserved');
  assert.deepEqual(readFileSync(join(options.outDir, artifactPath, 'circuit.zkey.pc')), readFileSync(new URL('circuit.zkey.pc', publicArtifacts)));
});

test('release packaging rejects an oversized asset before writing release artifacts', async t => {
  const options = fixture(t);
  writeFileSync(join(options.outDir, 'oversized.bin'), Buffer.alloc(maxAssetBytes + 1));
  await assert.rejects(createReleaseBundle(options), /25 MiB.*oversized\.bin/);
  assert.equal(existsSync(join(options.artifactsDir, 'stellarkey-1.0.1.tar.gz')), false);
});

for (const name of ['circuit.zkey.pc', 'circuit.zkey']) {
  test(`release packaging refuses to omit the raw key when ${name} is corrupt`, async t => {
    const options = fixture(t, true);
    writeFileSync(join(options.outDir, artifactPath, name), 'corrupt fixture');
    await assert.rejects(createReleaseBundle(options), /proving.key.*(size|hash)/i);
    assert.ok(existsSync(join(options.outDir, artifactPath, 'circuit.zkey')));
  });
}

test('release packaging refuses a raw key without the supported compressed transport', async t => {
  const options = fixture(t, true);
  const manifestPath = join(options.outDir, artifactPath, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  delete manifest.artifacts.zkeyTransport;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  await assert.rejects(createReleaseBundle(options), /compressed proving.key transport/i);
});
