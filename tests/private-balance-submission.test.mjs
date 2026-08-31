import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Keypair,
  SorobanDataBuilder,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { PrivateBalanceTransactionBuilder } from '../src/features/private-balance/runtime/transaction-builder.ts';
import { reviewPrivateBalanceTransaction } from '../src/features/private-balance/runtime/transaction-review.ts';
import {
  assertReviewedPrivateActionEndpoint,
  preparePrivateBalanceActionFlow,
  PrivateActionInFlightError,
} from '../src/features/private-balance/runtime/action-flow.ts';
import {
  broadcastPrivateBalanceAction,
  classifyPrivateActionRecovery,
  pollBroadcastPrivateBalanceTransaction,
  recoverPrivateBalanceAction,
  resumeSignedPrivateBalanceActions,
  signReviewedPrivateBalanceAction,
  validateSignedPrivateBalanceEnvelope,
  PrivateActionReviewExpiredError,
  PRIVATE_ACTION_EXPIRY_MARGIN_SECONDS,
  PRIVATE_BROADCAST_POLL_DELAYS_MS,
} from '../src/features/private-balance/runtime/submission.ts';
import {
  commitPrivateBalanceState,
  commitPrivateBuildReservation,
  createEmptyPrivateBalanceState,
  loadPrivateBalanceState,
  reservePrivateBuildReservation,
  transitionPrivatePendingAction,
} from '../src/features/private-balance/runtime/storage.ts';
import { readFileSync } from 'node:fs';

const networkPassphrase = 'Test SDF Network ; September 2015';
const poolContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';
const ASSET_CONTRACT_ID = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
const bytes = (length, value) => new Uint8Array(length).fill(value);

test('action controllers publish terminal status outside remountable modal state', () => {
  const controller = readFileSync(
    new URL('../src/features/private-balance/components/usePrivateActionController.ts', import.meta.url),
    'utf8',
  );
  assert.match(controller, /const status = await submitAction\(review\)/);
  assert.match(controller, /onSubmission\?\.\(status\)/);
});

function reviewedFixture() {
  const signer = Keypair.random();
  const operation = new PrivateBalanceTransactionBuilder({ poolContractId }).buildTransferOperation({
    action: {
      assetContractId: ASSET_CONTRACT_ID,
      actionNonce: bytes(32, 1),
      anchorRoot: bytes(32, 2),
      nullifiers: [bytes(32, 3), bytes(32, 0)],
      outputs: [
        { commitment: bytes(32, 4), recipientEnvelope: bytes(181, 5) },
        { commitment: bytes(32, 6), recipientEnvelope: bytes(181, 7) },
      ],
      publicValue: 0n,
      relayerFee: 0n,
      relayer: signer.publicKey(),
    },
    proof: { a: bytes(64, 8), b: bytes(128, 9), c: bytes(64, 10) },
  });
  const data = new SorobanDataBuilder().setResourceFee('500').build();
  const transaction = new TransactionBuilder(new Account(signer.publicKey(), '7'), {
    fee: '100',
    networkPassphrase,
    timebounds: { minTime: 1, maxTime: 2_000_000_000 },
  }).addOperation(operation).setSorobanData(data).build();
  const review = reviewPrivateBalanceTransaction({
    envelopeXdr: transaction.toXdr(),
    manifest: { networkPassphrase, poolContractId },
    assetContractId: ASSET_CONTRACT_ID,
    source: signer.publicKey(),
    sequence: '8',
    timeBounds: { minTime: '1', maxTime: '2000000000' },
    operation,
    simulationTransactionDataXdr: data.toXDR('base64'),
    maximumClassicFeeStroops: 100n,
    maximumResourceFeeStroops: 500n,
  });
  return { signer, transaction, review };
}

