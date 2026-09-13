import assert from 'node:assert/strict';
import test from 'node:test';
import { StrKey } from '@stellar/stellar-sdk';
import {
  computeAssetField, computeContextField, computeContextHash,
  deriveExpandedSpendingKey, openRecipientEnvelope,
} from '@stellarkey/private-balance';
import { preparePrivateAction } from '../src/features/private-balance/worker/action-builder.ts';

const bytes = value => new Uint8Array(32).fill(value);
const zero = value => value.every(byte => byte === 0);
const equal = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index]);

async function fixture(outgoingHistory = 'recoverable') {
  const context = { protocolVersion: 2, networkId: bytes(1), realmId: bytes(2), poolId: bytes(3), accountPublicKey: bytes(5) };
  const assetPayload = bytes(4);
  const contextHash = computeContextHash(2, context.networkId, context.realmId, context.poolId);
  const keyContext = { ...context, contextField: computeContextField(contextHash),
    deploymentBindingHash: bytes(9), addressPrefix: 'tskpay_' };
  const esk = await deriveExpandedSpendingKey(new Uint8Array(64).fill(6), 2,
    context.networkId, context.realmId, context.poolId, context.accountPublicKey, keyContext.contextField);
  const memo = Uint8Array.of(7, 8, 9);
  const borrowed = [...Object.values(esk), ...Object.values(keyContext).filter(value => value instanceof Uint8Array), memo]
    .map(value => [value, value.slice()]);
  return {
    input: { esk, keyContext, availableNotes: [], merklePaths: [], intent: { kind: 'deposit', assetIndex: 0,
      assetContractId: StrKey.encodeContract(assetPayload), publicValue: '50',
      depositSource: { kind: 0, payload: context.accountPublicKey }, memo, outgoingHistory } },
    contextHash, assetField: computeAssetField({ kind: 1, payload: assetPayload }),
    assertBorrowed: () => borrowed.forEach(([value, before]) => assert.ok(equal(value, before), 'borrowed input is unchanged')),
  };
}

function observe(t) {
  const notes = new Set();
  const memos = new Set();
  const rhos = new Set();
  const packages = new Set();
  const outgoingPlaintexts = new Set();
  const set = Uint8Array.prototype.set;
  t.mock.method(Uint8Array.prototype, 'set', function (source, offset) {
    const stack = new Error().stack;
    if (this.length === 128 && stack.includes('encodeNotePlaintext')) {
      notes.add(this);
      if (offset === 48) rhos.add(source);
      if (offset === 81) memos.add(source);
    }
    if (this.length === 128 && stack.includes('encodeOutgoingPlaintext')) outgoingPlaintexts.add(this);
    if (this.length === 370 && stack.includes('createOutputPackage')) packages.add(this);
    return set.call(this, source, offset);
  });
  return { notes, memos, rhos, packages, outgoingPlaintexts };
}

function assertCleared(observed, { failed = false, outputs = 1, packages = 0 } = {}) {
  assert.equal(observed.notes.size, outputs, 'observed original note allocation, not a WebCrypto copy');
  assert.equal(observed.packages.size, packages);
  assert.ok([...observed.notes].every(zero), 'owned note plaintext is overwritten');
  assert.ok([...observed.memos].every(zero), 'owned padded memo is overwritten');
  assert.ok([...observed.packages].every(zero), 'owned output package is overwritten');
  assert.ok([...observed.outgoingPlaintexts].every(zero), 'outgoing plaintext is overwritten');
  assert.ok([...observed.rhos].every(value => failed ? zero(value) : !zero(value)),
    failed ? 'failed witness rho is overwritten' : 'successful witness rho remains intact');
}

test('recipient encryption failure clears original note, memo and unreturned rho', async t => {
  const f = await fixture();
  const observed = observe(t);
  const error = new Error('synthetic recipient encryption failure');
  const encryptionInputs = [];
  t.mock.method(crypto.subtle, 'encrypt', async (_algorithm, _key, plaintext) => {
    encryptionInputs.push(plaintext);
    throw error;
  });
  // HPKE retains its existing SealError wrapper; cleanup must not replace it.
  await assert.rejects(preparePrivateAction(f.input), thrown => thrown.message === error.message);
  assert.equal(encryptionInputs.length, 1);
  assertCleared(observed, { failed: true });
  f.assertBorrowed();
});

test('outgoing encryption failure clears note, memo, package and unreturned rho without replacing the error', async t => {
  const f = await fixture();
  const observed = observe(t);
  const error = new Error('synthetic outgoing encryption failure');
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  let calls = 0;
  t.mock.method(crypto.subtle, 'encrypt', async (...args) => {
    calls += 1;
    if (calls === 2) throw error;
    return encrypt(...args);
  });
  await assert.rejects(preparePrivateAction(f.input), thrown => thrown === error);
  assert.equal(calls, 2);
  assertCleared(observed, { failed: true, packages: 1 });
  f.assertBorrowed();
});

for (const mode of ['recoverable', 'minimized']) {
  test(`${mode} output success clears temporary bytes and preserves usable recipient envelopes and witnesses`, async t => {
    const f = await fixture(mode);
    const observed = observe(t);
    const prepared = await preparePrivateAction(f.input);
    assertCleared(observed, { outputs: 3, packages: 3 });
    assert.equal(observed.outgoingPlaintexts.size, mode === 'minimized' ? 0 : 3,
      'minimized mode never constructs outgoing metadata');
    assert.equal(prepared.circuitInputs.outputRho.every(value => value !== '0'), true);
    f.assertBorrowed();
    t.mock.restoreAll();
    const lane = prepared.circuitInputs.outputValue.indexOf('50');
    const output = prepared.action.outputs[lane];
    const note = await openRecipientEnvelope(f.input.esk.hpkePrivateKey, output.recipientEnvelope,
      f.contextHash, f.input.keyContext.contextField, f.assetField, output.cm,
      prepared.action.actionNonce, lane, f.input.esk.baseOwnerCommitment);
    assert.ok(note, 'returned recipient envelope remains decryptable');
    assert.equal(note.value === 50n, true);
    assert.ok(equal(note.memo.subarray(0, 3), f.input.intent.memo));
  });
}

test('rejected commitment retries clear abandoned rho and preserve the successful replacement', async t => {
  const f = await fixture();
  const observed = observe(t);
  const some = Uint8Array.prototype.some;
  const every = Uint8Array.prototype.every;
  const sampled = [];
  let rejected = false;
  t.mock.method(Uint8Array.prototype, 'some', function (...args) {
    const stack = new Error().stack;
    const result = some.apply(this, args);
    if (stack.includes('sampleNonzeroField') && stack.includes('createOutput (') && result) sampled.push(this);
    return result;
  });
  t.mock.method(Uint8Array.prototype, 'every', function (...args) {
    const stack = new Error().stack;
    if (this.length === 32 && stack.includes('isZero (') && stack.includes('createOutput (') && !rejected) {
      rejected = true;
      return true;
    }
    return every.apply(this, args);
  });
  const prepared = await preparePrivateAction(f.input);
  assert.ok(rejected, 'forced one rejected commitment');
  assert.ok(sampled.length >= 4, 'observed rejected and successful rho allocations');
  assert.ok(zero(sampled[0]), 'abandoned rho is overwritten');
  assert.equal(prepared.circuitInputs.outputRho.every(value => value !== '0'), true);
  assertCleared(observed, { outputs: 3, packages: 3 });
  f.assertBorrowed();
});
