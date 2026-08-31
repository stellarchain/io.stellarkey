import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  computeContextField,
  computeContextHash,
  deriveKeysFromSeed,
  encodePrivateAddress,
} from '../dist/index.js';

const workspaceManifest = join(import.meta.dirname, '../../../Cargo.toml');
const fromHex = (value) => Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
const toHex = (value) => Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

test('1,000 seeded Rust and TypeScript key/address derivations agree byte-for-byte', async () => {
  const generated = spawnSync(
    process.env.CARGO ?? 'cargo',
    [
      'run',
      '--quiet',
      '--manifest-path',
      workspaceManifest,
      '-p',
      'private-balance-test-support',
      '--bin',
      'generate-key-address-cases',
      '--',
      '1000',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(generated.status, 0, generated.stderr || 'Rust vector generator failed');
  const cases = JSON.parse(generated.stdout);
  assert.equal(cases.length, 1000);

  for (const item of cases) {
    const networkId = fromHex(item.networkId);
    const realmId = fromHex(item.realmId);
    const poolId = fromHex(item.poolId);
    const accountPublicKey = fromHex(item.accountPublicKey);
    const contextHash = computeContextHash(1, networkId, realmId, poolId);
    const contextField = computeContextField(contextHash);
    const keys = await deriveKeysFromSeed(
      fromHex(item.rawSeed),
      1,
      networkId,
      realmId,
      poolId,
      accountPublicKey,
      contextField,
    );
    const address = encodePrivateAddress(
      {
        diversifier: fromHex(item.diversifier),
        ownerCommitment: keys.ownerCommitment,
        hpkePublicKey: keys.hpkePublicKey,
      },
      item.prefix,
    );

    assert.equal(toHex(contextHash), item.contextHash);
    assert.equal(toHex(contextField), item.contextField);
    assert.equal(toHex(keys.baseOwnerCommitment), item.baseOwnerCommitment);
    assert.equal(toHex(keys.ask), item.ask);
    assert.equal(toHex(keys.nk), item.nk);
    assert.equal(toHex(keys.ownerCommitment), item.ownerCommitment);
    assert.equal(toHex(keys.hpkePrivateKey), item.hpkePrivateKey);
    assert.equal(toHex(keys.hpkePublicKey), item.hpkePublicKey);
    assert.equal(address, item.address);
  }
});