test('private submission accepts only the signed reviewed envelope and recovers conservatively', () => {
  const { signer, transaction, review } = reviewedFixture();
  transaction.sign(signer);
  const signed = validateSignedPrivateBalanceEnvelope({
    signedEnvelopeXdr: transaction.toXdr(),
    networkPassphrase,
    expectedTransactionHash: review.transactionHash,
  });
  assert.equal(signed.hash, review.transactionHash);
  assert.equal(signed.signatures, 1);

  const changed = reviewedFixture();
  changed.transaction.sign(changed.signer);
  assert.throws(
    () => validateSignedPrivateBalanceEnvelope({
      signedEnvelopeXdr: changed.transaction.toXdr(),
      networkPassphrase,
      expectedTransactionHash: review.transactionHash,
    }),
    /reviewed transaction/i,
  );

  const action = {
    actionField: '11'.repeat(32),
    nullifiers: ['22'.repeat(32), '00'.repeat(32)],
  };
  assert.equal(classifyPrivateActionRecovery(action, 'NOT_FOUND', [], []), 'ambiguous');
  assert.equal(classifyPrivateActionRecovery(action, 'FAILED', [], []), 'release');
  assert.equal(classifyPrivateActionRecovery(action, 'NOT_FOUND', [action.actionField], []), 'confirmed');
  assert.equal(classifyPrivateActionRecovery(action, 'FAILED', [], [action.nullifiers[0]]), 'ambiguous');
});

test('private submission invalidates approval when the selected RPC endpoint changes', () => {
  assert.doesNotThrow(() => assertReviewedPrivateActionEndpoint(
    { rpcUrl: 'https://rpc.example.test' },
    'https://rpc.example.test/',
  ));
  assert.throws(
    () => assertReviewedPrivateActionEndpoint(
      { rpcUrl: 'https://rpc-a.example.test' },
      'https://rpc-b.example.test',
    ),
    /endpoint changed.*new review/i,
  );
});

test('private signing persists the exact envelope before an ambiguous broadcast', async () => {
  class MemoryDriver {
    records = new Map();
    async read(key) { return this.records.get(key) ?? null; }
    async compareAndSet(key, expectedRevision, value) {
      const current = this.records.get(key) ?? null;
      const revision = current === null ? null : JSON.parse(current).revision;
      if (revision !== expectedRevision) return { ok: false, current };
      this.records.set(key, value);
      return { ok: true, current: value };
    }
    async removePrefix() {}
  }
  const context = {
    networkId: '01'.repeat(32),
    realmId: '02'.repeat(32),
    poolId: '03'.repeat(32),
    accountId: 'account-1',
    deploymentBindingHash: '05'.repeat(32),
  };
  const storageKey = bytes(32, 12);
  const driver = new MemoryDriver();
  const note = {
    id: '13'.repeat(32),
    commitment: '13'.repeat(32),
    value: '5000000',
    assetContractId: ASSET_CONTRACT_ID,
    diversifier: '00000000',
    ownerCommitment: '14'.repeat(32),
    leafIndex: 0,
    actionIndex: 0,
    rho: '15'.repeat(32),
    memoHex: '',
    senderFingerprintHex: '',
    status: 'unspent',
    createdAt: 1,
  };
  await commitPrivateBalanceState(
    context,
    storageKey,
    { ...createEmptyPrivateBalanceState('16'.repeat(32), 1), notes: [note] },
    null,
    driver,
  );
  const fixture = reviewedFixture();
  const pending = {
    id: 'action-1',
    kind: 'transfer',
    assetContractId: ASSET_CONTRACT_ID,
    status: 'prepared',
    reservedNoteIds: [note.id],
    actionField: '17'.repeat(32),
    nullifiers: ['18'.repeat(32), '00'.repeat(32)],
    outputCommitments: ['19'.repeat(32), '1a'.repeat(32)],
    anchorRoot: '1b'.repeat(32),
    anchorExpiresAtLedger: 500,
    proofHash: '1c'.repeat(32),
    classicFeeCapStroops: '100',
    resourceFeeCapStroops: '500',
    broadcastAttempts: 0,
    createdAt: 2,
    updatedAt: 2,
  };
  await reservePrivateBuildReservation(context, storageKey, 0, {
    id: pending.id,
    kind: pending.kind,
    assetContractId: pending.assetContractId,
    reservedNoteIds: pending.reservedNoteIds,
    createdAt: pending.createdAt,
    updatedAt: pending.createdAt,
  }, driver);
  await commitPrivateBuildReservation(context, storageKey, 1, pending.id, pending, driver);
  await transitionPrivatePendingAction(
    context,
    storageKey,
    2,
    pending.id,
    { from: 'prepared', to: 'reviewed', transactionHash: fixture.review.transactionHash, updatedAt: 3 },
    driver,
  );

  const signed = await signReviewedPrivateBalanceAction({
    context,
    storageKey,
    expectedRevision: 3,
    actionId: pending.id,
    review: fixture.review,
    networkPassphrase,
    sign: async ({ envelopeXdr, transactionHash }) => {
      assert.equal(envelopeXdr, fixture.review.envelopeXdr);
      assert.equal(transactionHash, fixture.review.transactionHash);
      fixture.transaction.sign(fixture.signer);
      return fixture.transaction.toXdr();
    },
    storageDriver: driver,
    now: () => 4,
  });
  assert.equal(signed.pendingActions[0].status, 'signed');
  assert.equal(signed.pendingActions[0].expiresAtSeconds, 2_000_000_000);

  const broadcast = await broadcastPrivateBalanceAction({
    context,
    storageKey,
    expectedRevision: 4,
    actionId: pending.id,
    networkPassphrase,
    rpc: { async sendTransaction() { throw new Error('timeout'); } },
    storageDriver: driver,
    now: () => 5,
  });
  assert.equal(broadcast.status, 'ambiguous');
  assert.equal(broadcast.rpcStatus, 'UNAVAILABLE');
  assert.equal(broadcast.state.pendingActions[0].broadcastAttempts, 1);
  assert.equal(broadcast.state.notes[0].status, 'reserved');

  const missing = await recoverPrivateBalanceAction({
    context,
    storageKey,
    actionId: pending.id,
    rpc: { async getTransaction() { return { status: 'NOT_FOUND' }; } },
    scanCanonicalTranscript: async () => ({ actionFields: [], nullifiers: [] }),
    storageDriver: driver,
    now: () => 6,
  });
  assert.equal(missing.outcome, 'ambiguous');
  assert.equal(missing.state.pendingActions[0].latestRpcStatus, 'NOT_FOUND');
  assert.equal(missing.state.pendingActions[0].broadcastAttempts, 1);
  assert.equal(missing.state.notes[0].status, 'reserved');

  const failed = await recoverPrivateBalanceAction({
    context,
    storageKey,
    actionId: pending.id,
    rpc: { async getTransaction() { return { status: 'FAILED' }; } },
    scanCanonicalTranscript: async () => ({ actionFields: [], nullifiers: [] }),
    storageDriver: driver,
    now: () => 7,
  });
  assert.equal(failed.outcome, 'release');
  assert.equal(failed.state.pendingActions.length, 0);
  assert.equal(failed.state.notes[0].status, 'unspent');
});

