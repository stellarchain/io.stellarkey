import assert from 'node:assert/strict';
import test from 'node:test';
import * as storage from '../src/features/private-balance/runtime/storage.ts';
import {
  advancePrivateChainedApprovalFee,
  beginPrivateChainedApproval,
  clearPrivateChainedApproval,
  clearShieldedState,
  commitPrivateBalanceState,
  createEmptyPrivateBalanceState,
  loadPrivateBalanceState,
  commitPrivateBuildReservation,
  recordPrivateBalanceAddress,
  recordPrivateRecentRecipient,
  releaseExpiredPrivateBuildReservations,
  releasePrivateBuildReservation,
  releasePrivatePendingAction,
  releaseStalePrivatePendingActions,
  reservePrivateBuildReservation,
  transitionPrivatePendingAction,
  MAX_RECENT_PRIVATE_RECIPIENTS,
  PRIVATE_BUILD_RESERVATION_TTL_MS,
  PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS,
} from '../src/features/private-balance/runtime/storage.ts';

class MemoryDriver {
  records = new Map();

  async read(key) {
    return this.records.get(key) ?? null;
  }

  async compareAndSet(key, expectedRevision, value) {
    const current = this.records.get(key) ?? null;
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    this.records.set(key, value);
    return { ok: true, current: value };
  }

  async removePrefix(prefix) {
    for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key);
  }
}

const context = {
  networkId: '01'.repeat(32),
  realmId: '02'.repeat(32),
  poolId: '03'.repeat(32),
  accountId: 'account-1',
  deploymentBindingHash: '05'.repeat(32),
};
const ASSET_CONTRACT_ID = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
const key = new Uint8Array(32).fill(7);
const manifestHash = '0c'.repeat(32);
const note = {
  id: '06'.repeat(32),
  commitment: '06'.repeat(32),
  value: '5000000',
  assetContractId: ASSET_CONTRACT_ID,
  diversifier: '00000000',
  ownerCommitment: '07'.repeat(32),
  leafIndex: 0,
  actionIndex: 0,
  rho: '08'.repeat(32),
  memoHex: '',
  senderFingerprintHex: '',
  status: 'unspent',
  createdAt: 1,
};
const checkpoint = {
  lastActionIndex: 0,
  lastRecordHash: '0a'.repeat(32),
  treeRoot: '0b'.repeat(32),
  treeFrontier: Array.from({ length: 32 }, () => '00'.repeat(32)),
  deploymentBindingHash: context.deploymentBindingHash,
  manifestHash,
  latestLedger: 100,
  updatedAt: 2,
};

