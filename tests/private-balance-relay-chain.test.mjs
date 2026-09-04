import assert from 'node:assert/strict';
import test from 'node:test';
import { planPrivateRelayConsolidation } from '../src/features/private-balance/runtime/relay-consolidation-plan.ts';

const policy = await import('../src/features/private-balance/runtime/relay-chain-policy.ts').catch(() => ({}));
const storage = await import('../src/features/private-balance/runtime/storage.ts');
const driverModule = await import('../src/features/private-balance/runtime/relay-chained-send.ts').catch(() => ({}));
const preparation = await import('../src/features/private-balance/runtime/relay-chain-preparation.ts').catch(() => ({}));
const ASSET = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
const hex = n => n.toString(16).padStart(64, '0');
const notes = [1, 2, 3].map(n => ({ id: hex(n), commitment: hex(n), value: '4', leafIndex: n,
  assetContractId: ASSET, assetIndex: 0, status: 'unspent' }));
function approval() {
  const plan = planPrivateRelayConsolidation({ notes, assetContractId: ASSET, amountAtomic: 10n, perStepMaxPrivateFeeAtomic: 1n });
  return { id: 'relay-chain', submissionMode: 'relay', contextKey: 'account:deployment', assetContractId: ASSET,
    assetIndex: 0, draft: { kind: 'transfer', amount: '10', recipientAddress: 'private-final', memo: 'memo' },
    plan, steps: plan.steps, perStepMaxFeeStroops: '1000', cumulativeMaxFeeStroops: '2000', expiresAtSeconds: 1000 };
}
function record() {
  return { actionId: 'action-1', step: 0, actionField: hex(10), inputNoteIds: [hex(1), hex(2)],
    outputCommitment: hex(11), amountAtomic: '7', recipientAddress: 'private-own-one', privateFeeAtomic: '1',
    networkFeeStroops: '500', quoteId: hex(20), requestId: hex(21), sourceAccount: 'helper', expiresAtSeconds: 900 };
}

test('relayed chain advances exact ordered step IDs and both fee budgets atomically', () => {
  assert.equal(typeof policy.advancePrivateRelayChain, 'function');
  const journal = { approval: approval(), authorized: [], privateFeeAtomic: '0', networkFeeStroops: '0', selfAddresses: ['private-own-one'] };
  const next = policy.advancePrivateRelayChain(journal, record(), 500);
  assert.equal(next.privateFeeAtomic, '1');
  assert.equal(next.networkFeeStroops, '500');
  assert.equal(journal.authorized.length, 0);
  for (const change of [{ step: 1 }, { inputNoteIds: [hex(1), hex(3)] }, { privateFeeAtomic: '2' },
    { networkFeeStroops: '1001' }, { amountAtomic: '8' }, { expiresAtSeconds: 499 }]) {
    assert.throws(() => policy.advancePrivateRelayChain(journal, { ...record(), ...change }, 500));
  }
  assert.throws(() => policy.advancePrivateRelayChain(next, record(), 500), /step|duplicate|order/i);
  assert.throws(() => policy.advancePrivateRelayChain(journal, record(), 1000), /expir/i);
});

test('canonical relay continuation needs exact action inclusion and its owned spendable output', () => {
  assert.equal(typeof policy.confirmPrivateRelayMerge, 'function');
  const step = record();
  const output = { ...notes[0], id: hex(12), commitment: step.outputCommitment, value: '7', actionIndex: 8 };
  const durable = { pendingActions: [], activities: [{ id: step.actionField, actionIndex: 8,
    assetContractId: ASSET, outputCommitments: [step.outputCommitment] }], notes: [output] };
  assert.equal(policy.confirmPrivateRelayMerge(approval(), step, durable).id, output.id);
  for (const changed of [{ ...durable, activities: [] }, { ...durable, notes: [] },
    { ...durable, notes: [{ ...output, status: 'reserved' }] },
    { ...durable, notes: [{ ...output, assetContractId: 'other' }] },
    { ...durable, notes: [{ ...output, value: '8' }] },
    { ...durable, notes: [{ ...output, actionIndex: 9 }] }]) {
    assert.equal(policy.confirmPrivateRelayMerge(approval(), step, changed), null);
  }
});