test('post-broadcast polling is a read-only trigger for canonical reconciliation', async () => {
  assert.deepEqual([...PRIVATE_BROADCAST_POLL_DELAYS_MS], [1_000, 2_000, 4_000, 8_000, 15_000]);

  const delays = [];
  const statuses = ['NOT_FOUND', 'NOT_FOUND', 'SUCCESS'];
  let reconciliations = 0;
  const result = await pollBroadcastPrivateBalanceTransaction({
    transactionHash: 'ab'.repeat(32),
    rpc: {
      async getTransaction() {
        return { status: statuses[Math.min(delays.length - 1, statuses.length - 1)] };
      },
    },
    sleep: async (delay) => { delays.push(delay); },
    reconcile: async (rpcStatus) => {
      assert.equal(rpcStatus, 'SUCCESS');
      reconciliations += 1;
      return true;
    },
  });
  assert.equal(result, 'confirmed');
  assert.deepEqual(delays, [1_000, 2_000, 4_000]);
  assert.equal(reconciliations, 1);

  // FAILED alone never resolves the pending action: reconciliation keeps the
  // durable journal authoritative and the poll gives up as 'pending'.
  const failedStatuses = [];
  const unresolved = await pollBroadcastPrivateBalanceTransaction({
    transactionHash: 'cd'.repeat(32),
    rpc: { async getTransaction() { return { status: 'FAILED' }; } },
    sleep: async () => {},
    reconcile: async (rpcStatus) => {
      failedStatuses.push(rpcStatus);
      return false;
    },
  });
  assert.equal(unresolved, 'pending');
  assert.deepEqual(failedStatuses, ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'FAILED']);
});