test('private state is encrypted, context-bound, and reserved with atomic CAS', async () => {
  const driver = new MemoryDriver();
  const initial = {
    ...createEmptyPrivateBalanceState(manifestHash, 1),
    account: {
      setupState: 'ready',
      syncStatus: 'current',
      lastVerifiedActionIndex: 0,
      updatedAt: 2,
    },
    notes: [note],
    checkpoint,
  };
  await commitPrivateBalanceState(context, key, initial, null, driver);

  assert.equal(driver.records.size, 1);
  const [[recordKey, raw]] = driver.records;
  assert.doesNotMatch(raw, /5000000|0606060606060606|account-1/);
  assert.deepEqual(await loadPrivateBalanceState(context, key, driver), initial);
  await assert.rejects(
    () => loadPrivateBalanceState(context, new Uint8Array(32).fill(8), driver),
    /decrypt|authenticate/i,
  );

  const swappedContext = { ...context, accountId: 'account-2' };
  driver.records.set(recordKey.replace('account-1', 'account-2'), raw);
  await assert.rejects(
    () => loadPrivateBalanceState(swappedContext, key, driver),
    /decrypt|authenticate/i,
  );

  const pendingAction = {
    id: 'action-1',
    kind: 'transfer',
    assetContractId: ASSET_CONTRACT_ID,
    status: 'prepared',
    reservedNoteIds: [note.id],
    actionField: '0d'.repeat(32),
    nullifiers: ['0e'.repeat(32), '00'.repeat(32)],
    outputCommitments: ['0f'.repeat(32), '12'.repeat(32)],
    anchorRoot: checkpoint.treeRoot,
    anchorExpiresAtLedger: 150,
    proofHash: '10'.repeat(32),
    classicFeeCapStroops: '1000',
    resourceFeeCapStroops: '500000',
    amountStroops: '4000000',
    changeValueStroops: '1000000',
    broadcastAttempts: 0,
    createdAt: 3,
    updatedAt: 3,
  };
  await reservePrivateBuildReservation(context, key, 0, {
    id: pendingAction.id,
    kind: pendingAction.kind,
    assetContractId: pendingAction.assetContractId,
    reservedNoteIds: pendingAction.reservedNoteIds,
    createdAt: pendingAction.createdAt,
    updatedAt: pendingAction.createdAt,
  }, driver);
  const reserved = await commitPrivateBuildReservation(
    context,
    key,
    1,
    pendingAction.id,
    pendingAction,
    driver,
  );
  assert.equal(reserved.revision, 2);
  assert.equal(reserved.notes[0].status, 'reserved');
  assert.equal(reserved.notes[0].reservedAt, 3);
  assert.deepEqual(reserved.pendingActions, [pendingAction]);
  assert.deepEqual(await loadPrivateBalanceState(context, key, driver), reserved);

  const reviewed = await transitionPrivatePendingAction(
    context,
    key,
    2,
    pendingAction.id,
    { from: 'prepared', to: 'reviewed', transactionHash: '11'.repeat(32), updatedAt: 4 },
    driver,
  );
  assert.equal(reviewed.pendingActions[0].status, 'reviewed');
  assert.equal(reviewed.pendingActions[0].transactionHash, '11'.repeat(32));

  await assert.rejects(
    () => transitionPrivatePendingAction(
      context,
      key,
      3,
      pendingAction.id,
      { from: 'reviewed', to: 'signed', signedEnvelopeXdr: 'AAAA', updatedAt: 5 },
      driver,
    ),
    /expiry is invalid/,
  );
  const signed = await transitionPrivatePendingAction(
    context,
    key,
    3,
    pendingAction.id,
    {
      from: 'reviewed',
      to: 'signed',
      signedEnvelopeXdr: 'AAAA',
      expiresAtSeconds: 1_700_000_300,
      updatedAt: 5,
    },
    driver,
  );
  assert.equal(signed.pendingActions[0].status, 'signed');
  assert.equal(signed.pendingActions[0].signedEnvelopeXdr, 'AAAA');
  assert.equal(signed.pendingActions[0].expiresAtSeconds, 1_700_000_300);
  assert.equal(signed.pendingActions[0].amountStroops, '4000000');
  assert.equal(signed.pendingActions[0].changeValueStroops, '1000000');
  await assert.rejects(
    () => releasePrivatePendingAction(
      context,
      key,
      4,
      pendingAction.id,
      { reason: 'pre-broadcast-rejection', updatedAt: 6 },
      driver,
    ),
    /cannot be released/,
  );

  const ambiguous = await transitionPrivatePendingAction(
    context,
    key,
    4,
    pendingAction.id,
    { from: 'signed', to: 'ambiguous', latestRpcStatus: 'NOT_FOUND', updatedAt: 6 },
    driver,
  );
  assert.equal(ambiguous.pendingActions[0].status, 'ambiguous');
  assert.equal(ambiguous.pendingActions[0].broadcastAttempts, 1);
  assert.equal(ambiguous.notes[0].status, 'reserved');

  const released = await releasePrivatePendingAction(
    context,
    key,
    5,
    pendingAction.id,
    { reason: 'definitive-failure-nullifiers-absent', updatedAt: 7 },
    driver,
  );
  assert.equal(released.pendingActions.length, 0);
  assert.equal(released.notes[0].status, 'unspent');
  assert.equal(released.notes[0].reservedAt, undefined);

  await reservePrivateBuildReservation(context, key, 6, {
    id: 'deposit-1',
    kind: 'deposit',
    assetContractId: ASSET_CONTRACT_ID,
    reservedNoteIds: [],
    createdAt: 8,
    updatedAt: 8,
  }, driver);
  const deposit = await commitPrivateBuildReservation(context, key, 7, 'deposit-1', {
    ...pendingAction,
    id: 'deposit-1',
    kind: 'deposit',
    assetContractId: ASSET_CONTRACT_ID,
    reservedNoteIds: [],
    anchorRoot: '00'.repeat(32),
    anchorExpiresAtLedger: 0,
    createdAt: 8,
    updatedAt: 8,
  }, driver);
  assert.equal(deposit.pendingActions[0].kind, 'deposit');
  assert.deepEqual(deposit.pendingActions[0].reservedNoteIds, []);
  await releasePrivatePendingAction(
    context,
    key,
    8,
    'deposit-1',
    { reason: 'pre-broadcast-rejection', updatedAt: 9 },
    driver,
  );

  await assert.rejects(
    () => reservePrivateBuildReservation(context, key, 0, {
      id: 'action-2',
      kind: 'transfer',
      assetContractId: ASSET_CONTRACT_ID,
      reservedNoteIds: [note.id],
      createdAt: 10,
      updatedAt: 10,
    }, driver),
    /changed in another wallet session/i,
  );

  await clearShieldedState(context, driver);
  await clearShieldedState(swappedContext, driver);
  assert.equal(driver.records.size, 0);
});