test('encrypted relay authorization binds the reviewed pending action, route and revision', async () => {
  assert.equal(typeof storage.beginPrivateRelayChainApproval, 'function');
  const context = { networkId: hex(1), realmId: hex(2), poolId: hex(3), accountId: 'account', deploymentBindingHash: hex(4) };
  const key = new Uint8Array(32).fill(7);
  let encrypted = null;
  const driver = { read: async () => encrypted, removePrefix: async () => {}, compareAndSet: async (_key, revision, value) => {
    if ((encrypted === null ? null : JSON.parse(encrypted).revision) !== revision) return { ok: false, current: encrypted };
    encrypted = value; return { ok: true, current: value };
  } };
  const consent = approval();
  consent.contextKey = policy.privateRelayChainContextKey(context, ASSET);
  const step = record();
  const initial = { ...storage.createEmptyPrivateBalanceState(hex(8), 1), notes: notes.map(note => ({ ...note,
    diversifier: '00000000', ownerCommitment: hex(5), actionIndex: 0, rho: hex(6), memoHex: '', senderFingerprintHex: '', createdAt: 1 })) };
  await storage.commitPrivateBalanceState(context, key, initial, null, driver);
  const begun = await storage.beginPrivateRelayChainApproval(context, key, initial.revision, consent, 500, driver);
  assert.equal(begun.relayChainedApproval.authorized.length, 0);
  const pending = { id: step.actionId, kind: 'transfer', assetContractId: ASSET, assetIndex: 0, status: 'reviewed', submissionMode: 'relay',
    reservedNoteIds: step.inputNoteIds, actionField: step.actionField, nullifiers: [hex(30), hex(31)], outputCommitments: [step.outputCommitment, hex(32), hex(33)],
    anchorRoot: hex(34), anchorExpiresAtLedger: 1000, proofHash: hex(35), classicFeeCapStroops: '100', resourceFeeCapStroops: '400',
    amountStroops: step.amountAtomic, changeValueStroops: '0', transactionHash: hex(36), broadcastAttempts: 0, createdAt: 1, updatedAt: 2,
    relayChain: { approvalId: consent.id, step: 0, feeAtomic: '1', requestId: step.requestId, quoteId: step.quoteId, sourceAccount: step.sourceAccount,
      recipientAddress: step.recipientAddress, recipientOutputCommitment: step.outputCommitment, expiresAtSeconds: step.expiresAtSeconds } };
  const prepared = { ...begun, relayChainedApproval: { ...begun.relayChainedApproval, selfAddresses: [step.recipientAddress] }, revision: begun.revision + 1, pendingActions: [pending], notes: begun.notes.map(note =>
    step.inputNoteIds.includes(note.id) ? { ...note, status: 'reserved', reservedAt: 1 } : note) };
  await storage.commitPrivateBalanceState(context, key, prepared, begun.revision, driver);
  for (const changed of [{ ...step, actionId: 'other' }, { ...step, quoteId: hex(99) }, { ...step, networkFeeStroops: '499' }]) {
    await assert.rejects(storage.authorizePrivateRelayChainStep(context, key, prepared.revision, consent.id, changed, 500, driver));
  }
  const authorized = await storage.authorizePrivateRelayChainStep(context, key, prepared.revision, consent.id, step, 500, driver);
  assert.equal(authorized.relayChainedApproval.privateFeeAtomic, '1');
  await assert.rejects(storage.authorizePrivateRelayChainStep(context, key, prepared.revision, consent.id, step, 500, driver), /changed/);
  await assert.rejects(storage.authorizePrivateRelayChainStep(context, key, authorized.revision, consent.id, step, 500, driver), /step|duplicate|order/);
  assert.doesNotMatch(encrypted, /private-own-one|helper|relay-chain/);
  assert.equal(typeof storage.releaseExpiredPrivateRelayChainApproval, 'function');
  const live = await storage.releaseExpiredPrivateRelayChainApproval(context, key, 999, driver);
  assert.equal(live.revision, authorized.revision);
  const expired = await storage.releaseExpiredPrivateRelayChainApproval(context, key, 1000, driver);
  assert.equal(expired.relayChainedApproval, undefined);
  assert.equal(expired.pendingActions.length, 1, 'expired consent never releases a payment journal');
  assert.equal(expired.notes.filter(note => note.status === 'reserved').length, 2);
});

