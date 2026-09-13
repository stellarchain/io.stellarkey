import assert from 'node:assert/strict';
import test from 'node:test';
import { planPrivateWithdrawal } from '../src/features/private-balance/runtime/coin-selection.ts';
const note = (id, value, status = 'unspent') => ({ id: id.toString(16).padStart(64, '0'), commitment: id.toString(16).padStart(64, '0'), value: String(value), leafIndex: BigInt(id), status });

test('a full-balance withdrawal uses only independent full-input exits', () => {
  const notes = [note(1, 3), note(2, 4), note(3, 5), note(4, 6), note(5, 7)];
  const plan = planPrivateWithdrawal(notes, 25n);
  assert.equal(plan.length, 3);
  assert.equal(plan.reduce((sum, step) => sum + BigInt(step.amountStroops), 0n), 25n);
  assert.equal(new Set(plan.flatMap(step => step.noteIds)).size, 5);
  for (const step of plan) {
    assert.ok(step.noteIds.length <= 2);
    assert.equal(step.fullInputExit, true);
    assert.equal(step.inputValueStroops, step.amountStroops);
  }
});

test('partial withdrawal never increases the authorized amount; change is explicit', () => {
  const notes = [note(1, 3), note(2, 4), note(3, 5), note(4, 6), note(5, 7)];
  const plan = planPrivateWithdrawal(notes, 24n);
  assert.equal(plan.reduce((sum, step) => sum + BigInt(step.amountStroops), 0n), 24n);
  assert.equal(plan.at(-1).fullInputExit, false);
  assert.equal(BigInt(plan.at(-1).inputValueStroops) - BigInt(plan.at(-1).amountStroops), 1n);
  assert.ok(plan.slice(0, -1).every(step => step.fullInputExit));
});

test('exit groups stay in the circuit amount range and exclude held notes', () => {
  const max = (1n << 63n) - 1n;
  const plan = planPrivateWithdrawal([note(1, max), note(2, max), note(3, 1, 'reserved')], max * 2n);
  assert.equal(plan.length, 2);
  assert.ok(plan.every(step => step.noteIds.length === 1 && step.amountStroops === max.toString()));
  assert.throws(() => planPrivateWithdrawal([note(1, 3, 'reserved')], 3n), /insufficient/);
  assert.throws(() => planPrivateWithdrawal([note(1, 3)], 0n), /target/);
});

test('the withdrawal driver waits for canonical confirmation between exits', async () => {
  const { runPrivateChainedSend } = await import('../src/features/private-balance/runtime/chained-send.ts');
  const steps = planPrivateWithdrawal([note(1, 3), note(2, 4), note(3, 5)], 12n);
  const calls = [];
  let index = 0;
  const result = await runPrivateChainedSend({
    approval: { id: 'synthetic-exits', steps: steps.length, withdrawalSteps: steps, perStepMaxFeeStroops: '100', cumulativeMaxFeeStroops: '200', expiresAtSeconds: 500 },
    draft: { kind: 'withdraw', amount: '12', publicRecipient: 'SYNTHETIC-NONUSABLE-RECIPIENT' },
    ownFingerprint: '', assetDecimals: 0, now: () => 1000,
    prepare: async draft => {
      calls.push('prepare');
      const step = steps[index++];
      assert.equal(draft.kind, 'withdraw');
      assert.equal(draft.requireFullInputExit, true);
      assert.deepEqual(draft.selectedNoteIds, step.noteIds);
      return { id: String(index), kind: 'withdraw', publicRecipient: draft.publicRecipient,
        selectedNoteIds: [...step.noteIds], amountStroops: step.amountStroops, inputValueStroops: step.inputValueStroops, changeValueStroops: '0',
        transaction: { method: 'full_input_exit', classicFeeStroops: 1n, resourceFeeStroops: 1n } };
    },
    submit: async () => { calls.push('submit'); return { status: 'broadcast', transactionHash: '00'.repeat(32) }; },
    advanceApprovedFee: async () => { calls.push('fee'); },
    awaitConfirmation: async () => { calls.push('confirmed'); return true; },
    cancel: async () => { throw new Error('unexpected cancellation'); },
  });
  assert.deepEqual(calls, ['prepare', 'fee', 'submit', 'confirmed', 'prepare', 'fee', 'submit']);
  assert.equal(result.status, 'broadcast');
});

for (const mutation of ['recipient', 'amount', 'entrypoint', 'duplicate-input', 'fee', 'uncertain', 'unconfirmed']) {
  test(`withdrawal chain stops before another step after ${mutation}`, async () => {
    const { runPrivateChainedSend } = await import('../src/features/private-balance/runtime/chained-send.ts');
    const steps = planPrivateWithdrawal([note(1, 3), note(2, 4), note(3, 5)], 12n);
    let prepared = 0, submitted = 0, cancelled = 0;
    await assert.rejects(runPrivateChainedSend({
      approval: { id: 'synthetic-negative-exits', steps: 2, withdrawalSteps: steps,
        perStepMaxFeeStroops: '100', cumulativeMaxFeeStroops: '200', expiresAtSeconds: 500 },
      draft: { kind: 'withdraw', amount: '12', publicRecipient: 'SYNTHETIC-NONUSABLE-RECIPIENT' },
      ownFingerprint: '', assetDecimals: 0, now: () => 1000,
      prepare: async draft => {
        prepared++;
        const step = steps[0];
        return { id: 'synthetic-step', kind: 'withdraw',
          publicRecipient: mutation === 'recipient' ? 'ALTERED' : draft.publicRecipient,
          selectedNoteIds: mutation === 'duplicate-input' ? [step.noteIds[0], step.noteIds[0]] : [...step.noteIds],
          amountStroops: mutation === 'amount' ? '1' : step.amountStroops,
          inputValueStroops: step.inputValueStroops, changeValueStroops: '0',
          transaction: { method: mutation === 'entrypoint' ? 'withdraw' : 'full_input_exit',
            classicFeeStroops: 1n, resourceFeeStroops: mutation === 'fee' ? 100n : 1n } };
      },
      submit: async () => { submitted++; return { status: mutation === 'uncertain' ? 'ambiguous' : 'broadcast' }; },
      advanceApprovedFee: async () => {},
      awaitConfirmation: async () => mutation !== 'unconfirmed',
      cancel: async () => { cancelled++; },
    }));
    assert.equal(prepared, 1);
    const afterSubmission = ['uncertain', 'unconfirmed'].includes(mutation);
    assert.equal(submitted, afterSubmission ? 1 : 0);
    assert.equal(cancelled, afterSubmission ? 0 : 1);
  });
}
