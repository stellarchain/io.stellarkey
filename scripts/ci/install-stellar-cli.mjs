import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdir, mkdtemp, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = '27.0.0';
const REVISION = '5a7c5fe76530bf4248477ac812fc757146b98cc4';
// Digests and lengths published on the official v27.0.0 GitHub release.
const assets = {
  'darwin-arm64': ['aarch64-apple-darwin', 18_672_447, '70a259d10534259656b63fe7073116ec3bda0ce83839c9c72364750614beeae6'],
  'linux-x64': ['x86_64-unknown-linux-gnu', 21_895_604, '357bf712f6353c28cd33c794402a3c87231757a5b305e6ef1604365af4fdd556'],
  'linux-arm64': ['aarch64-unknown-linux-gnu', 21_761_277, 'a341adcc152e1865ea61d6c332e75b3d82b1f2f32108198fac97c50878b17034'],
};

export function stellarCliAsset(platform = process.platform, arch = process.arch) {
  const asset = assets[`${platform}-${arch}`];
  if (!asset) throw new Error('Unsupported Stellar CLI build host.');
  const [triple, byteLength, sha256] = asset;
  const name = `stellar-cli-${VERSION}-${triple}.tar.gz`;
  return { name, byteLength, sha256, url: `https://github.com/stellar/stellar-cli/releases/download/v${VERSION}/${name}` };
}

export function assertArchiveIntegrity(bytes, asset) {
  if (bytes.byteLength !== asset.byteLength) throw new Error('Stellar CLI archive length mismatch.');
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error('Stellar CLI archive checksum mismatch; refusing the cached or downloaded archive.');
  }
}

export function assertArchiveMembers(listing) {
  if (listing !== 'stellar\n') throw new Error('Unexpected Stellar CLI archive members.');
}

export function assertStellarCliVersion(output) {
  if (output.split(/\r?\n/)[0] !== `stellar ${VERSION} (${REVISION})`) {
    throw new Error('Unexpected Stellar CLI version or source revision.');
  }
}

export async function readPinnedArchive(file, asset) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== asset.byteLength) throw new Error('Stellar CLI archive length mismatch.');
    const buffer = Buffer.alloc(asset.byteLength + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const bytes = buffer.subarray(0, length);
    assertArchiveIntegrity(bytes, asset);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function downloadArchive(asset) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error('Stellar CLI archive download failed.');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > asset.byteLength) throw new Error('Stellar CLI archive length exceeded the pinned limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

export async function installStellarCli({ cacheDir, installRoot, githubPath = process.env.GITHUB_PATH }) {
  if (!path.isAbsolute(cacheDir) || !path.isAbsolute(installRoot)) {
    throw new Error('Stellar CLI cache and installation roots must be absolute.');
  }
  const asset = stellarCliAsset();
  await mkdir(cacheDir, { recursive: true });
  const archive = path.join(cacheDir, asset.name);
  let cacheHit = true;
  let bytes = await readPinnedArchive(archive, asset).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    cacheHit = false;
    return null;
  });
  bytes ??= await downloadArchive(asset);
  // Cache hits are untrusted until the same fixed checksum check succeeds.
  assertArchiveIntegrity(bytes, asset);
  if (!cacheHit) {
    await writeFile(archive, bytes, { flag: 'wx' }).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      await readPinnedArchive(archive, asset);
    });
  }
  // Extract the verified bytes from a private, fresh directory, never directly
  // from a mutable cache pathname or into a pre-existing executable directory.
  const binDir = await mkdtemp(path.join(installRoot, 'stellarkey-cli-'));
  const verifiedArchive = path.join(binDir, asset.name);
  await writeFile(verifiedArchive, bytes, { flag: 'wx', mode: 0o600 });
  assertArchiveMembers(execFileSync('tar', ['-tzf', verifiedArchive], { encoding: 'utf8' }));
  execFileSync('tar', ['-xzf', verifiedArchive, '-C', binDir, 'stellar']);
  const binary = path.join(binDir, 'stellar');
  await chmod(binary, 0o755);
  assertStellarCliVersion(execFileSync(binary, ['--version'], { encoding: 'utf8' }));
  if (githubPath) await appendFile(githubPath, `${binDir}\n`);
  return { binDir, cacheHit, version: VERSION, revision: REVISION };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--cache-dir' || args[2] !== '--install-root') {
    throw new Error('Usage: install-stellar-cli.mjs --cache-dir ABSOLUTE_PATH --install-root ABSOLUTE_PATH');
  }
  const result = await installStellarCli({ cacheDir: args[1], installRoot: args[3] });
  console.log(`Verified Stellar CLI ${result.version} (${result.revision}); archive cache ${result.cacheHit ? 'hit' : 'miss'}.`);
}
