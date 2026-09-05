import assert from 'node:assert/strict';
import test from 'node:test';
import * as storage from '../src/features/private-balance/runtime/storage.ts';
import { classifyPrivateActionRecovery, recoverPrivateBalanceAction } from '../src/features/private-balance/runtime/submission.ts';
import * as disclosure from '../src/features/private-balance/runtime/proof-disclosure.ts';
import { PrivateProofExposedError } from '../src/features/private-balance/runtime/proof-exposure.ts';
import { humanizePrivateError } from '../src/features/private-balance/copy.ts';
import { preparePrivateBalanceActionFlow, PrivateActionInFlightError } from '../src/features/private-balance/runtime/action-flow.ts';

const hex = byte => byte.repeat(64);
const context = { accountId: 'exposure-test', networkId: hex('1'), realmId: hex('2'), poolId: hex('3'), deploymentBindingHash: hex('4') };
const assetContractId = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
const key = new Uint8Array(32).fill(7);
class MemoryDriver {
  records = new Map();
  async read(key) { return this.records.get(key) ?? null; }
  async compareAndSet(key, revision, value) {
    const current = await this.read(key);
    if ((current ? JSON.parse(current).revision : null) !== revision) return { ok: false, current };
    this.records.set(key, value); return { ok: true, current: value };
  }
  async removePrefix() { throw new Error('Unexpected reset'); }
}
const action = { id: 'proof', kind: 'transfer', assetIndex: 0, assetContractId, status: 'prepared', submissionMode: 'relay', proofExposure: 'shared',
  reservedNoteIds: [hex('5')], actionField: hex('6'), nullifiers: [hex('7'), hex('0')], outputCommitments: [hex('8'), hex('9'), hex('a')],
  anchorRoot: hex('b'), anchorExpiresAtLedger: 100, proofHash: hex('c'), classicFeeCapStroops: '100', resourceFeeCapStroops: '1000', broadcastAttempts: 0, createdAt: 1, updatedAt: 1 };
const note = { id: hex('5'), commitment: hex('5'), value: '10', assetIndex: 0, assetContractId, diversifier: '00000000', ownerCommitment: hex('1'), leafIndex: 0, actionIndex: 0, rho: hex('2'), memoHex: '', senderFingerprintHex: '', status: 'reserved', reservedAt: 1, createdAt: 1 };
async function fixture(overrides = {}) {
  const driver = new MemoryDriver();
  const state = { ...storage.createEmptyPrivateBalanceState(hex('d'), 1), notes: [note], pendingActions: [{ ...action, ...overrides }] };
  await storage.commitPrivateBalanceState(context, key, state, null, driver);
  return { driver, state };
}

test('unsigned disclosed spends survive cancellation and stale review cleanup, including legacy records', async () => {
  for (const proofExposure of ['shared', undefined]) {
    const { driver, state } = await fixture({ proofExposure });
    await assert.rejects(storage.releasePrivatePendingAction(context, key, state.revision, action.id, { reason: 'pre-broadcast-rejection', updatedAt: 2 }, driver), /exposed|cannot be released/iu);
    const swept = await storage.releaseStalePrivatePendingActions(context, key, 10_000_000, 10, driver);
    assert.equal(swept.pendingActions.length, 1);
    assert.equal(swept.notes[0].status, 'reserved');
  }
  const { driver, state } = await fixture({ proofExposure: 'local' });
  const released = await storage.releasePrivatePendingAction(context, key, state.revision, action.id, { reason: 'pre-broadcast-rejection', updatedAt: 2 }, driver);
  assert.equal(released.notes[0].status, 'unspent');
});

test('envelope failure and expiry cannot revoke a reusable spend proof', () => {
  for (const kind of ['transfer', 'withdraw']) for (const proofExposure of ['shared', undefined]) {
    const exposed = { ...action, kind, proofExposure, expiresAtSeconds: 2 };
    for (const status of ['FAILED', 'NOT_FOUND', 'SUCCESS', 'UNAVAILABLE']) {
      assert.equal(classifyPrivateActionRecovery(exposed, status, [], [], 10_000), 'ambiguous');
    }
    assert.equal(classifyPrivateActionRecovery(exposed, 'NOT_FOUND', [action.actionField], [], 10_000), 'confirmed');
  }
  assert.equal(classifyPrivateActionRecovery({ ...action, kind: 'deposit', expiresAtSeconds: 2 }, 'FAILED', [], [], 10_000), 'release');
});

