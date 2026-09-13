import { parsePrivateIndices, stringifyPrivateIndices } from '../src/features/private-balance/runtime/indices.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { StrKey } from '@stellar/stellar-sdk';
import {
  appendFrontier,
  computeGenesisRecordHash,
  computeRecordHash,
  createEmptyTree,
  refreshTreeRoot,
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
import { loadPrivateBalanceMerkleCheckpoint } from '../src/features/private-balance/runtime/merkle-cache.ts';

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
  async compareAndSetMany(key, expectedRevision, entries, removeKeys = [], expectedPrefix, expectedRecords) {
    const current = this.records.get(key) ?? null;
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    if (expectedPrefix) {
      const actual = new Map([...this.records].filter(([key]) => key.startsWith(expectedPrefix.prefix)));
      if (actual.size !== expectedPrefix.entries.size || [...expectedPrefix.entries].some(([key, value]) => actual.get(key) !== value)) {
        return { ok: false, current };
      }
    }
    if ([...expectedRecords ?? []].some(([key, raw]) => (this.records.get(key) ?? null) !== raw)) return { ok: false, current };
    for (const key of removeKeys) if (!entries.has(key)) this.records.delete(key);
    for (const [entryKey, value] of entries) this.records.set(entryKey, value);
    for (const [entryKey, value] of entries) assert.equal(this.records.get(entryKey), value);
    return { ok: true, current: entries.get(key) ?? null };
  }
  async replacePrefixVerified(prefix, entries, removeKeys = [], guard = {}, expectedRecords) {
    guard.signal?.throwIfAborted();
    guard.assertActive?.();
    if ([...expectedRecords ?? []].some(([key, raw]) => (this.records.get(key) ?? null) !== raw)) throw new Error('Records changed before removal');
    for (const key of [...this.records.keys()]) if (key.startsWith(prefix)) this.records.delete(key);
    for (const key of removeKeys) this.records.delete(key);
    for (const [key, value] of entries) this.records.set(key, value);
    for (const [key, value] of entries) assert.equal(this.records.get(key), value);
  }
  async removePrefix(prefix) {
    for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key);
  }
}