test('the one-step reservation shortcut stays deleted from storage', () => {
  assert.equal('reserveShieldedNotes' in storage, false);
});

test('private notes reserve before witness creation and promote atomically', async () => {
  const driver = new MemoryDriver();
  await commitPrivateBalanceState(
    context,
    key,
    { ...createEmptyPrivateBalanceState(manifestHash, 1), notes: [note] },
    null,
    driver,
  );
  const reservation = {
    id: 'build-1',
    kind: 'transfer',
    assetContractId: ASSET_CONTRACT_ID,
    reservedNoteIds: [note.id],
    createdAt: 2,
    updatedAt: 2,
  };
  const reserved = await reservePrivateBuildReservation(
    context,
    key,
    0,
    reservation,
    driver,
  );
  assert.equal(reserved.notes[0].status, 'reserved');
  assert.deepEqual(reserved.buildReservations, [reservation]);
  assert.deepEqual(reserved.pendingActions, []);

  const pendingAction = {
    id: reservation.id,
    kind: reservation.kind,
    assetContractId: reservation.assetContractId,
    status: 'prepared',
    reservedNoteIds: reservation.reservedNoteIds,
    actionField: '0d'.repeat(32),
    nullifiers: ['0e'.repeat(32), '00'.repeat(32)],
    outputCommitments: ['0f'.repeat(32), '12'.repeat(32)],
    anchorRoot: checkpoint.treeRoot,
    anchorExpiresAtLedger: 150,
    proofHash: '10'.repeat(32),
    classicFeeCapStroops: '1000',
    resourceFeeCapStroops: '500000',
    broadcastAttempts: 0,
    createdAt: 2,
    updatedAt: 3,
  };
  const promoted = await commitPrivateBuildReservation(
    context,
    key,
    1,
    reservation.id,
    pendingAction,
    driver,
  );
  assert.deepEqual(promoted.buildReservations, []);
  assert.deepEqual(promoted.pendingActions, [pendingAction]);
  assert.equal(promoted.notes[0].status, 'reserved');

  const releasedPending = await releasePrivatePendingAction(
    context,
    key,
    2,
    pendingAction.id,
    { reason: 'pre-broadcast-rejection', updatedAt: 4 },
    driver,
  );
  const reservedAgain = await reservePrivateBuildReservation(
    context,
    key,
    3,
    { ...reservation, id: 'build-2', createdAt: 5, updatedAt: 5 },
    driver,
  );
  assert.equal(reservedAgain.notes[0].status, 'reserved');
  const cancelled = await releasePrivateBuildReservation(
    context,
    key,
    4,
    'build-2',
    6,
    driver,
  );
  assert.equal(cancelled.notes[0].status, 'unspent');
  assert.deepEqual(cancelled.buildReservations, []);
  assert.equal(releasedPending.pendingActions.length, 0);
});

test('build reservations past the TTL release their notes in one commit', async () => {
  const driver = new MemoryDriver();
  await commitPrivateBalanceState(
    context,
    key,
    { ...createEmptyPrivateBalanceState(manifestHash, 1), notes: [note] },
    null,
    driver,
  );
  const reservation = {
    id: 'stale-build',
    kind: 'transfer',
    assetContractId: ASSET_CONTRACT_ID,
    reservedNoteIds: [note.id],
    createdAt: 1_000,
    updatedAt: 1_000,
  };
  const reserved = await reservePrivateBuildReservation(context, key, 0, reservation, driver);
  assert.equal(reserved.notes[0].status, 'reserved');

  const fresh = await releaseExpiredPrivateBuildReservations(
    context,
    key,
    1_000 + PRIVATE_BUILD_RESERVATION_TTL_MS - 1,
    PRIVATE_BUILD_RESERVATION_TTL_MS,
    driver,
  );
  assert.deepEqual(fresh.buildReservations, [reservation]);
  assert.equal(fresh.notes[0].status, 'reserved');

  const released = await releaseExpiredPrivateBuildReservations(
    context,
    key,
    1_000 + PRIVATE_BUILD_RESERVATION_TTL_MS,
    PRIVATE_BUILD_RESERVATION_TTL_MS,
    driver,
  );
  assert.deepEqual(released.buildReservations, []);
  assert.equal(released.notes[0].status, 'unspent');
  assert.equal(released.notes[0].reservedAt, undefined);
  assert.deepEqual(
    await loadPrivateBalanceState(context, key, driver),
    JSON.parse(JSON.stringify(released)),
  );
});

