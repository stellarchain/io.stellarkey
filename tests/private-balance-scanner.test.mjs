import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ActionKind,
  appendCommitments,
  computeCommitment,
  computeAssetField,
  computeContextField,
  computeContextHash,
  computeGenesisRecordHash,
  computeNullifier,
  computeRecordHash,
  createEmptyTree,
  createOutputPackage,
  deriveOutgoingAad,
  deriveDiversifiedAddressKeys,
  deriveKeysFromSeed,
  derivePrivateAddressDeploymentTag,
  encodeOutgoingPlaintext,
  encodePrivateAddress,
  encodeNotePlaintext,
  sealOutgoingEnvelope,
  toViewingKey,
} from '@stellarkey/private-balance';
import { StrKey } from '@stellar/stellar-sdk';
import * as scannerModule from '../src/features/private-balance/runtime/scanner.ts';
import { privateAddressFingerprint } from '../src/features/private-balance/runtime/receive.ts';

const { scanArchiveRecords } = scannerModule;

const zero = (length) => new Uint8Array(length);
const bytes = (value, length = 32) => new Uint8Array(length).fill(value);
const hex = value => Buffer.from(value).toString('hex');

test('scanner maps envelope trials concurrently in bounded ordered batches', async () => {
  assert.equal(typeof scannerModule.mapInBoundedBatches, 'function');
  assert.equal(scannerModule.SCAN_ENVELOPE_BATCH_SIZE, 8);
  let active = 0;
  let peak = 0;
  const values = Array.from({ length: 145 }, (_, index) => index);
  const results = await scannerModule.mapInBoundedBatches(
    values,
    scannerModule.SCAN_ENVELOPE_BATCH_SIZE,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, value % 3));
      active -= 1;
      return value * 2;
    },
  );

  assert.ok(peak > 1, 'envelope trials should overlap');
  assert.ok(peak <= scannerModule.SCAN_ENVELOPE_BATCH_SIZE, 'concurrency must remain bounded');
  assert.deepEqual(results, values.map(value => value * 2), 'results must retain input order');
});

