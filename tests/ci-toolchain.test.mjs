import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const installerUrl = new URL('../scripts/ci/install-stellar-cli.mjs', import.meta.url);
async function installer() {
  assert.ok(existsSync(installerUrl), 'provide the checksum-verified Stellar CLI installer');
  return import(installerUrl.href);
}

test('CLI archives pin supported hosts, exact release digests and source revision', async () => {
  const { stellarCliAsset, assertStellarCliVersion } = await installer();
  const expected = [
    ['darwin', 'arm64', 'aarch64-apple-darwin', '70a259d10534259656b63fe7073116ec3bda0ce83839c9c72364750614beeae6'],
    ['linux', 'x64', 'x86_64-unknown-linux-gnu', '357bf712f6353c28cd33c794402a3c87231757a5b305e6ef1604365af4fdd556'],
    ['linux', 'arm64', 'aarch64-unknown-linux-gnu', 'a341adcc152e1865ea61d6c332e75b3d82b1f2f32108198fac97c50878b17034'],
  ];
  for (const [platform, arch, triple, digest] of expected) {
    const asset = stellarCliAsset(platform, arch);
    assert.equal(asset.sha256, digest);
    assert.equal(asset.url, `https://github.com/stellar/stellar-cli/releases/download/v27.0.0/stellar-cli-27.0.0-${triple}.tar.gz`);
    assert.ok(asset.byteLength > 0 && asset.byteLength < 30_000_000);
  }
  assert.throws(() => stellarCliAsset('linux', 'ia32'), /Unsupported/);
  assert.throws(() => stellarCliAsset('win32', 'x64'), /Unsupported/);
  assert.doesNotThrow(() => assertStellarCliVersion('stellar 27.0.0 (5a7c5fe76530bf4248477ac812fc757146b98cc4)\nstellar-xdr 27.0.0\n'));
  for (const output of ['stellar 27.0.1 (5a7c5fe76530bf4248477ac812fc757146b98cc4)', 'stellar 27.0.0 (other)', 'stellar 27.0.0', 'unexpected\nstellar 27.0.0 (5a7c5fe76530bf4248477ac812fc757146b98cc4)']) {
    assert.throws(() => assertStellarCliVersion(output), /revision/);
  }
});

test('archive validation rejects corruption, wrong length and unexpected extraction members', async () => {
  const { assertArchiveIntegrity, assertArchiveMembers } = await installer();
  const bytes = Buffer.from('non-usable archive fixture');
  const asset = { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.doesNotThrow(() => assertArchiveIntegrity(bytes, asset));
  assert.throws(() => assertArchiveIntegrity(Buffer.from('non-usable archive fixturE'), asset), /checksum/);
  assert.throws(() => assertArchiveIntegrity(Buffer.concat([bytes, bytes]), asset), /length/);
  assert.doesNotThrow(() => assertArchiveMembers('stellar\n'));
  for (const members of ['', '../stellar\n', '/stellar\n', 'stellar\nextra\n', 'stellar\nstellar\n', './stellar\n']) {
    assert.throws(() => assertArchiveMembers(members), /members/);
  }
});

test('CI caches only archives and executes validation on both cache hits and misses', async () => {
  await installer();
  const action = readFileSync(new URL('../.github/actions/setup-stellar-cli/action.yml', import.meta.url), 'utf8');
  assert.match(action, /actions\/cache@[0-9a-f]{40}/);
  assert.match(action, /stellarkey-cli-archives/);
  assert.doesNotMatch(action, /cache-hit.*(?:true|false)|continue-on-error/);
  assert.match(action, /node scripts\/ci\/install-stellar-cli\.mjs/);
  assert.match(action, /libdbus-1-3 libudev1/);
  assert.doesNotMatch(action, /cargo.*install stellar-cli|--no-default-features/);
});

test('cached archive reads are bounded and validate the actual file bytes', async () => {
  const { readPinnedArchive } = await installer();
  const directory = await mkdtemp(path.join(tmpdir(), 'stellarkey-cli-cache-test-'));
  try {
    const file = path.join(directory, 'archive.tar.gz');
    const bytes = Buffer.from('non-usable archive fixture');
    const asset = { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    await writeFile(file, bytes);
    assert.deepEqual(await readPinnedArchive(file, asset), bytes);
    await writeFile(file, Buffer.concat([bytes, bytes]));
    await assert.rejects(readPinnedArchive(file, asset), /length/);
    await writeFile(file, Buffer.from('non-usable archive fixturE'));
    await assert.rejects(readPinnedArchive(file, asset), /checksum/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the real installer rejects a corrupt cache before extraction or PATH publication', async () => {
  const { installStellarCli, stellarCliAsset } = await installer();
  const directory = await mkdtemp(path.join(tmpdir(), 'stellarkey-cli-install-test-'));
  try {
    const cacheDir = path.join(directory, 'cache');
    const githubPath = path.join(directory, 'github-path');
    await mkdir(cacheDir);
    const asset = stellarCliAsset();
    await writeFile(path.join(cacheDir, asset.name), Buffer.alloc(asset.byteLength));
    await assert.rejects(installStellarCli({ cacheDir, installRoot: directory, githubPath }), /checksum/);
    assert.deepEqual(await readdir(directory), ['cache']);
    assert.equal(existsSync(githubPath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
