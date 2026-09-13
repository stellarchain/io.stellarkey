import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { preparePrivateBalanceActionFlow } from '../src/features/private-balance/runtime/action-flow.ts';
import { prepareReviewedPrivateBalanceTransaction } from '../src/features/private-balance/runtime/action-transaction.ts';
import { preparePrivateAction } from '../src/features/private-balance/worker/action-builder.ts';
import * as storage from '../src/features/private-balance/runtime/storage.ts';
import { broadcastPrivateBalanceAction, signReviewedPrivateBalanceAction } from '../src/features/private-balance/runtime/submission.ts';
import { planPrivateChainedSend, runPrivateChainedSend } from '../src/features/private-balance/runtime/chained-send.ts';
import { disclosePrivateProof } from '../src/features/private-balance/runtime/proof-disclosure.ts';

const hex = n => n.toString(16).padStart(64, '0');
const ASSET = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';

// Raw historical data, not a new relay action built by the application.
async function legacyFixture(mode = 'relay', status = 'reviewed') {
  const context = { accountId: 'synthetic-legacy', networkId: hex(1), realmId: hex(2), poolId: hex(3), deploymentBindingHash: hex(4) };
  const key = new Uint8Array(32).fill(7);
  let encrypted = null;
  let refuseCommit = false;
  const driver = {
    read: async () => encrypted,
    removePrefix: async () => assert.fail('Migration cannot reset private state'),
    compareAndSet: async (_recordKey, revision, value) => {
      if (refuseCommit || (encrypted === null ? null : JSON.parse(encrypted).revision) !== revision) return { ok: false, current: encrypted };
      encrypted = value; return { ok: true, current: value };
    },
  };
  const notes = [1, 2, 3].map(n => ({ id: hex(n), commitment: hex(n), value: '4', leafIndex: BigInt(n),
    assetContractId: ASSET, assetIndex: 0, status: n < 3 ? 'reserved' : 'unspent', ...(n < 3 ? { reservedAt: 1 } : {}),
    diversifier: '00000000', ownerCommitment: hex(5), actionIndex: 0n, rho: hex(6), memoHex: '', senderFingerprintHex: '', createdAt: 1 }));
  const approval = { id: 'legacy-chain', submissionMode: 'relay',
    contextKey: JSON.stringify([context.accountId, context.networkId, context.realmId, context.poolId, context.deploymentBindingHash, ASSET]),
    assetContractId: ASSET, assetIndex: 0, draft: { kind: 'transfer', amount: '10', recipientAddress: 'synthetic-final' },
    steps: 2, perStepMaxFeeStroops: '1000', cumulativeMaxFeeStroops: '2000', expiresAtSeconds: 2_000_000_000,
    plan: { amountAtomic: '10', perStepMaxPrivateFeeAtomic: '1', cumulativeMaxPrivateFeeAtomic: '2', steps: 2,
      inputNotes: notes.map(({ id, commitment, value }) => ({ id, commitment, value })),
      merges: [{ left: `note:${hex(1)}`, right: `note:${hex(2)}`, output: 'merge:0', minimumOutputValue: '7', maximumOutputValue: '8' }],
      finalInputs: ['merge:0', `note:${hex(3)}`] } };
  const pending = { id: 'legacy-action', kind: 'transfer', assetContractId: ASSET, assetIndex: 0, status,
    ...(mode === undefined ? {} : { submissionMode: mode }), proofExposure: 'shared', reservedNoteIds: [hex(1), hex(2)],
    actionField: hex(10), nullifiers: [hex(30), hex(31)], outputCommitments: [hex(11), hex(32), hex(33)],
    anchorRoot: hex(34), anchorExpiresAtLedger: 1000, proofHash: hex(35), classicFeeCapStroops: '100', resourceFeeCapStroops: '400',
    amountStroops: '7', changeValueStroops: '0', transactionHash: hex(36), broadcastAttempts: 0, createdAt: 1, updatedAt: 2,
    ...(status === 'signed' ? { signedEnvelopeXdr: 'NON_USABLE_SYNTHETIC_ENVELOPE', expiresAtSeconds: 2_000_000_000 } : {}) };
  if (mode === 'relay') pending.relayChain = { approvalId: approval.id, step: 0, feeAtomic: '1', requestId: hex(21), quoteId: hex(20), sourceAccount: 'synthetic-helper', recipientAddress: 'synthetic-own', recipientOutputCommitment: hex(11), expiresAtSeconds: 1900 };
  const state = { ...storage.createEmptyPrivateBalanceState(hex(8), 1), notes, pendingActions: [pending], issuedAddressDiversifiers: ['01020304'],
    relayChainedApproval: { approval, authorized: [], privateFeeAtomic: '0', networkFeeStroops: '0', selfAddresses: ['synthetic-own'] } };
  await storage.commitPrivateBalanceState(context, key, state, null, driver);
  return { context, key, state, pending, driver, refuseCommit: () => { refuseCommit = true; } };
}

