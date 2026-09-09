import assert from 'node:assert/strict';
import test from 'node:test';
import { PrivateRelayHelperSession, PrivateRelayMessenger, PrivateRelaySenderSession } from '../src/features/private-balance/relay/session.ts';

const NOW = 1_800_000_000;
const requestId = '11'.repeat(32);
const quoteId = '22'.repeat(32);
const hash = '33'.repeat(32);
function jobInput(expiresAt = NOW + 120) {
  const quote = { version: 3, type: 'quote', requestId, quoteId, peerPubkey: '44'.repeat(32),
    peerAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', feeAtomic: '1',
    accountSignature: '55'.repeat(64), nonce: '66'.repeat(32), expiresAt };
  return { quote, payout: { version: 3, type: 'payout', requestId, quoteId, peerAccount: quote.peerAccount,
    feeAtomic: quote.feeAtomic, privateFeeAddress: 'synthetic', nonce: '77'.repeat(32), expiresAt },
    operationXdr: 'AAAA', maxTime: Math.min(expiresAt, NOW + 120), classicFeeStroops: '100', maximumResourceFeeStroops: '1000' };
}
function harness(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW * 1000 });
  let receive;
  let closed = false;
  let published = 0;
  let job = null;
  const messenger = new PrivateRelayMessenger({ publicKey: '88'.repeat(32), secretKey: new Uint8Array(32) }, { close() {} });
  // Isolate wire I/O only; exercise the real sender and messenger wait lifecycle.
  messenger.subscribe = (input, signal) => {
    receive = input.onMessage;
    signal.addEventListener('abort', () => { closed = true; });
    return { close() { closed = true; } };
  };
  messenger.publish = async message => { published++; job = message; };
  const sender = new PrivateRelaySenderSession(messenger);
  t.after(() => sender.close());
  return { sender, messenger, get closed() { return closed; }, get published() { return published; }, get job() { return job; },
    deliver(overrides = {}) { receive?.({ message: { version: 3, type: 'outcome', requestId, quoteId,
      prepareId: job?.prepareId ?? '00'.repeat(32), preparedEnvelopeXdr: 'AQIDBA==', signedEnvelopeXdr: 'AQIDBAU=',
      transactionHash: hash, accountSequence: '7', simulationLedger: 123, rpcStatus: 'PENDING',
      nonce: '99'.repeat(32), expiresAt: NOW + 120, ...overrides } }); } };
}

test('a human approval remains receivable beyond twenty seconds until the quote or payout deadline', async t => {
  const h = harness(t);
  let outcome;
  const pending = h.sender.requestPreparation(jobInput()).then(value => { outcome = value; }, error => { outcome = error; });
  t.mock.timers.tick(21_000);
  await Promise.resolve();
  assert.equal(outcome, undefined);
  assert.equal(h.closed, false);
  h.deliver();
  await pending;
  assert.equal(outcome.type, 'outcome');
  assert.equal(h.published, 1);
  assert.equal(h.job.type, 'job');
  assert.equal(h.job.expiresAt, NOW + 120, 'the job expires with the offer, not with a renewed timeout');
  assert.equal(h.closed, true);
});

test('the outcome carries the signature and receipt for the later sign and submit steps', async t => {
  const h = harness(t);
  const input = jobInput();
  const pending = h.sender.requestPreparation(input);
  h.deliver();
  const outcome = await pending;
  assert.deepEqual([outcome.preparedEnvelopeXdr, outcome.accountSequence, outcome.simulationLedger], ['AQIDBA==', '7', 123]);
  const signed = await h.sender.requestSignature({ quote: input.quote, payout: input.payout, unsignedEnvelopeXdr: 'AQIDBA==', transactionHash: hash });
  assert.deepEqual(signed, { requestId, quoteId, transactionHash: hash, signedEnvelopeXdr: 'AQIDBAU=', expiresAt: NOW + 120 });
  assert.deepEqual(await h.sender.requestSubmission({ quote: input.quote, signed }), { transactionHash: hash, rpcStatus: 'PENDING' });
  assert.equal(h.published, 1, 'signing and submission add no wire round trips');
  await assert.rejects(h.sender.requestSignature({ quote: input.quote, payout: input.payout, unsignedEnvelopeXdr: 'BBBB', transactionHash: hash }), /does not match/iu);
  await assert.rejects(h.sender.requestSignature({ quote: input.quote, payout: input.payout, unsignedEnvelopeXdr: 'AQIDBA==', transactionHash: 'ff'.repeat(32) }), /does not match/iu);
  await assert.rejects(h.sender.requestSubmission({ quote: input.quote, signed: { ...signed, signedEnvelopeXdr: 'tampered' } }), /does not match/iu);
  await assert.rejects(h.sender.requestSignature({ ...jobInput(), quote: { ...input.quote, quoteId: 'aa'.repeat(32) } }), /not answered/iu);
});

test('waiting expires at the earlier quote deadline without extending the payout', async t => {
  const h = harness(t);
  const input = jobInput();
  input.quote.expiresAt = NOW + 30;
  input.maxTime = NOW + 30;
  const pending = assert.rejects(h.sender.requestPreparation(input), /approval.*expired/iu);
  t.mock.timers.tick(30_000);
  await pending;
  assert.equal(h.closed, true);
});

