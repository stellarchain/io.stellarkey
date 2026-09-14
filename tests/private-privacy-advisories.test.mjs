import assert from 'node:assert/strict';
import test from 'node:test';
import { privatePrivacyAdvisories } from '../src/features/private-balance/runtime/privacy-advisories.ts';

const now = 2_000_000_000_000;
const deposit = { actionKind: 'deposit', direction: 'inflow', assetContractId: 'synthetic-asset', amount: '10000000', timestamp: now - 60_000 };
const evaluate = (changes = {}) => privatePrivacyAdvisories({ kind: 'withdraw', amount: 10000000n,
  decimals: 7, assetContractId: 'synthetic-asset', activities: [deposit], now, ...changes });

test('matching and recent deposits produce independent local advice', () => {
  assert.deepEqual(evaluate(), ['matching-deposit', 'recent-deposit']);
  assert.deepEqual(evaluate({ amount: 20000000n }), ['recent-deposit']);
  assert.deepEqual(evaluate({ activities: [{ ...deposit, timestamp: 0 }] }), ['matching-deposit']);
});

test('unknown, future and invalid timestamps never imply a recent deposit', () => {
  for (const timestamp of [0, -1, NaN, Infinity, now + 1, now - 86_400_000]) {
    assert.deepEqual(evaluate({ activities: [{ ...deposit, timestamp }] }), ['matching-deposit']);
  }
  assert.deepEqual(evaluate({ now: NaN }), ['matching-deposit']);
});

test('other assets, non-deposits, and non-inflows are excluded', () => {
  for (const change of [{ assetContractId: 'other-issuer' }, { actionKind: 'transfer' },
    { actionKind: 'withdraw' }, { direction: 'outflow' }, { direction: 'internal' }]) {
    assert.deepEqual(evaluate({ activities: [{ ...deposit, ...change }] }), []);
  }
});

test('missing, zero, invalid or negative amounts yield no advice or exception', () => {
  for (const amount of [null, 0n, -1n]) assert.deepEqual(evaluate({ amount }), []);
  for (const amount of ['', 'x', '-1', '0', '1.2', '1e7', '1'.repeat(30)]) {
    assert.deepEqual(evaluate({ activities: [{ ...deposit, amount }] }), []);
  }
  assert.deepEqual(evaluate({ assetContractId: null }), []);
});

test('comparison is exact above Number.MAX_SAFE_INTEGER', () => {
  assert.deepEqual(evaluate({ amount: 9007199254740993n,
    activities: [{ ...deposit, amount: '9007199254740992', timestamp: 0 }] }), []);
  assert.deepEqual(evaluate({ amount: 9007199254740993n,
    activities: [{ ...deposit, amount: '9007199254740993', timestamp: 0 }] }), ['matching-deposit']);
});

test('deposit precision advice respects asset decimals and never changes the amount', () => {
  assert.deepEqual(evaluate({ kind: 'deposit', amount: 12345678n }), ['precise-deposit']);
  assert.deepEqual(evaluate({ kind: 'deposit', amount: 12300000n }), []);
  assert.deepEqual(evaluate({ kind: 'deposit', amount: 123n, decimals: 2 }), []);
  assert.deepEqual(evaluate({ kind: 'deposit', amount: 123n, decimals: 3 }), ['precise-deposit']);
  for (const decimals of [-1, 1.5, 19, NaN]) assert.deepEqual(evaluate({ kind: 'deposit', decimals }), []);
});

test('shielded transfers never receive public-boundary amount advice', () => {
  assert.deepEqual(evaluate({ kind: 'transfer' }), []);
});

test('advice is deduplicated and leaves supplied history unchanged', () => {
  const activities = Object.freeze([Object.freeze({ ...deposit }), Object.freeze({ ...deposit })]);
  assert.deepEqual(evaluate({ activities }), ['matching-deposit', 'recent-deposit']);
  assert.equal(activities.length, 2);
  assert.equal(activities[0].timestamp, deposit.timestamp);
});
