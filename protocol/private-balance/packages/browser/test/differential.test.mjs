import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldId,
  isCanonicalField,
  bytesToField,
  computeContextHash,
  computeContextField,
  computeAddressContextTag,
} from '../dist/index.js';

test('differential: context derivation consistency', () => {
  const protocolVersion = 1;
  const networkId = new Uint8Array(32).fill(0x01);
  const realmId = new Uint8Array(32).fill(0x02);
  const poolId = new Uint8Array(32).fill(0x03);
  const ctxHash = computeContextHash(protocolVersion, networkId, realmId, poolId);
  assert.equal(ctxHash.length, 32);

  const ctxField = computeContextField(ctxHash);
  assert.equal(ctxField.length, 32);
  assert.equal(isCanonicalField(ctxField), true);

  const tag = computeAddressContextTag(ctxHash);
  assert.equal(tag.length, 16);
});
