import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePrivateAmount,
  selectPrivateNotes,
} from '../src/features/private-balance/runtime/coin-selection.ts';

const note = (id, value, status = 'unspent') => ({
  id: id.toString(16).padStart(64, '0'),
  commitment: id.toString(16).padStart(64, '0'),
  value: value.toString(),
  diversifier: '00000000',
  ownerCommitment: '01'.repeat(32),
  leafIndex: id,
  actionIndex: 0,
  rho: '02'.repeat(32),
  memoHex: '',
  senderFingerprintHex: '',
  status,
  createdAt: 0,
});

test('private amounts parse exactly to positive stroops', () => {
  assert.equal(parsePrivateAmount('1.0000001'), 10_000_001n);
  assert.throws(() => parsePrivateAmount('0'), /greater than zero/);
  assert.throws(() => parsePrivateAmount('1.00000001'), /7 decimal places/);
});

test('coin selection prefers one note, then the smallest sufficient pair', () => {
  const notes = [note(1, 4), note(2, 7), note(3, 11), note(4, 15, 'spent')];
  assert.deepEqual(selectPrivateNotes(notes, 7n), {
    kind: 'selected',
    noteIds: [notes[1].id],
    inputValue: 7n,
    changeValue: 0n,
  });
  assert.deepEqual(selectPrivateNotes(notes, 10n), {
    kind: 'selected',
    noteIds: [notes[2].id],
    inputValue: 11n,
    changeValue: 1n,
  });
  assert.deepEqual(selectPrivateNotes(notes.slice(0, 2), 10n), {
    kind: 'selected',
    noteIds: [notes[0].id, notes[1].id],
    inputValue: 11n,
    changeValue: 1n,
  });
});

test('coin selection distinguishes consolidation from insufficient balance', () => {
  const notes = [note(1, 4), note(2, 4), note(3, 4)];
  assert.deepEqual(selectPrivateNotes(notes, 10n), {
    kind: 'consolidation-required',
    availableValue: 12n,
    inputCount: 3,
    actionCount: 2,
  });
  assert.deepEqual(selectPrivateNotes(notes, 13n), {
    kind: 'insufficient',
    availableValue: 12n,
    missingValue: 1n,
  });
});
