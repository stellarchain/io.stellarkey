import { stringifyPrivateIndices } from '../src/features/private-balance/runtime/indices.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as storage from '../src/features/private-balance/runtime/storage.ts';
import { privateOutgoingHistoryMode } from '../src/features/private-balance/runtime/outgoing-history.ts';
import { attachLocalActivityMetadata } from '../src/features/private-balance/runtime/sync-machine.ts';
import { exportPrivateBalanceBackupArchive, restorePrivateBalanceBackupArchive, preparePrivateBalanceBackupArchive } from '../src/features/private-balance/runtime/backup.ts';
import * as historyChange from '../src/features/private-balance/runtime/outgoing-history-change.ts';
import { encodePrivateAddress, derivePrivateAddressDeploymentTag } from '@stellarkey/private-balance';
import { encryptBytesWithKey } from '../src/lib/crypto.ts';
import { PrivateBalanceArchiveClient } from '../src/features/private-balance/runtime/archive-client.ts';
import { preparePrivateBalanceActionFlow } from '../src/features/private-balance/runtime/action-flow.ts';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

class MemoryDriver {
  records = new Map();
  async read(key) { return this.records.get(key) ?? null; }
  async readPrefix(prefix) { return new Map([...this.records].filter(([key]) => key.startsWith(prefix))); }
  async compareAndSet(key, revision, value) {
    const current = await this.read(key);
    if ((current ? JSON.parse(current).revision : null) !== revision) return { ok: false, current };
    this.records.set(key, value); return { ok: true, current: value };
  }
  async removePrefix(prefix) { for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key); }
  async replacePrefixVerified(prefix, entries) { await this.removePrefix(prefix); for (const [key, value] of entries) this.records.set(key, value); }
}
const hex = byte => byte.repeat(64);
const context = { accountId: 'history-test', networkId: hex('1'), realmId: hex('2'), poolId: hex('3'), deploymentBindingHash: hex('4') };
const assetContractId = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
const key = new Uint8Array(32).fill(7);
const note = { id: hex('5'), commitment: hex('5'), value: '10', assetIndex: 0, assetContractId, diversifier: '00000000', ownerCommitment: hex('1'), leafIndex: 0n, actionIndex: 0n, rho: hex('2'), memoHex: '', senderFingerprintHex: '', status: 'unspent', createdAt: 1 };
const pending = { outgoingHistoryMode: 'recoverable', id: 'proof', kind: 'transfer', assetIndex: 0, assetContractId, status: 'prepared', submissionMode: 'direct', proofExposure: 'shared',
  reservedNoteIds: [note.id], actionField: hex('6'), nullifiers: [hex('7'), hex('0')], outputCommitments: [hex('8'), hex('9'), hex('a')],
  anchorRoot: hex('b'), anchorExpiresAtLedger: 100, proofHash: hex('c'), classicFeeCapStroops: '100', resourceFeeCapStroops: '1000', broadcastAttempts: 0, createdAt: 1, updatedAt: 1 };
async function fixture(extra = {}) {
  const driver = new MemoryDriver();
  const state = { ...storage.createEmptyPrivateBalanceState(hex('d'), 1), ...extra };
  await storage.commitPrivateBalanceState(context, key, state, null, driver);
  return { driver, state };
}

test('encrypted outgoing-history setting requires explicit loss consent, valid mode and scoped CAS', async () => {
  assert.equal(typeof storage.recordPrivateOutgoingHistoryMode, 'function');
  const { driver, state } = await fixture();
  assert.equal(privateOutgoingHistoryMode(state.outgoingHistoryMode), 'recoverable');
  for (const options of [undefined, {}, { acknowledgeRecoveryLoss: false }, { acknowledgeRecoveryLoss: 'true' }]) {
    await assert.rejects(storage.recordPrivateOutgoingHistoryMode(context, key, 0, 'minimized', options, driver), /acknowledge|consent/i);
  }
  for (const mode of [undefined, null, false, '', 'off']) await assert.rejects(storage.recordPrivateOutgoingHistoryMode(context, key, 0, mode, { acknowledgeRecoveryLoss: true }, driver), /invalid|policy/i);
  const minimized = await storage.recordPrivateOutgoingHistoryMode(context, key, 0, 'minimized', { acknowledgeRecoveryLoss: true }, driver);
  assert.equal(minimized.outgoingHistoryMode, 'minimized');
  assert.doesNotMatch([...driver.records.values()][0], /minimized|outgoingHistoryMode/);
  await assert.rejects(storage.recordPrivateOutgoingHistoryMode(context, key, 0, 'recoverable', {}, driver), /changed/);
  await assert.rejects(storage.recordPrivateOutgoingHistoryMode({ ...context, accountId: 'other-account' }, key, 1, 'recoverable', {}, driver), /unavailable|changed/);
  await assert.rejects(storage.recordPrivateOutgoingHistoryMode({ ...context, poolId: hex('e') }, key, 1, 'recoverable', {}, driver), /unavailable|changed/);
  const restored = await storage.recordPrivateOutgoingHistoryMode(context, key, 1, 'recoverable', {}, driver);
  assert.equal(restored.outgoingHistoryMode, 'recoverable');
});