test('accepted private broadcasts remain conservatively journaled across a concurrent state revision', async () => {
  class MemoryDriver {
    records = new Map();
    async read(key) { return this.records.get(key) ?? null; }
    async compareAndSet(key, expectedRevision, value) {
      const current = this.records.get(key) ?? null;
      const revision = current === null ? null : JSON.parse(current).revision;
      if (revision !== expectedRevision) return { ok: false, current };
      this.records.set(key, value);
      return { ok: true, current: value };
    }
    async removePrefix() {}
  }
  const context = {
    networkId: '21'.repeat(32),
    realmId: '22'.repeat(32),
    poolId: '23'.repeat(32),
    accountId: 'concurrent-account',
    deploymentBindingHash: '25'.repeat(32),
  };
  const storageKey = bytes(32, 26);
  const driver = new MemoryDriver();
  const note = {
    id: '27'.repeat(32),
    commitment: '27'.repeat(32),
    value: '5000000',
    assetContractId: ASSET_CONTRACT_ID,
    diversifier: '00000000',
    ownerCommitment: '28'.repeat(32),
    leafIndex: 0,
    actionIndex: 0,
    rho: '29'.repeat(32),
    memoHex: '',
    senderFingerprintHex: '',
    status: 'unspent',
    createdAt: 1,
  };
  await commitPrivateBalanceState(
    context,
    storageKey,
    { ...createEmptyPrivateBalanceState('2a'.repeat(32), 1), notes: [note] },
    null,
    driver,
  );
  const fixture = reviewedFixture();
  const pending = {
    id: 'concurrent-action',
    kind: 'transfer',
    assetContractId: ASSET_CONTRACT_ID,
    status: 'prepared',
    reservedNoteIds: [note.id],
    actionField: '2b'.repeat(32),
    nullifiers: ['2c'.repeat(32), '00'.repeat(32)],
    outputCommitments: ['2d'.repeat(32), '2e'.repeat(32)],
    anchorRoot: '2f'.repeat(32),
    anchorExpiresAtLedger: 500,
    proofHash: '30'.repeat(32),
    classicFeeCapStroops: '100',
    resourceFeeCapStroops: '500',
    broadcastAttempts: 0,
    createdAt: 2,
    updatedAt: 2,
  };
  await reservePrivateBuildReservation(context, storageKey, 0, {
    id: pending.id,
    kind: pending.kind,
    assetContractId: pending.assetContractId,
    reservedNoteIds: pending.reservedNoteIds,
    createdAt: pending.createdAt,
    updatedAt: pending.createdAt,
  }, driver);
  await commitPrivateBuildReservation(context, storageKey, 1, pending.id, pending, driver);
  await transitionPrivatePendingAction(
    context,
    storageKey,
    2,
    pending.id,
    { from: 'prepared', to: 'reviewed', transactionHash: fixture.review.transactionHash, updatedAt: 3 },
    driver,
  );
  const signed = await signReviewedPrivateBalanceAction({
    context,
    storageKey,
    expectedRevision: 3,
    actionId: pending.id,
    review: fixture.review,
    networkPassphrase,
    sign: async () => {
      fixture.transaction.sign(fixture.signer);
      return fixture.transaction.toXdr();
    },
    storageDriver: driver,
    now: () => 4,
  });

  const broadcast = await broadcastPrivateBalanceAction({
    context,
    storageKey,
    expectedRevision: signed.revision,
    actionId: pending.id,
    networkPassphrase,
    rpc: {
      async sendTransaction() {
        const concurrent = await loadPrivateBalanceState(context, storageKey, driver);
        assert.ok(concurrent);
        await commitPrivateBalanceState(
          context,
          storageKey,
          { ...concurrent, revision: concurrent.revision + 1 },
          concurrent.revision,
          driver,
        );
        return { status: 'PENDING', hash: fixture.review.transactionHash };
      },
    },
    storageDriver: driver,
    now: () => 5,
  });

  assert.equal(broadcast.status, 'ambiguous');
  assert.equal(broadcast.state.pendingActions[0].status, 'ambiguous');
  assert.equal(broadcast.state.pendingActions[0].broadcastAttempts, 1);
  assert.equal(broadcast.state.notes[0].status, 'reserved');
});