test('unsigned exposed recovery uses canonical sync without transaction lookup or input release', async () => {
  const { driver } = await fixture();
  let scans = 0;
  const recovered = await recoverPrivateBalanceAction({ context, storageKey: key, actionId: action.id, storageDriver: driver,
    rpc: { getTransaction: async () => { throw new Error('No transaction exists to query'); } },
    scanCanonicalTranscript: async () => { scans++; return { actionFields: [], nullifiers: [], headCloseTimeSeconds: 10_000 }; } });
  assert.equal(scans, 1);
  assert.equal(recovered.outcome, 'ambiguous');
  assert.equal(recovered.state.pendingActions[0].transactionHash, undefined);
  assert.equal(recovered.state.notes[0].status, 'reserved');
});

test('disclosure waits for exact intent consent and durable journal before any helper or RPC payload', async () => {
  assert.equal(typeof disclosure.disclosePrivateProof, 'function');
  const request = { kind: 'transfer', actionId: 'one', actionField: hex('1'), assetContractId, amountStroops: '5', recipientAddress: 'exact-address', publicRecipient: null, memoHex: '0102', privateFeeAtomic: '1', maximumNetworkFeeStroops: '1100', submissionMode: 'relay' };
  let approve;
  const events = [];
  const promise = disclosure.disclosePrivateProof({ request,
    authorize: async shown => { assert.deepEqual(shown, request); events.push('shown'); await new Promise(resolve => { approve = resolve; }); },
    commit: async () => { events.push('journal'); },
    disclose: async () => { events.push('network'); throw new Error('Helper preparation timed out'); } });
  await Promise.resolve();
  assert.deepEqual(events, ['shown']);
  approve();
  await assert.rejects(promise, /timed out/);
  assert.deepEqual(events, ['shown', 'journal', 'network']);
  const controller = new AbortController();
  await assert.rejects(disclosure.disclosePrivateProof({ request, signal: controller.signal,
    authorize: async () => { controller.abort(); }, commit: async () => assert.fail('cancelled before journal'), disclose: async () => assert.fail('cancelled before disclosure') }), /cancelled/);
  await assert.rejects(disclosure.disclosePrivateProof({ request, authorize: async () => {},
    commit: async () => { throw new Error('CAS changed'); }, disclose: async () => assert.fail('failed CAS must prevent proof sharing') }), /CAS changed/);
  await assert.rejects(disclosure.disclosePrivateProof({ request,
    commit: async () => assert.fail('no consent'), disclose: async () => assert.fail('no consent') }), /consent/);
});

test('the in-panel consent gate is explicit, abortable and cannot approve a replacement proof', async () => {
  assert.equal(typeof disclosure.PrivateProofConsent, 'function');
  const gate = new disclosure.PrivateProofConsent();
  const first = new AbortController();
  const waiting = gate.wait('first', first.signal);
  assert.equal(gate.approve('different'), false);
  first.abort();
  await assert.rejects(waiting, /cancelled/);
  const second = gate.wait('second', new AbortController().signal);
  assert.equal(gate.approve('first'), false);
  assert.equal(gate.approve('second'), true);
  await second;
  assert.equal(gate.approve('second'), false);
});