test('scanner recovers and authenticates an owned encrypted deposit', async (t) => {
  const networkId = bytes(1);
  const realmId = bytes(2);
  const poolId = bytes(3);
  const assetId = bytes(4);
  const asset = { kind: 1, payload: assetId };
  const assetContractId = StrKey.encodeContract(assetId);
  const assetField = computeAssetField(asset);
  const accountPublicKey = bytes(5);
  const deploymentBindingHash = bytes(6);
  const contextHash = computeContextHash(1, networkId, realmId, poolId);
  const contextField = computeContextField(contextHash);
  const keys = await deriveKeysFromSeed(
    bytes(7),
    1,
    networkId,
    realmId,
    poolId,
    accountPublicKey,
    contextField,
  );

  const rho = bytes(8);
  const diversifier = Uint8Array.of(1, 2, 3, 4);
  const receiveKeys = await deriveDiversifiedAddressKeys(
    keys.baseOwnerCommitment,
    keys.hpkePrivateKey,
    diversifier,
  );
  const note = {
    protocolVersion: 1,
    flags: 0,
    value: 50_000_000n,
    diversifier,
    ownerCommitment: receiveKeys.ownerCommitment,
    rho,
    memoLength: 4,
    memo: Uint8Array.from([...Buffer.from('rent'), ...zero(28)]),
    assetIndex: 0,
    reserved: zero(11),
  };
  const commitment = computeCommitment(
    contextField,
    assetField,
    receiveKeys.ownerCommitment,
    note.value,
    rho,
  );
  const actionNonce = bytes(9);
  const encrypted = await createOutputPackage(
    receiveKeys.hpkePublicKey,
    note.diversifier,
    encodeNotePlaintext(note),
    contextHash,
    commitment,
    actionNonce,
    0,
  );
  const dummyRho = bytes(10);
  const dummyNote = {
    ...note,
    flags: 1,
    value: 0n,
    rho: dummyRho,
    memoLength: 0,
    memo: zero(32),
  };
  const dummyCommitment = computeCommitment(
    contextField,
    assetField,
    receiveKeys.ownerCommitment,
    0n,
    dummyRho,
  );
  const dummyEncrypted = await createOutputPackage(
    receiveKeys.hpkePublicKey,
    dummyNote.diversifier,
    encodeNotePlaintext(dummyNote),
    contextHash,
    dummyCommitment,
    actionNonce,
    1,
  );
  const secondDummyRho = bytes(15);
  const secondDummyNote = { ...dummyNote, rho: secondDummyRho };
  const secondDummyCommitment = computeCommitment(
    contextField,
    assetField,
    receiveKeys.ownerCommitment,
    0n,
    secondDummyRho,
  );
  const secondDummyEncrypted = await createOutputPackage(
    receiveKeys.hpkePublicKey,
    secondDummyNote.diversifier,
    encodeNotePlaintext(secondDummyNote),
    contextHash,
    secondDummyCommitment,
    actionNonce,
    2,
  );
  const outputs = [
    {
      cm: commitment,
      recipientEnvelope: encrypted.recipientEnvelope,
      outgoingEnvelope: bytes(11, 157),
    },
    {
      cm: dummyCommitment,
      recipientEnvelope: dummyEncrypted.recipientEnvelope,
      outgoingEnvelope: bytes(12, 157),
    },
    {
      cm: secondDummyCommitment,
      recipientEnvelope: secondDummyEncrypted.recipientEnvelope,
      outgoingEnvelope: bytes(16, 157),
    },
  ];
  const tree = await createEmptyTree();
  const anchorRoot = zero(32);
  const treeRootAfter = await appendCommitments(tree, outputs.map(output => output.cm));
  const action = {
    protocolVersion: 1,
    kind: ActionKind.Deposit,
    assetIndex: 0,
    asset,
    actionNonce,
    anchorRoot,
    nullifiers: [bytes(13), bytes(14)],
    outputs,
    publicValue: note.value,
    depositSource: { kind: 0, payload: accountPublicKey },
  };
  const priorRecordHash = computeGenesisRecordHash(contextHash, deploymentBindingHash);
  const record = {
    actionIndex: 0,
    ledgerSequence: 123,
    startingLeafIndex: 0,
    actionKind: ActionKind.Deposit,
    assetIndex: 0,
    asset,
    actionNonce,
    anchorRoot,
    treeRootAfter,
    nullifiers: action.nullifiers,
    outputs,
    publicValue: note.value,
    depositSource: action.depositSource,
  };
  const recordHash = computeRecordHash(record, 1, priorRecordHash);

  const result = await scanArchiveRecords({
    records: [record],
    viewingKey: toViewingKey(keys),
    context: {
      protocolVersion: 1,
      networkId,
      realmId,
      poolId,
      contextHash,
      contextField,
      deploymentBindingHash,
      addressPrefix: 'tskpay_',
      assets: [{ index: 0, contractId: assetContractId }],
      accountAddress: { kind: 0, payload: accountPublicKey },
    },
    expectedPriorRecordHash: priorRecordHash,
    ledgerClosedAt: { 123: 1_700_000_000_000 },
  });

  assert.equal(result.notes.length, 1);
  assert.deepEqual(result.notes[0], {
    id: hex(commitment),
    commitment: hex(commitment),
    value: note.value.toString(),
    assetIndex: 0,
    assetContractId,
    diversifier: '01020304',
    ownerCommitment: hex(receiveKeys.ownerCommitment),
    leafIndex: 0,
    actionIndex: 0,
    rho: hex(rho),
    memoHex: Buffer.from('rent').toString('hex'),
    senderFingerprintHex: '',
    status: 'unspent',
    createdAt: 1_700_000_000_000,
  });
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].direction, 'inflow');
  assert.equal(result.activities[0].amount, note.value.toString());
  assert.equal(hex(result.tree.currentRoot), hex(treeRootAfter));
  assert.equal(hex(result.lastRecordHash), hex(recordHash));
  assert.match(result.nullifiersByCommitment.get(hex(commitment)), /^[0-9a-f]{64}$/);

  const recipientKeys = await deriveKeysFromSeed(
    bytes(17),
    1,
    networkId,
    realmId,
    poolId,
    bytes(18),
    contextField,
  );
  const transferNonce = bytes(19);
  const recipientRho = bytes(20);
  const changeRho = bytes(21);
  const recipientNote = {
    ...note,
    diversifier: new Uint8Array(4),
    value: 30_000_000n,
    ownerCommitment: recipientKeys.ownerCommitment,
    rho: recipientRho,
    memoLength: 3,
    memo: Uint8Array.from([...Buffer.from('pay'), ...zero(29)]),
  };
  const changeNote = {
    ...note,
    diversifier: new Uint8Array(4),
    ownerCommitment: keys.ownerCommitment,
    value: 20_000_000n,
    rho: changeRho,
    memoLength: 0,
    memo: zero(32),
  };
  const recipientCommitment = computeCommitment(
    contextField,
    assetField,
    recipientKeys.ownerCommitment,
    recipientNote.value,
    recipientRho,
  );
  const changeCommitment = computeCommitment(
    contextField,
    assetField,
    keys.ownerCommitment,
    changeNote.value,
    changeRho,
  );
  const transferOutputs = [
    {
      cm: recipientCommitment,
      recipientEnvelope: (await createOutputPackage(
        recipientKeys.hpkePublicKey,
        recipientNote.diversifier,
        encodeNotePlaintext(recipientNote),
        contextHash,
        recipientCommitment,
        transferNonce,
        0,
      )).recipientEnvelope,
      outgoingEnvelope: bytes(24, 157),
    },
    {
      cm: changeCommitment,
      recipientEnvelope: (await createOutputPackage(
        keys.hpkePublicKey,
        changeNote.diversifier,
        encodeNotePlaintext(changeNote),
        contextHash,
        changeCommitment,
        transferNonce,
        1,
      )).recipientEnvelope,
      outgoingEnvelope: bytes(25, 157),
    },
  ];
  const transferDummyRho = bytes(23);
  const transferDummy = {
    ...dummyNote,
    diversifier: new Uint8Array(4),
    ownerCommitment: keys.ownerCommitment,
    rho: transferDummyRho,
  };
  const transferDummyCommitment = computeCommitment(
    contextField,
    assetField,
    transferDummy.ownerCommitment,
    0n,
    transferDummyRho,
  );
  transferOutputs.push({
    cm: transferDummyCommitment,
    recipientEnvelope: (await createOutputPackage(
      keys.hpkePublicKey,
      transferDummy.diversifier,
      encodeNotePlaintext(transferDummy),
      contextHash,
      transferDummyCommitment,
      transferNonce,
      2,
    )).recipientEnvelope,
    outgoingEnvelope: bytes(29, 157),
  });
  for (const [outputIndex, output] of transferOutputs.entries()) {
    const outgoingNote = [recipientNote, changeNote, transferDummy][outputIndex];
    const recipientPublicKey = outputIndex === 0 ? recipientKeys.hpkePublicKey : keys.hpkePublicKey;
    const outgoingPlaintext = encodeOutgoingPlaintext({
      protocolVersion: 1,
      flags: outgoingNote.value === 0n ? 1 : 0,
      value: outgoingNote.value,
      diversifier: outgoingNote.diversifier,
      ownerCommitment: outgoingNote.ownerCommitment,
      recipientHpkePublicKey: recipientPublicKey,
      memoLength: outgoingNote.memoLength,
      memo: outgoingNote.memo,
      assetIndex: 0,
      reserved: zero(11),
    });
    output.outgoingEnvelope = await sealOutgoingEnvelope(
      keys.outgoingViewingKey,
      output.recipientEnvelope.slice(5, 37),
      outgoingPlaintext,
      deriveOutgoingAad(
        deploymentBindingHash,
        contextHash,
        assetField,
        output.cm,
        transferNonce,
        outputIndex,
      ),
      bytes(30 + outputIndex, 12),
    );
  }
  const transferNullifier = computeNullifier(
    contextField,
    keys.nk,
    rho,
    0n,
    commitment,
  );
  const transferRootAfter = await appendCommitments(
    tree,
    transferOutputs.map(output => output.cm),
  );
  const transferAction = {
    protocolVersion: 1,
    kind: ActionKind.PrivateTransfer,
    actionNonce: transferNonce,
    anchorRoot: treeRootAfter,
    nullifiers: [transferNullifier, bytes(26)],
    outputs: transferOutputs,
    publicValue: 0n,
  };
  const transferRecord = {
    actionIndex: 1,
    ledgerSequence: 124,
    startingLeafIndex: 3,
    actionKind: ActionKind.PrivateTransfer,
    actionNonce: transferNonce,
    anchorRoot: treeRootAfter,
    treeRootAfter: transferRootAfter,
    nullifiers: transferAction.nullifiers,
    outputs: transferOutputs,
    publicValue: 0n,
  };
  const transferRecordHash = computeRecordHash(transferRecord, 1, recordHash);
  const transferResult = await scanArchiveRecords({
    records: [record, transferRecord],
    viewingKey: toViewingKey(keys),
    context: {
      protocolVersion: 1,
      networkId,
      realmId,
      poolId,
      contextHash,
      contextField,
      deploymentBindingHash,
      addressPrefix: 'tskpay_',
      assets: [{ index: 0, contractId: assetContractId }],
      accountAddress: { kind: 0, payload: accountPublicKey },
    },
    expectedPriorRecordHash: priorRecordHash,
  });
  assert.equal(transferResult.notes.length, 2);
  assert.equal(hex(transferResult.lastRecordHash), hex(transferRecordHash));
  assert.equal(transferResult.notes[0].status, 'spent');
  assert.equal(transferResult.notes[1].value, '20000000');
  assert.equal(
    transferResult.notes.some(owned => owned.commitment === hex(recipientCommitment)),
    false,
  );
  assert.deepEqual(
    transferResult.activities.map(activity => ({
      actionKind: activity.actionKind,
      amount: activity.amount,
      direction: activity.direction,
    })),
    [
      { actionKind: 'deposit', amount: '50000000', direction: 'inflow' },
      { actionKind: 'transfer', amount: '30000000', direction: 'outflow' },
    ],
  );
  const recipientAddress = encodePrivateAddress({
    deploymentTag: derivePrivateAddressDeploymentTag(deploymentBindingHash),
    diversifier: recipientNote.diversifier,
    ownerCommitment: recipientNote.ownerCommitment,
    hpkePublicKey: recipientKeys.hpkePublicKey,
  }, 'tskpay_');
  assert.equal(
    transferResult.activities[1].recipientFingerprint,
    privateAddressFingerprint(recipientAddress),
  );
  assert.equal(transferResult.activities[1].memoHex, Buffer.from('pay').toString('hex'));

  const recipientTransferResult = await scanArchiveRecords({
    records: [record, transferRecord],
    viewingKey: toViewingKey(recipientKeys),
    context: {
      protocolVersion: 1,
      networkId,
      realmId,
      poolId,
      contextHash,
      contextField,
      deploymentBindingHash,
      addressPrefix: 'tskpay_',
      assets: [{ index: 0, contractId: assetContractId }],
      accountAddress: { kind: 0, payload: accountPublicKey },
    },
    expectedPriorRecordHash: priorRecordHash,
  });
  assert.equal(recipientTransferResult.activities.length, 1);
  assert.equal(recipientTransferResult.activities[0].direction, 'inflow');
  assert.equal(
    recipientTransferResult.activities[0].memoHex,
    Buffer.from('pay').toString('hex'),
    'the recipient activity must retain the memo decrypted from its owned note',
  );

  const duplicateNonce = bytes(22);
  const duplicateEnvelope = await createOutputPackage(
    receiveKeys.hpkePublicKey,
    note.diversifier,
    encodeNotePlaintext(note),
    contextHash,
    commitment,
    duplicateNonce,
    0,
  );
  const duplicateOutputs = [
    {
      cm: commitment,
      recipientEnvelope: duplicateEnvelope.recipientEnvelope,
      outgoingEnvelope: bytes(27, 157),
    },
    {
      cm: dummyCommitment,
      recipientEnvelope: dummyEncrypted.recipientEnvelope,
      outgoingEnvelope: bytes(28, 157),
    },
    {
      cm: secondDummyCommitment,
      recipientEnvelope: secondDummyEncrypted.recipientEnvelope,
      outgoingEnvelope: bytes(29, 157),
    },
  ];
  const duplicateTree = await createEmptyTree();
  await appendCommitments(duplicateTree, outputs.map(output => output.cm));
  const duplicateTreeRootAfter = await appendCommitments(
    duplicateTree,
    duplicateOutputs.map(output => output.cm),
  );
  const duplicateRecord = {
    ...record,
    actionIndex: 1,
    ledgerSequence: 124,
    startingLeafIndex: 3,
    actionNonce: duplicateNonce,
    treeRootAfter: duplicateTreeRootAfter,
    outputs: duplicateOutputs,
  };
  const duplicateResult = await scanArchiveRecords({
    records: [record, duplicateRecord],
    viewingKey: toViewingKey(keys),
    context: {
      protocolVersion: 1,
      networkId,
      realmId,
      poolId,
      contextHash,
      contextField,
      deploymentBindingHash,
      addressPrefix: 'tskpay_',
      assets: [{ index: 0, contractId: assetContractId }],
      accountAddress: { kind: 0, payload: accountPublicKey },
    },
    expectedPriorRecordHash: priorRecordHash,
  });
  assert.equal(duplicateResult.notes.length, 2, 'each authenticated leaf remains independently spendable');
  assert.equal(duplicateResult.activities.length, 2, 'each value-backed deposit remains visible');
  assert.notEqual(duplicateResult.notes[0].id, duplicateResult.notes[1].id);
  assert.equal(duplicateResult.notes[0].commitment, duplicateResult.notes[1].commitment);
  assert.notEqual(
    duplicateResult.nullifiersByCommitment.get(duplicateResult.notes[0].id),
    duplicateResult.nullifiersByCommitment.get(duplicateResult.notes[1].id),
  );
  assert.equal(duplicateResult.tree.nextIndex, 6, 'every on-chain output still advances the tree');

  const scanContext = {
    protocolVersion: 1,
    networkId,
    realmId,
    poolId,
    contextHash,
    contextField,
    deploymentBindingHash,
    addressPrefix: 'tskpay_',
    // Trial the wrong registered asset first; plaintext metadata must not select it.
    assets: [
      { index: 1, contractId: StrKey.encodeContract(bytes(40)) },
      { index: 0, contractId: assetContractId },
    ],
    accountAddress: { kind: 0, payload: accountPublicKey },
  };
  const scanInput = {
    viewingKey: toViewingKey(keys),
    context: scanContext,
    expectedPriorRecordHash: priorRecordHash,
  };
  const resealTransferMetadata = async (recipientIndexes, outgoingIndex = 0) => Promise.all(
    transferOutputs.map(async (output, outputIndex) => {
      const canonicalNote = [recipientNote, changeNote, transferDummy][outputIndex];
      const recipientHpkePublicKey = outputIndex === 0
        ? recipientKeys.hpkePublicKey
        : keys.hpkePublicKey;
      const { recipientEnvelope } = await createOutputPackage(
        recipientHpkePublicKey,
        canonicalNote.diversifier,
        encodeNotePlaintext({ ...canonicalNote, assetIndex: recipientIndexes[outputIndex] }),
        contextHash,
        output.cm,
        transferNonce,
        outputIndex,
      );
      // Resealing changes Epub, so rebind genuine sender recovery to that envelope.
      const outgoingEnvelope = await sealOutgoingEnvelope(
        keys.outgoingViewingKey,
        recipientEnvelope.slice(5, 37),
        encodeOutgoingPlaintext({
          ...canonicalNote,
          assetIndex: outgoingIndex,
          recipientHpkePublicKey,
        }),
        deriveOutgoingAad(
          deploymentBindingHash,
          contextHash,
          assetField,
          output.cm,
          transferNonce,
          outputIndex,
        ),
        bytes(41 + outputIndex, 12),
      );
      return { ...output, recipientEnvelope, outgoingEnvelope };
    }),
  );
  const laterTreeRoot = await appendCommitments(tree, duplicateOutputs.map(output => output.cm));
  const laterRecord = {
    ...duplicateRecord,
    actionIndex: 2,
    ledgerSequence: 125,
    startingLeafIndex: 6,
    nullifiers: [bytes(27), bytes(28)],
    treeRootAfter: laterTreeRoot,
  };

  for (const [name, recipientIndexes] of [
    ['another registered asset', [1, 0, 0]],
    ['an unregistered asset in change and dummy outputs', [0, 0xffff_ffff, 0xffff_ffff]],
  ]) {
    await t.test(`scanner contains recipient metadata naming ${name}`, async () => {
      const mixedRecord = {
        ...transferRecord,
        outputs: await resealTransferMetadata(recipientIndexes),
      };
      const mixedRecordHash = computeRecordHash(mixedRecord, 1, recordHash);
      const laterRecordHash = computeRecordHash(laterRecord, 1, mixedRecordHash);
      for (const [owner, ownerKeys] of [['sender', keys], ['recipient', recipientKeys]]) {
        const input = { ...scanInput, viewingKey: toViewingKey(ownerKeys) };
        const full = await scanArchiveRecords({
          ...input,
          records: [record, mixedRecord, laterRecord],
        });
        assert.deepEqual(
          full.notes.map(owned => ({
            value: owned.value,
            assetIndex: owned.assetIndex,
            assetContractId: owned.assetContractId,
            leafIndex: owned.leafIndex,
            status: owned.status,
          })),
          (owner === 'sender'
            ? [['50000000', 0, 'spent'], ['20000000', 4, 'unspent'], ['50000000', 6, 'unspent']]
            : [['30000000', 3, 'unspent']]
          ).map(([value, leafIndex, status]) => ({
            value, assetIndex: 0, assetContractId, leafIndex, status,
          })),
          'only commitment-authenticated real outputs enter canonical note accounting',
        );
        assert.deepEqual(
          full.activities.map(activity => [activity.actionKind, activity.direction, activity.amount]),
          owner === 'sender'
            ? [['deposit', 'inflow', '50000000'], ['transfer', 'outflow', '30000000'], ['deposit', 'inflow', '50000000']]
            : [['transfer', 'inflow', '30000000']],
        );
        assert.ok(full.activities.every(activity => (
          activity.assetIndex === 0 && activity.assetContractId === assetContractId
        )));
        const activity = full.activities.find(activity => activity.actionIndex === 1);
        assert.equal(activity.memoHex, Buffer.from('pay').toString('hex'));
        if (owner === 'sender') {
          assert.equal(activity.recipientFingerprint, privateAddressFingerprint(recipientAddress));
          assert.deepEqual(full.spentNullifierHexes, [hex(transferNullifier)]);
        } else {
          assert.deepEqual(full.spentNullifierHexes, []);
        }
        assert.equal(full.tree.nextIndex, 9);
        assert.deepEqual(full.tree.currentRoot, laterTreeRoot);
        assert.deepEqual(full.lastRecordHash, laterRecordHash);

        const firstPage = await scanArchiveRecords({ ...input, records: [record, mixedRecord] });
        assert.equal(firstPage.tree.nextIndex, 6);
        assert.deepEqual(firstPage.lastRecordHash, mixedRecordHash);
        const nextPage = await scanArchiveRecords({
          ...input,
          records: [laterRecord],
          initialTree: firstPage.tree,
          existingNotes: firstPage.notes,
          expectedPriorRecordHash: firstPage.lastRecordHash,
        });
        assert.deepEqual(nextPage.notes, full.notes);
        assert.deepEqual([...firstPage.activities, ...nextPage.activities], full.activities);
        assert.deepEqual(nextPage.tree, full.tree);
        assert.deepEqual(nextPage.lastRecordHash, full.lastRecordHash);
        assert.deepEqual(nextPage.nullifiersByCommitment, full.nullifiersByCommitment);
        assert.equal(firstPage.tree.nextIndex, 6, 'incremental scanning must not mutate its prior cursor');
      }
    });
  }

  await t.test('recipient metadata containment preserves canonical rejection boundaries', async () => {
    for (const [name, patch, expected] of [
      ['boundary registry mismatch', { assetIndex: 1 }, /authenticated registry/i],
      ['noncanonical commitment', {
        outputs: [{ ...outputs[0], cm: bytes(255) }, ...outputs.slice(1)],
      }, /commitment is not canonical/i],
      ['noncanonical nullifier', { nullifiers: [bytes(255), bytes(14)] }, /nullifier.*not canonical/i],
      ['duplicate nullifier', { nullifiers: [bytes(13), bytes(13)] }, /nullifiers must differ/i],
      ['malformed transcript field', { actionNonce: bytes(9, 31) }, /action nonce must be 32 bytes/i],
      ['wrong tree root', { treeRootAfter: bytes(10) }, /tree root mismatch/i],
      ['wrong action sequence', { actionIndex: 1 }, /action sequence mismatch/i],
      ['wrong leaf position', { actionIndex: 1, startingLeafIndex: 3 }, /leaf position mismatch/i],
    ]) {
      await assert.rejects(
        () => scanArchiveRecords({ ...scanInput, records: [{ ...record, ...patch }] }),
        expected,
        name,
      );
    }
    for (const [name, assets, expected] of [
      ['invalid registry index', [{ index: -1, contractId: assetContractId }], /registry index is invalid/i],
      ['invalid registry contract', [{ index: 0, contractId: 'invalid' }], /registry contract is invalid/i],
      ['duplicate registry index', scanContext.assets.map(asset => ({ ...asset, index: 0 })), /duplicate entries/i],
      ['duplicate registry contract', scanContext.assets.map(asset => ({ ...asset, contractId: assetContractId })), /duplicate entries/i],
    ]) {
      await assert.rejects(
        () => scanArchiveRecords({
          ...scanInput, records: [record], context: { ...scanContext, assets },
        }),
        expected,
        name,
      );
    }
    const wrongOutgoing = { ...transferRecord, outputs: await resealTransferMetadata([0, 0, 0], 1) };
    await assert.rejects(
      () => scanArchiveRecords({ ...scanInput, records: [record, wrongOutgoing] }),
      /outgoing asset index does not match its authenticated asset/i,
    );
    for (const [patch, expected] of [
      [{ assetIndex: 1 }, /not in the authenticated registry/i],
      [{ status: 'spent' }, /spent more than once/i],
    ]) {
      await assert.rejects(
        () => scanArchiveRecords({
          ...scanInput,
          records: [transferRecord],
          initialTree: result.tree,
          existingNotes: result.notes.map(owned => ({ ...owned, ...patch })),
          expectedPriorRecordHash: result.lastRecordHash,
        }),
        expected,
      );
    }
  });

  await assert.rejects(
    () => scanArchiveRecords({
      records: [{ ...record, actionIndex: 1 }],
      viewingKey: toViewingKey(keys),
      context: {
        protocolVersion: 1,
        networkId,
        realmId,
        poolId,
        contextHash,
        contextField,
        deploymentBindingHash,
        addressPrefix: 'tskpay_',
        assets: [{ index: 0, contractId: assetContractId }],
      },
      expectedPriorRecordHash: priorRecordHash,
    }),
    /action sequence/i,
  );
  await assert.rejects(
    () => scanArchiveRecords({
      records: [{ ...record, treeRootAfter: bytes(10) }],
      viewingKey: toViewingKey(keys),
      context: {
        protocolVersion: 1,
        networkId,
        realmId,
        poolId,
        contextHash,
        contextField,
        deploymentBindingHash,
        addressPrefix: 'tskpay_',
        assets: [{ index: 0, contractId: assetContractId }],
      },
      expectedPriorRecordHash: priorRecordHash,
    }),
    /tree root/i,
  );
});