test('outgoing-history changes cannot rewrite open reservations, pending proofs or chain approvals', async () => {
  for (const extra of [
    { notes: [{ ...note, status: 'reserved', reservedAt: 1 }], buildReservations: [{ outgoingHistoryMode: 'recoverable', id: 'build', kind: 'transfer', proofExposure: 'local', assetContractId, reservedNoteIds: [note.id], createdAt: 1, updatedAt: 1 }] },
    { notes: [{ ...note, status: 'reserved', reservedAt: 1 }], pendingActions: [pending] },
    { chainedApproval: { id: 'chain', steps: 2, perStepMaxFeeStroops: '1000', cumulativeMaxFeeStroops: '2000', accumulatedFeeStroops: '0', expiresAtSeconds: 1000, createdAt: 1, updatedAt: 1 } },
  ]) {
    const { driver, state } = await fixture(extra);
    await assert.rejects(storage.recordPrivateOutgoingHistoryMode(context, key, 0, 'minimized', { acknowledgeRecoveryLoss: true }, driver), /action|approval|pending|idle/i);
    assert.deepEqual(await storage.loadPrivateBalanceState(context, key, driver), state);
  }
});

test('minimized journal metadata is not promoted into permanent outgoing activity and old history remains recoverable', () => {
  const activity = { id: pending.actionField, actionIndex: 1n, actionKind: 'transfer', direction: 'outflow', assetIndex: 0, assetContractId,
    amount: '10', timestamp: 1, nullifiers: pending.nullifiers, outputCommitments: pending.outputCommitments };
  const metadata = { actionField: pending.actionField, recipientFingerprint: 'ABCD EF01 2345 6789 ABCD EF01 2345 6789', memoHex: '0102', transactionHash: hex('e') };
  assert.deepEqual(attachLocalActivityMetadata([activity], [{ ...metadata, outgoingHistoryMode: 'minimized' }]), [activity]);
  for (const outgoingHistoryMode of [undefined, 'recoverable']) assert.deepEqual(attachLocalActivityMetadata([activity], [{ ...metadata, outgoingHistoryMode }]), [{ ...activity, recipientFingerprint: metadata.recipientFingerprint, memoHex: metadata.memoHex, transactionHash: metadata.transactionHash }]);
  const incoming = { ...activity, direction: 'inflow', memoHex: '0506' };
  assert.equal(attachLocalActivityMetadata([incoming], [{ ...metadata, outgoingHistoryMode: 'minimized' }])[0].memoHex, '0506');
});

test('encrypted history preference survives backup and verification resets without becoming a seed-derived default', async () => {
  const { driver, state } = await fixture({ outgoingHistoryMode: 'minimized' });
  const target = new MemoryDriver();
  await restorePrivateBalanceBackupArchive({ archive: await exportPrivateBalanceBackupArchive(driver), driver: target, resolveStorageKey: async () => key.slice(), validateContext: async () => {}, now: () => 2 });
  assert.equal((await storage.loadPrivateBalanceState(context, key, target)).outgoingHistoryMode, 'minimized');
  const reset = storage.createPrivateBalanceVerificationReset(state, hex('d'), 3);
  assert.equal(reset.outgoingHistoryMode, 'minimized');
  const rollback = storage.createPrivateBalanceVerificationRollback({ ...state, outgoingHistoryMode: 'recoverable' }, { ...reset, outgoingHistoryMode: 'minimized' });
  assert.equal(rollback.outgoingHistoryMode, 'minimized');
  assert.equal(privateOutgoingHistoryMode(storage.createEmptyPrivateBalanceState(hex('d')).outgoingHistoryMode), 'recoverable');
});

