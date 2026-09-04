import assert from 'node:assert/strict';
import test from 'node:test';
import * as preparation from '../src/features/private-balance/relay/preparation.ts';

test('actual quote expiry releases the pending approval and preparation lease before request expiry', t => {
  assert.equal(typeof preparation.PrivateRelayQuoteExpiries, 'function');
  assert.equal(typeof preparation.releasePrivateRelayHelperQuote, 'function');
  const now = 1_800_000_000;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: now * 1_000 });
  const expiries = new preparation.PrivateRelayQuoteExpiries();
  const lease = new preparation.PrivateRelayPreparationLease();
  const first = { quote: { quoteId: 'first', expiresAt: now + 120 } };
  const pending = { current: first };
  let renderedPending = first;
  const state = {
    negotiations: new Map([['first', first]]), signed: new Map(), preparationLease: lease, pending,
    onPendingReleased: released => { if (renderedPending === released) renderedPending = null; },
  };
  const token = lease.begin('first');
  lease.complete(token, { preparedEnvelopeXdr: 'synthetic', accountSequence: '7', simulationLedger: 123 });
  expiries.watch(first.quote, quoteId => preparation.releasePrivateRelayHelperQuote(quoteId, state));

  t.mock.timers.tick(121_000);
  assert.equal(Date.now() < (now + 300) * 1_000, true);
  assert.equal(pending.current, null);
  assert.equal(renderedPending, null);
  assert.equal(state.negotiations.has('first'), false);
  assert.equal(lease.get('first'), undefined);
  const next = lease.begin('second');
  assert.ok(next);
  assert.equal(lease.complete(token, { preparedEnvelopeXdr: 'stale', accountSequence: '7', simulationLedger: 123 }), false);
  expiries.clear();
});

test('old expiry callbacks cannot clear a replacement quote or another pending approval', t => {
  assert.equal(typeof preparation.PrivateRelayQuoteExpiries, 'function');
  const now = 1_800_000_000;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: now * 1_000 });
  const expiries = new preparation.PrivateRelayQuoteExpiries();
  const expired = [];
  expiries.watch({ quoteId: 'same', expiresAt: now + 10 }, id => expired.push(`old-${id}`));
  expiries.watch({ quoteId: 'same', expiresAt: now + 20 }, id => expired.push(`new-${id}`));
  t.mock.timers.tick(11_000);
  assert.deepEqual(expired, []);
  t.mock.timers.tick(10_000);
  assert.deepEqual(expired, ['new-same']);

  const other = { quote: { quoteId: 'other' } };
  const pending = { current: other };
  let cleared = false;
  preparation.releasePrivateRelayHelperQuote('same', {
    negotiations: new Map(), signed: new Map(), preparationLease: new preparation.PrivateRelayPreparationLease(),
    pending, onPendingReleased: () => { cleared = true; },
  });
  assert.equal(pending.current, other);
  assert.equal(cleared, false);
  expiries.watch({ quoteId: 'closing', expiresAt: now + 30 }, id => expired.push(id));
  expiries.clear();
  t.mock.timers.tick(20_000);
  assert.deepEqual(expired, ['new-same']);
});
