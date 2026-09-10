import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PrivateActionReviewExpiredError } from '../src/features/private-balance/runtime/submission.ts';
import { PrivateProofExposedError } from '../src/features/private-balance/runtime/proof-exposure.ts';
const lifecycle = await import('../src/features/private-balance/components/private-action-operation.ts').catch(() => ({}));

function submissionHandler(context) {
  const source = readFileSync(new URL('../src/features/private-balance/components/usePrivateActionController.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'submit' &&
      node.initializer && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0]?.getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression, 'exercise the actual controller submission callback');
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
}

for (const mode of ['direct', 'chained']) {
  for (const outcome of ['broadcast', 'ambiguous']) {
    test(`${mode} confirmation retains its first owner and ${outcome} outcome through a same-render activation`, async () => {
      const ui = { working: false, error: null, errorCause: null, submission: null, submittedHash: null };
      const current = { current: null };
      const outcomes = [];
      let resolve;
      const pending = new Promise(yes => { resolve = yes; });
      let providerBusy = false;
      let requests = 0;
      let busyRejections = 0;
      const submitRuntime = async () => {
        requests++;
        if (providerBusy) {
          busyRejections++;
          throw new Error('Another Private Balance action is already open.');
        }
        providerBusy = true;
        try { return await pending; }
        finally { providerBusy = false; }
      };
      const review = { id: 'synthetic-review', kind: 'transfer', transaction: { transactionHash: 'synthetic-hash' } };
      const scope = {
        Error, AbortController, PrivateActionReviewExpiredError, PrivateProofExposedError,
        completePrivateActionOperation: lifecycle.completePrivateActionOperation,
        abortRef: current, disclosure: null, review,
        chained: mode === 'chained' ? { approval: { steps: 2 }, draft: { kind: 'transfer' } } : null,
        // State setters do not replace this render's closed-over value.
        working: false,
        draftRef: { current: { kind: 'transfer' } },
        proofConsentRef: { current: { approve: () => assert.fail('unexpected proof consent') } },
        submitAction: submitRuntime, submitChainedSend: submitRuntime,
        cancelAction: async () => assert.fail('a duplicate must not cancel the review'),
        prepare: async () => assert.fail('a duplicate must not prepare another action'),
        triggerHaptic() {},
        onSubmission: status => outcomes.push(status),
      };
      for (const name of ['Working', 'Error', 'ErrorCause', 'Submission', 'SubmittedHash', 'Chained', 'ChainProgress', 'Preparing', 'Review']) {
        scope[`set${name}`] = value => { ui[name[0].toLowerCase() + name.slice(1)] = value; };
      }
      const submit = submissionHandler(scope);
      const first = submit();
      const owner = current.current;
      await submit();
      const afterDuplicate = { ...ui, owner: current.current, aborted: owner.signal.aborted };
      resolve(mode === 'chained' ? { status: outcome, finalTransactionHash: 'synthetic-hash' } : outcome);
      await first;

      assert.equal(requests, 1, 'duplicate confirmation must not reach the provider busy rejection');
      assert.equal(busyRejections, 0);
      assert.equal(afterDuplicate.owner, owner, 'the first submission keeps publication ownership');
      assert.equal(afterDuplicate.aborted, false);
      assert.equal(afterDuplicate.working, true);
      assert.equal(afterDuplicate.error, null);
      assert.equal(afterDuplicate.errorCause, null);
      assert.equal(ui.submission, outcome);
      assert.equal(ui.submittedHash, 'synthetic-hash');
      assert.deepEqual(outcomes, [outcome]);
      assert.equal(ui.working, false);
      assert.equal(current.current, null);
    });
  }
}

test('a cancelled deferred chain cannot clear a replacement direct proof review', async () => {
  assert.equal(typeof lifecycle.completePrivateActionOperation, 'function');
  const old = new AbortController();
  const current = { current: old };
  let rejectOld;
  const deferred = new Promise((_resolve, reject) => { rejectOld = reject; });
  const ui = { preparing: true, working: true, disclosure: null, chained: { id: 'old' }, error: null };
  const settled = lifecycle.completePrivateActionOperation({ controller: old, current, run: () => deferred,
    success: () => assert.fail('cancelled old chain reported success'),
    failure: error => { ui.chained = null; ui.error = error.message; },
    finish: () => { ui.preparing = false; ui.working = false; ui.disclosure = null; },
  });
  // Back cancels local authority immediately; durable cleanup is still deferred.
  old.abort(); current.current = null;
  const replacement = new AbortController(); current.current = replacement;
  const disclosure = { actionId: 'synthetic-new-proof', submissionMode: 'direct', privateFeeAtomic: '0' };
  Object.assign(ui, { preparing: true, working: false, disclosure, chained: { id: 'replacement' } });
  rejectOld(new Error('old chain cancelled after synchronization'));
  await settled;
  assert.deepEqual(ui, { preparing: true, working: false, disclosure, chained: { id: 'replacement' }, error: null });
  assert.equal(current.current, replacement);
  assert.equal(replacement.signal.aborted, false);
});

test('only the current operation publishes completion and releases its UI ownership', async () => {
  assert.equal(typeof lifecycle.completePrivateActionOperation, 'function');
  for (const fails of [false, true]) {
    const controller = new AbortController(); const current = { current: controller }; const events = [];
    await lifecycle.completePrivateActionOperation({ controller, current,
      run: async () => { if (fails) throw new Error('current failure'); return 'broadcast'; },
      success: outcome => events.push(outcome), failure: error => events.push(error.message), finish: () => events.push('finish'),
    });
    assert.deepEqual(events, [fails ? 'current failure' : 'broadcast', 'finish']);
    assert.equal(current.current, null);
  }
});