class MemoryDriver {
  records = new Map();
  async read(key) { return this.records.get(key) ?? null; }
  async compareAndSet(key, expectedRevision, value) {
    const current = this.records.get(key) ?? null;
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    this.records.set(key, value);
    return { ok: true, current: value };
  }
  async removePrefix() {}
}

function stateFixture(accountId) {
  return {
    context: {
      networkId: '31'.repeat(32),
      realmId: '32'.repeat(32),
      poolId: '33'.repeat(32),
      accountId,
      deploymentBindingHash: '35'.repeat(32),
    },
    storageKey: bytes(32, 40),
    note: {
      id: '36'.repeat(32),
      commitment: '36'.repeat(32),
      value: '5000000',
      assetContractId: ASSET_CONTRACT_ID,
      diversifier: '00000000',
      ownerCommitment: '37'.repeat(32),
      leafIndex: 0,
      actionIndex: 0,
      rho: '38'.repeat(32),
      memoHex: '',
      senderFingerprintHex: '',
      status: 'unspent',
      createdAt: 1,
    },
    driver: new MemoryDriver(),
  };
}

test('signing refuses an expired review before requesting a signature', async () => {
  const { context, storageKey, driver } = stateFixture('expired-review-account');
  const fixture = reviewedFixture();
  await assert.rejects(
    () => signReviewedPrivateBalanceAction({
      context,
      storageKey,
      expectedRevision: 0,
      actionId: 'action-1',
      review: fixture.review,
      networkPassphrase,
      sign: async () => assert.fail('an expired review must never reach the signer'),
      storageDriver: driver,
      now: () => fixture.review.expiresAt * 1000,
    }),
    PrivateActionReviewExpiredError,
  );
});

test('persisted signed actions resume through broadcast and release after time-bound finality', async () => {
  const { context, storageKey, note, driver } = stateFixture('resume-account');
  await commitPrivateBalanceState(
    context,
    storageKey,
    { ...createEmptyPrivateBalanceState('39'.repeat(32), 1), notes: [note] },
    null,
    driver,
  );
  const fixture = reviewedFixture();
  const pending = {
    id: 'resume-action',
    kind: 'transfer',
    assetContractId: ASSET_CONTRACT_ID,
    status: 'prepared',
    reservedNoteIds: [note.id],
    actionField: '3a'.repeat(32),
    nullifiers: ['3b'.repeat(32), '00'.repeat(32)],
    outputCommitments: ['3c'.repeat(32), '3d'.repeat(32)],
    anchorRoot: '3e'.repeat(32),
    anchorExpiresAtLedger: 500,
    proofHash: '3f'.repeat(32),
    classicFeeCapStroops: '100',
    resourceFeeCapStroops: '500',
    broadcastAttempts: 0,
    createdAt: 2,
    updatedAt: 2,
  };
  await reservePrivateBuildReservation(context, storageKey, 0, {
    id: pending.id,
    kind: pending.kind,
    assetContractId: pending.assetContractId,
    reservedNoteIds: pending.reservedNoteIds,
    createdAt: pending.createdAt,
    updatedAt: pending.createdAt,
  }, driver);
  await commitPrivateBuildReservation(context, storageKey, 1, pending.id, pending, driver);
  await transitionPrivatePendingAction(
    context,
    storageKey,
    2,
    pending.id,
    { from: 'prepared', to: 'reviewed', transactionHash: fixture.review.transactionHash, updatedAt: 3 },
    driver,
  );
  await signReviewedPrivateBalanceAction({
    context,
    storageKey,
    expectedRevision: 3,
    actionId: pending.id,
    review: fixture.review,
    networkPassphrase,
    sign: async () => {
      fixture.transaction.sign(fixture.signer);
      return fixture.transaction.toXdr();
    },
    storageDriver: driver,
    now: () => 4,
  });

  let sends = 0;
  const resumed = await resumeSignedPrivateBalanceActions({
    context,
    storageKey,
    networkPassphrase,
    rpc: {
      async sendTransaction() {
        sends += 1;
        return { status: 'DUPLICATE', hash: fixture.review.transactionHash };
      },
    },
    storageDriver: driver,
    now: () => 5,
  });
  assert.equal(sends, 1);
  assert.equal(resumed.pendingActions[0].status, 'broadcast');
  assert.equal(resumed.pendingActions[0].broadcastAttempts, 1);
  assert.equal(resumed.pendingActions[0].latestRpcStatus, 'DUPLICATE');
  assert.equal(resumed.notes[0].status, 'reserved');

  const untouched = await resumeSignedPrivateBalanceActions({
    context,
    storageKey,
    networkPassphrase,
    rpc: { async sendTransaction() { assert.fail('broadcast actions must not be resent'); } },
    storageDriver: driver,
    now: () => 6,
  });
  assert.equal(untouched.pendingActions[0].status, 'broadcast');

  const early = await recoverPrivateBalanceAction({
    context,
    storageKey,
    actionId: pending.id,
    rpc: {
      async getTransaction() {
        return {
          status: 'NOT_FOUND',
          latestLedgerCloseTime: fixture.review.expiresAt + PRIVATE_ACTION_EXPIRY_MARGIN_SECONDS,
        };
      },
    },
    scanCanonicalTranscript: async () => ({ actionFields: [], nullifiers: [] }),
    storageDriver: driver,
    now: () => 7,
  });
  assert.equal(early.outcome, 'ambiguous');
  assert.equal(early.state.notes[0].status, 'reserved');

  const recovered = await recoverPrivateBalanceAction({
    context,
    storageKey,
    actionId: pending.id,
    rpc: {
      async getTransaction() {
        return {
          status: 'NOT_FOUND',
          latestLedgerCloseTime: fixture.review.expiresAt + PRIVATE_ACTION_EXPIRY_MARGIN_SECONDS + 1,
        };
      },
    },
    scanCanonicalTranscript: async () => ({ actionFields: [], nullifiers: [] }),
    storageDriver: driver,
    now: () => 8,
  });
  assert.equal(recovered.outcome, 'release');
  assert.equal(recovered.state.pendingActions.length, 0);
  assert.equal(recovered.state.notes[0].status, 'unspent');
});

