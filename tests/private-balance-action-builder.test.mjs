import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  computeCommitment,
  computeAssetField,
  computeContextField,
  computeContextHash,
  deriveDiversifiedAddressKeys,
  deriveExpandedSpendingKey,
  derivePrivateAddressDeploymentTag,
  deriveOutgoingAad,
  decodeOutgoingPlaintext,
  encodePrivateAddress,
  bigintTo32Bytes,
  openRecipientEnvelope,
  openOutgoingEnvelope,
  computeActionField,
  computeGenesisRecordHash,
  createEmptyTree,
  appendCommitments,
  MerkleNodeStore,
  toViewingKey,
} from '@stellarkey/private-balance';
import { StrKey } from '@stellar/stellar-sdk';
import { preparePrivateAction } from '../src/features/private-balance/worker/action-builder.ts';
import * as actionFlow from '../src/features/private-balance/runtime/action-flow.ts';
import { scanArchiveRecords } from '../src/features/private-balance/runtime/scanner.ts';

const bytes = value => new Uint8Array(32).fill(value);
const hex = value => Buffer.from(value).toString('hex');

async function fixture() {
  const context = {
    protocolVersion: 1,
    networkId: bytes(1),
    realmId: bytes(2),
    poolId: bytes(3),
    accountPublicKey: bytes(5),
  };
  const assetPayload = bytes(4);
  const assetContractId = StrKey.encodeContract(assetPayload);
  const assetField = computeAssetField({ kind: 1, payload: assetPayload });
  const contextHash = computeContextHash(
    context.protocolVersion,
    context.networkId,
    context.realmId,
    context.poolId,
  );
  const keyContext = {
    ...context,
    deploymentBindingHash: bytes(9),
    contextField: computeContextField(contextHash),
    addressPrefix: 'tskpay_',
    assets: [{ index: 0, contractId: assetContractId }],
  };
  const owner = await deriveExpandedSpendingKey(
    new Uint8Array(64).fill(6),
    context.protocolVersion,
    context.networkId,
    context.realmId,
    context.poolId,
    context.accountPublicKey,
    keyContext.contextField,
  );
  const recipient = await deriveExpandedSpendingKey(
    new Uint8Array(64).fill(7),
    context.protocolVersion,
    context.networkId,
    context.realmId,
    context.poolId,
    bytes(8),
    keyContext.contextField,
  );
  const recipientAddress = encodePrivateAddress({
    deploymentTag: derivePrivateAddressDeploymentTag(keyContext.deploymentBindingHash),
    diversifier: new Uint8Array(4),
    ownerCommitment: recipient.ownerCommitment,
    hpkePublicKey: recipient.hpkePublicKey,
  }, 'tskpay_');
  return { keyContext, owner, recipient, recipientAddress, assetContractId, assetField };
}

test('action flow snapshots selected durable notes for a fresh worker session', () => {
  assert.equal(typeof actionFlow.privateActionNoteSnapshot, 'function');
  const privateActionNoteSnapshot = actionFlow.privateActionNoteSnapshot;
  const note = {
    id: '05'.repeat(32),
    commitment: '05'.repeat(32),
    value: '10',
    assetIndex: 0,
    assetContractId: StrKey.encodeContract(bytes(4)),
    diversifier: '00000000',
    ownerCommitment: '06'.repeat(32),
    leafIndex: 0,
    actionIndex: 0,
    rho: '07'.repeat(32),
    memoHex: '',
    senderFingerprintHex: '',
    status: 'unspent',
    createdAt: 0,
  };

  assert.deepEqual(privateActionNoteSnapshot([note], [note.id]), [note]);
  assert.throws(
    () => privateActionNoteSnapshot([{ ...note, status: 'reserved' }], [note.id]),
    /unavailable/i,
  );
  assert.throws(() => privateActionNoteSnapshot([], [note.id]), /unavailable/i);
});

