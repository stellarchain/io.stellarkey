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