test('runtime history updates own the busy slot and reject followers, lock or stale context around awaits', async () => {
  assert.equal(typeof historyChange.changePrivateOutgoingHistory, 'function');
  const good = { mounted: true, leader: true, unlocked: true, authenticatedCurrent: true, contextCurrent: true };
  for (const field of Object.keys(good)) {
    const busy = { current: false };
    await assert.rejects(historyChange.changePrivateOutgoingHistory({ busy, access: () => ({ ...good, [field]: false }), change: async () => assert.fail('Unavailable context must not write') }));
    assert.equal(busy.current, false);
  }
  const busy = { current: true };
  await assert.rejects(historyChange.changePrivateOutgoingHistory({ busy, access: () => good, change: async () => assert.fail('Busy runtime must not write') }), /action|busy/);
  assert.equal(busy.current, true);
  busy.current = false;
  let active = true;
  await assert.rejects(historyChange.changePrivateOutgoingHistory({ busy, access: () => ({ ...good, contextCurrent: active }), change: async check => {
    assert.equal(busy.current, true); active = false; check(); assert.fail('Stale callback must not write');
  } }), /context|unavailable/);
  assert.equal(busy.current, false);
  active = true;
  await assert.rejects(historyChange.changePrivateOutgoingHistory({ busy, access: () => ({ ...good, contextCurrent: active }), change: async () => { active = false; return 'stale-result'; } }), /context|unavailable/);
  assert.equal(busy.current, false);
});

test('build reservations bind an immutable outgoing policy before a proof can be prepared', async () => {
  const { driver, state } = await fixture({ outgoingHistoryMode: 'minimized', notes: [note] });
  const reservation = { id: pending.id, kind: pending.kind, outgoingHistoryMode: 'minimized', proofExposure: 'local', assetContractId, reservedNoteIds: pending.reservedNoteIds, createdAt: 1, updatedAt: 1 };
  await assert.rejects(storage.reservePrivateBuildReservation(context, key, state.revision, { ...reservation, outgoingHistoryMode: 'recoverable' }, driver), /policy|history/);
  const reserved = await storage.reservePrivateBuildReservation(context, key, state.revision, reservation, driver);
  await assert.rejects(storage.commitPrivateBuildReservation(context, key, reserved.revision, pending.id, { ...pending, outgoingHistoryMode: 'recoverable' }, driver), /match|policy/);
  const committed = await storage.commitPrivateBuildReservation(context, key, reserved.revision, pending.id, { ...pending, outgoingHistoryMode: 'minimized' }, driver);
  await assert.rejects(storage.transitionPrivatePendingAction(context, key, committed.revision, pending.id, { from: 'prepared', to: 'reviewed', transactionHash: hex('e'), updatedAt: 2, outgoingHistoryMode: 'recoverable' }, driver), /history|policy/);
  const reviewed = await storage.transitionPrivatePendingAction(context, key, committed.revision, pending.id, { from: 'prepared', to: 'reviewed', transactionHash: hex('e'), updatedAt: 2 }, driver);
  assert.equal(reviewed.pendingActions[0].outgoingHistoryMode, 'minimized');
});

test('minimized payments do not append a recent private recipient even if a caller supplies one', async () => {
  const recipient = { address: encodePrivateAddress({ deploymentTag: derivePrivateAddressDeploymentTag(new Uint8Array(32).fill(0x44)), diversifier: new Uint8Array([0, 0, 0, 1]),
    ownerCommitment: new Uint8Array(32).fill(9), hpkePublicKey: new Uint8Array(32).fill(10) }, 'tskpay_'), fingerprint: 'ABCD EF01 2345 6789 ABCD EF01 2345 6789', lastUsedAt: 3 };
  for (const outgoingHistoryMode of ['minimized', 'recoverable']) {
    const { driver, state } = await fixture({ notes: [{ ...note, status: 'reserved', reservedAt: 1 }], pendingActions: [{ ...pending, outgoingHistoryMode }] });
    const updated = await storage.recordPrivateRecentRecipient(context, key, state.revision, recipient, driver, pending.id);
    assert.equal(updated.recentPrivateRecipients?.length ?? 0, outgoingHistoryMode === 'minimized' ? 0 : 1);
    assert.equal(updated.revision, outgoingHistoryMode === 'minimized' ? state.revision : state.revision + 1);
  }
});


