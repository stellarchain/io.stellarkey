import { stringifyPrivateIndices } from '../src/features/private-balance/runtime/indices.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptBytesWithKey } from '../src/lib/crypto.ts';
import {
  exportPrivateBalanceBackupArchive,
  preparePrivateBalanceBackupArchive,
  removePrivateBalanceRecordsForAccount,
  restorePrivateBalanceBackupArchive,
} from '../src/features/private-balance/runtime/backup.ts';
import {
  commitPrivateBalanceState,
  createEmptyPrivateBalanceState,
  loadPrivateBalanceState,
  reservePrivateBuildReservation,
} from '../src/features/private-balance/runtime/storage.ts';

class MemoryDriver {
  records = new Map();
  async read(key) { return this.records.get(key) ?? null; }
  async readPrefix(prefix) {
    return new Map([...this.records].filter(([key]) => key.startsWith(prefix)));
  }
  async compareAndSet(key, expectedRevision, value) {
    const current = this.records.get(key) ?? null;
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    this.records.set(key, value);
    return { ok: true, current: value };
  }
  async replacePrefixVerified(prefix, entries) {
    for (const key of [...this.records.keys()]) if (key.startsWith(prefix)) this.records.delete(key);
    for (const [key, value] of entries) this.records.set(key, value);
  }
  async removePrefix(prefix) {
    await this.replacePrefixVerified(prefix, new Map());
  }
  async remove(key) {
    this.records.delete(key);
  }
}

const context = {
  networkId: '01'.repeat(32),
  realmId: '02'.repeat(32),
  poolId: '03'.repeat(32),
  accountId: 'account-1',
  deploymentBindingHash: '05'.repeat(32),
};
const key = new Uint8Array(32).fill(6);

test('private backup restores only staged validated sensitive state and requires reconciliation', async () => {
  const source = new MemoryDriver();
  const state = {
    ...createEmptyPrivateBalanceState('07'.repeat(32), 1),
    account: {
      setupState: 'ready',
      syncStatus: 'current',
      lastVerifiedActionIndex: 0n,
      updatedAt: 1,
    },
    privateAddress: `tskpay_${'2'.repeat(121)}`,
    recentPrivateRecipients: [{
      address: `tskpay_${'3'.repeat(121)}`,
      fingerprint: 'ABCD EF01',
      lastUsedAt: 1,
    }],
    notes: [{
      id: '09'.repeat(32),
      commitment: '09'.repeat(32),
      value: '100',
      assetIndex: 0,
      assetContractId: 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF',
      diversifier: '00000000',
      ownerCommitment: '0a'.repeat(32),
      leafIndex: 0n,
      actionIndex: 0n,
      rho: '0b'.repeat(32),
      memoHex: '',
      senderFingerprintHex: '',
      status: 'unspent',
      createdAt: 1,
    }],
    activities: [{
      id: '0c'.repeat(32),
      actionIndex: 0n,
      actionKind: 'transfer',
      assetIndex: 0,
      assetContractId: 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF',
      amount: '60',
      direction: 'outflow',
      timestamp: 1,
      nullifiers: ['0d'.repeat(32)],
      outputCommitments: ['0e'.repeat(32)],
      recipientFingerprint: 'ABCD EF01',
      memoHex: Buffer.from('rent').toString('hex'),
    }],
  };
  await commitPrivateBalanceState(context, key, state, null, source);
  await reservePrivateBuildReservation(
    context,
    key,
    0,
    {
      id: 'build-1',
      kind: 'transfer',
      proofExposure: 'local',
      assetContractId: 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF',
      reservedNoteIds: ['09'.repeat(32)],
      createdAt: 2,
      updatedAt: 2,
    },
    source,
  );
  source.records.set('private:cache:v1:public', 'must-not-export');
  const archive = await exportPrivateBalanceBackupArchive(source);
  assert.equal(archive.records.length, 1);
  assert.equal(stringifyPrivateIndices(archive).includes('private:cache:v1'), false);

  const target = new MemoryDriver();
  target.records.set('private:sensitive:v1:old', 'preserve-on-failure');
  const validated = [];
  await restorePrivateBalanceBackupArchive({
    archive,
    driver: target,
    resolveStorageKey: async restoredContext => {
      assert.deepEqual(restoredContext, context);
      return key.slice();
    },
    validateContext: async (restoredContext, restoredState) => {
      validated.push(restoredContext.accountId);
      assert.equal(restoredState.lastValidatedManifestHash, '07'.repeat(32));
    },
    now: () => 10,
  });
  assert.deepEqual(validated, ['account-1']);
  const restored = await loadPrivateBalanceState(context, key, target);
  assert.equal(restored.account.syncStatus, 'never');
  assert.equal('recovery' in restored, false);
  assert.deepEqual(restored.buildReservations, []);
  assert.equal(restored.notes[0].status, 'unspent');
  assert.equal(restored.notes[0].reservedAt, undefined);
  assert.deepEqual(restored.activities[0], state.activities[0]);
  assert.equal(restored.privateAddress, state.privateAddress);
  assert.deepEqual(restored.recentPrivateRecipients, state.recentPrivateRecipients);
  assert.equal([...target.records.keys()].some(item => item.endsWith(':old')), false);

  const before = new Map(target.records);
  const tampered = structuredClone(archive);
  tampered.records[0].key = tampered.records[0].key.replace('05'.repeat(32), '08'.repeat(32));
  await assert.rejects(
    () => restorePrivateBalanceBackupArchive({
      archive: tampered,
      driver: target,
      resolveStorageKey: async () => key.slice(),
      validateContext: async () => {},
      now: () => 11,
    }),
    /decrypt|authenticate|context/i,
  );
  assert.deepEqual(target.records, before);
});