test('stale pre-broadcast pending actions release their notes, broadcasts never do', async () => {
  // The sweep TTL must exceed the chained approval window so a live chain's
  // prepared or reviewed step can never be swept out from under its driver.
  assert.ok(PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS > 15 * 60_000);

  const driver = new MemoryDriver();
  const makeNote = (id, reservedAt) => ({
    ...note,
    id,
    commitment: id,
    status: 'reserved',
    reservedAt,
  });
  const orphanNote = makeNote('16'.repeat(32), 1_000);
  const broadcastNote = makeNote('17'.repeat(32), 1_000);
  const freshNote = makeNote('18'.repeat(32), 5_000);
  const base = {
    kind: 'transfer',
    assetContractId: ASSET_CONTRACT_ID,
    actionField: '0d'.repeat(32),
    nullifiers: ['0e'.repeat(32), '00'.repeat(32)],
    outputCommitments: ['0f'.repeat(32), '12'.repeat(32)],
    anchorRoot: '0b'.repeat(32),
    anchorExpiresAtLedger: 150,
    proofHash: '10'.repeat(32),
    classicFeeCapStroops: '1000',
    resourceFeeCapStroops: '500000',
  };
  // A tab closed or locked between prepare and sign leaves exactly this:
  // 'reviewed', zero broadcast attempts, notes still reserved.
  const orphan = {
    ...base,
    id: 'orphan-1',
    status: 'reviewed',
    reservedNoteIds: [orphanNote.id],
    transactionHash: '11'.repeat(32),
    broadcastAttempts: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
  };
  // A broadcast action is never provably unsent; the sweep must not touch it.
  const sent = {
    ...base,
    id: 'sent-1',
    status: 'broadcast',
    reservedNoteIds: [broadcastNote.id],
    transactionHash: '13'.repeat(32),
    signedEnvelopeXdr: 'AAAA',
    expiresAtSeconds: 1_700_000_300,
    broadcastAttempts: 1,
    latestRpcStatus: 'PENDING',
    lastBroadcastAt: 1_000,
    createdAt: 900,
    updatedAt: 1_000,
  };
  const fresh = {
    ...base,
    id: 'fresh-1',
    status: 'reviewed',
    reservedNoteIds: [freshNote.id],
    transactionHash: '14'.repeat(32),
    broadcastAttempts: 0,
    createdAt: 5_000,
    updatedAt: 5_000,
  };
  await commitPrivateBalanceState(
    context,
    key,
    {
      ...createEmptyPrivateBalanceState(manifestHash, 1),
      notes: [orphanNote, broadcastNote, freshNote],
      pendingActions: [orphan, sent, fresh],
    },
    null,
    driver,
  );

  const untouched = await releaseStalePrivatePendingActions(
    context,
    key,
    1_000 + PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS - 1,
    PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS,
    driver,
  );
  assert.equal(untouched.revision, 0);
  assert.equal(untouched.pendingActions.length, 3);

  const swept = await releaseStalePrivatePendingActions(
    context,
    key,
    1_000 + PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS,
    PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS,
    driver,
  );
  assert.equal(swept.revision, 1);
  // Only the stale pre-broadcast orphan is gone; its notes spend again.
  assert.deepEqual(swept.pendingActions.map(action => action.id), ['sent-1', 'fresh-1']);
  const statuses = new Map(swept.notes.map(item => [item.id, item.status]));
  assert.equal(statuses.get(orphanNote.id), 'unspent');
  assert.equal(statuses.get(broadcastNote.id), 'reserved');
  assert.equal(statuses.get(freshNote.id), 'reserved');
  assert.deepEqual(
    await loadPrivateBalanceState(context, key, driver),
    JSON.parse(JSON.stringify(swept)),
  );
});