test('relay proof disclosure atomically reserves maximum fees and inputs before an unsigned helper rejection', async () => {
  const { disclosePrivateProof } = await import('../src/features/private-balance/runtime/proof-disclosure.ts');
  for (const invalid of [null, 'fee', 'output', 'CAS']) {
    const context = { accountId: 'atomic-proof', networkId: hex(1), realmId: hex(2), poolId: hex(3), deploymentBindingHash: hex(4) };
    const key = new Uint8Array(32).fill(7);
    let encrypted = null;
    let rejectCas = false;
    const memory = { read: async () => encrypted, removePrefix: async () => assert.fail('No state reset'), compareAndSet: async (_key, revision, value) => {
      if (rejectCas || (encrypted === null ? null : JSON.parse(encrypted).revision) !== revision) return { ok: false, current: encrypted };
      encrypted = value; return { ok: true, current: value };
    } };
    const consent = approval(); consent.contextKey = policy.privateRelayChainContextKey(context, ASSET);
    const step = record();
    let state = { ...storage.createEmptyPrivateBalanceState(hex(8), 1), notes: notes.map(note => ({ ...note,
      diversifier: '00000000', ownerCommitment: hex(5), actionIndex: 0, rho: hex(6), memoHex: '', senderFingerprintHex: '', createdAt: 1 })) };
    await storage.commitPrivateBalanceState(context, key, state, null, memory);
    state = await storage.beginPrivateRelayChainApproval(context, key, state.revision, consent, 500, memory);
    const issued = { ...state, revision: state.revision + 1, relayChainedApproval: { ...state.relayChainedApproval, selfAddresses: [step.recipientAddress] } };
    await storage.commitPrivateBalanceState(context, key, issued, state.revision, memory);
    state = await storage.reservePrivateBuildReservation(context, key, issued.revision, { id: step.actionId, kind: 'transfer', proofExposure: 'local', assetContractId: ASSET, reservedNoteIds: step.inputNoteIds, createdAt: 500_000, updatedAt: 500_000 }, memory);
    const pending = { id: step.actionId, kind: 'transfer', proofExposure: 'shared', assetContractId: ASSET, assetIndex: 0, status: 'prepared', submissionMode: 'relay',
      reservedNoteIds: step.inputNoteIds, actionField: step.actionField, nullifiers: [hex(30), hex(31)], outputCommitments: [step.outputCommitment, hex(32), hex(33)],
      anchorRoot: hex(34), anchorExpiresAtLedger: 1000, proofHash: hex(35), classicFeeCapStroops: '100', resourceFeeCapStroops: '900',
      amountStroops: step.amountAtomic, changeValueStroops: '0', broadcastAttempts: 0, createdAt: 500_000, updatedAt: 500_000,
      relayChain: { approvalId: consent.id, step: 0, feeAtomic: invalid === 'fee' ? '3' : '1', requestId: step.requestId, quoteId: step.quoteId, sourceAccount: step.sourceAccount,
        recipientAddress: step.recipientAddress, recipientOutputCommitment: invalid === 'output' ? hex(99) : step.outputCommitment, expiresAtSeconds: step.expiresAtSeconds } };
    rejectCas = invalid === 'CAS';
    let networkCalls = 0;
    await assert.rejects(disclosePrivateProof({ request: { kind: 'transfer' }, persistedRelayChainConsent: true,
      commit: async () => { state = await storage.commitPrivateBuildReservation(context, key, state.revision, pending.id, pending, memory); },
      disclose: async () => {
        networkCalls++;
        const persisted = await storage.loadPrivateBalanceState(context, key, memory);
        assert.equal(persisted.pendingActions[0].proofExposure, 'shared');
        assert.equal(persisted.pendingActions[0].transactionHash, undefined);
        assert.equal(persisted.relayChainedApproval.authorized[0].actionId, pending.id);
        assert.equal(persisted.relayChainedApproval.networkFeeStroops, '1000');
        assert.equal(persisted.relayChainedApproval.privateFeeAtomic, '1');
        throw new Error('Helper rejects preparation before returning an envelope');
      } }));
    assert.equal(networkCalls, invalid ? 0 : 1);
    const retained = await storage.loadPrivateBalanceState(context, key, memory);
    assert.equal(retained.notes.filter(note => note.status === 'reserved').length, 2);
    if (!invalid) {
      const swept = await storage.releaseStalePrivatePendingActions(context, key, 10_000_000, 1, memory);
      assert.equal(swept.pendingActions.length, 1);
      assert.equal(swept.relayChainedApproval.authorized.length, 1);
    } else assert.equal(retained.relayChainedApproval.authorized.length, 0);
  }
});

