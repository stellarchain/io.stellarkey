// Three real wallets (Alice, Bob, Charlie) on one synthetic Private Payments
// pool. Every scenario ends with the same two checks: no wallet keeps a
// reservation or pending action it should not, and the total of public plus
// shielded value never drifts. Fresh seed-plus-archive scans must agree with
// each wallet's durable state, so nothing depends on local journals.
//
// TEST ONLY: non-usable deployment, no network, no valid spend proofs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import { ACTORS, createPrivatePaymentsNetwork, format } from './helpers/private-payments-network.ts';

const manifest = JSON.parse(readFileSync(new URL('../protocol/private-balance/manifests/development.json', import.meta.url), 'utf8'));
const MINUTES = 60_000;
const xlm = value => BigInt(Math.round(Number(value) * 10_000_000));

async function network(options) {
  return createPrivatePaymentsNetwork(manifest, options);
}

/** Deposits for everyone, confirmed on the ledger, so every scenario starts funded. */
async function fund(net, amounts = { alice: '100', bob: '50', charlie: '20' }) {
  for (const name of ACTORS) {
    const handle = await net.send(name, { kind: 'deposit', amount: amounts[name] });
    await net.include(handle);
  }
  await net.assertSettled();
}

async function spendable(net, name) { return format((await net.balances(name)).spendable); }
async function publicBalance(net, name) { return format((await net.balances(name)).public); }

/** Asserts the wallet holds `value` for one pending action and can spend nothing else. */
async function assertHeld(net, name, value, spendableValue = '0') {
  const balances = await net.balances(name);
  assert.equal(format(balances.reserved), value, `${name} holds the shared inputs`);
  assert.equal(format(balances.spendable), spendableValue, `${name} spendable while held`);
  assert.equal(balances.pending, 1, `${name} keeps exactly one pending action`);
  const totals = await net.totals();
  assert.equal(totals.everything, totals.initial, 'a hold is never a loss');
}

/** The wallet's own escape from a held proof: a direct self-consolidation of exactly the held inputs. */
async function selfRecover(net, name) {
  const held = (await net.state(name)).pendingActions[0];
  assert.ok(held, `${name} has a held action to recover`);
  const recovery = await net.prepare(name, { kind: 'consolidate' }, { recoveryActionId: held.id });
  assert.equal((await net.state(name)).pendingActions[0].submissionMode, 'direct', 'recovery is always direct');
  assert.notEqual(recovery.id, held.id);
  assert.deepEqual((await net.state(name)).pendingActions.map(action => action.id), [recovery.id], 'the recovery replaces the hold in one step');
  assert.equal((await net.state(name)).spendRecovery?.outcome, 'pending');
  return recovery;
}

// ---------------------------------------------------------------------------
// Happy paths: deposits and direct payments in every direction
// ---------------------------------------------------------------------------

test('deposits: every wallet funds its private balance and the ledger, journals and fresh scans agree', async () => {
  const net = await network();
  try {
    await fund(net);
    assert.equal(await spendable(net, 'alice'), '100');
    assert.equal(await publicBalance(net, 'alice'), '900');
    assert.equal(format(await net.freshScan('bob')), '50');
    assert.equal(format(await net.freshScan('charlie')), '20');
    const totals = await net.totals();
    assert.equal(totals.everything, totals.initial);
  } finally { net.restore(); }
});