const removed = /Peer relaying has been removed/i;
const root = new URL('../', import.meta.url);

for (const kind of ['deposit', 'transfer', 'withdraw', 'consolidate']) {
  test(`direct-only preparation rejects an obsolete ${kind} relay binding before touching private state`, async () => {
    let touched = false;
    await assert.rejects(preparePrivateBalanceActionFlow({
      draft: { kind, relay: { sourceAccount: 'NON_USABLE_SYNTHETIC_HELPER' } },
      storageDriver: { async read() { touched = true; throw new Error('Private state was accessed'); } },
    }), removed);
    assert.equal(touched, false);
  });
}

for (const option of ['relayPreparation', 'relayChainStep']) {
  test(`direct-only preparation rejects obsolete ${option} before touching private state`, async () => {
    await assert.rejects(preparePrivateBalanceActionFlow({
      draft: { kind: 'deposit', amount: '1' },
      [option]: {},
    }), removed);
  });
}

test('direct-only transaction preparation refuses relay mode instead of falling back to RPC', async () => {
  let remotePreparation = 0;
  let rpcCalls = 0;
  await assert.rejects(prepareReviewedPrivateBalanceTransaction({
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: 500n,
    submissionMode: 'relay',
    relayPreparation: {
      expiresAt: 2_000_000_000,
      async prepare() { remotePreparation += 1; throw new Error('Obsolete helper contacted'); },
    },
    rpc: { async getAccount() { rpcCalls += 1; throw new Error('Unexpected direct fallback'); } },
    nowSeconds: 1_000,
  }), removed);
  assert.deepEqual([remotePreparation, rpcCalls], [0, 0]);
});

for (const kind of ['transfer', 'withdraw', 'consolidate']) {
  test(`direct-only worker refuses an obsolete ${kind} peer fee before constructing outputs`, async () => {
    await assert.rejects(preparePrivateAction({
      intent: { kind, peerFee: { amount: '1', recipientAddress: 'NON_USABLE_SYNTHETIC_FEE_ADDRESS' } },
    }), removed);
  });
}

test('direct-only storage rejects creating a new legacy relayed pending action', async () => {
  await assert.rejects(storage.commitPrivateBuildReservation({}, new Uint8Array(32), 0, 'stale', { submissionMode: 'relay' }), removed);
});

for (const target of ['approval', 'draft']) test(`direct-only chain refuses an obsolete ${target} before any preparation`, async () => {
  const approval = planPrivateChainedSend({ approvalId: 'direct-test', consolidationActionCount: 1,
    perStepMaxFeeStroops: 100n, publicXlmBalanceStroops: 200n, nowSeconds: 1 });
  const draft = { kind: 'transfer', amount: '1', recipientAddress: 'synthetic-recipient' };
  if (target === 'approval') approval.submissionMode = 'relay';
  else draft.relay = {};
  await assert.rejects(runPrivateChainedSend({ approval, draft, assetDecimals: 7, now: () => 1000,
    prepare: async () => assert.fail('Stale relay chain cannot create a direct proof') }), removed);
});

test('direct-only chain rejects an obsolete prepared relay step before fee authorization or submission', async () => {
  const approval = planPrivateChainedSend({ approvalId: 'direct-test', consolidationActionCount: 1,
    perStepMaxFeeStroops: 100n, publicXlmBalanceStroops: 200n, nowSeconds: 1 });
  let cancelled = 0;
  await assert.rejects(runPrivateChainedSend({ approval,
    draft: { kind: 'transfer', amount: '1', recipientAddress: 'synthetic-recipient' }, ownFingerprint: 'SYNTHETIC', assetDecimals: 7, now: () => 1000,
    prepare: async () => ({ id: 'legacy-step', kind: 'consolidate', recipientFingerprint: 'SYNTHETIC', relay: {}, transaction: { classicFeeStroops: 50n, resourceFeeStroops: 50n } }),
    advanceApprovedFee: async () => assert.fail('No fee authorization for a stale relay step'),
    cancel: async () => { cancelled++; }, submit: async () => assert.fail('No stale relay submission') }), removed);
  assert.equal(cancelled, 1);
});

for (const request of [{ kind: 'transfer', submissionMode: 'relay' }, { kind: 'transfer', submissionMode: 'direct', privateFeeAtomic: '1' }]) {
  test('direct-only disclosure rejects obsolete relay intent before consent or a durable write', async () => {
    await assert.rejects(disclosePrivateProof({ request,
      authorize: async () => assert.fail('No stale relay consent'), commit: async () => assert.fail('No stale relay commit'),
      disclose: async () => assert.fail('No stale relay network request') }), removed);
  });
}