function chainHarness(overrides = {}) {
  const consent = overrides.approval ?? approval();
  let state = { notes: [...(overrides.notes ?? notes)], activities: [], pendingActions: [], relayChainedApproval: { approval: structuredClone(consent), authorized: [], privateFeeAtomic: '0', networkFeeStroops: '0', selfAddresses: [] } };
  const events = [];
  const signal = new AbortController();
  const input = { approval: consent, signal: signal.signal, now: () => 500_000,
    readState: async () => state, issueSelfAddress: async () => { const address = `private-own-${state.relayChainedApproval.authorized.length}`; state.relayChainedApproval.selfAddresses.push(address); return address; },
    selectPeer: async request => { events.push(['choose', request.step]); return { binding: { feeAtomic: '1', sourceAccount: 'helper',
      requestId: hex(21 + request.step), quoteId: hex(20 + request.step * 10), peerPublicKey: hex(30), privateFeeAddress: 'private-fee' },
      preparation: { expiresAt: 900, prepare: async () => assert.fail('driver cannot simulate directly') },
      submission: {}, close: () => events.push(['close', request.step]) }; },
    prepare: async (draft, chainStep, peer) => {
      events.push(['prepare', chainStep.step]);
      const inputs = policy.resolvePrivateRelayChainInputs(state.relayChainedApproval, state);
      const value = inputs.reduce((sum, note) => sum + BigInt(note.value), 0n);
      const review = { id: `action-${chainStep.step}`, actionField: hex(40 + chainStep.step), kind: draft.kind,
        assetContractId: ASSET, selectedNoteIds: inputs.map(note => note.id), recipientOutputCommitment: hex(50 + chainStep.step),
        amountStroops: draft.kind === 'consolidate' ? String(value - 1n) : consent.plan.amountAtomic, changeValueStroops: draft.kind === 'consolidate' ? '0' : String(value - BigInt(consent.plan.amountAtomic) - 1n), inputValueStroops: String(value),
        recipientAddress: chainStep.selfAddress ?? 'private-final', memoHex: draft.kind === 'transfer' ? Buffer.from('memo').toString('hex') : null,
        relay: peer.binding, transaction: { classicFeeStroops: 100n, resourceFeeStroops: 400n, expiresAt: 900, transactionHash: hex(60) } };
      const step = { actionId: review.id, step: chainStep.step, actionField: review.actionField, inputNoteIds: review.selectedNoteIds,
        outputCommitment: review.recipientOutputCommitment, amountAtomic: review.amountStroops, recipientAddress: review.recipientAddress,
        privateFeeAtomic: peer.binding.feeAtomic, networkFeeStroops: overrides.preExposureNetworkFeeStroops ?? consent.perStepMaxFeeStroops, quoteId: peer.binding.quoteId,
        requestId: peer.binding.requestId, sourceAccount: peer.binding.sourceAccount, expiresAtSeconds: peer.preparation.expiresAt };
      events.push(['authorize', step.step]);
      state.relayChainedApproval = policy.advancePrivateRelayChain(state.relayChainedApproval, step, 500, state);
      return review;
    },
    submit: async (_review, _peer, isFinal) => { events.push(['submit', isFinal]); return 'broadcast'; },
    cancel: async id => events.push(['cancel', id]),
    awaitConfirmation: async (_review, step) => {
      events.push(['canonical', step.step]);
      state.notes = state.notes.filter(note => !step.inputNoteIds.includes(note.id));
      state.notes.push({ ...notes[0], id: hex(70 + step.step), commitment: step.outputCommitment, value: step.amountAtomic, actionIndex: 8 });
      state.activities.push({ id: step.actionField, assetContractId: ASSET, actionIndex: 8, outputCommitments: [step.outputCommitment] });
      return true;
    }, ...overrides };
  return { input, events, signal };
}