test('direct transfer: Alice pays Bob, Bob receives, Alice keeps her change', async () => {
  const net = await network();
  try {
    await fund(net);
    const payment = await net.send('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') });
    assert.equal((await net.balances('alice')).pending, 1, 'the payment is journaled until the ledger includes it');
    await net.include(payment);
    assert.equal(await spendable(net, 'alice'), '90');
    assert.equal(await spendable(net, 'bob'), '60');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('direct source: Alice submits and no uninvolved wallet receives a reward', async () => {
  const net = await network();
  try {
    await fund(net);
    const payment = await net.send('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') });
    assert.equal((await net.state('alice')).pendingActions[0].submissionMode, 'direct');
    assert.equal(TransactionBuilder.fromXdr(payment.review.transaction.envelopeXdr, net.manifest.networkPassphrase).source, net.publicKey('alice'));
    await net.include(payment);
    assert.equal(await spendable(net, 'alice'), '90', 'only the approved private payment leaves Alice');
    assert.equal(await spendable(net, 'bob'), '60');
    assert.equal(await spendable(net, 'charlie'), '20', 'an uninvolved wallet receives no private fee');
    assert.equal(net.rpcLookups, 0, 'a confirmed direct payment needs no separate transaction lookup');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('round trip: A pays B, B pays C, C pays A, and every direct wallet agrees with the ledger', async () => {
  const net = await network();
  try {
    await fund(net);
    await net.include(await net.send('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') }));
    await net.include(await net.send('bob', { kind: 'transfer', amount: '15', recipientAddress: net.address('charlie') }));
    await net.include(await net.send('charlie', { kind: 'transfer', amount: '5', recipientAddress: net.address('alice') }));
    assert.equal(await spendable(net, 'alice'), '95');   // 100 - 10 + 5
    assert.equal(await spendable(net, 'bob'), '45');     // 50 + 10 - 15
    assert.equal(await spendable(net, 'charlie'), '30'); // 20 + 15 - 5
    assert.equal(net.rpcLookups, 0);
    await net.assertSettled();
  } finally { net.restore(); }
});

test('direct variations: recipients can pay back and two senders transact in sequence', async () => {
  const net = await network();
  try {
    await fund(net);
    await net.include(await net.send('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') }));
    assert.equal(await spendable(net, 'alice'), '90');
    assert.equal(await spendable(net, 'bob'), '60', 'Bob receives only the payment');
    await net.include(await net.send('bob', { kind: 'transfer', amount: '20', recipientAddress: net.address('alice') }));
    await net.include(await net.send('alice', { kind: 'transfer', amount: '7', recipientAddress: net.address('bob') }));
    assert.equal(await spendable(net, 'alice'), '103');   // 90 + 20 - 7
    assert.equal(await spendable(net, 'bob'), '47');     // 60 - 20 + 7
    assert.equal(await spendable(net, 'charlie'), '20'); // no payment to Charlie
    assert.equal(net.rpcLookups, 0);
    await net.assertSettled();
  } finally { net.restore(); }
});

test('exact amounts: paying the whole balance leaves no change note, and fractional payments conserve every stroop', async () => {
  const net = await network();
  try {
    await fund(net);
    await net.include(await net.send('alice', { kind: 'transfer', amount: '100', recipientAddress: net.address('bob') }));
    assert.equal(await spendable(net, 'alice'), '0');
    assert.equal(await spendable(net, 'bob'), '150');
    assert.equal(await spendable(net, 'charlie'), '20');
    await net.include(await net.send('bob', { kind: 'transfer', amount: '10.1234567', recipientAddress: net.address('alice') }));
    assert.equal((await net.balances('alice')).spendable, xlm('10.1234567'));
    assert.equal((await net.balances('bob')).spendable, xlm('139.8765433'));
    await net.assertSettled();
  } finally { net.restore(); }
});

test('withdrawals: direct to another public account and to the sender\'s own account move value out of the pool exactly once', async () => {
  const net = await network();
  try {
    await fund(net);
    await net.include(await net.send('alice', { kind: 'withdraw', amount: '20', publicRecipient: net.publicKey('bob') }));
    assert.equal(await spendable(net, 'alice'), '80');
    assert.equal(await publicBalance(net, 'bob'), '970');
    const ownWithdrawal = await net.send('alice', { kind: 'withdraw', amount: '10', publicRecipient: net.publicKey('alice') });
    assert.equal((await net.state('alice')).pendingActions[0].submissionMode, 'direct');
    await net.include(ownWithdrawal);
    assert.equal(await spendable(net, 'alice'), '70');
    assert.equal(await publicBalance(net, 'alice'), '910');
    assert.equal(await spendable(net, 'charlie'), '20');
    assert.equal(net.rpcLookups, 0);
    await net.assertSettled();
  } finally { net.restore(); }
});

