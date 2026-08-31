import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPrivateActionRecovery,
  PRIVATE_ACTION_EXPIRY_MARGIN_SECONDS,
} from '../src/features/private-balance/runtime/submission.ts';

const action = {
  actionField: '01'.repeat(32),
  nullifiers: ['02'.repeat(32), '03'.repeat(32)],
};

test('ambiguous recovery never releases inputs without a definitive chain outcome', () => {
  assert.equal(classifyPrivateActionRecovery(action, 'NOT_FOUND', [], []), 'ambiguous');
  assert.equal(
    classifyPrivateActionRecovery(action, 'FAILED', [], [action.nullifiers[0]]),
    'ambiguous',
  );
  assert.equal(
    classifyPrivateActionRecovery(action, 'NOT_FOUND', [action.actionField], action.nullifiers),
    'confirmed',
  );
});

test('time-bound finality releases only past envelope expiry with canonical absence', () => {
  const expiring = { ...action, expiresAtSeconds: 1_000 };
  const closedPastExpiry = 1_000 + PRIVATE_ACTION_EXPIRY_MARGIN_SECONDS + 1;
  // Missing expiry or head close time keeps the conservative outcome.
  assert.equal(classifyPrivateActionRecovery(action, 'NOT_FOUND', [], [], closedPastExpiry), 'ambiguous');
  assert.equal(classifyPrivateActionRecovery(expiring, 'NOT_FOUND', [], []), 'ambiguous');
  // The verified head must close beyond expiry plus the safety margin.
  assert.equal(
    classifyPrivateActionRecovery(expiring, 'NOT_FOUND', [], [], 1_000 + PRIVATE_ACTION_EXPIRY_MARGIN_SECONDS),
    'ambiguous',
  );
  assert.equal(classifyPrivateActionRecovery(expiring, 'NOT_FOUND', [], [], closedPastExpiry), 'release');
  // An observed input nullifier or a confirmed action field still wins.
  assert.equal(
    classifyPrivateActionRecovery(expiring, 'NOT_FOUND', [], [action.nullifiers[0]], closedPastExpiry),
    'ambiguous',
  );
  assert.equal(
    classifyPrivateActionRecovery(expiring, 'NOT_FOUND', [action.actionField], [], closedPastExpiry),
    'confirmed',
  );
  // An unreachable RPC never releases.
  assert.equal(classifyPrivateActionRecovery(expiring, 'UNAVAILABLE', [], [], closedPastExpiry), 'ambiguous');
});
