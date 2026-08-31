import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPrivateBalanceAmount,
  formatPrivateBalanceXlm,
  selectCanSpendPrivateBalance,
  selectTotalShieldedBalance,
  selectUnspentNotes,
} from '../src/features/private-balance/runtime/selectors.ts';
import { parsePrivateAmount } from '../src/features/private-balance/runtime/coin-selection.ts';

const note = (id, value, status = 'unspent') => ({
  id,
  commitment: id,
  value,
  diversifier: '00000000',
  ownerCommitment: '02'.repeat(32),
  leafIndex: 0,
  actionIndex: 0,
  rho: '03'.repeat(32),
  memoHex: '',
  senderFingerprintHex: '',
  status,
  createdAt: 1,
});

test('private balance selectors use exact integer stroops and exclude unavailable notes', () => {
  const state = {
    notes: [
      note('01'.repeat(32), '9007199254740993'),
      note('04'.repeat(32), '5000000', 'reserved'),
      note('05'.repeat(32), '7000000', 'spent'),
    ],
  };
  assert.equal(selectTotalShieldedBalance(state), 9007199254740993n);
  assert.equal(formatPrivateBalanceXlm(9007199254740993n), '900719925.4740993');
  assert.deepEqual(selectUnspentNotes(state).map(value => value.id), ['01'.repeat(32)]);
  assert.throws(() => formatPrivateBalanceXlm(-1n), /non-negative/i);
});

test('private spending is enabled only for a fully current synchronized state', () => {
  const current = {
    account: { syncStatus: 'current' },
  };
  assert.equal(selectCanSpendPrivateBalance(current), true);
  assert.equal(selectCanSpendPrivateBalance({ ...current, account: { syncStatus: 'syncing' } }), false);
  assert.equal(selectCanSpendPrivateBalance({ ...current, account: { syncStatus: 'never' } }), false);
});

test('private amounts parse and format exact generic atomic units', () => {
  assert.equal(formatPrivateBalanceAmount(1234567n, 6), '1.234567');
  assert.equal(formatPrivateBalanceAmount(42n, 0), '42');
  assert.equal(formatPrivateBalanceAmount(1n, 18), '0.000000000000000001');
  assert.equal(parsePrivateAmount('1.234567', 6), 1234567n);
  assert.equal(parsePrivateAmount('42', 0), 42n);
  assert.equal(parsePrivateAmount('0.000000000000000001', 18), 1n);
  assert.throws(() => parsePrivateAmount('1.0000001', 6), /decimal places/i);
  assert.throws(() => parsePrivateAmount('0', 6), /greater than zero/i);
  assert.throws(() => formatPrivateBalanceAmount(-1n, 7), /non-negative/i);
});