test('consolidation: a payment needing more than two inputs is refused until Bob merges notes, then goes through', async () => {
  const net = await network();
  try {
    await fund(net);
    for (let round = 0; round < 3; round++) {
      await net.include(await net.send('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') }));
    }
    assert.equal(await spendable(net, 'bob'), '80');
    const pay = () => net.send('bob', { kind: 'transfer', amount: '75', recipientAddress: net.address('charlie') });
    await assert.rejects(pay, error => error.name === 'PrivateConsolidationRequiredError');
    assert.deepEqual(await net.balances('bob').then(b => [b.pending, b.reservedNotes]), [0, 0], 'a refused payment reserves nothing');
    let merges = 0;
    for (;;) {
      try { await net.include(await pay()); break; } catch (error) {
        if (error.name !== 'PrivateConsolidationRequiredError' || merges++ >= 3) throw error;
        await net.include(await net.send('bob', { kind: 'consolidate' }));
        assert.equal(await spendable(net, 'bob'), '80', 'consolidation moves value between Bob\'s own notes only');
      }
    }
    assert.equal(merges, 2, 'two merges turn four notes into two inputs that cover 75');
    assert.equal(await spendable(net, 'bob'), '5');
    assert.equal(await spendable(net, 'charlie'), '95');
    await net.assertSettled();
  } finally { net.restore(); }
});

// ---------------------------------------------------------------------------
// Direct preparation failures: before the proof is shared nothing is held; after, the
// hold is kept until the ledger or a self-recovery resolves it.
// ---------------------------------------------------------------------------

for (const mode of ['cancel', 'proof-failure', 'consent-expired']) test(`direct ${mode} before sharing: Alice keeps her whole balance spendable`, async () => {
  const net = await network();
  try {
    await fund(net);
    const submissions = net.submissions;
    const simulations = net.simulations;
    await assert.rejects(net.prepare('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') }, { mode }));
    assert.equal(await spendable(net, 'alice'), '100');
    assert.equal(net.submissions, submissions, 'nothing reached any RPC');
    assert.equal(net.simulations, simulations, 'the spend proof was not disclosed to simulation');
    await net.assertSettled();
    // The very next payment works without any cleanup.
    await net.include(await net.send('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') }));
    assert.equal(await spendable(net, 'alice'), '90');
    await net.assertSettled();
  } finally { net.restore(); }
});

for (const mode of ['rpc-reject', 'rpc-timeout']) test(`direct ${mode} after sharing: the deposit is held, never lost, and self-recovery frees it`, async () => {
  const net = await network();
  try {
    await fund(net);
    await assert.rejects(net.prepare('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') }, { mode }),
      error => error.name === 'PrivateProofExposedError');
    await assertHeld(net, 'alice', '100');
    // Time and retries do not release a shared proof.
    const outcomes = await net.recover('alice', { now: Date.now() + 60 * MINUTES });
    assert.deepEqual(outcomes.map(outcome => outcome.outcome), ['held'], 'a proof the RPC saw is neither released nor confirmed by time');
    assert.equal(net.rpcLookups, 0, 'an unsigned exposed action has no transaction hash to look up');
    await assertHeld(net, 'alice', '100');
    // A second payment cannot start while the hold is unresolved.
    await assert.rejects(net.prepare('alice', { kind: 'transfer', amount: '1', recipientAddress: net.address('bob') }), error => error.name === 'PrivateActionInFlightError');
    const recovery = await selfRecover(net, 'alice');
    await net.submit(recovery);
    await net.include(recovery);
    assert.equal((await net.state('alice')).spendRecovery?.outcome, 'recovered');
    assert.equal(await spendable(net, 'alice'), '100');
    assert.equal(await spendable(net, 'bob'), '50');
    assert.equal(await spendable(net, 'charlie'), '20');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('direct RPC rejection after sharing: the original payment can still land, and then recovery yields to it', async () => {
  const net = await network();
  try {
    await fund(net);
    let shared;
    await assert.rejects(net.prepare('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') },
      { mode: 'rpc-reject', onBuilt: handle => { shared = handle; } }), error => error.name === 'PrivateProofExposedError');
    assert.ok(shared, 'the engine hands back the shared action');
    const recovery = await selfRecover(net, 'alice');
    await net.submit(recovery);
    // The RPC submitted the exposed proof after all; the ledger includes the original.
    await net.include(shared);
    assert.equal((await net.state('alice')).spendRecovery?.outcome, 'original-confirmed');
    assert.equal(await spendable(net, 'alice'), '90');
    assert.equal(await spendable(net, 'bob'), '60');
    assert.equal(await spendable(net, 'charlie'), '20');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('direct signer refuses to sign: the shared proof is held until Alice recovers it herself', async () => {
  const net = await network();
  try {
    await fund(net);
    const submissions = net.submissions;
    const payment = await net.prepare('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') });
    await assert.rejects(net.submit(payment, 'signer-reject'));
    await assertHeld(net, 'alice', '100');
    assert.equal(net.submissions, submissions, 'an unsigned job never reaches the RPC');
    const recovery = await selfRecover(net, 'alice');
    await net.submit(recovery);
    await net.include(recovery);
    assert.equal(await spendable(net, 'alice'), '100');
    await net.assertSettled();
  } finally { net.restore(); }
});