test('verified activity keeps encrypted local recipient and memo metadata only when its action matches', () => {
  const activity = {
    id: '09'.repeat(32),
    actionIndex: 4n,
    actionKind: 'transfer',
    assetIndex: 0,
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

for (const holdCase of ['pending', 'legacy-transfer-spent', 'legacy-withdraw-spent', 'legacy-held']) test(`sync commits verified progress and reconciles only canonical spends of ${holdCase} inputs`, async () => {
  const contextHash = bytes(1);
  const deploymentBindingHash = bytes(2);
  const manifestHash = hex(bytes(3));
  const priorRecordHash = computeGenesisRecordHash(contextHash, deploymentBindingHash);
  const verifiedTree = await createEmptyTree();
  await appendFrontier(verifiedTree, bytes(6));
  await appendFrontier(verifiedTree, bytes(7));
  await appendFrontier(verifiedTree, bytes(8));
  await refreshTreeRoot(verifiedTree);
  const record = {
    actionIndex: 0n,
    ledgerSequence: 123,
    startingLeafIndex: 0n,
    actionKind: 1,
    assetIndex: 0,
    asset: ASSET,
    actionNonce: bytes(4),
    anchorRoot: bytes(0),
    treeRootAfter: verifiedTree.currentRoot,
    nullifiers: [bytes(18), bytes(19)],
    outputs: [
      { cm: bytes(6), recipientEnvelope: bytes(7, 181), outgoingEnvelope: bytes(8, 157) },
      { cm: bytes(7), recipientEnvelope: bytes(9, 181), outgoingEnvelope: bytes(10, 157) },
      { cm: bytes(8), recipientEnvelope: bytes(11, 181), outgoingEnvelope: bytes(12, 157) },
    ],
    publicValue: 5_000_000n,
    depositSource: { kind: 0, payload: bytes(8) },
  };
  const recordHash = computeRecordHash(record, 2, priorRecordHash);
  const actionField = bytes(9);
  const head = {
    latestLedger: 500,
    config: {},
    meta: {
      actionCount: 1n,
      transcriptHead: recordHash,
    },
    tree: {
      nextIndex: 3n,
      frontier: verifiedTree.frontier,
      currentRoot: record.treeRootAfter,
    },
  };
  let headReads = 0;
  let archiveReads = 0;
  const closeTimeRequests = [];
  const archive = {
    async readHead() {
      headReads += 1;
      return head;
    },
    async readRecords(startActionIndex, count) {
      archiveReads += 1;
      assert.equal(startActionIndex, 0n);
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
    assetIndex: 0,
    assetContractId: ASSET_CONTRACT_ID,
    diversifier: '00000000',
    ownerCommitment: hex(bytes(10)),
    leafIndex: 0n,
    actionIndex: 0n,
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
          holdCase === 'legacy-held' ? spentInput : { ...spentInput, status: 'spent', reservedAt: undefined, spentInActionIndex: 0n },
          survivingInput,
        ],
        activities: [{
          id: hex(actionField),
          actionIndex: 0n,
          actionKind: 'deposit',
          assetIndex: 0,
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
      assetIndex: 0,
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
      assetIndex: 0,
      assetContractId: ASSET_CONTRACT_ID,
      status: 'prepared',
      reservedNoteIds: [spentInput.id, survivingInput.id],
      actionField: hex(bytes(28)),
      nullifiers: [hex(bytes(29)), '00'.repeat(32)],
      outputCommitments: [hex(bytes(30)), hex(bytes(31)), hex(bytes(34))],
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
  if (holdCase !== 'pending') {
    initial.pendingActions.pop();
    initial.buildReservations = [{ id: 'legacy-build', kind: holdCase === 'legacy-withdraw-spent' ? 'withdraw' : 'transfer',
      assetContractId: ASSET_CONTRACT_ID, reservedNoteIds: [spentInput.id, survivingInput.id], createdAt: 1, updatedAt: 1 }];
  }
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
  assert.deepEqual(progressUpdates, [{ actionIndex: 0n, actionCount: 1n, firstActionIndex: 0n }]);
  assert.deepEqual(closeTimeRequests, [[123]]);
  assert.equal(result.account.syncStatus, 'current');
  assert.equal(result.account.lastVerifiedActionIndex, 0n);
  assert.equal(result.checkpoint.lastRecordHash, hex(recordHash));
  assert.equal(result.checkpoint.latestLedger, 500);
  assert.deepEqual(result.pendingActions, []);
  assert.equal(result.buildReservations.length, holdCase === 'legacy-held' ? 1 : 0);
  const notesById = new Map(result.notes.map(item => [item.id, item]));
  assert.equal(notesById.get(spentInput.id).status, holdCase === 'legacy-held' ? 'reserved' : 'spent');
  assert.equal(notesById.get(survivingInput.id).status, holdCase === 'legacy-held' ? 'reserved' : 'unspent');
  assert.equal(notesById.get(survivingInput.id).reservedAt, holdCase === 'legacy-held' ? 1 : undefined);
  assert.deepEqual(
    await loadPrivateBalanceState(storageContext, storageKey, driver),
    parsePrivateIndices(stringifyPrivateIndices(result), ['leafIndex', 'actionIndex', 'spentInActionIndex', 'lastVerifiedActionIndex', 'lastActionIndex', 'nextLeafIndex']),
  );
  assert.deepEqual(
    (await loadPrivateBalanceCommitments(storageContext, driver)).map(hex),
    record.outputs.map(output => hex(output.cm)),
  );

  const merkleCheckpointKey = [...driver.records.keys()].find(key => key.startsWith('private:merkle:') && key.endsWith(':checkpoint'));
  const corrupted = JSON.parse(driver.records.get(merkleCheckpointKey));
  corrupted.root = 'ff'.repeat(32);
  driver.records.set(merkleCheckpointKey, JSON.stringify(corrupted));
  const corruptPublic = holdCase === 'pending';
  if (corruptPublic) {
    const leafKey = [...driver.records.keys()].find(key => key.startsWith('private:cache:v2:') && key.includes(':commitments:'));
    const leaf = JSON.parse(driver.records.get(leafKey));
    leaf.commitments[0] = 'ff'.repeat(32);
    driver.records.set(leafKey, JSON.stringify(leaf));
  }
  const readsBeforeRecovery = archiveReads;
  const recovered = await syncPrivateBalance({
    archive,
    worker,
    contextHash,
    deploymentBindingHash,
    manifestHash,
    storageContext,
    storageKey,
    storageDriver: driver,
    publicCacheDriver: driver,
    now: () => 3,
  });
  assert.equal(recovered.account.syncStatus, 'current');
  assert.equal(archiveReads - readsBeforeRecovery, corruptPublic ? 1 : 0);
  assert.deepEqual((await loadPrivateBalanceCommitments(storageContext, driver)).map(hex), record.outputs.map(output => hex(output.cm)));
  assert.equal(
    (await loadPrivateBalanceMerkleCheckpoint(storageContext, driver)).root,
    hex(record.treeRootAfter),
  );
});

test('sync resumes a bounded number of times when the contract advances mid-scan', async () => {
  const emptyHead = transcriptByte => ({
    latestLedger: 100,
    config: {},
    meta: {
      actionCount: 0n,
      transcriptHead: bytes(transcriptByte),
    },
    tree: {
      nextIndex: 0n,
      frontier: Array.from({ length: 34 }, () => bytes(0)),
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

test('sync uses the injected corroborated head for both boundary checks', async () => {
  const deploymentBindingHash = bytes(62);
  const manifestHash = hex(bytes(63));
  const storageContext = {
    networkId: hex(bytes(64)),
    realmId: hex(bytes(65)),
    poolId: hex(bytes(66)),
    accountId: 'corroborated-head-account',
    deploymentBindingHash: hex(deploymentBindingHash),
  };
  const storageKey = bytes(67);
  const driver = new MemoryDriver();
  await commitPrivateBalanceState(
    storageContext,
    storageKey,
    createEmptyPrivateBalanceState(manifestHash, 1),
    null,
    driver,
  );
  const emptyHead = {
    latestLedger: 700,
    config: {},
    meta: { actionCount: 0n, transcriptHead: bytes(0) },
    tree: {
      nextIndex: 0n,
      frontier: Array.from({ length: 34 }, () => bytes(0)),
      currentRoot: bytes(0),
    },
  };
  let corroboratedReads = 0;
  const result = await syncPrivateBalance({
    archive: {
      async readHead() { assert.fail('the unauthenticated primary head must not be used'); },
      async readRecords() { assert.fail('an empty archive has no records'); },
    },
    async corroborateHead() {
      corroboratedReads += 1;
      return emptyHead;
    },
    worker: { async scanPage() { assert.fail('an empty archive never scans'); } },
    contextHash: bytes(61),
    deploymentBindingHash,
    manifestHash,
    storageContext,
    storageKey,
    storageDriver: driver,
    publicCacheDriver: driver,
    now: () => 5,
  });

  assert.equal(corroboratedReads, 2);
  assert.equal(result.account.syncStatus, 'current');
});

test('a failed initial corroboration leaves the durable checkpoint unchanged', async () => {
  const deploymentBindingHash = bytes(72);
  const manifestHash = hex(bytes(73));
  const storageContext = {
    networkId: hex(bytes(74)),
    realmId: hex(bytes(75)),
    poolId: hex(bytes(76)),
    accountId: 'disagreeing-head-account',
    deploymentBindingHash: hex(deploymentBindingHash),
  };
  const storageKey = bytes(77);
  const driver = new MemoryDriver();
  const initial = createEmptyPrivateBalanceState(manifestHash, 9);
  await commitPrivateBalanceState(storageContext, storageKey, initial, null, driver);

  await assert.rejects(
    () => syncPrivateBalance({
      archive: {
        async readHead() { assert.fail('the unauthenticated primary head must not be used'); },
        async readRecords() { assert.fail('corroboration failed before scanning'); },
      },
      async corroborateHead() {
        throw new Error('Private Payments RPC views disagree.');
      },
      worker: { async scanPage() { assert.fail('corroboration failed before scanning'); } },
      contextHash: bytes(71),
      deploymentBindingHash,
      manifestHash,
      storageContext,
      storageKey,
      storageDriver: driver,
      publicCacheDriver: driver,
    }),
    /RPC views disagree/,
  );

  assert.deepEqual(
    await loadPrivateBalanceState(storageContext, storageKey, driver),
    JSON.parse(JSON.stringify(initial)),
  );
});

test('incoming diffs collapse only new inbound transfers into one event', () => {
  const activity = (actionIndex, actionKind, direction, amount) => ({
    id: hex(bytes(actionIndex + 50)),
    actionIndex,
    actionKind,
    assetIndex: 0,
    assetContractId: ASSET_CONTRACT_ID,
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
  assert.deepEqual(diffIncomingPrivateTransfers(1n, activities), {
    count: 2,
    totalAmountStroops: '8000',
  });
  assert.deepEqual(diffIncomingPrivateTransfers(5n, activities), {
    count: 0,
    totalAmountStroops: '0',
  });
  assert.throws(() => diffIncomingPrivateTransfers(-1, activities), /index is invalid/);
});