test('direct action flow emits no public relayer identity or fee fields', () => {
  const source = readFileSync(
    new URL('../src/features/private-balance/runtime/action-flow.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /relayerFee|relayer_fee|selfRelayer|zeroFeeRelayer/);
});

test('spend preparation never reconstructs a Merkle tree from pool history', () => {
  const source = readFileSync(
    new URL('../src/features/private-balance/worker/action-builder.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /MerkleNodeStore|fromCommitments|loadPrivateBalanceCommitments/);
});

test('public deposit preflight reports the exact asset balance shortfall', () => {
  assert.doesNotThrow(() => actionFlow.assertSufficientPublicDepositBalance({
    available: 2_500_000_000n,
    requested: 2_500_000_000n,
    assetCode: 'USDC',
    assetDecimals: 7,
  }));
  assert.throws(
    () => actionFlow.assertSufficientPublicDepositBalance({
      available: 0n,
      requested: 2_500_000_000n,
      assetCode: 'USDC',
      assetDecimals: 7,
    }),
    /Insufficient public USDC balance\. Available: 0 USDC; requested: 250 USDC\./,
  );
});

test('one-time deposit preflight reserves the account minimum and full reviewed fee budget', () => {
  assert.doesNotThrow(() => actionFlow.assertSufficientStealthSweepBalance({
    available: 45_000_100n,
    requested: 25_000_000n,
    minimumBalance: 10_000_000n,
    classicFee: 100n,
    maximumResourceFee: 10_000_000n,
  }));
  assert.throws(
    () => actionFlow.assertSufficientStealthSweepBalance({
      available: 36_000_000n,
      requested: 25_000_000n,
      minimumBalance: 10_000_000n,
      classicFee: 100n,
      maximumResourceFee: 10_000_000n,
    }),
    /one-time account.*fee|insufficient/i,
  );
});

test('action builder creates a fixed-shape deposit with private dummy lanes', async () => {
  const { keyContext, owner, assetContractId, assetField } = await fixture();
  const prepared = await preparePrivateAction({
    esk: owner,
    keyContext,
    availableNotes: [],
    merklePaths: [],
    intent: {
      kind: 'deposit',
      assetIndex: 0,
      assetContractId,
      publicValue: '5000000',
      depositSource: { kind: 0, payload: keyContext.accountPublicKey },
      memo: new Uint8Array([0x64, 0x65, 0x70]),
    },
  });

  assert.deepEqual(prepared.reservedNoteIds, []);
  assert.equal(prepared.action.kind, 1);
  assert.equal(prepared.action.publicValue, 5_000_000n);
  assert.deepEqual(prepared.circuitInputs.inputReal, ['0', '0']);
  assert.equal(prepared.circuitInputs.inputDummySecret.every(value => value !== '0'), true);
  assert.equal(prepared.action.nullifiers.every(value => value.some(byte => byte !== 0)), true);
  assert.notDeepEqual(prepared.action.nullifiers[0], prepared.action.nullifiers[1]);
  assert.equal(prepared.circuitInputs.ask, '0');
  assert.equal(prepared.circuitInputs.nk, '0');
  assert.deepEqual(
    [...prepared.circuitInputs.outputValue].sort((left, right) => Number(left) - Number(right)),
    ['0', '0', '5000000'],
  );
  assert.equal(prepared.action.outputs.every(output => (
    output.cm.some(byte => byte !== 0)
    && output.recipientEnvelope.some(byte => byte !== 0)
    && output.outgoingEnvelope.some(byte => byte !== 0)
  )), true);
  const contextHash = computeContextHash(
    keyContext.protocolVersion,
    keyContext.networkId,
    keyContext.realmId,
    keyContext.poolId,
  );
  const outgoingFlags = [];
  for (const [lane, output] of prepared.action.outputs.entries()) {
    const plaintext = await openOutgoingEnvelope(
      owner.outgoingViewingKey,
      output.recipientEnvelope.slice(5, 37),
      output.outgoingEnvelope,
      deriveOutgoingAad(
        keyContext.deploymentBindingHash,
        contextHash,
        assetField,
        output.cm,
        prepared.action.actionNonce,
        lane,
      ),
    );
    assert.ok(plaintext);
    outgoingFlags.push(decodeOutgoingPlaintext(plaintext).flags);
  }
  assert.deepEqual(outgoingFlags.sort(), [0, 1, 1]);
  const outgoingDiversifiers = prepared.action.outputs.map(output => hex(output.recipientEnvelope.slice(1, 5)));
  assert.equal(new Set(outgoingDiversifiers).size, 1, 'all lanes hide behind one clear action diversifier');
  assert.equal(prepared.publicSignals.length, 11);
});

test('rotating the receive address cannot corrupt canonical self outputs', async () => {
  const { keyContext, owner, assetContractId, assetField } = await fixture();
  const rotated = await deriveDiversifiedAddressKeys(
    owner.baseOwnerCommitment,
    owner.hpkePrivateKey,
    Uint8Array.of(1, 2, 3, 4),
  );
  owner.ownerCommitment.set(rotated.ownerCommitment);
  owner.hpkePublicKey.set(rotated.hpkePublicKey);
  rotated.hpkePrivateKey.fill(0);

  const prepared = await preparePrivateAction({
    esk: owner,
    keyContext,
    availableNotes: [],
    merklePaths: [],
    intent: {
      kind: 'deposit',
      assetIndex: 0,
      assetContractId,
      publicValue: '5000000',
      depositSource: { kind: 0, payload: keyContext.accountPublicKey },
    },
  });

  const realLane = prepared.circuitInputs.outputValue.findIndex(value => value !== '0');
  const recovered = await openRecipientEnvelope(
    owner.hpkePrivateKey,
    prepared.action.outputs[realLane].recipientEnvelope,
    computeContextHash(
      keyContext.protocolVersion,
      keyContext.networkId,
      keyContext.realmId,
      keyContext.poolId,
    ),
    keyContext.contextField,
    assetField,
    prepared.action.outputs[realLane].cm,
    prepared.action.actionNonce,
    realLane,
    owner.baseOwnerCommitment,
  );

  assert.ok(recovered, 'canonical self-output must remain decryptable after address rotation');
  assert.equal(recovered.diversifier.some(byte => byte !== 0), true);
  assert.equal(recovered.value, 5_000_000n);
});

test('minimized outgoing history replaces every lane before action hashing without changing incoming recovery', async () => {
  const { keyContext, owner, assetContractId, assetField } = await fixture();
  const prepared = await preparePrivateAction({ esk: owner, keyContext, availableNotes: [], merklePaths: [],
    intent: { kind: 'deposit', assetIndex: 0, assetContractId, publicValue: '50',
      depositSource: { kind: 0, payload: keyContext.accountPublicKey }, outgoingHistory: 'minimized' } });
  const contextHash = computeContextHash(1, keyContext.networkId, keyContext.realmId, keyContext.poolId);
  let recoveredValue = 0n;
  for (const [lane, output] of prepared.action.outputs.entries()) {
    assert.equal(output.outgoingEnvelope.length, 157);
    assert.ok(output.outgoingEnvelope.some(byte => byte !== 0));
    const outgoing = await openOutgoingEnvelope(owner.outgoingViewingKey, output.recipientEnvelope.slice(5, 37), output.outgoingEnvelope,
      deriveOutgoingAad(keyContext.deploymentBindingHash, contextHash, assetField, output.cm, prepared.action.actionNonce, lane));
    try { assert.ok(outgoing === null, 'minimized outgoing metadata must not decrypt'); }
    finally { outgoing?.fill(0); }
    const note = await openRecipientEnvelope(owner.hpkePrivateKey, output.recipientEnvelope, contextHash,
      keyContext.contextField, assetField, output.cm, prepared.action.actionNonce, lane, owner.baseOwnerCommitment);
    if (note?.flags === 0) recoveredValue += note.value;
  }
  assert.equal(recoveredValue, 50n);
  assert.deepEqual(computeActionField(prepared.action, keyContext.networkId, keyContext.realmId, keyContext.poolId), prepared.actionField);
  const modified = structuredClone(prepared.action);
  modified.outputs[0].outgoingEnvelope[10] ^= 1;
  assert.notDeepEqual(computeActionField(modified, keyContext.networkId, keyContext.realmId, keyContext.poolId), prepared.actionField);
});

test('full seed scans preserve balances and spends when future outgoing details are omitted', async t => {
  const { keyContext, owner, recipientAddress, assetContractId } = await fixture();
  const contextHash = computeContextHash(1, keyContext.networkId, keyContext.realmId, keyContext.poolId);
  const context = { ...keyContext, contextHash, accountAddress: { kind: 0, payload: keyContext.accountPublicKey } };
  const ownAddress = encodePrivateAddress({ deploymentTag: derivePrivateAddressDeploymentTag(keyContext.deploymentBindingHash),
    diversifier: new Uint8Array(4), ownerCommitment: owner.ownerCommitment, hpkePublicKey: owner.hpkePublicKey }, 'tskpay_');
  const deposit = await preparePrivateAction({ esk: owner, keyContext, availableNotes: [], merklePaths: [],
    intent: { kind: 'deposit', assetIndex: 0, assetContractId, publicValue: '100',
      depositSource: { kind: 0, payload: keyContext.accountPublicKey } } });
  const recordsFor = async actions => {
    const tree = await createEmptyTree();
    const records = [];
    for (const [index, action] of actions.entries()) {
      const fields = { ...action };
      delete fields.protocolVersion;
      delete fields.kind;
      records.push({ ...fields, actionKind: action.kind, actionIndex: index, ledgerSequence: 100 + index,
        startingLeafIndex: index * 3, treeRootAfter: await appendCommitments(tree, action.outputs.map(output => output.cm)) });
    }
    return records;
  };
  const scan = async actions => scanArchiveRecords({ records: await recordsFor(actions), viewingKey: toViewingKey(owner), context,
    expectedPriorRecordHash: computeGenesisRecordHash(contextHash, keyContext.deploymentBindingHash) });
  const initial = await scan([deposit.action]);
  const initialNote = initial.notes[0];
  const tree = await MerkleNodeStore.fromCommitments(deposit.action.outputs.map(output => output.cm));
  const merklePath = await tree.getPath(initialNote.leafIndex);
  for (const [name, kind, amount, self] of [
    ['send with change', 'transfer', '60', false],
    ['send without change', 'transfer', '100', false],
    ['withdrawal', 'withdraw', '60', false],
    ['self transfer', 'transfer', '100', true],
  ]) {
    await t.test(name, async () => {
      const results = [];
      for (const outgoingHistory of ['recoverable', 'minimized']) {
        const common = { assetIndex: 0, assetContractId, selectedNoteIds: [initialNote.id],
          anchorRoot: tree.currentRoot, anchorExpiresAtLedger: 2000, outgoingHistory };
        const intent = kind === 'transfer'
          ? { ...common, kind, amount, recipientAddress: self ? ownAddress : recipientAddress, memo: new TextEncoder().encode('test memo') }
          : { ...common, kind, publicValue: amount, publicRecipient: { kind: 0, payload: bytes(12) } };
        const prepared = await preparePrivateAction({ esk: owner, keyContext, availableNotes: [initialNote], merklePaths: [merklePath], intent });
        const result = await scan([deposit.action, prepared.action]);
        const debit = self ? 0n : BigInt(amount);
        assert.equal(result.notes.find(note => note.id === initialNote.id).status, 'spent');
        assert.equal(result.notes.filter(note => note.status === 'unspent').reduce((sum, note) => sum + BigInt(note.value), 0n), 100n - debit);
        const activity = result.activities.at(-1);
        assert.equal(activity.amount, String(debit));
        assert.equal(activity.direction, debit === 0n ? 'internal' : 'outflow');
        if (outgoingHistory === 'minimized') {
          assert.equal(activity.recipientFingerprint, undefined);
          assert.equal(activity.memoHex, undefined);
        } else if (kind === 'transfer' && !self) {
          assert.ok(activity.recipientFingerprint);
          assert.equal(activity.memoHex, Buffer.from('test memo').toString('hex'));
        }
        results.push(result);
      }
      assert.deepEqual(results[0].spentNullifierHexes, results[1].spentNullifierHexes);
    });
  }

  // A write preference never disables recovery of old ON-mode records, and
  // switching it back on cannot recover metadata omitted by the middle send.
  const actions = [deposit.action];
  for (const [index, outgoingHistory] of ['recoverable', 'minimized', 'recoverable'].entries()) {
    const before = await scan(actions);
    const unspent = before.notes.filter(note => note.status === 'unspent');
    const currentTree = await MerkleNodeStore.fromCommitments(actions.flatMap(action => action.outputs.map(output => output.cm)));
    const next = await preparePrivateAction({ esk: owner, keyContext, availableNotes: unspent,
      merklePaths: await Promise.all(unspent.map(note => currentTree.getPath(note.leafIndex))),
      intent: { kind: 'transfer', assetIndex: 0, assetContractId, selectedNoteIds: unspent.map(note => note.id),
        anchorRoot: currentTree.currentRoot, anchorExpiresAtLedger: 2000, amount: String((index + 1) * 10),
        recipientAddress, memo: new TextEncoder().encode('test memo'), outgoingHistory } });
    actions.push(next.action);
  }
  const history = await scan(actions);
  assert.deepEqual(history.activities.slice(1).map(activity => Boolean(activity.recipientFingerprint)), [true, false, true]);
  assert.equal(history.notes.filter(note => note.status === 'unspent').reduce((sum, note) => sum + BigInt(note.value), 0n), 40n);
});

test('action builder creates an exact one-note transfer witness with self change', async () => {
  const { keyContext, owner, recipient, recipientAddress, assetContractId, assetField } = await fixture();
  const rho = bigintTo32Bytes(11n);
  const commitment = computeCommitment(keyContext.contextField, assetField, owner.ownerCommitment, 10n, rho);
  const noteId = hex(commitment);
  const note = {
    id: noteId,
    commitment: noteId,
    value: '10',
    assetIndex: 0,
    assetContractId,
    diversifier: '00000000',
    ownerCommitment: hex(owner.ownerCommitment),
    leafIndex: 0,
    actionIndex: 0,
    rho: hex(rho),
    memoHex: '',
    senderFingerprintHex: '',
    status: 'unspent',
    createdAt: 0,
  };
  const tree = await import('@stellarkey/private-balance')
    .then(({ MerkleNodeStore }) => MerkleNodeStore.fromCommitments([commitment]));
  const merklePath = await tree.getPath(0);

  const prepared = await preparePrivateAction({
    esk: owner,
    keyContext,
    availableNotes: [note],
    merklePaths: [merklePath],
    intent: {
      kind: 'transfer',
      assetIndex: 0,
      assetContractId,
      amount: '6',
      recipientAddress,
      selectedNoteIds: [noteId],
      anchorRoot: tree.currentRoot,
      anchorExpiresAtLedger: 1234,
      memo: new Uint8Array([0x68, 0x69]),
    },
  });

  assert.deepEqual(prepared.reservedNoteIds, [noteId]);
  assert.equal(prepared.inputValue, '10');
  assert.equal(prepared.changeValue, '4');
  assert.equal(prepared.recipientOutputCommitment, hex(prepared.action.outputs[prepared.circuitInputs.outputValue.indexOf('6')].cm));
  assert.deepEqual([...prepared.circuitInputs.inputReal].sort(), ['0', '1']);
  assert.deepEqual([...prepared.circuitInputs.outputValue].sort(), ['0', '4', '6']);
  assert.equal(prepared.action.asset, undefined, 'private transfers must not publish an asset');
  assert.equal(prepared.action.assetIndex, undefined, 'private transfers must not publish an asset index');
  assert.equal(prepared.circuitInputs.assetField, '0');
  assert.equal(prepared.circuitInputs.actionAssetField, BigInt(`0x${hex(assetField)}`).toString());
  const realInputLane = prepared.circuitInputs.inputReal.indexOf('1');
  assert.equal(prepared.circuitInputs.inputLeafIndex[realInputLane], '0');
  assert.equal(prepared.circuitInputs.inputSiblings[realInputLane].length, 17);
  assert.equal(prepared.circuitInputs.inputPositions[realInputLane].length, 17);
  assert.equal(prepared.action.outputs[0].cm.some(byte => byte !== 0), true);
  assert.equal(prepared.action.outputs[1].cm.some(byte => byte !== 0), true);
  assert.equal(prepared.action.outputs.every(output => output.outgoingEnvelope.length === 157), true);
  assert.equal(prepared.publicSignals.length, 11);
  const tamperedPath = {
    ...merklePath,
    siblings: merklePath.siblings.map((siblings, index) => (
      index === 0 ? [bytes(31), siblings[1].slice()] : siblings.map(node => node.slice())
    )),
    positions: [...merklePath.positions],
  };
  await assert.rejects(
    () => preparePrivateAction({
      esk: owner,
      keyContext,
      availableNotes: [note],
      merklePaths: [tamperedPath],
      intent: {
        kind: 'transfer',
        assetIndex: 0,
        assetContractId,
        amount: '6',
        recipientAddress,
        selectedNoteIds: [noteId],
        anchorRoot: tree.currentRoot,
        anchorExpiresAtLedger: 1234,
      },
    }),
    /Merkle witness/i,
  );
  await assert.rejects(
    () => preparePrivateAction({
      esk: owner,
      keyContext,
      availableNotes: [note],
      merklePaths: [merklePath],
      intent: {
        kind: 'transfer',
        assetIndex: 1,
        assetContractId: StrKey.encodeContract(bytes(9)),
        amount: '6',
        recipientAddress,
        selectedNoteIds: [noteId],
        anchorRoot: tree.currentRoot,
        anchorExpiresAtLedger: 1234,
      },
    }),
    /another asset/i,
  );
  const foreignDeploymentAddress = encodePrivateAddress({
    deploymentTag: derivePrivateAddressDeploymentTag(bytes(10)),
    diversifier: new Uint8Array(4),
    ownerCommitment: recipient.ownerCommitment,
    hpkePublicKey: recipient.hpkePublicKey,
  }, 'tskpay_');
  await assert.rejects(
    () => preparePrivateAction({
      esk: owner,
      keyContext,
      availableNotes: [note],
      merklePaths: [merklePath],
      intent: {
        kind: 'transfer',
        assetIndex: 0,
        assetContractId,
        amount: '6',
        recipientAddress: foreignDeploymentAddress,
        selectedNoteIds: [noteId],
        anchorRoot: tree.currentRoot,
        anchorExpiresAtLedger: 1234,
      },
    }),
    /deployment/i,
  );
});