test('chained approvals journal a one-shot cumulative fee cap that fails closed', async () => {
  const driver = new MemoryDriver();
  await commitPrivateBalanceState(
    context,
    key,
    createEmptyPrivateBalanceState(manifestHash, 1),
    null,
    driver,
  );
  const approval = {
    id: 'chain-1',
    steps: 3,
    perStepMaxFeeStroops: '1000',
    cumulativeMaxFeeStroops: '3000',
    accumulatedFeeStroops: '0',
    expiresAtSeconds: 2_000,
    createdAt: 5,
    updatedAt: 5,
  };

  await assert.rejects(
    () => beginPrivateChainedApproval(
      context,
      key,
      0,
      { ...approval, accumulatedFeeStroops: '1' },
      driver,
    ),
    /approval is invalid/,
  );
  const begun = await beginPrivateChainedApproval(context, key, 0, approval, driver);
  assert.deepEqual(begun.chainedApproval, approval);
  assert.deepEqual(await loadPrivateBalanceState(context, key, driver), begun);
  await assert.rejects(
    () => beginPrivateChainedApproval(context, key, 1, { ...approval, id: 'chain-2' }, driver),
    /already exists/,
  );

  const advanced = await advancePrivateChainedApprovalFee(
    context,
    key,
    1,
    'chain-1',
    1000n,
    6,
    driver,
  );
  assert.equal(advanced.chainedApproval.accumulatedFeeStroops, '1000');
  await assert.rejects(
    () => advancePrivateChainedApprovalFee(context, key, 2, 'chain-1', 1001n, 7, driver),
    /per-step cap/,
  );
  await advancePrivateChainedApprovalFee(context, key, 2, 'chain-1', 1000n, 8, driver);
  await advancePrivateChainedApprovalFee(context, key, 3, 'chain-1', 999n, 9, driver);
  await assert.rejects(
    () => advancePrivateChainedApprovalFee(context, key, 4, 'chain-1', 2n, 10, driver),
    /cumulative cap/,
  );
  await assert.rejects(
    () => advancePrivateChainedApprovalFee(context, key, 4, 'chain-1', 1n, 2_001_000, driver),
    /approval expired/,
  );
  await assert.rejects(
    () => advancePrivateChainedApprovalFee(context, key, 4, 'chain-9', 1n, 11, driver),
    /does not exist/,
  );

  const cleared = await clearPrivateChainedApproval(context, key, 4, driver);
  assert.equal(cleared.chainedApproval, undefined);
  assert.deepEqual(await loadPrivateBalanceState(context, key, driver), cleared);
});

test('the private address and recent recipients persist under schema validation', async () => {
  const driver = new MemoryDriver();
  await commitPrivateBalanceState(
    context,
    key,
    createEmptyPrivateBalanceState(manifestHash, 1),
    null,
    driver,
  );
  const address = index => `tks1${['q', 'p', 'z', 'r', 'y', 'x'][index].repeat(115)}`;

  await assert.rejects(
    () => recordPrivateBalanceAddress(context, key, 0, 'tks1not-canonical', driver),
    /address is invalid/,
  );
  const addressed = await recordPrivateBalanceAddress(context, key, 0, address(0), driver);
  assert.equal(addressed.revision, 1);
  assert.equal(addressed.privateAddress, address(0));
  const unchanged = await recordPrivateBalanceAddress(context, key, 1, address(0), driver);
  assert.equal(unchanged.revision, 1);

  await assert.rejects(
    () => recordPrivateRecentRecipient(
      context,
      key,
      1,
      { address: address(1), fingerprint: 'not a fingerprint', lastUsedAt: 2 },
      driver,
    ),
    /recent recipient is invalid/,
  );
  let state = addressed;
  for (let index = 0; index < MAX_RECENT_PRIVATE_RECIPIENTS + 1; index += 1) {
    state = await recordPrivateRecentRecipient(
      context,
      key,
      state.revision,
      { address: address(index), fingerprint: 'ABCD EF01', lastUsedAt: 2 + index },
      driver,
    );
  }
  assert.equal(state.recentPrivateRecipients.length, MAX_RECENT_PRIVATE_RECIPIENTS);
  assert.equal(state.recentPrivateRecipients[0].address, address(MAX_RECENT_PRIVATE_RECIPIENTS));
  assert.equal(
    state.recentPrivateRecipients.some(recipient => recipient.address === address(0)),
    false,
  );

  const repeated = await recordPrivateRecentRecipient(
    context,
    key,
    state.revision,
    { address: address(2), fingerprint: 'ABCD EF01', lastUsedAt: 99 },
    driver,
  );
  assert.equal(repeated.recentPrivateRecipients.length, MAX_RECENT_PRIVATE_RECIPIENTS);
  assert.deepEqual(repeated.recentPrivateRecipients[0], {
    address: address(2),
    fingerprint: 'ABCD EF01',
    lastUsedAt: 99,
  });
  assert.deepEqual(await loadPrivateBalanceState(context, key, driver), repeated);
});
