import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { encodePointCompressedZkey } from '../protocol/private-balance/scripts/zkey-point-transport.mjs';
import { expandPointCompressedZkeyTransport } from '../src/lib/private-balance-zkey-transport.ts';
import { validateManifest } from '../src/lib/private-balance-manifest.ts';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('point-compressed zkey transport expands byte-for-byte to the ceremony artifact', async () => {
  const raw = readFileSync('public/protocol/private-balance/v1/circuit.zkey');
  const encoded = await encodePointCompressedZkey(raw);
  assert.ok(encoded.byteLength < raw.byteLength * 0.8);

  const expanded = await expandPointCompressedZkeyTransport(
    encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
    raw.byteLength,
  );
  assert.equal(expanded.byteLength, raw.byteLength);
  assert.equal(sha256(new Uint8Array(expanded)), sha256(raw));
});

test('manifest accepts only bounded point-compressed transport metadata', () => {
  const manifest = JSON.parse(
    readFileSync('public/protocol/private-balance/v1/manifest.json', 'utf8'),
  );
  manifest.artifacts.zkeyTransport = {
    encoding: 'points-compressed',
    sha256: 'ab'.repeat(32),
    byteLength: Math.floor(manifest.artifacts.zkeyByteLength * 0.7),
    wireByteLength: Math.floor(manifest.artifacts.zkeyByteLength * 0.3),
  };
  assert.equal(validateManifest(manifest).artifacts.zkeyTransport.encoding, 'points-compressed');

  manifest.artifacts.zkeyTransport.wireByteLength = manifest.artifacts.zkeyTransport.byteLength + 1;
  assert.throws(() => validateManifest(manifest), /wireByteLength/i);
});
