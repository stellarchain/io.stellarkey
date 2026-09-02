import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  consumePrivateAddIntent,
  consumePrivateSendIntent,
  isPrivateReceiveAddressLike,
  isStealthMetaAddressLike,
  requestPrivateAdd,
  requestPrivateSend,
} from '../src/lib/private-address.ts';

test('recognizes only canonical-shape compact private payment addresses', () => {
  const body = '2'.repeat(121);
  assert.equal(isPrivateReceiveAddressLike(`tskpay_${body}`), true);
  assert.equal(isPrivateReceiveAddressLike(`skpay_${body}`), true);
  assert.equal(isPrivateReceiveAddressLike(`tks1${body}`), false);
  assert.equal(isPrivateReceiveAddressLike(`tskpay_${'2'.repeat(120)}`), false);
  assert.equal(isPrivateReceiveAddressLike(`tskpay_${'0'.repeat(121)}`), false);
  assert.equal(isPrivateReceiveAddressLike(` tskpay_${body}`), true);
});

test('recognizes only canonical-shape reusable private recipient handles', () => {
  const payload = 'q'.repeat(160);
  assert.equal(isStealthMetaAddressLike(`tsm1${payload}`), true);
  assert.equal(isStealthMetaAddressLike(`ssm1${payload}`), true);
  assert.equal(isStealthMetaAddressLike(`TSM1${payload}`), false);
  assert.equal(isStealthMetaAddressLike(`tsm1${'q'.repeat(159)}`), false);
  assert.equal(isStealthMetaAddressLike(`tsm1${'b'.repeat(160)}`), false);
  assert.equal(isStealthMetaAddressLike(` tsm1${payload}`), true);
});

test('private flow handoffs are single-use memory values rather than Web Storage records', () => {
  globalThis.window = { dispatchEvent() {} };
  requestPrivateSend(`tsm1${'q'.repeat(160)}`);
  requestPrivateAdd('12.5');
  assert.equal(consumePrivateSendIntent(), `tsm1${'q'.repeat(160)}`);
  assert.equal(consumePrivateSendIntent(), null);
  assert.equal(consumePrivateAddIntent(), '12.5');
  assert.equal(consumePrivateAddIntent(), null);

  const source = readFileSync(new URL('../src/lib/private-address.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sessionStorage/);
});
