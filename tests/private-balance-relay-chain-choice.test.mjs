import assert from 'node:assert/strict';
import test from 'node:test';
const chainChoice = await import('../src/features/private-balance/relay/chain-choice.ts');
const quote = index => ({ quoteId: index.toString(16).padStart(64, '0'), feeAtomic: '1', expiresAt: Math.floor(Date.now() / 1000) + 60 });

test('every relay chain step waits for a fresh explicit quote choice', async () => {
  assert.equal(typeof chainChoice.PrivateRelayChainChoice, 'function');
  const choice = new chainChoice.PrivateRelayChainChoice();
  const signal = new AbortController();
  let settled = false;
  const pending = choice.wait([quote(1), quote(2)], '1', signal.signal).then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(choice.choose(quote(2).quoteId), true);
  assert.equal((await pending).quoteId, quote(2).quoteId);
  assert.equal(choice.choose(quote(1).quoteId), false);
  const next = choice.wait([quote(3)], '1', signal.signal);
  assert.equal(choice.choose(quote(2).quoteId), false);
  assert.equal(choice.choose(quote(3).quoteId), true);
  await next;
});

test('quote choice rejects changed fees, expiration, cancellation and replacement attempts', async () => {
  assert.equal(typeof chainChoice.PrivateRelayChainChoice, 'function');
  const choice = new chainChoice.PrivateRelayChainChoice();
  const controller = new AbortController();
  const valid = quote(1);
  const pending = choice.wait([valid, { ...quote(2), feeAtomic: '2' }, { ...quote(3), expiresAt: 1 }], '1', controller.signal);
  valid.feeAtomic = '2';
  assert.equal(choice.choose(quote(2).quoteId), false);
  assert.equal(choice.choose(quote(3).quoteId), false);
  await assert.rejects(choice.wait([quote(4)], '1', controller.signal), /already/);
  controller.abort();
  await assert.rejects(pending, /cancel/i);
  assert.equal(choice.choose(valid.quoteId), false);
  await assert.rejects(choice.wait([quote(5)], '1', controller.signal), /cancel/i);
});

test('streaming choice accepts live bounded offers without waiting for discovery to settle', async () => {
  const choice = new chainChoice.PrivateRelayChainChoice();
  const controller = new AbortController();
  const pending = choice.wait([], '2', controller.signal, { streaming: true });
  const outcome = pending.catch(error => error);
  try {
    assert.equal(typeof choice.update, 'function');
    assert.equal(choice.pending, true);
    assert.equal(choice.choose(quote(1).quoteId), false);
    const live = quote(1);
    assert.equal(choice.update([live, { ...quote(2), feeAtomic: '3' }, { ...quote(3), expiresAt: 1 }]).length, 1);
    live.feeAtomic = '9';
    assert.equal(choice.choose(quote(2).quoteId), false);
    assert.equal(choice.choose(quote(1).quoteId), true);
    assert.equal(choice.choose(quote(1).quoteId), false);
    assert.equal(choice.update([quote(4)]), null);
    assert.equal((await outcome).feeAtomic, '1');
  } finally { controller.abort(); await outcome; }
});

test('streaming replacements invalidate old offers and cannot leak into the next step', async () => {
  const choice = new chainChoice.PrivateRelayChainChoice();
  const controller = new AbortController();
  const pending = choice.wait([], '2', controller.signal, { streaming: true });
  const outcome = pending.catch(error => error);
  try {
    assert.equal(typeof choice.update, 'function');
    const snapshot = choice.update([quote(1)]);
    snapshot[0].feeAtomic = '999';
    choice.update([quote(2)]);
    assert.equal(choice.choose(quote(1).quoteId), false);
    assert.equal(choice.choose(quote(2).quoteId), true);
    assert.equal((await outcome).feeAtomic, '1');
    const next = choice.wait([], '1', controller.signal, { streaming: true });
    const cancelled = assert.rejects(next, { name: 'AbortError' });
    assert.equal(choice.choose(quote(2).quoteId), false);
    controller.abort();
    await cancelled;
    assert.equal(choice.update([quote(3)]), null);
  } finally { controller.abort(); await outcome; }
});

test('streaming offers expire without retaining a decision or extending the five-minute bound', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  const choice = new chainChoice.PrivateRelayChainChoice();
  const controller = new AbortController();
  const pending = choice.wait([], '1', controller.signal, { streaming: true });
  const expired = assert.rejects(pending, /expired/);
  choice.update([{ ...quote(1), expiresAt: 1_800_000_001 }]);
  t.mock.timers.tick(1_000);
  await expired;
  assert.equal(choice.pending, false);
  assert.equal(choice.choose(quote(1).quoteId), false);
  const next = choice.wait([], '1', controller.signal, { streaming: true });
  const capped = assert.rejects(next, /expired/);
  t.mock.timers.tick(299_000);
  choice.update([{ ...quote(2), expiresAt: 1_800_001_000 }]);
  t.mock.timers.tick(1_000);
  await capped;
  assert.equal(choice.pending, false);
});
