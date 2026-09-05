import assert from 'node:assert/strict';
import test from 'node:test';
import { PrivateRelayHelperSession, PrivateRelayMessenger, PrivateRelaySenderSession } from '../src/features/private-balance/relay/session.ts';

const NOW = 1_800_000_000;
const requestId = '11'.repeat(32);
const quoteId = '22'.repeat(32);
const hash = '33'.repeat(32);
function signatureInput(expiresAt = NOW + 120) {
  const quote = { version: 2, type: 'quote', requestId, quoteId, peerPubkey: '44'.repeat(32),
    peerAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', feeAtomic: '1',
    accountSignature: '55'.repeat(64), nonce: '66'.repeat(32), expiresAt };
  return { quote, payout: { version: 2, type: 'payout', requestId, quoteId, peerAccount: quote.peerAccount,
    feeAtomic: quote.feeAtomic, privateFeeAddress: 'synthetic', nonce: '77'.repeat(32), expiresAt },
    unsignedEnvelopeXdr: 'synthetic-not-an-envelope', transactionHash: hash };
}
function harness(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW * 1000 });
  let receive;
  let closed = false;
  let published = 0;
  const messenger = new PrivateRelayMessenger({ publicKey: '88'.repeat(32), secretKey: new Uint8Array(32) }, { close() {} });
  // Isolate wire I/O only; exercise the real sender and messenger wait lifecycle.
  messenger.subscribe = (input, signal) => {
    receive = input.onMessage;
    signal.addEventListener('abort', () => { closed = true; });
    return { close() { closed = true; } };
  };
  messenger.publish = async () => { published++; };
  const sender = new PrivateRelaySenderSession(messenger);
  t.after(() => sender.close());
  return { sender, messenger, get closed() { return closed; }, get published() { return published; },
    deliver(overrides = {}) { receive?.({ message: { version: 2, type: 'signed-job', requestId, quoteId,
      transactionHash: hash, signedEnvelopeXdr: 'synthetic-signed', nonce: '99'.repeat(32), expiresAt: NOW + 120, ...overrides } }); } };
}

test('human relay approval remains receivable beyond twenty seconds until its existing deadline', async t => {
  const h = harness(t);
  let outcome;
  const pending = h.sender.requestSignature(signatureInput()).then(value => { outcome = value; }, error => { outcome = error; });
  t.mock.timers.tick(21_000);
  await Promise.resolve();
  assert.equal(outcome, undefined);
  assert.equal(h.closed, false);
  h.deliver();
  await pending;
  assert.equal(outcome.type, 'signed-job');
  assert.equal(h.published, 1);
  assert.equal(h.closed, true);
});

test('signature waiting expires at the earlier quote deadline without extending the payout', async t => {
  const h = harness(t);
  const input = signatureInput();
  input.quote.expiresAt = NOW + 30;
  const pending = assert.rejects(h.sender.requestSignature(input), /approval.*expired/iu);
  t.mock.timers.tick(30_000);
  await pending;
  assert.equal(h.closed, true);
});

test('signature waiting is aborted on session close without waiting for the deadline', async t => {
  const h = harness(t);
  let outcome;
  const pending = h.sender.requestSignature(signatureInput()).catch(error => { outcome = error; });
  h.sender.close();
  await pending;
  assert.equal(outcome?.name, 'AbortError');
  assert.equal(h.closed, true);
});

test('signature wait refuses expired or changed contexts before wire publication', async t => {
  const h = harness(t);
  for (const input of [signatureInput(NOW), signatureInput(NaN), signatureInput(NOW + 301),
    { ...signatureInput(), payout: { ...signatureInput().payout, quoteId: 'aa'.repeat(32) } }]) {
    let outcome;
    const pending = h.sender.requestSignature(input).catch(error => { outcome = error; });
    await Promise.resolve(); await Promise.resolve();
    assert.match(outcome?.message ?? 'No validation error', /expired|deadline|context/iu);
    await pending;
  }
  assert.equal(h.published, 0);
});