test('relayed chain chooses a peer explicitly for each exact step and waits for canonical own output', async () => {
  assert.equal(typeof driverModule.runPrivateRelayChainedSend, 'function');
  const harness = chainHarness();
  const result = await driverModule.runPrivateRelayChainedSend(harness.input);
  assert.equal(result.status, 'broadcast');
  assert.deepEqual(harness.events.map(event => event[0]), ['choose', 'prepare', 'authorize', 'submit', 'canonical', 'close', 'choose', 'prepare', 'authorize', 'submit', 'close']);
});

test('a smaller independently journaled pre-exposure network cap stays valid while actual fees remain bounded by it', async () => {
  const smaller = chainHarness({ preExposureNetworkFeeStroops: '800' });
  assert.equal((await driverModule.runPrivateRelayChainedSend(smaller.input)).status, 'broadcast');
  const tooSmall = chainHarness({ preExposureNetworkFeeStroops: '400' });
  await assert.rejects(driverModule.runPrivateRelayChainedSend(tooSmall.input), /authorization|fee/);
  assert.equal(tooSmall.events.some(event => event[0] === 'submit'), false);
});

test('cheaper per-step helper quotes preserve the approved trace without using later notes', async () => {
  const inputs = [1, 2, 3, 4].map(n => ({ ...notes[0], id: hex(n), commitment: hex(n), value: '6', leafIndex: n }));
  const plan = planPrivateRelayConsolidation({ notes: inputs, assetContractId: ASSET, amountAtomic: 18n, perStepMaxPrivateFeeAtomic: 2n });
  const consent = { ...approval(), draft: { ...approval().draft, amount: '18' }, plan, steps: plan.steps, cumulativeMaxFeeStroops: String(plan.steps * 1000) };
  const harness = chainHarness({ approval: consent, notes: [...inputs, { ...notes[0], id: hex(99), commitment: hex(99), value: '100' }] });
  await driverModule.runPrivateRelayChainedSend(harness.input);
  const state = await harness.input.readState();
  assert.deepEqual(state.relayChainedApproval.authorized.map(step => step.amountAtomic), ['11', '16', '18']);
  assert.equal(state.relayChainedApproval.privateFeeAtomic, '3');
  assert.equal(state.relayChainedApproval.authorized.some(step => step.inputNoteIds.includes(hex(99))), false);
  assert.equal(new Set(state.relayChainedApproval.selfAddresses).size, 2);
});

test('final intent, authorization failure and context changes stop relay continuation without a fallback', async () => {
  for (const change of [{ amountStroops: '9' }, { recipientAddress: 'other' }, { memoHex: null }]) {
    const harness = chainHarness(); const prepare = harness.input.prepare;
    harness.input.prepare = async (...args) => { const review = await prepare(...args); return args[0].kind === 'transfer' ? { ...review, ...change } : review; };
    await assert.rejects(driverModule.runPrivateRelayChainedSend(harness.input));
    assert.equal(harness.events.filter(event => event[0] === 'submit').length, 1);
  }
  const failed = chainHarness({ prepare: async () => { throw new Error('CAS state changed before disclosure'); } });
  await assert.rejects(driverModule.runPrivateRelayChainedSend(failed.input), /CAS/);
  assert.equal(failed.events.some(event => event[0] === 'submit'), false);
  const changed = chainHarness();
  const choose = changed.input.selectPeer;
  changed.input.selectPeer = async (...args) => { const peer = await choose(...args); (await changed.input.readState()).relayChainedApproval.approval.contextKey = 'changed'; return peer; };
  await assert.rejects(driverModule.runPrivateRelayChainedSend(changed.input), /context|authorization/);
  assert.equal(changed.events.some(event => event[0] === 'submit'), false);
});