test('legacy build reservations never expire merely because no envelope was returned', async () => {
  const driver = new MemoryDriver();
  let state = { ...storage.createEmptyPrivateBalanceState(hex('d'), 1), notes: [{ ...note, status: 'unspent', reservedAt: undefined }] };
  await storage.commitPrivateBalanceState(context, key, state, null, driver);
  state = await storage.reservePrivateBuildReservation(context, key, state.revision, { id: 'legacy-build', kind: 'transfer', assetContractId, reservedNoteIds: [note.id], createdAt: 1, updatedAt: 1 }, driver);
  assert.equal((await storage.releaseExpiredPrivateBuildReservations(context, key, 10_000_000, 1, driver)).buildReservations.length, 1);
  await assert.rejects(storage.releasePrivateBuildReservation(context, key, state.revision, 'legacy-build', 2, driver), /exposed/);
});

test('context replacement after approval or journal prevents network disclosure', async () => {
  let current = true;
  const assertContext = () => { if (!current) throw new Error('Wallet context changed'); };
  const request = { kind: 'transfer' };
  await assert.rejects(disclosure.disclosePrivateProof({ request, assertContext, authorize: async () => { current = false; },
    commit: async () => assert.fail('stale context must not journal'), disclose: async () => assert.fail('stale context must not disclose') }), /context changed/);
  current = true;
  await assert.rejects(disclosure.disclosePrivateProof({ request, assertContext, authorize: async () => {},
    commit: async () => { current = false; }, disclose: async () => assert.fail('stale context after journal must not disclose') }), /context changed/);
});

test('exposed preparation errors never invite resetting or retrying as an unspent payment', () => {
  const error = new PrivateProofExposedError(new Error('Helper rejected before returning an envelope'));
  const displayed = humanizePrivateError(error);
  assert.equal(displayed.title, 'Payment status unknown');
  assert.equal(displayed.action, undefined);
  assert.match(displayed.body, /remain reserved/);
  assert.doesNotMatch(displayed.body, /nothing (was sent|left)|try again|ready in a moment/i);
});

test('an earlier unresolved payment has distinct blocking copy, without changing its reservation', async () => {
  const shown = humanizePrivateError(new PrivateActionInFlightError());
  assert.equal(shown.title, 'Blocked by an earlier payment');
  assert.match(shown.body, /This new action has not started/u);
  assert.match(shown.body, /earlier payment.*unknown/u);
  assert.equal(shown.action, undefined);
  assert.doesNotMatch(shown.body, /try again|nothing was sent|money is safe/iu);
  const { driver, state } = await fixture();
  await storage.commitPrivateBalanceState(context, key, { ...state, revision: state.revision + 1,
    account: { ...state.account, syncStatus: 'current' } }, state.revision, driver);
  await assert.rejects(preparePrivateBalanceActionFlow({ manifest: { assets: [{ index: 0, contractId: assetContractId }] },
    accountPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', privateAddress: 'not-read',
    storageContext: context, storageKey: key, storageDriver: driver, worker: {}, rpcUrl: 'invalid-never-requested',
    classicFeeStroops: 100n, assetIndex: 0, assetContractId, registryAssets: [{ index: 0, contractId: assetContractId }],
    assetCode: 'XLM', assetDecimals: 7, draft: { kind: 'deposit', amount: '1' } }), PrivateActionInFlightError);
  const retained = await storage.loadPrivateBalanceState(context, key, driver);
  assert.equal(retained.pendingActions.length, 1);
  assert.equal(retained.notes[0].status, 'reserved');
});

test('unsigned exposed actions stop another proof before any chain lookup', async () => {
  const { driver, state } = await fixture();
  await storage.commitPrivateBalanceState(context, key, { ...state, revision: state.revision + 1, account: { ...state.account, syncStatus: 'current' } }, state.revision, driver);
  await assert.rejects(preparePrivateBalanceActionFlow({ manifest: { assets: [{ index: 0, contractId: assetContractId }] }, accountPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    privateAddress: 'invalid-never-read', storageContext: context, storageKey: key, storageDriver: driver, worker: {}, rpcUrl: 'invalid-never-requested',
    classicFeeStroops: 100n, assetIndex: 0, assetContractId, registryAssets: [{ index: 0, contractId: assetContractId }], assetCode: 'XLM', assetDecimals: 7,
    draft: { kind: 'transfer', amount: '1', recipientAddress: 'invalid-never-read' } }), PrivateActionInFlightError);
});
