import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { humanizePrivateError } from '../src/features/private-balance/copy.ts';
import { Account, Contract, FeeBumpTransaction, Keypair, SorobanDataBuilder, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { signExactPrivateBalanceEnvelope } from '../src/lib/private-balance-signing.ts';
import { validateSignedPrivateBalanceEnvelope } from '../src/features/private-balance/runtime/submission.ts';
import * as fees from '../src/features/private-balance/runtime/fee-policy.ts';
import { signReviewedPrivateBalanceAction, resumeSignedPrivateBalanceActions } from '../src/features/private-balance/runtime/submission.ts';
import { createEmptyPrivateBalanceState, commitPrivateBalanceState, loadPrivateBalanceState, transitionPrivatePendingAction } from '../src/features/private-balance/runtime/storage.ts';

const networkPassphrase = 'Test SDF Network ; September 2015';
const hex = bytes => Buffer.from(bytes).toString('hex');
function scenario() {
  const owner = Keypair.random(), payer = Keypair.random();
  const feePayer = { accountId: 'synthetic-payer', publicKey: payer.publicKey() };
  const inner = new TransactionBuilder(new Account(owner.publicKey(), '7'), {
    fee: '100', networkPassphrase, timebounds: { minTime: 0, maxTime: 2_000_000_000 },
  }).addOperation(new Contract(StrKey.encodeContract(Buffer.alloc(32, 91))).call('transfer'))
    .setSorobanData(new SorobanDataBuilder().setResourceFee('50000').build()).build();
  const request = { envelopeXdr: inner.toXdr(), expectedTransactionHash: hex(inner.hash()), expectedSource: owner.publicKey(),
    networkPassphrase, softwareSigner: owner, feePayer, feePayerSigner: payer,
    maximumClassicFeeStroops: 200n, maximumResourceFeeStroops: 50_000n };
  return { owner, payer, feePayer, inner, request };
}

test('another wallet account signs only the fee bump around the exact reviewed inner transaction', () => {
  const h = scenario();
  const signed = TransactionBuilder.fromXdr(signExactPrivateBalanceEnvelope(h.request), networkPassphrase);
  assert.ok(signed instanceof FeeBumpTransaction, 'An alternate payer must produce a fee-bump envelope');
  assert.equal(signed.feeSource, h.payer.publicKey());
  assert.equal(signed.innerTransaction.source, h.owner.publicKey());
  assert.equal(hex(signed.innerTransaction.hash()), h.request.expectedTransactionHash);
  assert.equal(signed.fee, '50200', 'The resource fee is charged once, plus two inclusion-fee operations');
  assert.notEqual(hex(signed.hash()), h.request.expectedTransactionHash);
  assert.equal(signed.signatures.length, 1);
  assert.equal(signed.innerTransaction.signatures.length, 1);
  assert.ok(h.payer.verify(signed.hash(), signed.signatures[0].signature));
  assert.ok(h.owner.verify(signed.innerTransaction.hash(), signed.innerTransaction.signatures[0].signature));
});

for (const [name, patch] of [
  ['wrong payer key', h => ({ feePayerSigner: h.owner })],
  ['missing payer key', () => ({ feePayerSigner: undefined })],
  ['changed payer', () => ({ feePayer: { accountId: 'synthetic-payer', publicKey: Keypair.random().publicKey() } })],
  ['missing reviewed fee cap', () => ({ maximumClassicFeeStroops: undefined })],
  ['inclusion fee above consent', () => ({ maximumClassicFeeStroops: 199n })],
  ['resource fee above consent', () => ({ maximumResourceFeeStroops: 49_999n })],
]) test(`private sponsorship rejects ${name} without falling back to the active account`, () => {
  const h = scenario();
  assert.throws(() => signExactPrivateBalanceEnvelope({ ...h.request, ...patch(h) }), /payer|fee|cap|sponsor/i);
});

test('ordinary signing remains an ordinary exact envelope', () => {
  const h = scenario();
  const request = { ...h.request, feePayer: undefined, feePayerSigner: undefined };
  const signed = TransactionBuilder.fromXdr(signExactPrivateBalanceEnvelope(request), networkPassphrase);
  assert.equal(signed instanceof FeeBumpTransaction, false);
  assert.equal(hex(signed.hash()), request.expectedTransactionHash);
});

test('a sponsored signed envelope requires explicit inner identity, payer and fee validation', () => {
  const h = scenario();
  h.inner.sign(h.owner);
  const outer = TransactionBuilder.buildFeeBumpTransaction(h.payer.publicKey(), '100', h.inner, networkPassphrase);
  outer.sign(h.payer);
  const input = { signedEnvelopeXdr: outer.toXdr(), networkPassphrase,
    expectedTransactionHash: hex(outer.hash()), expectedInnerTransactionHash: h.request.expectedTransactionHash,
    feePayer: h.feePayer, maximumClassicFeeStroops: 200n, maximumResourceFeeStroops: 50_000n };
  const validated = validateSignedPrivateBalanceEnvelope(input);
  assert.equal(validated.hash, hex(outer.hash()));
  for (const patch of [
    { feePayer: undefined }, { expectedInnerTransactionHash: undefined },
    { expectedInnerTransactionHash: '00'.repeat(32) },
    { feePayer: { ...h.feePayer, publicKey: h.owner.publicKey() } },
    { maximumClassicFeeStroops: 199n }, { maximumResourceFeeStroops: 49_999n },
  ]) assert.throws(() => validateSignedPrivateBalanceEnvelope({ ...input, ...patch }));
});

for (const invalid of ['network', 'inner signer', 'outer signer', 'extra signature', 'outer fee']) {
  test(`sponsored envelope validation rejects an altered ${invalid}`, () => {
    const h = scenario();
    h.inner.sign(invalid === 'inner signer' ? h.payer : h.owner);
    const outer = TransactionBuilder.buildFeeBumpTransaction(h.payer.publicKey(), invalid === 'outer fee' ? '101' : '100', h.inner, networkPassphrase);
    outer.sign(invalid === 'outer signer' ? h.owner : h.payer);
    if (invalid === 'extra signature') outer.sign(h.owner);
    assert.throws(() => validateSignedPrivateBalanceEnvelope({
      signedEnvelopeXdr: outer.toXdr(), networkPassphrase: invalid === 'network' ? 'synthetic wrong network' : networkPassphrase,
      expectedTransactionHash: hex(outer.hash()), expectedInnerTransactionHash: h.request.expectedTransactionHash,
      feePayer: h.feePayer, maximumClassicFeeStroops: 200n, maximumResourceFeeStroops: 50_000n,
    }));
  });
}

test('fee-account selection defaults to the active account and never accepts unavailable signers', () => {
  assert.equal(typeof fees.resolvePrivateFeePayer, 'function');
  const h = scenario();
  const accounts = [
    { id: 'owner', publicKey: h.owner.publicKey() },
    { id: h.feePayer.accountId, publicKey: h.payer.publicKey() },
    { id: 'watch', publicKey: Keypair.random().publicKey(), watchOnly: true },
    { id: 'hardware', publicKey: Keypair.random().publicKey(), hardware: 'trezor' },
  ];
  assert.equal(fees.resolvePrivateFeePayer(accounts, 'owner'), undefined);
  assert.equal(fees.resolvePrivateFeePayer(accounts, 'owner', 'owner'), undefined);
  assert.deepEqual(fees.resolvePrivateFeePayer(accounts, 'owner', h.feePayer.accountId), h.feePayer);
  assert.throws(() => fees.resolvePrivateFeePayer(accounts, 'owner', 'missing'), /unavailable/i);
  assert.throws(() => fees.resolvePrivateFeePayer(accounts, 'owner', 'watch'), /watch.only/i);
  assert.throws(() => fees.resolvePrivateFeePayer(accounts, 'owner', 'hardware'), /hardware/i);
});

async function journalScenario() {
  const h = scenario();
  const context = { networkId: '01'.repeat(32), realmId: '02'.repeat(32), poolId: '03'.repeat(32), accountId: 'owner', deploymentBindingHash: '04'.repeat(32) };
  const storageKey = new Uint8Array(32).fill(72);
  const records = new Map();
  const driver = {
    async read(key) { return records.get(key) ?? null; },
    async compareAndSet(key, expected, value) {
      const current = records.get(key) ?? null;
      if ((current === null ? null : JSON.parse(current).revision) !== expected) return { ok: false, current };
      records.set(key, value); return { ok: true, current: value };
    },
  };
  const pending = { outgoingHistoryMode: 'recoverable', id: 'sponsored-action', kind: 'deposit', assetIndex: 0, assetContractId: StrKey.encodeContract(Buffer.alloc(32, 91)), status: 'reviewed', submissionMode: 'direct', proofExposure: 'shared', feePayer: h.feePayer,
    reservedNoteIds: [], actionField: '11'.repeat(32), nullifiers: ['00'.repeat(32), '00'.repeat(32)], outputCommitments: ['12'.repeat(32), '13'.repeat(32), '14'.repeat(32)], anchorRoot: '15'.repeat(32), anchorExpiresAtLedger: 500,
    proofHash: '16'.repeat(32), classicFeeCapStroops: '200', resourceFeeCapStroops: '50000', transactionHash: h.request.expectedTransactionHash, broadcastAttempts: 0, createdAt: 1, updatedAt: 1 };
  await commitPrivateBalanceState(context, storageKey, { ...createEmptyPrivateBalanceState('17'.repeat(32), 1), pendingActions: [pending] }, null, driver);
  const review = { envelopeXdr: h.request.envelopeXdr, transactionHash: h.request.expectedTransactionHash, feePayer: h.feePayer, classicFeeStroops: 200n, resourceFeeStroops: 50_000n, expiresAt: 2_000_000_000 };
  return { ...h, context, storageKey, driver, review, pending };
}

test('sponsored signing atomically journals both hashes and resumes the exact outer envelope after reload', async () => {
  const h = await journalScenario();
  const signed = await signReviewedPrivateBalanceAction({ context: h.context, storageKey: h.storageKey, expectedRevision: 0, actionId: h.pending.id, review: h.review, networkPassphrase, storageDriver: h.driver, now: () => 2,
    sign: async request => {
      assert.deepEqual(request.feePayer, h.feePayer);
      assert.equal(request.maximumClassicFeeStroops, 200n);
      return signExactPrivateBalanceEnvelope(h.request);
    } });
  const pending = signed.pendingActions[0];
  assert.equal(pending.innerTransactionHash, h.review.transactionHash);
  assert.notEqual(pending.transactionHash, h.review.transactionHash);
  let calls = 0;
  const resumed = await resumeSignedPrivateBalanceActions({ context: h.context, storageKey: h.storageKey, networkPassphrase, storageDriver: h.driver, now: () => 3,
    rpc: { async sendTransaction(transaction) {
      calls += 1; assert.ok(transaction instanceof FeeBumpTransaction);
      assert.equal(hex(transaction.hash()), pending.transactionHash);
      assert.equal(transaction.toXdr(), pending.signedEnvelopeXdr);
      return { status: 'PENDING', hash: pending.transactionHash };
    } } });
  assert.equal(calls, 1);
  assert.equal(resumed.pendingActions[0].status, 'broadcast');
  assert.equal(resumed.pendingActions[0].feePayer.publicKey, h.payer.publicKey());
});

test('journal and reviewed fee payer must match before any signing request', async () => {
  const h = await journalScenario();
  let calls = 0;
  await assert.rejects(signReviewedPrivateBalanceAction({ context: h.context, storageKey: h.storageKey, expectedRevision: 0, actionId: h.pending.id, review: { ...h.review, feePayer: undefined }, networkPassphrase, storageDriver: h.driver, now: () => 2,
    sign: async () => { calls += 1; return signExactPrivateBalanceEnvelope(h.request); } }), /fee.pay/i);
  assert.equal(calls, 0);
  assert.equal((await loadPrivateBalanceState(h.context, h.storageKey, h.driver)).revision, 0);
});

test('the signer cannot mutate the approved payer through its signing request', async () => {
  const h = await journalScenario();
  await assert.rejects(signReviewedPrivateBalanceAction({ context: h.context, storageKey: h.storageKey, expectedRevision: 0, actionId: h.pending.id, review: h.review, networkPassphrase, storageDriver: h.driver, now: () => 2,
    sign: async request => {
      request.feePayer.publicKey = h.owner.publicKey();
      return signExactPrivateBalanceEnvelope(h.request);
    } }));
  assert.equal((await loadPrivateBalanceState(h.context, h.storageKey, h.driver)).revision, 0);
});

test('signing consent keeps its snapshotted resource cap while waiting for the signer', async () => {
  const h = await journalScenario();
  const frozen = [];
  const signed = await signReviewedPrivateBalanceAction({ context: h.context, storageKey: h.storageKey, expectedRevision: 0, actionId: h.pending.id, review: h.review, networkPassphrase, storageDriver: h.driver, now: () => 2,
    sign: async request => {
      frozen.push(Object.isFrozen(request), Object.isFrozen(request.feePayer));
      h.review.resourceFeeStroops = 100_000n;
      h.review.transactionHash = 'aa'.repeat(32);
      return signExactPrivateBalanceEnvelope(h.request);
    } });
  assert.deepEqual(frozen, [true, true]);
  assert.equal(signed.pendingActions[0].innerTransactionHash, h.request.expectedTransactionHash);
  assert.equal(signed.pendingActions[0].resourceFeeCapStroops, '50000');
});

test('a pending proof cannot change payer or substitute an unbound submitted hash', async () => {
  const h = await journalScenario();
  for (const patch of [{ feePayer: undefined }, { transactionHash: 'aa'.repeat(32) }]) {
    await assert.rejects(transitionPrivatePendingAction(h.context, h.storageKey, 0, h.pending.id, {
      from: 'reviewed', to: 'signed', signedEnvelopeXdr: signExactPrivateBalanceEnvelope(h.request), expiresAtSeconds: h.review.expiresAt, updatedAt: 2, ...patch,
    }, h.driver), /payer|hash|sponsor/i);
  }
});

test('all shielded forms explicitly carry the fee account into preparation and the visible review', () => {
  for (const file of ['SendPrivate.tsx', 'AddPrivateFunds.tsx', 'WithdrawPrivate.tsx', 'PrivateHeldBalanceRecovery.tsx']) {
    const source = readFileSync(new URL(`../src/features/private-balance/components/${file}`, import.meta.url), 'utf8');
    assert.match(source, /<PrivateFeeAccountSelector/, file);
    assert.match(source, /feePayerAccountId/, file);
    assert.match(source, /feePayer:/, file);
  }
});

test('a vanished fee account stays a missing selection instead of being presented as the current payer', () => {
  const selector = readFileSync(new URL('../src/features/private-balance/components/PrivateFeeAccountSelector.tsx', import.meta.url), 'utf8');
  assert.match(selector, /selection\.publicKey/);
  const review = readFileSync(new URL('../src/features/private-balance/components/PrivateActionReview.tsx', import.meta.url), 'utf8');
  assert.match(review, /draft.feePayer && \(!feeAccount \|\| privateFeePayerUnavailableReason\(feeAccount\)\)/);
});

test('fee account errors explain next steps without promising that an exposed proof is revoked', () => {
  const poor = humanizePrivateError(new Error('The selected fee-paying account needs more spendable public XLM for the network fee limit.'));
  assert.equal(poor.title, 'Not enough XLM for network fees');
  const changed = humanizePrivateError(new Error('The fee-paying account changed. Create a new private payment review.'));
  assert.equal(changed.title, 'Choose the fee account again');
  assert.equal(/nothing was sent|proof.*revoked/i.test(poor.body + changed.body), false);
});
