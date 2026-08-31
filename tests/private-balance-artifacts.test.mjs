import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import {
  computeSha256,
  fetchAndVerifyArtifact,
  loadCircuitArtifacts,
} from '../src/lib/private-balance-artifacts.ts';
import { validateManifest } from '../src/lib/private-balance-manifest.ts';

const exactArrayBuffer = buffer => buffer.buffer.slice(
  buffer.byteOffset,
  buffer.byteOffset + buffer.byteLength,
);

test('artifacts: verification of proving and local-verification files against manifest hashes', async () => {
  const manifestPath = join(process.cwd(), 'public/protocol/private-balance/v1/manifest.json');
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));

  const wasmPath = join(process.cwd(), 'public/protocol/private-balance/v1/circuit.wasm');
  const wasmBuffer = exactArrayBuffer(readFileSync(wasmPath));
  const wasmHash = await computeSha256(wasmBuffer);
  assert.equal(wasmHash, manifest.artifacts.wasmSha256);

  const zkeyPath = join(process.cwd(), 'public/protocol/private-balance/v1/circuit.zkey');
  const zkeyBuffer = exactArrayBuffer(readFileSync(zkeyPath));
  const zkeyHash = await computeSha256(zkeyBuffer);
  assert.equal(zkeyHash, manifest.artifacts.zkeySha256);

  const zkeyTransportPath = join(process.cwd(), 'public/protocol/private-balance/v1/circuit.zkey.pc');
  const zkeyTransportBytes = readFileSync(zkeyTransportPath);
  const zkeyTransportBuffer = exactArrayBuffer(zkeyTransportBytes);
  const zkeyTransportHash = await computeSha256(zkeyTransportBuffer);
  assert.equal(zkeyTransportHash, manifest.artifacts.zkeyTransport.sha256);
  assert.equal(zkeyTransportBuffer.byteLength, manifest.artifacts.zkeyTransport.byteLength);
  const wireBytes = brotliCompressSync(zkeyTransportBytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
  assert.equal(wireBytes.byteLength, manifest.artifacts.zkeyTransport.wireByteLength);

  const verificationKeyPath = join(
    process.cwd(),
    'public/protocol/private-balance/v1/verification-key.json',
  );
  const verificationKeyBuffer = exactArrayBuffer(readFileSync(verificationKeyPath));
  const verificationKeyHash = await computeSha256(verificationKeyBuffer);
  assert.equal(verificationKeyHash, manifest.artifacts.vkJsonSha256);
});

