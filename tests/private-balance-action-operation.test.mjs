import assert from 'node:assert/strict';
import test from 'node:test';
import { PrivateRelayChainChoice } from '../src/features/private-balance/relay/chain-choice.ts';
const lifecycle = await import('../src/features/private-balance/components/private-action-operation.ts').catch(() => ({}));

test('a cancelled deferred chain cannot clear a replacement discovery, choice or review', async () => {
  assert.equal(typeof lifecycle.completePrivateActionOperation, 'function');
  const old = new AbortController();
  const current = { current: old };
  let rejectOld;
  const deferred = new Promise((_resolve, reject) => { rejectOld = reject; });
  const choice = new PrivateRelayChainChoice();
  const ui = { preparing: true, working: true, quotes: [], chained: { id: 'old' }, error: null };
  const settled = lifecycle.completePrivateActionOperation({ controller: old, current, run: () => deferred,
    success: () => assert.fail('cancelled old chain reported success'),
    failure: error => { ui.chained = null; ui.error = error.message; },
    finish: () => { choice.cancel(); ui.preparing = false; ui.working = false; ui.quotes = []; },
  });
  // Back cancels local authority immediately; durable cleanup is still deferred.
  old.abort(); current.current = null;
  const replacement = new AbortController(); current.current = replacement;
  const quote = { quoteId: '01'.repeat(32), feeAtomic: '1', expiresAt: Math.floor(Date.now() / 1000) + 60 };
  Object.assign(ui, { preparing: true, working: false, quotes: [quote], chained: { id: 'replacement' } });
  const waiting = choice.wait([quote], '1', replacement.signal);
  rejectOld(new Error('old chain cancelled after synchronization'));
  await settled;
  assert.deepEqual(ui, { preparing: true, working: false, quotes: [quote], chained: { id: 'replacement' }, error: null });
  assert.equal(current.current, replacement);
  assert.equal(choice.pending, true);
  choice.choose(quote.quoteId);
  await waiting;
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
