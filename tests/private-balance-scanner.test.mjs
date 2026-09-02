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
import { scanArchiveRecords } from '../src/features/private-balance/runtime/scanner.ts';
import { privateAddressFingerprint } from '../src/features/private-balance/runtime/receive.ts';

const zero = (length) => new Uint8Array(length);
const bytes = (value, length = 32) => new Uint8Array(length).fill(value);
const hex = value => Buffer.from(value).toString('hex');

test('scanner recovers and authenticates an owned encrypted deposit', async () => {
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
    reserved: zero(15),
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
  ];
  const tree = await createEmptyTree();
  const anchorRoot = zero(32);
  const treeRootAfter = await appendCommitments(tree, outputs.map(output => output.cm));
  const action = {
    protocolVersion: 1,
    kind: ActionKind.Deposit,
    asset,
    actionNonce,
    anchorRoot,
    nullifiers: [bytes(13), bytes(14)],
    outputs,
    publicValue: note.value,
    relayerFee: 0n,
    relayer: undefined,
    depositSource: { kind: 0, payload: accountPublicKey },
  };
  const priorRecordHash = computeGenesisRecordHash(contextHash, deploymentBindingHash);
  const record = {
    actionIndex: 0,
    ledgerSequence: 123,
    startingLeafIndex: 0,
    actionKind: ActionKind.Deposit,
    asset,
    actionNonce,
    anchorRoot,
    treeRootAfter,
    nullifiers: action.nullifiers,
    outputs,
    publicValue: note.value,
    relayerFee: 0n,
    relayer: undefined,
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
  for (const [outputIndex, output] of transferOutputs.entries()) {
    const outgoingNote = outputIndex === 0 ? recipientNote : changeNote;
    const recipientPublicKey = outputIndex === 0
      ? recipientKeys.hpkePublicKey
      : keys.hpkePublicKey;
    const outgoingPlaintext = encodeOutgoingPlaintext({
      protocolVersion: 1,
      flags: 0,
      value: outgoingNote.value,
      diversifier: outgoingNote.diversifier,
      ownerCommitment: outgoingNote.ownerCommitment,
      recipientHpkePublicKey: recipientPublicKey,
      memoLength: outgoingNote.memoLength,
      memo: outgoingNote.memo,
      reserved: zero(15),
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
    asset,
    actionNonce: transferNonce,
    anchorRoot: treeRootAfter,
    nullifiers: [transferNullifier, bytes(26)],
    outputs: transferOutputs,
    publicValue: 0n,
    relayerFee: 0n,
    relayer: { kind: 0, payload: accountPublicKey },
  };
  const transferRecord = {
    actionIndex: 1,
    ledgerSequence: 124,
    startingLeafIndex: 2,
    actionKind: ActionKind.PrivateTransfer,
    asset,
    actionNonce: transferNonce,
    anchorRoot: treeRootAfter,
    treeRootAfter: transferRootAfter,
    nullifiers: transferAction.nullifiers,
    outputs: transferOutputs,
    publicValue: 0n,
    relayerFee: 0n,
    relayer: transferAction.relayer,
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
    startingLeafIndex: 2,
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
  assert.equal(duplicateResult.tree.nextIndex, 4, 'every on-chain output still advances the tree');

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
      },
      expectedPriorRecordHash: priorRecordHash,
    }),
    /tree root/i,
  );
});
