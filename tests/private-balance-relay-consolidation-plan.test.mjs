import assert from 'node:assert/strict';
import test from 'node:test';
import { planPrivateRelayConsolidation } from '../src/features/private-balance/runtime/relay-consolidation-plan.ts';

const ASSET = 'synthetic-asset';
const MAX = (1n << 63n) - 1n;
function note(index, value, overrides = {}) {
  const id = index.toString(16).padStart(64, '0');
  return { id, commitment: id, value: String(value), leafIndex: index,
    assetContractId: ASSET, status: 'unspent', ...overrides };
}
function plan(values, amountAtomic, perStepMaxPrivateFeeAtomic = 1n) {
  return planPrivateRelayConsolidation({
    notes: values.map((value, index) => note(index + 1, value)),
    assetContractId: ASSET, amountAtomic, perStepMaxPrivateFeeAtomic,
  });
}

test('relay consolidation plans the minimum largest-pair chain after every private fee', () => {
  const result = plan([4n, 4n, 4n], 10n);
  assert.equal(result.steps, 2);
  assert.equal(result.cumulativeMaxPrivateFeeAtomic, '2');
  assert.equal(result.merges.length, 1);
  assert.deepEqual(result.merges[0], {
    left: `note:${note(1, 4).id}`, right: `note:${note(2, 4).id}`,
    output: 'merge:0', minimumOutputValue: '7', maximumOutputValue: '8',
  });
  assert.deepEqual(new Set(result.finalInputs), new Set(['merge:0', `note:${note(3, 4).id}`]));
  assert.equal(result.inputNotes.length, 3);
  assert.throws(() => plan([4n, 4n, 4n], 11n), /insufficient/i);
  assert.throws(() => plan([4n, 4n], 6n), /does not need consolidation/i);
});

test('relay plan bounds both worst-case fees and cheaper subsequent quotes', () => {
  const result = plan([6n, 6n, 6n, 6n], 18n, 2n);
  assert.equal(result.steps, 3);
  assert.equal(result.cumulativeMaxPrivateFeeAtomic, '6');
  assert.deepEqual(result.merges.map(merge => [merge.minimumOutputValue, merge.maximumOutputValue]),
    [['10', '12'], ['14', '18']]);
  assert.throws(() => plan([6n, 6n, 6n, 6n], 19n, 2n), /insufficient/i);
  assert.throws(() => plan([MAX / 2n, MAX / 2n, MAX / 2n], MAX - 1n), /range|bound|overflow/i);
});

test('relay consolidation cannot consume another asset, reserved notes, or later arrivals', () => {
  const notes = [note(1, 4), note(2, 4), note(3, 4),
    note(4, 100, { assetContractId: 'other-asset' }), note(5, 100, { status: 'reserved' }),
    note(6, 100, { status: 'spent' }), note(7, 1)];
  const before = structuredClone(notes);
  const result = planPrivateRelayConsolidation({ notes, assetContractId: ASSET,
    amountAtomic: 10n, perStepMaxPrivateFeeAtomic: 1n });
  assert.deepEqual(result.inputNotes.map(input => input.id).sort(), [1, 2, 3].map(index => note(index, 4).id));
  assert.deepEqual(notes, before);
});

test('relay consolidation has an exact 64-transaction bound', () => {
  const allowed = plan(Array(65).fill(2n), 66n);
  assert.equal(allowed.steps, 64);
  assert.equal(allowed.merges.length, 63);
  assert.equal(allowed.cumulativeMaxPrivateFeeAtomic, '64');
  assert.throws(() => plan(Array(66).fill(2n), 67n), /step|64/i);
});

test('relay consolidation rejects malformed amounts, fees, duplicate notes and unproductive merges', () => {
  for (const amount of [0n, -1n, MAX]) assert.throws(() => plan([4n, 4n, 4n], amount), /range|invalid|bound/i);
  for (const fee of [0n, -1n, MAX + 1n]) assert.throws(() => plan([4n, 4n, 4n], 10n, fee), /fee|invalid|range/i);
  for (const value of [0n, -1n, MAX + 1n]) assert.throws(() => plan([value, 4n, 4n], 10n), /note|range|invalid/i);
  assert.throws(() => plan(Array(10).fill(1n), 2n), /insufficient/i);
  assert.throws(() => planPrivateRelayConsolidation({
    notes: [note(1, 4), note(1, 4), note(2, 4)], assetContractId: ASSET,
    amountAtomic: 10n, perStepMaxPrivateFeeAtomic: 1n,
  }), /duplicate/i);
});