test('relayed chain fails closed on wrong merge, address, fees, unconfirmed output or cancellation', async () => {
  assert.equal(typeof driverModule.runPrivateRelayChainedSend, 'function');
  for (const change of [{ kind: 'transfer' }, { recipientAddress: 'not-own' }, { amountStroops: '8' },
    { assetContractId: 'wrong' }, { changeValueStroops: '1' }, { selectedNoteIds: [hex(1), hex(3)] },
    { relay: null }, { transaction: { classicFeeStroops: 1001n, resourceFeeStroops: 1n, expiresAt: 900 } }]) {
    const harness = chainHarness();
    const original = harness.input.prepare;
    harness.input.prepare = async (...args) => ({ ...await original(...args), ...change });
    await assert.rejects(driverModule.runPrivateRelayChainedSend(harness.input));
    assert.equal(harness.events.some(event => event[0] === 'submit'), false);
    assert.equal(harness.events.some(event => event[0] === 'cancel'), true);
  }
  const unconfirmed = chainHarness({ awaitConfirmation: async () => true });
  await assert.rejects(driverModule.runPrivateRelayChainedSend(unconfirmed.input), /canonical|output|confirm/i);
  assert.equal(unconfirmed.events.filter(event => event[0] === 'choose').length, 1);
  const cancelled = chainHarness();
  const original = cancelled.input.prepare;
  cancelled.input.prepare = async (...args) => { const review = await original(...args); cancelled.signal.abort(); return review; };
  await assert.rejects(driverModule.runPrivateRelayChainedSend(cancelled.input), /cancel/i);
  assert.equal(cancelled.events.some(event => event[0] === 'submit'), false);
});

test('relay consolidation preparation verifies the full fresh own address and fixed inputs before proving', async () => {
  assert.equal(typeof preparation.validatePrivateRelayChainPreparation, 'function');
  const { encodePrivateAddress, derivePrivateAddressDeploymentTag } = await import('@stellarkey/private-balance');
  const scope = { accountId: 'account', networkId: hex(1), realmId: hex(2), poolId: hex(3), deploymentBindingHash: hex(4) };
  const address = encodePrivateAddress({ deploymentTag: derivePrivateAddressDeploymentTag(Uint8Array.from(Buffer.from(hex(4), 'hex'))),
    diversifier: new Uint8Array([0, 0, 0, 1]), ownerCommitment: new Uint8Array(32).fill(5), hpkePublicKey: new Uint8Array(32).fill(6) }, 'tskpay_');
  const consent = approval(); consent.contextKey = policy.privateRelayChainContextKey(scope, ASSET);
  const input = { state: { notes, activities: [], pendingActions: [], issuedAddressDiversifiers: ['00000001'],
    relayChainedApproval: { approval: consent, authorized: [], privateFeeAtomic: '0', networkFeeStroops: '0', selfAddresses: [address] } },
    scope, assetContractId: ASSET, assetIndex: 0, assetDecimals: 0, nowSeconds: 500,
    draft: { kind: 'consolidate', relay: { feeAtomic: '1' } }, chain: { approvalId: consent.id, step: 0, selfAddress: address },
    deriveOwnAddress: async () => address, networkPassphrase: 'Test SDF Network ; September 2015' };
  const selected = await preparation.validatePrivateRelayChainPreparation(input);
  assert.equal(selected.amount, 7n);
  assert.equal(selected.recipientAddress, address);
  assert.deepEqual(selected.noteIds, [hex(1), hex(2)]);
  for (const change of [{ deriveOwnAddress: async () => 'another full address' }, { assetContractId: 'other' },
    { chain: { ...input.chain, step: 1 } }, { nowSeconds: 1000 },
    { state: { ...input.state, issuedAddressDiversifiers: [] } }, { draft: { kind: 'consolidate' } },
    { state: { ...input.state, relayChainedApproval: { ...input.state.relayChainedApproval, selfAddresses: ['previously shared address'] } } },
    { state: { ...input.state, notes: [...notes.slice(1), { ...notes[0], status: 'spent' }] } }]) {
    await assert.rejects(preparation.validatePrivateRelayChainPreparation({ ...input, ...change }));
  }
});