test('approval with less than a second left is not extended or rejected prematurely', async t => {
  const h = harness(t);
  t.mock.timers.tick(999);
  const pending = h.sender.requestSignature(signatureInput(NOW + 1));
  h.deliver({ expiresAt: NOW + 1 });
  assert.equal((await pending).type, 'signed-job');
});

test('an approval delivered after the absolute deadline is ignored even when timers were suspended', async t => {
  const h = harness(t);
  const pending = assert.rejects(h.sender.requestSignature(signatureInput()), /approval.*expired/iu);
  t.mock.timers.setTime((NOW + 120) * 1000);
  h.deliver();
  await pending;
  assert.equal(h.closed, true);
});

test('approval cancellation ignores late messages and preserves ordinary machine timeouts', async t => {
  const h = harness(t);
  const controller = new AbortController();
  const pending = assert.rejects(h.sender.requestSignature(signatureInput(), controller.signal), { name: 'AbortError' });
  controller.abort();
  h.deliver();
  await pending;
  const machine = assert.rejects(h.messenger.waitFor({ peerPublicKey: '44'.repeat(32), requestId, quoteId,
    types: ['payout'], publish: async () => {} }), /did not respond in time/iu);
  t.mock.timers.tick(20_000);
  await machine;
});

test('signature responses remain bound to the original context while waiting', async t => {
  const h = harness(t);
  const input = signatureInput();
  let completed = false;
  const pending = h.sender.requestSignature(input).then(response => { completed = true; return response; });
  input.quote.peerPubkey = 'ff'.repeat(32);
  input.payout.quoteId = 'ee'.repeat(32);
  input.transactionHash = 'dd'.repeat(32);
  h.deliver({ quoteId: input.payout.quoteId });
  await Promise.resolve();
  assert.equal(completed, false);
  h.deliver();
  assert.equal((await pending).transactionHash, hash);
});

test('signature replies cannot change the reviewed hash or extend the approval deadline', async t => {
  const h = harness(t);
  for (const overrides of [{ transactionHash: 'ff'.repeat(32) }, { expiresAt: NOW + 121 }, { expiresAt: NOW }]) {
    const pending = assert.rejects(h.sender.requestSignature(signatureInput()), /does not match/iu);
    h.deliver(overrides);
    await pending;
  }
});

test('a publication failure cleans up the wait and cannot be undone by a late reply', async t => {
  const h = harness(t);
  h.messenger.publish = async () => { throw new Error('Synthetic publication failed'); };
  await assert.rejects(h.sender.requestSignature(signatureInput()), /Synthetic publication failed/u);
  assert.equal(h.closed, true);
  h.deliver();
  assert.equal(h.messenger.pendingWaits.size, 0);
});

test('helper registers the exact signed response before publication can deliver a submit request', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW * 1000 });
  const input = signatureInput();
  let registered;
  let acknowledge;
  const wire = { publish: async response => {
    assert.strictEqual(registered, response, 'Authorization must exist before a remote submit can arrive');
    await new Promise(resolve => { acknowledge = resolve; });
  }, close() {} };
  const helper = new PrivateRelayHelperSession(wire);
  helper.senderByQuote.set(quoteId, input.quote.peerPubkey);
  t.after(() => helper.close());
  const job = { version: 2, type: 'sign-job', requestId, quoteId, transactionHash: hash,
    unsignedEnvelopeXdr: input.unsignedEnvelopeXdr, nonce: 'aa'.repeat(32), expiresAt: NOW + 120 };
  const pending = helper.sendSigned({ job, quote: input.quote, signedEnvelopeXdr: 'synthetic-signed',
    onBeforePublish: response => { registered = response; } });
  // Consume rejection so a failing pre-publication assertion is reported, not left unhandled.
  const outcome = pending.catch(error => error);
  await Promise.resolve();
  assert.equal(registered?.signedEnvelopeXdr, 'synthetic-signed');
  assert.equal(registered?.transactionHash, hash);
  acknowledge();
  assert.strictEqual(await outcome, registered);
});