test('fixed relay traces conserve funds across cheaper quotes without consuming inputs twice', () => {
  let randomState = 71;
  const next = bound => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState % bound;
  };
  let executed = 0;
  for (let trial = 0; trial < 200; trial += 1) {
    const values = Array.from({ length: 3 + next(12) }, () => BigInt(10 + next(90)));
    const fee = BigInt(1 + next(5));
    const amount = values.reduce((sum, value) => sum + value, 0n) - BigInt(values.length) * fee;
    let result;
    try { result = plan(values, amount, fee); } catch (error) {
      assert.match(error.message, /does not need consolidation|insufficient/);
      continue;
    }
    const unspent = new Map(result.inputNotes.map(note => [`note:${note.id}`, BigInt(note.value)]));
    let paid = 0n;
    for (const merge of result.merges) {
      assert.notEqual(merge.left, merge.right);
      assert.ok(unspent.has(merge.left) && unspent.has(merge.right));
      const inputs = unspent.get(merge.left) + unspent.get(merge.right);
      const actualFee = 1n + BigInt(next(Number(fee)));
      paid += actualFee;
      const output = inputs - actualFee;
      assert.ok(inputs <= MAX && output >= BigInt(merge.minimumOutputValue) && output <= BigInt(merge.maximumOutputValue));
      unspent.delete(merge.left);
      unspent.delete(merge.right);
      assert.ok(!unspent.has(merge.output));
      unspent.set(merge.output, output);
    }
    assert.equal(new Set(result.finalInputs).size, result.finalInputs.length);
    const finalValue = result.finalInputs.reduce((sum, ref) => {
      assert.ok(unspent.has(ref));
      return sum + unspent.get(ref);
    }, 0n);
    assert.ok(finalValue >= amount + fee && finalValue <= MAX);
    assert.ok(paid + fee <= BigInt(result.cumulativeMaxPrivateFeeAtomic));
    const reversed = planPrivateRelayConsolidation({
      notes: values.map((value, index) => note(index + 1, value)).reverse(),
      assetContractId: ASSET, amountAtomic: amount, perStepMaxPrivateFeeAtomic: fee,
    });
    assert.deepEqual(reversed, result);
    executed += 1;
  }
  assert.ok(executed >= 150);
});

test('relay consolidation chooses a legal pair when the two largest notes would overflow', () => {
  const unit = MAX / 100n;
  const result = plan([60n * unit, 55n * unit, 20n * unit, 20n * unit], 90n * unit - 1n);
  assert.equal(result.steps, 2);
  assert.equal(result.merges[0].minimumOutputValue, String(80n * unit - 1n));
  assert.equal(result.merges[0].maximumOutputValue, String(80n * unit));
  assert.equal(result.inputNotes.length, 3);
});

test('relay plan rejects type-coerced note identities and values', () => {
  for (const malformed of [{ value: 4 }, { id: 123 }, { commitment: 123 }, { value: '0'.repeat(10000) }]) {
    assert.throws(() => planPrivateRelayConsolidation({
      notes: [note(1, 4, malformed), note(2, 4), note(3, 4)], assetContractId: ASSET,
      amountAtomic: 10n, perStepMaxPrivateFeeAtomic: 1n,
    }), /note.*invalid/i);
  }
});

test('relay plan rejects non-bigint payment and fee values before arithmetic', () => {
  for (const amount of ['10', 10, null, undefined]) {
    assert.throws(() => plan([40n, 40n, 40n], amount), /amount.*invalid/i);
  }
  for (const fee of ['1', 1, null]) {
    assert.throws(() => plan([40n, 40n, 40n], 10n, fee), /fee.*invalid/i);
  }
});