for (const mode of ['relay', null]) {
  test(`direct-only signing rejects a persisted ${mode ?? 'missing'} route before parsing or signing`, async () => {
    const fixture = await legacyFixture(mode ?? undefined);
    if (mode === null) {
      delete fixture.state.pendingActions[0].submissionMode;
      delete fixture.state.pendingActions[0].relayChain;
      await storage.commitPrivateBalanceState(fixture.context, fixture.key, { ...fixture.state, revision: 1 }, 0, fixture.driver);
    }
    await assert.rejects(signReviewedPrivateBalanceAction({ context: fixture.context, storageKey: fixture.key,
      expectedRevision: mode === null ? 1 : 0, actionId: fixture.pending.id, now: () => 1000,
      review: { expiresAt: 2_000_000_000, transactionHash: fixture.pending.transactionHash, envelopeXdr: 'NON_USABLE_SYNTHETIC_ENVELOPE' },
      sign: async () => assert.fail('Legacy route cannot invoke signing'), storageDriver: fixture.driver }), removed);
  });
}

test('direct-only broadcast rejects relay mode before reading storage or networking', async () => {
  await assert.rejects(broadcastPrivateBalanceAction({ submissionMode: 'relay',
    storageDriver: { read: async () => assert.fail('No private state read') },
    rpc: { sendTransaction: async () => assert.fail('No network call') } }), removed);
});

test('obsolete consent retires atomically without releasing legacy notes, addresses, or pending records', async () => {
  assert.equal(typeof storage.retireLegacyPrivateRelayConsent, 'function');
  const fixture = await legacyFixture();
  const migrated = await storage.retireLegacyPrivateRelayConsent(fixture.context, fixture.key, fixture.driver);
  assert.equal(migrated.relayChainedApproval, undefined);
  assert.equal(migrated.revision, 1);
  for (const field of ['notes', 'pendingActions', 'buildReservations', 'issuedAddressDiversifiers', 'activities']) assert.deepEqual(migrated[field], fixture.state[field]);
  assert.deepEqual(await storage.loadPrivateBalanceState(fixture.context, fixture.key, fixture.driver), migrated);
  assert.equal((await storage.retireLegacyPrivateRelayConsent(fixture.context, fixture.key, fixture.driver)).revision, 1);
});

test('obsolete consent retirement loses no holds when its compare-and-set fails', async () => {
  assert.equal(typeof storage.retireLegacyPrivateRelayConsent, 'function');
  const fixture = await legacyFixture();
  fixture.refuseCommit();
  await assert.rejects(storage.retireLegacyPrivateRelayConsent(fixture.context, fixture.key, fixture.driver), /changed|conflict/i);
  assert.deepEqual(await storage.loadPrivateBalanceState(fixture.context, fixture.key, fixture.driver), fixture.state);
});

test('relay-only networking dependencies are absent from the manifest and installed lock graph', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
  for (const name of ['@waku/sdk', '@chainsafe/libp2p-yamux', '@libp2p/mplex', 'nostr-tools']) {
    assert.equal(manifest.dependencies?.[name], undefined, `${name} must not remain a direct dependency`);
    assert.equal(lock.packages?.['']?.dependencies?.[name], undefined, `${name} must not remain in the root lock entry`);
  }
  assert.equal(Object.keys(lock.packages).some(path => /node_modules\/(?:@waku\/|@libp2p\/|@chainsafe\/libp2p-|nostr-tools(?:\/|$))/u.test(path)), false);
});

test('application source cannot import relay transports or expose helper signing APIs', () => {
  function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const location = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
      return entry.isDirectory() ? files(location) : /\.[cm]?[jt]sx?$/u.test(entry.name) ? [location] : [];
    });
  }
  for (const file of files(new URL('src/', root))) {
    const source = readFileSync(file, 'utf8');
    assert.equal(/(?:from\s*|import\s*\()\s*['"][^'"]*(?:@waku\/|@libp2p\/|@chainsafe\/libp2p-|nostr-tools|\/relay\/)/u.test(source), false, file.pathname);
    assert.equal(/\b(?:derivePrivateRelayPayout|preparePrivateRelayJob|reviewPrivateRelayJob|signPrivateRelayJob|submitPrivateRelayJob|prepareRelayChainedSend|submitRelayChainedSend)\b/u.test(source), false, file.pathname);
  }
  assert.equal(existsSync(new URL('src/features/private-balance/relay/', root)), false);
});
