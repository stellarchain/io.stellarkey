import assert from 'node:assert/strict';
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
} from '@stellarkey/private-balance';
import { StrKey } from '@stellar/stellar-sdk';
import { preparePrivateAction } from '../src/features/private-balance/worker/action-builder.ts';
import * as actionFlow from '../src/features/private-balance/runtime/action-flow.ts';

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

test('action builder creates a fixed-shape deposit with private dummy lanes', async () => {
  const { keyContext, owner, assetContractId, assetField } = await fixture();
  const prepared = await preparePrivateAction({
    esk: owner,
    keyContext,
    availableNotes: [],
    commitments: [],
    intent: {
      kind: 'deposit',
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
  assert.deepEqual([...prepared.circuitInputs.outputReal].sort(), ['0', '1']);
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
  assert.deepEqual(outgoingFlags.sort(), [0, 1]);
  assert.equal(prepared.publicSignals.length, 13);
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
    commitments: [],
    intent: {
      kind: 'deposit',
      assetContractId,
      publicValue: '5000000',
      depositSource: { kind: 0, payload: keyContext.accountPublicKey },
    },
  });

  const realLane = prepared.circuitInputs.outputReal.indexOf('1');
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

test('action builder creates an exact one-note transfer witness with self change', async () => {
  const { keyContext, owner, recipient, recipientAddress, assetContractId, assetField } = await fixture();
  const rho = bigintTo32Bytes(11n);
  const commitment = computeCommitment(keyContext.contextField, assetField, owner.ownerCommitment, 10n, rho);
  const noteId = hex(commitment);
  const note = {
    id: noteId,
    commitment: noteId,
    value: '10',
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

  const prepared = await preparePrivateAction({
    esk: owner,
    keyContext,
    availableNotes: [note],
    commitments: [commitment],
    intent: {
      kind: 'transfer',
      assetContractId,
      amount: '6',
      recipientAddress,
      selectedNoteIds: [noteId],
      anchorRoot: tree.currentRoot,
      anchorExpiresAtLedger: 1234,
      memo: new Uint8Array([0x68, 0x69]),
      relayerFee: '0',
      relayer: { kind: 0, payload: keyContext.accountPublicKey },
    },
  });

  assert.deepEqual(prepared.reservedNoteIds, [noteId]);
  assert.equal(prepared.inputValue, '10');
  assert.equal(prepared.changeValue, '4');
  assert.deepEqual([...prepared.circuitInputs.inputReal].sort(), ['0', '1']);
  assert.deepEqual(prepared.circuitInputs.outputReal, ['1', '1']);
  const realInputLane = prepared.circuitInputs.inputReal.indexOf('1');
  assert.equal(prepared.circuitInputs.inputLeafIndex[realInputLane], '0');
  assert.equal(prepared.circuitInputs.inputSiblings[realInputLane].length, 32);
  assert.equal(prepared.circuitInputs.inputDirectionBits[realInputLane].length, 32);
  assert.equal(prepared.action.outputs[0].cm.some(byte => byte !== 0), true);
  assert.equal(prepared.action.outputs[1].cm.some(byte => byte !== 0), true);
  assert.equal(prepared.action.outputs.every(output => output.outgoingEnvelope.length === 157), true);
  assert.equal(prepared.publicSignals.length, 13);
  await assert.rejects(
    () => preparePrivateAction({
      esk: owner,
      keyContext,
      availableNotes: [note],
      commitments: [commitment],
      intent: {
        kind: 'transfer',
        assetContractId: StrKey.encodeContract(bytes(9)),
        amount: '6',
        recipientAddress,
        selectedNoteIds: [noteId],
        anchorRoot: tree.currentRoot,
        anchorExpiresAtLedger: 1234,
        relayerFee: '0',
        relayer: { kind: 0, payload: keyContext.accountPublicKey },
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
      commitments: [commitment],
      intent: {
        kind: 'transfer',
        assetContractId,
        amount: '6',
        recipientAddress: foreignDeploymentAddress,
        selectedNoteIds: [noteId],
        anchorRoot: tree.currentRoot,
        anchorExpiresAtLedger: 1234,
        relayerFee: '0',
        relayer: { kind: 0, payload: keyContext.accountPublicKey },
      },
    }),
    /deployment/i,
  );
});