test('waiting is aborted on session close without waiting for the deadline', async t => {
  const h = harness(t);
  let outcome;
  const pending = h.sender.requestPreparation(jobInput()).catch(error => { outcome = error; });
  h.sender.close();
  await pending;
  assert.equal(outcome?.name, 'AbortError');
  assert.equal(h.closed, true);
});

test('the job refuses expired or changed contexts before wire publication', async t => {
  const h = harness(t);
  for (const input of [jobInput(NOW), jobInput(NaN), jobInput(NOW + 301),
    { ...jobInput(), payout: { ...jobInput().payout, quoteId: 'aa'.repeat(32) } },
    { ...jobInput(), maxTime: NOW + 121 }]) {
    let outcome;
    const pending = h.sender.requestPreparation(input).catch(error => { outcome = error; });
    await Promise.resolve(); await Promise.resolve();
    assert.match(outcome?.message ?? 'No validation error', /expired|deadline|context/iu);
    await pending;
  }
  assert.equal(h.published, 0);
});

test('an approval with less than a second left is not extended or rejected prematurely', async t => {
  const h = harness(t);
  t.mock.timers.tick(999);
  const pending = h.sender.requestPreparation(jobInput(NOW + 1));
  h.deliver({ expiresAt: NOW + 1 });
  assert.equal((await pending).type, 'outcome');
});

test('an outcome delivered after the absolute deadline is ignored even when timers were suspended', async t => {
  const h = harness(t);
  const pending = assert.rejects(h.sender.requestPreparation(jobInput()), /approval.*expired/iu);
  t.mock.timers.setTime((NOW + 120) * 1000);
  h.deliver();
  await pending;
  assert.equal(h.closed, true);
});

test('cancellation ignores late outcomes and preserves ordinary machine timeouts', async t => {
  const h = harness(t);
  const controller = new AbortController();
  const pending = assert.rejects(h.sender.requestPreparation(jobInput(), controller.signal), { name: 'AbortError' });
  controller.abort();
  h.deliver();
  await pending;
  const machine = assert.rejects(h.messenger.waitFor({ peerPublicKey: '44'.repeat(32), requestId, quoteId,
    types: ['payout'], publish: async () => {} }), /did not respond in time/iu);
  t.mock.timers.tick(20_000);
  await machine;
});

test('outcomes remain bound to the job while waiting', async t => {
  const h = harness(t);
  const input = jobInput();
  let completed = false;
  const pending = h.sender.requestPreparation(input).then(response => { completed = true; return response; });
  input.quote.peerPubkey = 'ff'.repeat(32);
  input.payout.quoteId = 'ee'.repeat(32);
  h.deliver({ quoteId: input.payout.quoteId });
  await Promise.resolve();
  assert.equal(completed, false);
  h.deliver({ prepareId: 'ab'.repeat(32) });
  await Promise.resolve();
  assert.equal(completed, false, 'another preparation id is not this job');
  h.deliver();
  assert.equal((await pending).transactionHash, hash);
});

test('outcomes cannot extend the approval deadline', async t => {
  const h = harness(t);
  for (const overrides of [{ expiresAt: NOW + 121 }, { expiresAt: NOW }]) {
    const pending = assert.rejects(h.sender.requestPreparation(jobInput()), /does not match/iu);
    h.deliver(overrides);
    await pending;
  }
});

test('a publication failure cleans up the wait and cannot be undone by a late reply', async t => {
  const h = harness(t);
  h.messenger.publish = async () => { throw new Error('Synthetic publication failed'); };
  await assert.rejects(h.sender.requestPreparation(jobInput()), /Synthetic publication failed/u);
  assert.equal(h.closed, true);
  h.deliver();
  assert.equal(h.messenger.pendingWaits.size, 0);
});

test('helper registers the exact outcome before publication can deliver it', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW * 1000 });
  const input = jobInput();
  let registered;
  let acknowledge;
  const wire = { publish: async response => {
    assert.strictEqual(registered, response, 'The outcome must exist before a remote acknowledgement can arrive');
    await new Promise(resolve => { acknowledge = resolve; });
  }, close() {} };
  const helper = new PrivateRelayHelperSession(wire);
  helper.senderByQuote.set(quoteId, input.quote.peerPubkey);
  t.after(() => helper.close());
  const job = { version: 3, type: 'job', requestId, quoteId, prepareId: 'bb'.repeat(32), operationXdr: 'AAAA', maxTime: NOW + 120,
    classicFeeStroops: '100', maximumResourceFeeStroops: '1000', nonce: 'aa'.repeat(32), expiresAt: NOW + 120 };
  const pending = helper.sendOutcome({ job, quote: input.quote, preparedEnvelopeXdr: 'AQIDBA==', accountSequence: '7', simulationLedger: 123,
    signedEnvelopeXdr: 'AQIDBAU=', transactionHash: hash, rpcStatus: 'PENDING',
    onBeforePublish: response => { registered = response; } });
  // Consume rejection so a failing pre-publication assertion is reported, not left unhandled.
  const outcome = pending.catch(error => error);
  await Promise.resolve();
  assert.equal(registered?.signedEnvelopeXdr, 'AQIDBAU=');
  assert.equal(registered?.transactionHash, hash);
  assert.equal(registered?.rpcStatus, 'PENDING');
  acknowledge();
  assert.strictEqual(await outcome, registered);
});