test('artifacts: downloads point-compressed transport and returns the verified raw proving key', async () => {
  const manifestPath = join(process.cwd(), 'public/protocol/private-balance/v1/manifest.json');
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const rawZkey = readFileSync(join(
    process.cwd(),
    'public/protocol/private-balance/v1/circuit.zkey',
  ));
  const transport = readFileSync(join(
    process.cwd(),
    'public/protocol/private-balance/v1/circuit.zkey.pc',
  ));
  const files = new Map([
    [manifest.artifacts.wasmSha256, readFileSync(join(
      process.cwd(),
      'public/protocol/private-balance/v1/circuit.wasm',
    ))],
    [manifest.artifacts.zkeyTransport.sha256, transport],
    [manifest.artifacts.vkJsonSha256, readFileSync(join(
      process.cwd(),
      'public/protocol/private-balance/v1/verification-key.json',
    ))],
  ]);
  const originalFetch = globalThis.fetch;
  const requestedPaths = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url, 'https://wallet.example.test');
    requestedPaths.push(parsed.pathname);
    const body = files.get(parsed.searchParams.get('sha256'));
    assert.ok(body, `unexpected artifact fetch for ${url}`);
    return new Response(body, {
      status: 200,
      headers: { 'content-length': String(body.byteLength) },
    });
  };
  try {
    const loaded = await loadCircuitArtifacts(manifest, undefined, null);
    assert.deepEqual(Buffer.from(loaded.zkeyBuffer), rawZkey);
    assert.ok(requestedPaths.includes('/protocol/private-balance/v1/circuit.zkey.pc'));
    assert.ok(!requestedPaths.includes('/protocol/private-balance/v1/circuit.zkey'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('artifacts: rejects point-compressed transport with a forged expanded size', async () => {
  const manifestPath = join(process.cwd(), 'public/protocol/private-balance/v1/manifest.json');
  const source = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const transport = Buffer.from(readFileSync(join(
    process.cwd(),
    'public/protocol/private-balance/v1/circuit.zkey.pc',
  )));
  transport.writeUInt32LE(source.artifacts.zkeyByteLength - 1, 8);
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  source.artifacts = {
    ...source.artifacts,
    zkeyTransport: {
      ...source.artifacts.zkeyTransport,
      sha256: sha256(transport),
    },
  };
  const manifest = validateManifest(source);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const parsed = new URL(url, 'https://wallet.example.test');
    if (parsed.pathname.endsWith('circuit.zkey.pc')) return new Response(transport);
    const path = parsed.pathname.endsWith('circuit.wasm')
      ? 'public/protocol/private-balance/v1/circuit.wasm'
      : 'public/protocol/private-balance/v1/verification-key.json';
    return new Response(readFileSync(join(process.cwd(), path)));
  };
  try {
    await assert.rejects(
      () => loadCircuitArtifacts(manifest, undefined, null),
      /invalid expanded size/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('artifacts: rejects oversized remote bodies before consuming them', async () => {
  const originalFetch = globalThis.fetch;
  let bodyRead = false;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': '100' }),
    body: {
      getReader() {
        bodyRead = true;
        throw new Error('body should not be read');
      },
    },
  });
  try {
    await assert.rejects(
      () => fetchAndVerifyArtifact('/oversized', '00'.repeat(32), undefined, 4),
      /size exceeds/i,
    );
    assert.equal(bodyRead, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('artifacts: content-addressed cache serves verified copies and dedupes loads', async () => {
  const manifestPath = join(process.cwd(), 'public/protocol/private-balance/v1/manifest.json');
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const files = {
    [manifest.artifacts.wasmSha256]:
      exactArrayBuffer(readFileSync(join(process.cwd(), 'public/protocol/private-balance/v1/circuit.wasm'))),
    [manifest.artifacts.zkeyTransport.sha256]:
      exactArrayBuffer(readFileSync(join(process.cwd(), 'public/protocol/private-balance/v1/circuit.zkey.pc'))),
    [manifest.artifacts.vkJsonSha256]:
      exactArrayBuffer(readFileSync(join(process.cwd(), 'public/protocol/private-balance/v1/verification-key.json'))),
  };
  const entries = new Map();
  const cache = {
    async read(sha256) { return entries.get(sha256) ?? null; },
    async write(sha256, buffer) { entries.set(sha256, buffer.slice(0)); },
  };
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    fetches += 1;
    const sha256 = new URL(url, 'https://wallet.example.test').searchParams.get('sha256');
    const body = files[sha256];
    assert.ok(body, `unexpected artifact fetch for ${url}`);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(body.byteLength) }),
      body: null,
      async arrayBuffer() { return body.slice(0); },
    };
  };
  try {
    // Concurrent loads share one in-flight download set.
    const [first, deduped] = await Promise.all([
      loadCircuitArtifacts(manifest, undefined, cache),
      loadCircuitArtifacts(manifest, undefined, cache),
    ]);
    assert.equal(fetches, 3);
    assert.equal(first.wasmBuffer.byteLength, manifest.artifacts.wasmByteLength);
    assert.equal(deduped.zkeyBuffer.byteLength, manifest.artifacts.zkeyByteLength);
    assert.equal(entries.size, 3);

    // A warm cache answers without touching the network at all.
    globalThis.fetch = async () => { throw new Error('cache hit must not fetch'); };
    const cached = await loadCircuitArtifacts(manifest, undefined, cache);
    assert.equal(cached.wasmBuffer.byteLength, manifest.artifacts.wasmByteLength);
    assert.equal(cached.verificationKey.protocol, 'groth16');

    // A poisoned cache entry is re-verified, rejected, and refetched.
    entries.set(manifest.artifacts.wasmSha256, new ArrayBuffer(8));
    fetches = 0;
    globalThis.fetch = async url => {
      fetches += 1;
      const sha256 = new URL(url, 'https://wallet.example.test').searchParams.get('sha256');
      const body = files[sha256];
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': String(body.byteLength) }),
        body: null,
        async arrayBuffer() { return body.slice(0); },
      };
    };
    const repaired = await loadCircuitArtifacts(manifest, undefined, cache);
    assert.equal(fetches, 1);
    assert.equal(repaired.wasmBuffer.byteLength, manifest.artifacts.wasmByteLength);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