for (const mode of ['ERROR', 'timeout']) test(`direct submitted proof ${mode}: nothing is confirmed, the hold survives, and inclusion later resolves it`, async () => {
  const net = await network();
  try {
    await fund(net);
    const payment = await net.prepare('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') });
    const submitted = await net.submit(payment, mode);
    assert.equal(submitted.status, 'ambiguous');
    await assertHeld(net, 'alice', '100');
    assert.deepEqual((await net.recover('alice')).map(outcome => outcome.outcome), ['ambiguous']);
    assert.equal(net.rpcLookups, 0, 'exposed spends resolve only from the canonical transcript, not transaction-status claims');
    await net.include(payment);
    assert.equal(await spendable(net, 'alice'), '90');
    assert.equal(await spendable(net, 'bob'), '60');
    assert.equal(await spendable(net, 'charlie'), '20');
    await net.assertSettled();
  } finally { net.restore(); }
});

// ---------------------------------------------------------------------------
// Direct submission outcomes and restarts
// ---------------------------------------------------------------------------

for (const mode of ['PENDING', 'ERROR', 'timeout']) test(`direct transfer ${mode} without inclusion is never confirmation; recovery keeps the hold, inclusion resolves it`, async () => {
  const net = await network();
  try {
    await fund(net);
    const payment = await net.prepare('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') });
    const submitted = await net.submit(payment, mode);
    assert.equal(submitted.status, mode === 'PENDING' ? 'broadcast' : 'ambiguous');
    await assertHeld(net, 'alice', '100');
    assert.equal(await spendable(net, 'bob'), '50', 'Bob sees nothing until the ledger does');
    // A restart: recovery re-reads the journal and asks the RPC; a shared spend stays held even after the review expires.
    assert.deepEqual((await net.recover('alice', { now: Date.now() + 30 * MINUTES })).map(outcome => outcome.outcome), ['ambiguous']);
    await assertHeld(net, 'alice', '100');
    await net.include(payment);
    assert.equal(await spendable(net, 'alice'), '90');
    assert.equal(await spendable(net, 'bob'), '60');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('direct transfer fails on chain: the hold is not released on the RPC\'s word, and self-recovery restores the balance', async () => {
  const net = await network();
  try {
    await fund(net);
    const payment = await net.send('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') });
    net.fail(payment);
    assert.deepEqual((await net.recover('alice', { now: Date.now() + 30 * MINUTES })).map(outcome => outcome.outcome), ['ambiguous']);
    await assertHeld(net, 'alice', '100');
    const recovery = await selfRecover(net, 'alice');
    await net.submit(recovery);
    await net.include(recovery);
    assert.equal(await spendable(net, 'alice'), '100');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('direct transfer signer rejection leaves the reviewed action retryable, and the retry confirms once', async () => {
  const net = await network();
  try {
    await fund(net);
    const submissions = net.submissions;
    const payment = await net.prepare('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') });
    await assert.rejects(net.submit(payment, 'signer-reject'));
    assert.equal(net.submissions, submissions);
    await assertHeld(net, 'alice', '100');
    assert.equal((await net.submit(payment)).status, 'broadcast');
    assert.equal(net.submissions, submissions + 1, 'the retry broadcasts exactly once');
    await net.include(payment);
    assert.equal(await spendable(net, 'alice'), '90');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('prepared but never submitted: a deposit expires and is released, a transfer stays held until recovered', async () => {
  const net = await network();
  try {
    await fund(net);
    const deposit = await net.prepare('bob', { kind: 'deposit', amount: '5' });
    assert.equal((await net.balances('bob')).pending, 1);
    assert.deepEqual(await net.recover('bob', { now: Date.now() + 2 * MINUTES }).then(list => list.map(outcome => outcome.outcome)), ['unsubmitted'], 'not yet expired, and never sent anywhere');
    assert.deepEqual(await net.recover('bob', { now: Date.now() + 20 * MINUTES }), [], 'the stale deposit journal is swept before recovery runs');
    assert.equal((await net.balances('bob')).pending, 0);
    assert.equal(await publicBalance(net, 'bob'), '950', 'nothing left Bob\'s public account');
    await net.assertSettled();
    assert.equal(deposit.included, false);

    await net.prepare('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') });
    await assertHeld(net, 'alice', '100');
    assert.deepEqual(await net.recover('alice', { now: Date.now() + 20 * MINUTES }).then(list => list.map(outcome => outcome.outcome)), ['held'],
      'the pre-broadcast sweep never releases a spend proof');
    await assertHeld(net, 'alice', '100');
    const recovery = await selfRecover(net, 'alice');
    await net.submit(recovery);
    await net.include(recovery);
    assert.equal(await spendable(net, 'alice'), '100');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('a second payment is blocked while the first is unresolved and allowed as soon as the ledger includes it', async () => {
  const net = await network();
  try {
    await fund(net);
    const first = await net.send('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') });
    await assert.rejects(net.prepare('alice', { kind: 'transfer', amount: '1', recipientAddress: net.address('charlie') }), error => error.name === 'PrivateActionInFlightError');
    await assert.rejects(net.prepare('alice', { kind: 'deposit', amount: '1' }), error => error.name === 'PrivateActionInFlightError');
    await net.include(first);
    await net.include(await net.send('alice', { kind: 'transfer', amount: '1', recipientAddress: net.address('charlie') }));
    assert.equal(await spendable(net, 'alice'), '89');
    assert.equal(await spendable(net, 'charlie'), '21');
    await net.assertSettled();
  } finally { net.restore(); }
});

// ---------------------------------------------------------------------------
// Deposits that go wrong: paused, unfunded, unconfirmed, and lost devices
// ---------------------------------------------------------------------------

test('deposit outcomes: ERROR and timeout are not confirmation, expiry releases an absent deposit, inclusion confirms a late one', async () => {
  const net = await network();
  try {
    await fund(net);
    const absent = await net.prepare('alice', { kind: 'deposit', amount: '5' });
    assert.equal((await net.submit(absent, 'ERROR')).status, 'ambiguous');
    assert.equal(await spendable(net, 'alice'), '100');
    assert.equal(await publicBalance(net, 'alice'), '900', 'the public balance is untouched until the ledger executes');
    assert.deepEqual((await net.recover('alice')).map(outcome => outcome.outcome), ['ambiguous'], 'before expiry the deposit may still land');
    assert.equal(net.rpcLookups, 1, 'a local deposit may query its submitted transaction at the direct RPC');
    assert.deepEqual((await net.recover('alice', { now: Date.now() + 10 * MINUTES })).map(outcome => outcome.outcome), ['release']);
    assert.equal((await net.balances('alice')).pending, 0);
    await net.assertSettled();

    const late = await net.prepare('alice', { kind: 'deposit', amount: '5' });
    assert.equal((await net.submit(late, 'timeout')).status, 'ambiguous');
    await net.include(late, { sync: false });
    assert.deepEqual(await net.recover('alice'), [], 'the canonical sync inside recovery confirms it before any RPC lookup');
    assert.equal((await net.balances('alice')).pending, 0);
    assert.equal(await spendable(net, 'alice'), '105');
    assert.equal(await publicBalance(net, 'alice'), '895');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('deposit refused while deposits are paused or the public balance is short, leaving no journal behind', async () => {
  const net = await network();
  try {
    await fund(net);
    net.pauseDeposits(true);
    await assert.rejects(net.prepare('alice', { kind: 'deposit', amount: '1' }), /paused/);
    net.pauseDeposits(false);
    await assert.rejects(net.prepare('alice', { kind: 'deposit', amount: '5000' }));
    assert.equal((await net.balances('alice')).pending, 0);
    await net.include(await net.send('alice', { kind: 'deposit', amount: '1' }));
    assert.equal(await spendable(net, 'alice'), '101');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('lost device: a wallet wiped after its deposit confirmed recovers every note from the seed and the archive', async () => {
  const net = await network();
  try {
    await fund(net);
    await net.include(await net.send('bob', { kind: 'transfer', amount: '12', recipientAddress: net.address('alice') }));
    await net.forget('alice');
    assert.equal(await spendable(net, 'alice'), '112', 'the deposit and the incoming payment come back');
    assert.equal((await net.state('alice')).activities.length, 2);
    await net.assertSettled();
    await net.include(await net.send('alice', { kind: 'transfer', amount: '2', recipientAddress: net.address('charlie') }));
    assert.equal(await spendable(net, 'alice'), '110');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('lost device mid-deposit: the journal is gone but the ledger still credits the wallet when the deposit lands', async () => {
  const net = await network();
  try {
    await fund(net);
    const deposit = await net.send('charlie', { kind: 'deposit', amount: '30' });
    await net.forget('charlie');
    assert.equal((await net.balances('charlie')).pending, 0, 'the pending journal did not survive the wipe');
    assert.equal(await spendable(net, 'charlie'), '20');
    await net.include(deposit);
    assert.equal(await spendable(net, 'charlie'), '50');
    assert.equal(await publicBalance(net, 'charlie'), '950');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('recipient offline: Bob sees the payment only when he syncs, and nothing depends on the sender telling him', async () => {
  const net = await network();
  try {
    await fund(net);
    const payment = await net.send('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') });
    await net.include(payment, { sync: false });
    await net.sync('alice');
    assert.equal(await spendable(net, 'alice'), '90');
    assert.equal(await spendable(net, 'bob'), '50');
    assert.equal(await spendable(net, 'charlie'), '20');
    await net.sync('bob');
    assert.equal(await spendable(net, 'bob'), '60');
    await net.sync('charlie');
    assert.equal(await spendable(net, 'charlie'), '20');
    await net.assertSettled();
  } finally { net.restore(); }
});

test('minimized outgoing history: every wallet still recovers change and payments from the archive alone', async () => {
  const net = await network({ outgoingHistory: 'minimized' });
  try {
    await fund(net);
    await net.include(await net.send('alice', { kind: 'transfer', amount: '10', recipientAddress: net.address('bob') }));
    await net.include(await net.send('bob', { kind: 'withdraw', amount: '5', publicRecipient: net.publicKey('charlie') }));
    for (const name of ACTORS) await net.forget(name);
    assert.equal(await spendable(net, 'alice'), '90');
    assert.equal(await spendable(net, 'bob'), '55');
    assert.equal(await spendable(net, 'charlie'), '20');
    assert.equal(await publicBalance(net, 'charlie'), '985');
    await net.assertSettled();
  } finally { net.restore(); }
});

// ---------------------------------------------------------------------------
// Randomised mixed traffic: many payments in every direction, with failures
// sprinkled in, checked against an independent ledger model after every step.
// ---------------------------------------------------------------------------

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

for (const seed of [1, 2, 3]) test(`mixed traffic (seed ${seed}): forty random actions with failures never lose or invent a stroop`, async () => {
  const net = await network();
  const random = seeded(seed);
  const pick = list => list[Math.floor(random() * list.length)];
  const stroops = max => 1n + BigInt(Math.floor(random() * Number(max - 1n)));
  const model = Object.fromEntries(ACTORS.map(name => [name, { shielded: 0n, public: xlm('1000') }]));
  const check = async (step) => {
    for (const name of ACTORS) {
      const balances = await net.balances(name);
      assert.equal(balances.shielded, model[name].shielded, `step ${step}: ${name} shielded`);
      assert.equal(balances.public, model[name].public, `step ${step}: ${name} public`);
    }
  };
  try {
    for (const name of ACTORS) {
      await net.include(await net.send(name, { kind: 'deposit', amount: '40' }));
      model[name].shielded += xlm('40');
      model[name].public -= xlm('40');
    }
    await check('funding');
    const outcomes = { included: 0, refused: 0, held: 0, consolidated: 0 };
    for (let step = 1; step <= 40; step++) {
      const sender = pick(ACTORS);
      const others = ACTORS.filter(name => name !== sender);
      const available = (await net.balances(sender)).spendable;
      const depositing = random() < 0.2 || available <= 1n;
      let draft;
      if (depositing) {
        draft = { kind: 'deposit', amount: format(stroops(xlm('30'))) };
      } else if (random() < 0.75) {
        draft = { kind: 'transfer', amount: format(stroops(available)), recipientAddress: net.address(pick(others)) };
      } else {
        draft = { kind: 'withdraw', amount: format(stroops(available)), publicRecipient: net.publicKey(pick(ACTORS)) };
      }
      const roll = random();
      const mode = draft.kind !== 'deposit' && roll < 0.1 ? pick(['cancel', 'proof-failure', 'consent-expired']) : draft.kind !== 'deposit' && roll < 0.3 ? pick(['rpc-reject', 'rpc-timeout']) : 'approve';
      let handle;
      try {
        handle = await net.prepare(sender, draft, { mode });
      } catch (error) {
        if (error.name === 'PrivateConsolidationRequiredError') {
          await net.include(await net.send(sender, { kind: 'consolidate' }));
          outcomes.consolidated++;
          await check(step);
          continue;
        }
        if (mode === 'approve') throw error;
        if (error.name === 'PrivateProofExposedError') {
          outcomes.held++;
          const recovery = await selfRecover(net, sender);
          await net.submit(recovery);
          await net.include(recovery);
        } else {
          outcomes.refused++;
        }
        await check(step);
        continue;
      }
      const submit = pick(['PENDING', 'PENDING', 'ERROR', 'timeout']);
      assert.equal((await net.submit(handle, submit)).status, submit === 'PENDING' ? 'broadcast' : 'ambiguous');
      await net.include(handle);
      outcomes.included++;
      const amount = handle.amountStroops;
      const recipient = draft.kind === 'transfer' ? ACTORS.find(name => net.address(name) === draft.recipientAddress) : null;
      if (draft.kind === 'deposit') { model[sender].shielded += amount; model[sender].public -= amount; }
      if (draft.kind === 'transfer') { model[sender].shielded -= amount; model[recipient].shielded += amount; }
      if (draft.kind === 'withdraw') { model[sender].shielded -= amount; model[handle.publicRecipient].public += amount; }
      await check(step);
    }
    assert.ok(outcomes.included >= 20 && outcomes.refused >= 1 && outcomes.held >= 1, `the mix exercised every path: ${JSON.stringify(outcomes)}`);
    assert.equal(net.rpcLookups, 0);
    await net.assertSettled();
    for (const name of ACTORS) await net.forget(name);
    await check('after reinstall');
    await net.assertSettled();
  } finally { net.restore(); }
});