test('encrypted backup restore preserves legacy possibly exposed build holds but releases explicitly local work', async () => {
  const assetContractId = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
  for (const kind of ['transfer', 'withdraw']) for (const proofExposure of [undefined, 'local']) {
    const source = new MemoryDriver();
    const note = { id: '09'.repeat(32), commitment: '09'.repeat(32), value: '100', assetIndex: 0, assetContractId,
      diversifier: '00000000', ownerCommitment: '0a'.repeat(32), leafIndex: 0n, actionIndex: 0n, rho: '0b'.repeat(32), memoHex: '', senderFingerprintHex: '', status: 'unspent', createdAt: 1 };
    await commitPrivateBalanceState(context, key, { ...createEmptyPrivateBalanceState('07'.repeat(32), 1), notes: [note] }, null, source);
    await reservePrivateBuildReservation(context, key, 0, { id: 'build-held', kind, proofExposure, assetContractId, reservedNoteIds: [note.id], createdAt: 2, updatedAt: 2 }, source);
    const archive = await exportPrivateBalanceBackupArchive(source);
    const target = new MemoryDriver();
    await restorePrivateBalanceBackupArchive({ archive, driver: target, resolveStorageKey: async () => key.slice(), validateContext: async () => {}, now: () => 10_000_000 });
    const restored = await loadPrivateBalanceState(context, key, target);
    assert.equal(restored.buildReservations.length, proofExposure === 'local' ? 0 : 1);
    assert.equal(restored.notes[0].status, proofExposure === 'local' ? 'unspent' : 'reserved');
    if (proofExposure === undefined) assert.equal(restored.notes[0].reservedAt, 2);
  }
});

test('backup preparation validates persisted proof-exposure and route markers and preserves unsigned shared holds', async () => {
  const assetContractId = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
  const pending = { id: 'shared-proof', kind: 'transfer', assetIndex: 0, assetContractId, status: 'prepared', submissionMode: 'relay', proofExposure: 'shared',
    reservedNoteIds: ['09'.repeat(32)], actionField: '10'.repeat(32), nullifiers: ['11'.repeat(32), '00'.repeat(32)], outputCommitments: ['12'.repeat(32), '13'.repeat(32), '14'.repeat(32)],
    anchorRoot: '15'.repeat(32), anchorExpiresAtLedger: 100, proofHash: '16'.repeat(32), classicFeeCapStroops: '100', resourceFeeCapStroops: '1000', broadcastAttempts: 0, createdAt: 2, updatedAt: 2 };
  const source = new MemoryDriver();
  const state = { ...createEmptyPrivateBalanceState('07'.repeat(32), 1), pendingActions: [pending], notes: [{
    id: '09'.repeat(32), commitment: '09'.repeat(32), value: '100', assetIndex: 0, assetContractId, diversifier: '00000000', ownerCommitment: '0a'.repeat(32),
    leafIndex: 0n, actionIndex: 0n, rho: '0b'.repeat(32), memoHex: '', senderFingerprintHex: '', status: 'reserved', reservedAt: 2, createdAt: 1,
  }] };
  await commitPrivateBalanceState(context, key, state, null, source);
  const archive = await exportPrivateBalanceBackupArchive(source);
  const target = new MemoryDriver();
  await restorePrivateBalanceBackupArchive({ archive, driver: target, resolveStorageKey: async () => key.slice(), validateContext: async () => {}, now: () => 1000 });
  const restored = await loadPrivateBalanceState(context, key, target);
  assert.deepEqual(restored.pendingActions, [pending]);
  assert.equal(restored.notes[0].status, 'reserved');
  for (const invalid of [{ proofExposure: 'unshared' }, { proofExposure: false }, { submissionMode: 'automatic' }]) {
    const malformed = structuredClone(archive);
    const record = malformed.records[0];
    const envelope = JSON.parse(record.value);
    envelope.crypto = await encryptBytesWithKey(new TextEncoder().encode(stringifyPrivateIndices({ ...state, pendingActions: [{ ...pending, ...invalid }] })), key,
      new TextEncoder().encode(`stellarkey-private-balance-state|2|${state.revision}|${record.key}`));
    record.value = stringifyPrivateIndices(envelope);
    await assert.rejects(preparePrivateBalanceBackupArchive({ archive: malformed, resolveStorageKey: async () => key.slice(), validateContext: async () => assert.fail('Invalid state must fail before context acceptance') }), /schema/);
  }
});

