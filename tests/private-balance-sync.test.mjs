import assert from 'node:assert/strict';
import test from 'node:test';
import { StrKey } from '@stellar/stellar-sdk';
import {
  computeGenesisRecordHash,
  computeRecordHash,
} from '@stellarkey/private-balance';
import {
  commitPrivateBalanceState,
  createEmptyPrivateBalanceState,
  loadPrivateBalanceState,
} from '../src/features/private-balance/runtime/storage.ts';
import {
  attachLocalActivityMetadata,
  diffIncomingPrivateTransfers,
  syncPrivateBalance,
  PrivateContractAdvancedDuringSyncError,
  MAX_CONTRACT_ADVANCE_RESUMES,
} from '../src/features/private-balance/runtime/sync-machine.ts';
import { loadPrivateBalanceCommitments } from '../src/features/private-balance/runtime/public-cache.ts';

const bytes = (value, length = 32) => new Uint8Array(length).fill(value);
const hex = value => Buffer.from(value).toString('hex');
const ASSET_CONTRACT_ID = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
const ASSET = { kind: 1, payload: new Uint8Array(StrKey.decodeContract(ASSET_CONTRACT_ID)) };

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
  async removePrefix() {}
}

test('verified activity keeps encrypted local recipient and memo metadata only when its action matches', () => {
  const activity = {
    id: '09'.repeat(32),
    actionIndex: 4,
    actionKind: 'transfer',
    assetContractId: ASSET_CONTRACT_ID,
    amount: '6000000',
    direction: 'outflow',
    timestamp: 2,
    nullifiers: ['0a'.repeat(32)],
    outputCommitments: ['0b'.repeat(32)],
  };
  const matching = {
    actionField: activity.id,
    transactionHash: '0d'.repeat(32),
    recipientFingerprint: 'ABCD EF01',
    memoHex: Buffer.from('rent').toString('hex'),
  };

  assert.deepEqual(attachLocalActivityMetadata([activity], [matching]), [{
    ...activity,
    transactionHash: '0d'.repeat(32),
    recipientFingerprint: 'ABCD EF01',
    memoHex: Buffer.from('rent').toString('hex'),
  }]);
  assert.deepEqual(attachLocalActivityMetadata([activity], []), [activity]);
  assert.deepEqual(attachLocalActivityMetadata([activity], [{
    ...matching,
    actionField: '0c'.repeat(32),
  }]), [activity]);
});

