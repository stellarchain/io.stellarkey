import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exportPrivateBalanceBackupArchive,
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
      lastVerifiedActionIndex: 0,
      updatedAt: 1,
    },
    privateAddress: `tks1${'q'.repeat(115)}`,
    recentPrivateRecipients: [{
      address: `tks1${'p'.repeat(115)}`,
      fingerprint: 'ABCD EF01',
      lastUsedAt: 1,
    }],
    notes: [{
      id: '09'.repeat(32),
      commitment: '09'.repeat(32),
      value: '100',
      assetContractId: 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF',
      diversifier: '00000000',
      ownerCommitment: '0a'.repeat(32),
      leafIndex: 0,
      actionIndex: 0,
      rho: '0b'.repeat(32),
      memoHex: '',
      senderFingerprintHex: '',
      status: 'unspent',
      createdAt: 1,
    }],
    activities: [{
      id: '0c'.repeat(32),
      actionIndex: 0,
      actionKind: 'transfer',
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
  assert.equal(JSON.stringify(archive).includes('private:cache:v1'), false);

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
