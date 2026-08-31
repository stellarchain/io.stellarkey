import assert from 'node:assert/strict';
import test from 'node:test';
import { isStealthMetaAddressLike } from '../src/lib/private-address.ts';

test('recognizes only canonical-shape reusable private recipient handles', () => {
  const payload = 'q'.repeat(109);
  assert.equal(isStealthMetaAddressLike(`tsm1${payload}`), true);
  assert.equal(isStealthMetaAddressLike(`ssm1${payload}`), true);
  assert.equal(isStealthMetaAddressLike(`TSM1${payload}`), false);
  assert.equal(isStealthMetaAddressLike(`tsm1${'q'.repeat(108)}`), false);
  assert.equal(isStealthMetaAddressLike(`tsm1${'b'.repeat(109)}`), false);
  assert.equal(isStealthMetaAddressLike(` tsm1${payload}`), true);
});