test('invalid encrypted history modes fail local load and backup preparation, including pending and build snapshots', async () => {
  const { driver, state } = await fixture();
  const archive = await exportPrivateBalanceBackupArchive(driver);
  for (const mode of [undefined, null, false, '', 'off']) for (const location of ['preference', 'pending', 'build']) {
    const malformed = structuredClone(archive);
    const record = malformed.records[0];
    const envelope = JSON.parse(record.value);
    const reserved = { ...note, status: 'reserved', reservedAt: 1 };
    const candidate = location === 'preference' ? { ...state, outgoingHistoryMode: mode } : location === 'pending'
      ? { ...state, notes: [reserved], pendingActions: [{ ...pending, outgoingHistoryMode: mode }] }
      : { ...state, notes: [reserved], buildReservations: [{ id: 'build', kind: 'transfer', outgoingHistoryMode: mode, proofExposure: 'local', assetContractId, reservedNoteIds: [note.id], createdAt: 1, updatedAt: 1 }] };
    envelope.crypto = await encryptBytesWithKey(new TextEncoder().encode(stringifyPrivateIndices(candidate)), key,
      new TextEncoder().encode(`stellarkey-private-balance-state|2|${state.revision}|${record.key}`));
    record.value = stringifyPrivateIndices(envelope);
    const tampered = new MemoryDriver(); tampered.records.set(record.key, record.value);
    await assert.rejects(storage.loadPrivateBalanceState(context, key, tampered), /schema/);
    await assert.rejects(preparePrivateBalanceBackupArchive({ archive: malformed, resolveStorageKey: async () => key.slice(), validateContext: async () => assert.fail('Invalid history policy must not reach context acceptance') }), /schema/);
  }
});

test('the real action flow snapshots outgoing mode before worker construction, including deposit and sweep source accounts', async t => {
  t.mock.method(PrivateBalanceArchiveClient.prototype, 'readHead', async () => ({ latestLedger: 1, tree: { currentRoot: new Uint8Array(32) } }));
  t.mock.method(PrivateBalanceArchiveClient.prototype, 'readDepositsPaused', async () => false);
  t.mock.method(PrivateBalanceArchiveClient.prototype, 'readAssetBalance', async () => 100_000_000n);
  const sources = ['GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(9)).publicKey()];
  for (const accountPublicKey of sources) for (const outgoingHistoryMode of ['recoverable', 'minimized']) {
    const { driver } = await fixture({ outgoingHistoryMode, account: { setupState: 'ready', syncStatus: 'current', lastVerifiedActionIndex: 0n, updatedAt: 1 } });
    let builds = 0;
    await assert.rejects(preparePrivateBalanceActionFlow({ manifest: { assets: [{ index: 0, contractId: assetContractId }] },
      accountPublicKey, privateAddress: 'unused-by-deposit', storageContext: context, storageKey: key,
      storageDriver: driver, rpcUrl: 'https://rpc.invalid', classicFeeStroops: 100n, assetContractId, assetIndex: 0, registryAssets: [{ index: 0, contractId: assetContractId }], assetCode: 'XLM', assetDecimals: 7,
      draft: { kind: 'deposit', amount: '1' }, worker: { buildAction: async (_id, intent) => {
        builds++;
        const durable = await storage.loadPrivateBalanceState(context, key, driver);
        assert.equal(intent.outgoingHistory, outgoingHistoryMode ?? 'recoverable');
        assert.deepEqual(intent.depositSource.payload, new Uint8Array(StrKey.decodeEd25519PublicKey(accountPublicKey)));
        assert.equal(durable.buildReservations[0].outgoingHistoryMode, intent.outgoingHistory);
        await assert.rejects(storage.recordPrivateOutgoingHistoryMode(context, key, durable.revision, 'recoverable', {}, driver), /pending|action/);
        throw new Error('Captured immutable worker policy before proving or network simulation');
      } } }), /Captured immutable worker policy/);
    assert.equal(builds, 1);
  }
});