test('sync commits verified record progress and marks current only after head reconciliation', async () => {
  const contextHash = bytes(1);
  const deploymentBindingHash = bytes(2);
  const manifestHash = hex(bytes(3));
  const priorRecordHash = computeGenesisRecordHash(contextHash, deploymentBindingHash);
  const record = {
    actionIndex: 0,
    ledgerSequence: 123,
    startingLeafIndex: 0,
    actionKind: 1,
    asset: ASSET,
    actionNonce: bytes(4),
    anchorRoot: bytes(0),
    treeRootAfter: bytes(5),
    nullifiers: [bytes(0), bytes(0)],
    outputs: [
      { cm: bytes(6), recipientEnvelope: bytes(7, 181) },
      { cm: bytes(0), recipientEnvelope: bytes(0, 181) },
    ],
    publicValue: 5_000_000n,
    relayerFee: 0n,
    relayer: undefined,
    depositSource: { kind: 0, payload: bytes(8) },
  };
  const recordHash = computeRecordHash(record, 1, priorRecordHash);
  const actionField = bytes(9);
  const head = {
    latestLedger: 500,
    config: {},
    meta: {
      actionCount: 1,
      transcriptHead: recordHash,
    },
    tree: {
      nextIndex: 2,
      frontier: Array.from({ length: 32 }, () => bytes(0)),
      currentRoot: record.treeRootAfter,
    },
  };
  let headReads = 0;
  const closeTimeRequests = [];
  const archive = {
    async readHead() {
      headReads += 1;
      return head;
    },
    async readRecords(startActionIndex, count) {
      assert.equal(startActionIndex, 0);
      assert.equal(count, 1);
      return [record];
    },
    async readLedgerCloseTimes(sequences) {
      closeTimeRequests.push([...sequences]);
      // Unix seconds from the RPC; the sync machine stores milliseconds.
      return { 123: 1_700 };
    },
  };
  const note = {
    id: hex(bytes(6)),
    commitment: hex(bytes(6)),
    value: '5000000',
    assetContractId: ASSET_CONTRACT_ID,
    diversifier: '00000000',
    ownerCommitment: hex(bytes(10)),
    leafIndex: 0,
    actionIndex: 0,
    rho: hex(bytes(11)),
    memoHex: '',
    senderFingerprintHex: '',
    status: 'unspent',
    createdAt: 0,
  };
  const spentInput = {
    ...note,
    id: hex(bytes(24)),
    commitment: hex(bytes(24)),
    rho: hex(bytes(25)),
    status: 'reserved',
    reservedAt: 1,
  };
  const survivingInput = {
    ...note,
    id: hex(bytes(26)),
    commitment: hex(bytes(26)),
    rho: hex(bytes(27)),
    status: 'reserved',
    reservedAt: 1,
  };
  const worker = {
    async scanPage(input) {
      assert.deepEqual(input.expectedPriorRecordHash, priorRecordHash);
      assert.deepEqual(input.records, [record]);
      assert.deepEqual(input.ledgerClosedAt, { 123: 1_700_000 });
      return {
        notes: [
          note,
          { ...spentInput, status: 'spent', reservedAt: undefined, spentInActionIndex: 0 },
          survivingInput,
        ],
        activities: [{
          id: hex(actionField),
          actionIndex: 0,
          actionKind: 'deposit',
          assetContractId: ASSET_CONTRACT_ID,
          amount: '5000000',
          direction: 'inflow',
          timestamp: 2,
          nullifiers: record.nullifiers.map(hex),
          outputCommitments: record.outputs.map(output => hex(output.cm)),
        }],
        tree: head.tree,
        lastRecordHash: recordHash,
        spentNullifierHexes: [],
        nullifiersByCommitment: new Map(),
      };
    },
  };
  const storageContext = {
    networkId: hex(bytes(12)),
    realmId: hex(bytes(13)),
    poolId: hex(bytes(14)),
    accountId: 'account-1',
    deploymentBindingHash: hex(deploymentBindingHash),
  };
  const storageKey = bytes(16);
  const driver = new MemoryDriver();
  const initial = {
    ...createEmptyPrivateBalanceState(manifestHash, 1),
    notes: [spentInput, survivingInput],
    pendingActions: [{
      id: 'deposit-1',
      kind: 'deposit',
      assetContractId: ASSET_CONTRACT_ID,
      status: 'prepared',
      reservedNoteIds: [],
      actionField: hex(actionField),
      nullifiers: record.nullifiers.map(hex),
      outputCommitments: record.outputs.map(output => hex(output.cm)),
      anchorRoot: hex(record.anchorRoot),
      anchorExpiresAtLedger: 0,
      proofHash: hex(bytes(17)),
      classicFeeCapStroops: '1000',
      resourceFeeCapStroops: '500000',
      broadcastAttempts: 0,
      createdAt: 1,
      updatedAt: 1,
    }, {
      // A foreign action consumed one of the two reserved inputs, so this
      // transfer can never land and its surviving input must be released.
      id: 'foreign-loser',
      kind: 'transfer',
      assetContractId: ASSET_CONTRACT_ID,
      status: 'prepared',
      reservedNoteIds: [spentInput.id, survivingInput.id],
      actionField: hex(bytes(28)),
      nullifiers: [hex(bytes(29)), '00'.repeat(32)],
      outputCommitments: [hex(bytes(30)), hex(bytes(31))],
      anchorRoot: hex(bytes(32)),
      anchorExpiresAtLedger: 600,
      proofHash: hex(bytes(33)),
      classicFeeCapStroops: '1000',
      resourceFeeCapStroops: '500000',
      broadcastAttempts: 0,
      createdAt: 1,
      updatedAt: 1,
    }],
  };
  await commitPrivateBalanceState(
    storageContext,
    storageKey,
    initial,
    null,
    driver,
  );

  const progressUpdates = [];
  const result = await syncPrivateBalance({
    archive,
    worker,
    contextHash,
    deploymentBindingHash,
    manifestHash,
    storageContext,
    storageKey,
    storageDriver: driver,
    publicCacheDriver: driver,
    onProgress: update => progressUpdates.push(update),
    now: () => 2,
  });

  assert.equal(headReads, 2);
  assert.deepEqual(progressUpdates, [{ actionIndex: 0, actionCount: 1, firstActionIndex: 0 }]);
  assert.deepEqual(closeTimeRequests, [[123]]);
  assert.equal(result.account.syncStatus, 'current');
  assert.equal(result.account.lastVerifiedActionIndex, 0);
  assert.equal(result.checkpoint.lastRecordHash, hex(recordHash));
  assert.equal(result.checkpoint.latestLedger, 500);
  assert.deepEqual(result.pendingActions, []);
  const notesById = new Map(result.notes.map(item => [item.id, item]));
  assert.equal(notesById.get(spentInput.id).status, 'spent');
  assert.equal(notesById.get(survivingInput.id).status, 'unspent');
  assert.equal(notesById.get(survivingInput.id).reservedAt, undefined);
  assert.deepEqual(
    await loadPrivateBalanceState(storageContext, storageKey, driver),
    JSON.parse(JSON.stringify(result)),
  );
  assert.deepEqual(
    (await loadPrivateBalanceCommitments(storageContext, driver)).map(hex),
    record.outputs.map(output => hex(output.cm)),
  );
});

