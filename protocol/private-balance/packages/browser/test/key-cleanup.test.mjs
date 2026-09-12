import assert from 'node:assert/strict';
import test from 'node:test';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { deriveExpandedSpendingKey } from '../dist/keys.js';

const zero = bytes => bytes.every(byte => byte === 0);
const equal = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index]);
const protocolCaller = () => new Error().stack.split('\n').find(line => line.includes('/dist/')) ?? '';
function fixture() {
  const inputs = [new Uint8Array(64).fill(6), 1, ...[1, 2, 3, 5, 7].map(value => new Uint8Array(32).fill(value))];
  const borrowed = inputs.filter(value => value instanceof Uint8Array).map(bytes => [bytes, bytes.slice()]);
  return { inputs, assertBorrowed: () => borrowed.forEach(([bytes, before]) => assert.ok(equal(bytes, before), 'borrowed input is unchanged')) };
}

// Retain only actual owned arrays at known allocation/use boundaries. There are
// no production observers; every prototype wrapper is restored by node:test.
function observe(t, { failCopy, failDefaultAddress } = {}) {
  const scratch = new Set();
  const expanded = [];
  const fields = [];
  const discardedPrivate = [];
  const set = Uint8Array.prototype.set;
  const slice = Uint8Array.prototype.slice;
  const every = Uint8Array.prototype.every;
  t.mock.method(Uint8Array.prototype, 'set', function (source, offset) {
    const caller = protocolCaller();
    if (caller.includes('hkdfExpand') && this.length === 64 && source.length === 64) {
      scratch.add(this); scratch.add(source);
      set.call(this, source, offset);
      if (failCopy) throw failCopy;
      return;
    }
    if (caller.includes('computeDiversifiedOwnerCommitment') && failDefaultAddress) throw failDefaultAddress;
    if (caller.includes('encodeX25519PrivateKeyPkcs8') && offset === 16) discardedPrivate.push(source);
    return set.call(this, source, offset);
  });
  t.mock.method(Uint8Array.prototype, 'slice', function (...args) {
    const result = slice.apply(this, args);
    if (protocolCaller().includes('hkdfExpand')) expanded.push(result);
    return result;
  });
  t.mock.method(Uint8Array.prototype, 'every', function (...args) {
    if (protocolCaller().includes('deriveNonzeroField')) fields.push(this);
    return every.apply(this, args);
  });
  return { scratch, expanded, fields, discardedPrivate };
}

test('SHA-512 expansion wipes scratch and field-expansion bytes while preserving returned keys and borrowed inputs', async t => {
  const f = fixture();
  const expected = await deriveExpandedSpendingKey(...f.inputs);
  const observed = observe(t);
  const actual = await deriveExpandedSpendingKey(...f.inputs);
  assert.ok(observed.scratch.size >= 10, 'observed each SHA-512 expansion source and target');
  assert.ok([...observed.scratch].every(zero), 'SHA-512 scratch is overwritten');
  assert.ok(observed.expanded.filter(bytes => bytes.length === 64).every(zero), 'unreturned scalar expansion is overwritten');
  for (const name of Object.keys(expected)) assert.ok(equal(actual[name], expected[name]), 'returned key field is unchanged');
  f.assertBorrowed();
});

test('SHA-512 expansion copy failure wipes allocated scratch and preserves the original error', async t => {
  const error = new Error('synthetic expansion copy failure');
  const f = fixture();
  const observed = observe(t, { failCopy: error });
  await assert.rejects(deriveExpandedSpendingKey(...f.inputs), thrown => thrown === error);
  assert.equal(observed.scratch.size, 2);
  assert.ok([...observed.scratch].every(zero), 'failed expansion scratch is overwritten');
  f.assertBorrowed();
});

test('expanded-key success clears discarded default-address private bytes without clearing returned incoming material', async t => {
  const f = fixture();
  const observed = observe(t);
  const key = await deriveExpandedSpendingKey(...f.inputs);
  assert.equal(observed.discardedPrivate.length, 1, 'captured the scalar copied into native key import');
  assert.ok(observed.discardedPrivate.every(zero), 'discarded child private scalar is overwritten');
  assert.ok(!zero(key.hpkePrivateKey));
  assert.ok(!zero(key.ask) && !zero(key.nk) && !zero(key.outgoingViewingKey));
  f.assertBorrowed();
});

test('default-address failure clears partial key fields and serialized incoming bytes, preserving borrowed inputs and error', async t => {
  const error = new Error('synthetic default address failure');
  const f = fixture();
  const observed = observe(t, { failDefaultAddress: error });
  const serialized = [];
  const serialize = DhkemX25519HkdfSha256.prototype.serializePrivateKey;
  t.mock.method(DhkemX25519HkdfSha256.prototype, 'serializePrivateKey', async function (...args) {
    const buffer = await serialize.apply(this, args);
    serialized.push(new Uint8Array(buffer));
    return buffer;
  });
  await assert.rejects(deriveExpandedSpendingKey(...f.inputs), thrown => thrown === error);
  assert.equal(serialized.length, 1);
  assert.equal(observed.fields.length, 2);
  assert.ok(serialized.every(zero), 'unreturned incoming material is overwritten');
  assert.ok(observed.fields.every(zero), 'unreturned spending fields are overwritten');
  assert.ok(observed.expanded.every(zero), 'unreturned expansion results are overwritten');
  f.assertBorrowed();
});

test('a rejected owner scalar is overwritten before retry while the replacement remains usable', async t => {
  const f = fixture();
  const observed = observe(t);
  const every = Uint8Array.prototype.every;
  let rejected = false;
  t.mock.method(Uint8Array.prototype, 'every', function (...args) {
    const caller = protocolCaller();
    if (caller.includes('deriveExpandedSpendingKey') && !rejected) { rejected = true; return true; }
    return every.apply(this, args);
  });
  const key = await deriveExpandedSpendingKey(...f.inputs);
  assert.ok(rejected);
  assert.equal(observed.fields.length, 3);
  assert.ok(zero(observed.fields[1]), 'rejected ask scalar is overwritten');
  assert.ok(observed.fields[2] === key.ask, 'replacement ownership transfers to caller');
  assert.ok(observed.expanded.filter(bytes => bytes.length === 64).every(zero), 'retry expansions are overwritten');
  assert.ok(!zero(key.ask) && !zero(key.nk));
  f.assertBorrowed();
});
