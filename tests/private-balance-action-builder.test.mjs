import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCommitment,
  computeAssetField,
  computeContextField,
  computeContextHash,
  deriveExpandedSpendingKey,
  encodePrivateAddress,
  bigintTo32Bytes,
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
    contextField: computeContextField(contextHash),
    addressPrefix: 'tks',
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
    diversifier: new Uint8Array(4),
    ownerCommitment: recipient.ownerCommitment,
    hpkePublicKey: recipient.hpkePublicKey,
  }, 'tks');
  return { keyContext, owner, recipientAddress, assetContractId, assetField };
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

test('action builder creates a deposit with zero private witness lanes', async () => {
  const { keyContext, owner, assetContractId } = await fixture();
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
  assert.deepEqual(prepared.circuitInputs.inputEnabled, ['0', '0']);
  assert.equal(prepared.circuitInputs.ask, '0');
  assert.equal(prepared.circuitInputs.nk, '0');
  assert.deepEqual(prepared.circuitInputs.outputEnabled, ['1', '0']);
  assert.equal(prepared.publicSignals.length, 13);
});

test('action builder creates an exact one-note transfer witness with self change', async () => {
  const { keyContext, owner, recipientAddress, assetContractId, assetField } = await fixture();
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
  assert.deepEqual(prepared.circuitInputs.inputEnabled, ['1', '0']);
  assert.deepEqual(prepared.circuitInputs.outputEnabled, ['1', '1']);
  assert.equal(prepared.circuitInputs.inputLeafIndex[0], '0');
  assert.equal(prepared.circuitInputs.inputSiblings[0].length, 32);
  assert.equal(prepared.circuitInputs.inputDirectionBits[0].length, 32);
  assert.equal(prepared.action.outputs[0].cm.some(byte => byte !== 0), true);
  assert.equal(prepared.action.outputs[1].cm.some(byte => byte !== 0), true);
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
});
