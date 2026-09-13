import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptBytesWithKey } from '../src/lib/crypto.ts';
import { privateBalanceStateRecordKey } from '../src/lib/private-balance-bootstrap.ts';
import { stringifyPrivateIndices } from '../src/features/private-balance/runtime/indices.ts';
import * as storage from '../src/features/private-balance/runtime/storage.ts';
import { preparePrivateBalanceBackupArchive } from '../src/features/private-balance/runtime/backup.ts';
import { recoverPrivateBalanceAction, resumeSignedPrivateBalanceActions, signReviewedPrivateBalanceAction,
  broadcastPrivateBalanceAction } from '../src/features/private-balance/runtime/submission.ts';

const hex = n => n.toString(16).padStart(64, '0');
const context = { accountId: 'baseline-fixture', networkId: hex(1), realmId: hex(2), poolId: hex(3), deploymentBindingHash: hex(4) };
const key = new Uint8Array(32).fill(7);
const assetContractId = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
const pending = { id: 'synthetic-deposit', kind: 'deposit', status: 'prepared', assetContractId, assetIndex: 0,
  submissionMode: 'direct', proofExposure: 'local', outgoingHistoryMode: 'recoverable',
  reservedNoteIds: [], actionField: hex(5), nullifiers: [hex(0), hex(0)], outputCommitments: [hex(6), hex(0), hex(0)],
  anchorRoot: hex(7), anchorExpiresAtLedger: 100, proofHash: hex(8), classicFeeCapStroops: '100',
  resourceFeeCapStroops: '100', broadcastAttempts: 0, createdAt: 1, updatedAt: 1 };

const cases = {
  'missing route': state => { delete state.pendingActions[0].submissionMode; },
  'relayed route': state => { state.pendingActions[0].submissionMode = 'relay'; },
  'missing exposure': state => { delete state.pendingActions[0].proofExposure; },
  'missing action policy': state => { delete state.pendingActions[0].outgoingHistoryMode; },
  'missing preference': state => { delete state.outgoingHistoryMode; },
  'missing issuance history': state => { delete state.issuedAddressDiversifiers; },
  'archived consent': state => { state.relayChainedApproval = {}; },
  'archived route metadata': state => { state.pendingActions[0].relayChain = {}; },
  'missing build exposure': state => { state.pendingActions = []; state.buildReservations = [{ id: 'build', kind: 'deposit',
    outgoingHistoryMode: 'recoverable', assetContractId, reservedNoteIds: [], createdAt: 1, updatedAt: 1 }]; },
  'short recipient check code': state => { state.recentPrivateRecipients = [{ address: `tskpay_${'1'.repeat(121)}`,
    fingerprint: 'ABCD EF01', lastUsedAt: 1 }]; },
  'missing signed expiry': state => { Object.assign(state.pendingActions[0], { status: 'signed',
    transactionHash: hex(10), signedEnvelopeXdr: 'QUJDRA==' }); },
};

for (const [name, change] of Object.entries(cases)) {
  test(`v1.0.0 rejects ${name} locally and in backups without changing encrypted bytes`, async () => {
    const state = { ...storage.createEmptyPrivateBalanceState(hex(9), 1), outgoingHistoryMode: 'recoverable',
      issuedAddressDiversifiers: [], pendingActions: [structuredClone(pending)] };
    change(state);
    const recordKey = privateBalanceStateRecordKey(context);
    const envelope = { kind: 'stellarkey-private-balance-state', version: 2, revision: 0,
      crypto: await encryptBytesWithKey(new TextEncoder().encode(stringifyPrivateIndices(state)), key,
        new TextEncoder().encode(`stellarkey-private-balance-state|2|0|${recordKey}`)) };
    const raw = JSON.stringify(envelope);
    const driver = { read: async () => raw,
      compareAndSet: async () => assert.fail('Unsupported state cannot be rewritten'),
      removePrefix: async () => assert.fail('Unsupported state cannot be deleted') };
    await assert.rejects(storage.loadPrivateBalanceState(context, key, driver), /schema|unsupported|invalid/i);
    const input = { context, storageKey: key, storageDriver: driver, actionId: pending.id, expectedRevision: 0,
      networkPassphrase: 'synthetic', submissionMode: 'direct', now: () => 1,
      review: { expiresAt: 100, transactionHash: hex(10) },
      sign: async () => assert.fail('Unsupported state cannot invoke signing'),
      scanCanonicalTranscript: async () => assert.fail('Unsupported state cannot start recovery'),
      rpc: { sendTransaction: async () => assert.fail('Unsupported state cannot be submitted'),
        getTransaction: async () => assert.fail('Unsupported state cannot trigger a hash lookup') } };
    for (const operation of [recoverPrivateBalanceAction, resumeSignedPrivateBalanceActions,
      signReviewedPrivateBalanceAction, broadcastPrivateBalanceAction]) {
      await assert.rejects(operation(input), /schema|unsupported|invalid/i);
    }
    await assert.rejects(preparePrivateBalanceBackupArchive({ archive: { schemaVersion: 1, records: [{ key: recordKey, value: raw }] },
      resolveStorageKey: async () => key.slice(), validateContext: async () => {}, now: () => 10 }), /schema|unsupported|invalid/i);
    assert.equal(await driver.read(recordKey), raw);
  });
}

test('v1.0.0 has no obsolete relay-journal upgrader', () => {
  assert.equal(storage.retireLegacyPrivateRelayConsent, undefined);
});