test('private backup preserves independently encrypted state for multiple pools', async () => {
  const source = new MemoryDriver();
  const secondContext = {
    ...context,
    poolId: '11'.repeat(32),
    deploymentBindingHash: '13'.repeat(32),
  };
  const firstState = createEmptyPrivateBalanceState('07'.repeat(32), 1);
  const secondState = createEmptyPrivateBalanceState('14'.repeat(32), 1);

  await commitPrivateBalanceState(context, key, firstState, null, source);
  await commitPrivateBalanceState(secondContext, key, secondState, null, source);

  const archive = await exportPrivateBalanceBackupArchive(source);
  assert.equal(archive.records.length, 2);
  assert.notEqual(archive.records[0].key, archive.records[1].key);

  const target = new MemoryDriver();
  await restorePrivateBalanceBackupArchive({
    archive,
    driver: target,
    resolveStorageKey: async () => key.slice(),
    validateContext: async () => {},
    now: () => 20,
  });

  const restoredFirst = await loadPrivateBalanceState(context, key, target);
  const restoredSecond = await loadPrivateBalanceState(secondContext, key, target);
  assert.equal(restoredFirst.lastValidatedManifestHash, firstState.lastValidatedManifestHash);
  assert.equal(restoredSecond.lastValidatedManifestHash, secondState.lastValidatedManifestHash);
  assert.equal(restoredFirst.account.syncStatus, 'never');
  assert.equal(restoredSecond.account.syncStatus, 'never');
});

test('private backup preparation omits only explicitly unresolvable account records', async () => {
  const source = new MemoryDriver();
  const knownContext = context;
  const unknownContext = { ...context, accountId: 'unknown-account' };
  await commitPrivateBalanceState(
    knownContext,
    key,
    createEmptyPrivateBalanceState('07'.repeat(32), 1),
    null,
    source,
  );
  await commitPrivateBalanceState(
    unknownContext,
    key,
    createEmptyPrivateBalanceState('08'.repeat(32), 1),
    null,
    source,
  );
  const archive = await exportPrivateBalanceBackupArchive(source);

  const prepared = await preparePrivateBalanceBackupArchive({
    archive,
    resolveStorageKey: async restoredContext =>
      restoredContext.accountId === knownContext.accountId ? key.slice() : null,
    validateContext: async () => {},
    now: () => 20,
  });

  assert.equal(prepared.omittedRecords, 1);
  assert.equal(prepared.archive.records.length, 1);
  assert.match(prepared.archive.records[0].key, new RegExp(`:${knownContext.accountId}:`));
});

test('account archival cleanup removes only matching sensitive private records', async () => {
  const driver = new MemoryDriver();
  const secondContext = { ...context, accountId: 'account-2' };
  await commitPrivateBalanceState(
    context,
    key,
    createEmptyPrivateBalanceState('07'.repeat(32), 1),
    null,
    driver,
  );
  await commitPrivateBalanceState(
    secondContext,
    key,
    createEmptyPrivateBalanceState('08'.repeat(32), 1),
    null,
    driver,
  );
  driver.records.set('private:cache:v1:public', 'keep-public-cache');
  driver.records.set('merchant.records.v1:data:keep', 'keep-merchant');

  const removed = await removePrivateBalanceRecordsForAccount(context.accountId, driver);

  assert.equal(removed, 1);
  assert.equal([...driver.records.keys()].some(recordKey =>
    recordKey.includes(`:${context.accountId}:`)), false);
  assert.equal([...driver.records.keys()].some(recordKey =>
    recordKey.includes(`:${secondContext.accountId}:`)), true);
  assert.equal(driver.records.get('private:cache:v1:public'), 'keep-public-cache');
  assert.equal(driver.records.get('merchant.records.v1:data:keep'), 'keep-merchant');
});