test('sync resumes a bounded number of times when the contract advances mid-scan', async () => {
  const emptyHead = transcriptByte => ({
    latestLedger: 100,
    config: {},
    meta: {
      actionCount: 0,
      transcriptHead: bytes(transcriptByte),
    },
    tree: {
      nextIndex: 0,
      frontier: Array.from({ length: 32 }, () => bytes(0)),
      currentRoot: bytes(0),
    },
  });
  const storageContext = {
    networkId: hex(bytes(40)),
    realmId: hex(bytes(41)),
    poolId: hex(bytes(42)),
    accountId: 'resume-account',
    deploymentBindingHash: hex(bytes(2)),
  };
  const storageKey = bytes(44);
  const worker = { async scanPage() { assert.fail('an empty archive never scans'); } };
  const base = {
    worker,
    contextHash: bytes(1),
    deploymentBindingHash: bytes(2),
    manifestHash: hex(bytes(3)),
    storageContext,
    storageKey,
    now: () => 2,
  };

  // The final head settles after one resume: the sync succeeds quietly.
  const settlingDriver = new MemoryDriver();
  await commitPrivateBalanceState(
    storageContext,
    storageKey,
    createEmptyPrivateBalanceState(base.manifestHash, 1),
    null,
    settlingDriver,
  );
  let settlingReads = 0;
  const settled = await syncPrivateBalance({
    ...base,
    storageDriver: settlingDriver,
    publicCacheDriver: settlingDriver,
    archive: {
      async readHead() {
        settlingReads += 1;
        return settlingReads === 1 ? emptyHead(7) : emptyHead(8);
      },
      async readRecords() { assert.fail('an empty archive has no records'); },
    },
  });
  assert.equal(settlingReads, 4);
  assert.equal(settled.account.syncStatus, 'current');

  // A head that never settles surfaces the typed error once the resume
  // budget runs out.
  const churnDriver = new MemoryDriver();
  await commitPrivateBalanceState(
    storageContext,
    storageKey,
    createEmptyPrivateBalanceState(base.manifestHash, 1),
    null,
    churnDriver,
  );
  let churnReads = 0;
  await assert.rejects(
    () => syncPrivateBalance({
      ...base,
      storageDriver: churnDriver,
      publicCacheDriver: churnDriver,
      archive: {
        async readHead() {
          churnReads += 1;
          return emptyHead(churnReads % 256);
        },
        async readRecords() { assert.fail('an empty archive has no records'); },
      },
    }),
    PrivateContractAdvancedDuringSyncError,
  );
  assert.equal(churnReads, (MAX_CONTRACT_ADVANCE_RESUMES + 1) * 2);
});

test('incoming diffs collapse only new inbound transfers into one event', () => {
  const activity = (actionIndex, actionKind, direction, amount) => ({
    id: hex(bytes(actionIndex + 50)),
    actionIndex,
    actionKind,
    amount,
    direction,
    timestamp: 0,
    nullifiers: [],
    outputCommitments: [],
  });
  const activities = [
    activity(0, 'transfer', 'inflow', '1000'),
    activity(1, 'deposit', 'inflow', '2000'),
    activity(2, 'transfer', 'inflow', '3000'),
    activity(3, 'transfer', 'internal', '0'),
    activity(4, 'transfer', 'outflow', '4000'),
    activity(5, 'transfer', 'inflow', '5000'),
  ];
  assert.deepEqual(diffIncomingPrivateTransfers(1, activities), {
    count: 2,
    totalAmountStroops: '8000',
  });
  assert.deepEqual(diffIncomingPrivateTransfers(5, activities), {
    count: 0,
    totalAmountStroops: '0',
  });
  assert.throws(() => diffIncomingPrivateTransfers(-1, activities), /index is invalid/);
});