test('prepare refuses while a previous payment is still confirming', async () => {
  const { context, storageKey, note, driver } = stateFixture('inflight-account');
  await commitPrivateBalanceState(
    context,
    storageKey,
    {
      ...createEmptyPrivateBalanceState('48'.repeat(32), 1),
      account: {
        setupState: 'ready',
        syncStatus: 'current',
        lastVerifiedActionIndex: 0,
        updatedAt: 1,
      },
      notes: [{ ...note, status: 'reserved', reservedAt: 2 }],
      pendingActions: [{
        id: 'inflight-action',
        kind: 'transfer',
        assetContractId: ASSET_CONTRACT_ID,
        status: 'broadcast',
        reservedNoteIds: [note.id],
        actionField: '41'.repeat(32),
        nullifiers: ['42'.repeat(32), '00'.repeat(32)],
        outputCommitments: ['43'.repeat(32), '44'.repeat(32)],
        anchorRoot: '45'.repeat(32),
        anchorExpiresAtLedger: 500,
        proofHash: '46'.repeat(32),
        classicFeeCapStroops: '100',
        resourceFeeCapStroops: '500',
        expiresAtSeconds: 2_000_000_000,
        transactionHash: '47'.repeat(32),
        signedEnvelopeXdr: 'AAAA',
        broadcastAttempts: 1,
        latestRpcStatus: 'PENDING',
        lastBroadcastAt: 2,
        createdAt: 2,
        updatedAt: 2,
      }],
    },
    null,
    driver,
  );

  await assert.rejects(
    () => preparePrivateBalanceActionFlow({
      manifest: {},
      accountPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      privateAddress: `tks1${'q'.repeat(115)}`,
      storageContext: context,
      storageKey,
      storageDriver: driver,
      worker: {},
      rpcUrl: 'http://localhost',
      classicFeeStroops: 100n,
      assetContractId: ASSET_CONTRACT_ID,
      assetCode: 'XLM',
      assetDecimals: 7,
      draft: { kind: 'transfer', amount: '1', recipientAddress: `tks1${'p'.repeat(115)}` },
    }),
    PrivateActionInFlightError,
  );
});
