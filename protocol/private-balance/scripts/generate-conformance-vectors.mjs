#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ActionKind,
  appendCommitments,
  computeActionField,
  computeAssetField,
  computeCommitment,
  computeContextField,
  computeContextHash,
  deriveHpkeAad,
  deriveHpkeInfo,
  deriveOutgoingAad,
  computeNullifier,
  computePublicSignals,
  computeRecordHash,
  createEmptyTree,
  deriveKeysFromSeed,
  derivePrivacySessionRoot,
  derivePrivateAddressDeploymentTag,
  encodeNotePlaintext,
  encodeOutgoingPlaintext,
  encodePrivateAddress,
  sealOutgoingEnvelope,
  serializeCanonicalActionBytes,
} from '../packages/browser/dist/index.js';

const vectorsDir = join(process.cwd(), 'protocol/private-balance/vectors');
mkdirSync(vectorsDir, { recursive: true });
const fill = (value, length) => new Uint8Array(length).fill(value);
const hex = bytes => Buffer.from(bytes).toString('hex');
const write = (name, value) => writeFileSync(
  join(vectorsDir, name),
  `${JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2)}\n`,
);

const rawSeed = fill(0x11, 32);
const networkId = fill(0x22, 32);
const realmId = fill(0x33, 32);
const poolId = fill(0x44, 32);
const assetId = fill(0x55, 32);
const asset = { kind: 1, payload: assetId };
const assetField = computeAssetField(asset);
const accountPublicKey = fill(0x66, 32);
const contextHash = computeContextHash(2, networkId, realmId, poolId);
const contextField = computeContextField(contextHash);
const sessionRoot = derivePrivacySessionRoot(
  rawSeed,
  2,
  networkId,
  realmId,
  poolId,
  accountPublicKey,
);
const keys = await deriveKeysFromSeed(
  rawSeed,
  2,
  networkId,
  realmId,
  poolId,
  accountPublicKey,
  contextField,
);
write('keys-v1.json', {
  version: 1,
  syntheticSeedNotice: 'Fixed conformance bytes only; never used by a wallet.',
  input: Object.fromEntries(Object.entries({
    rawSeed,
    networkId,
    realmId,
    poolId,
    accountPublicKey,
  }).map(([name, bytes]) => [name, hex(bytes)])),
  expected: {
    contextHash: hex(contextHash),
    contextField: hex(contextField),
    sessionRoot: hex(sessionRoot),
    ask: hex(keys.ask),
    nk: hex(keys.nk),
    baseOwnerCommitment: hex(keys.baseOwnerCommitment),
    ownerCommitment: hex(keys.ownerCommitment),
    hpkePrivateKey: hex(keys.hpkePrivateKey),
    hpkePublicKey: hex(keys.hpkePublicKey),
    outgoingViewingKey: hex(keys.outgoingViewingKey),
  },
});

const diversifier = new Uint8Array(4);
const deploymentBindingHash = new Uint8Array(32).fill(0x42);
const deploymentTag = derivePrivateAddressDeploymentTag(deploymentBindingHash);
write('addresses-v1.json', {
  version: 1,
  input: {
    diversifier: hex(diversifier),
    deploymentBindingHash: hex(deploymentBindingHash),
    ownerCommitment: hex(keys.ownerCommitment),
    hpkePublicKey: hex(keys.hpkePublicKey),
  },
  expected: {
    testnet: encodePrivateAddress({
      deploymentTag,
      diversifier,
      ownerCommitment: keys.ownerCommitment,
      hpkePublicKey: keys.hpkePublicKey,
    }, 'tskpay_'),
    mainnet: encodePrivateAddress({
      deploymentTag,
      diversifier,
      ownerCommitment: keys.ownerCommitment,
      hpkePublicKey: keys.hpkePublicKey,
    }, 'skpay_'),
  },
});

const rho = new Uint8Array(32);
rho[31] = 0x99;
const memo = new Uint8Array(32);
memo.set([0x70, 0x61, 0x79, 0x31]);
const note = {
  protocolVersion: 2,
  flags: 0,
  value: 5_000_000n,
  diversifier,
  ownerCommitment: keys.ownerCommitment,
  rho,
  memoLength: 4,
  memo,
  assetIndex: 0,
  reserved: new Uint8Array(11),
};
const noteBytes = encodeNotePlaintext(note);
const commitment = computeCommitment(contextField, assetField, keys.ownerCommitment, note.value, rho);
const nullifier = computeNullifier(contextField, keys.nk, rho, 0n, commitment);
write('notes-v1.json', {
  version: 1,
  input: {
    value: note.value.toString(),
    assetIndex: note.assetIndex,
    assetId: hex(assetId),
    assetField: hex(assetField),
    diversifier: hex(diversifier),
    ownerCommitment: hex(keys.ownerCommitment),
    rho: hex(rho),
    memo: hex(memo.subarray(0, note.memoLength)),
    leafIndex: '0',
  },
  expected: {
    plaintext: hex(noteBytes),
    commitment: hex(commitment),
    nullifier: hex(nullifier),
  },
});

const actionNonce = fill(0x12, 32);
const deploymentBindingHashForOutgoing = fill(0x77, 32);
const ephemeralPublicKey = fill(0x78, 32);
const outgoingNonce = fill(0x79, 12);
const outgoingPlaintext = encodeOutgoingPlaintext({
  protocolVersion: 2,
  flags: 0,
  value: note.value,
  diversifier,
  ownerCommitment: keys.ownerCommitment,
  recipientHpkePublicKey: keys.hpkePublicKey,
    memoLength: note.memoLength,
    memo,
    assetIndex: 0,
    reserved: new Uint8Array(11),
});
const outgoingAad = deriveOutgoingAad(
  deploymentBindingHashForOutgoing,
  contextHash,
  assetField,
  commitment,
  actionNonce,
  0,
);
const outgoingEnvelope = await sealOutgoingEnvelope(
  keys.outgoingViewingKey,
  ephemeralPublicKey,
  outgoingPlaintext,
  outgoingAad,
  outgoingNonce,
);
write('encryption-v1.json', {
  version: 1,
  suite: { kemId: '0x0020', kdfId: '0x0001', aeadId: '0x0001' },
  input: {
    contextHash: hex(contextHash),
    commitment: hex(commitment),
    actionNonce: hex(actionNonce),
    outputIndex: 0,
    deploymentBindingHash: hex(deploymentBindingHashForOutgoing),
    assetField: hex(assetField),
    ephemeralPublicKey: hex(ephemeralPublicKey),
    outgoingNonce: hex(outgoingNonce),
  },
  expected: {
    info: hex(deriveHpkeInfo(2, contextHash)),
    aad: hex(deriveHpkeAad(contextHash, commitment, actionNonce, 0)),
    recipientEnvelopeBytes: 181,
    outputPackageBytes: 370,
    outgoingPlaintext: hex(outgoingPlaintext),
    outgoingAad: hex(outgoingAad),
    outgoingEnvelope: hex(outgoingEnvelope),
    outgoingEnvelopeBytes: outgoingEnvelope.length,
  },
});

const tree = await createEmptyTree();
const emptyRoot = tree.currentRoot.slice();
const secondCommitment = new Uint8Array(32);
secondCommitment[31] = 2;
const thirdCommitment = new Uint8Array(32);
thirdCommitment[31] = 3;
await appendCommitments(tree, [commitment, secondCommitment, thirdCommitment]);
write('tree-v1.json', {
  version: 1,
  input: { leaves: [hex(commitment), hex(secondCommitment), hex(thirdCommitment)] },
  expected: { emptyRoot: hex(emptyRoot), rootAfter: hex(tree.currentRoot), nextIndex: 3 },
});

const zero32 = new Uint8Array(32);
const firstDummyNullifier = fill(0x01, 32);
const secondDummyNullifier = fill(0x02, 32);
const action = {
  protocolVersion: 2,
  kind: ActionKind.Deposit,
  assetIndex: 0,
  asset,
  actionNonce,
  anchorRoot: zero32,
  nullifiers: [firstDummyNullifier, secondDummyNullifier],
  outputs: [
    {
      cm: commitment,
      recipientEnvelope: fill(0xa1, 181),
      outgoingEnvelope: fill(0xa2, 157),
    },
    {
      cm: secondCommitment,
      recipientEnvelope: fill(0xb1, 181),
      outgoingEnvelope: fill(0xb2, 157),
    },
    {
      cm: thirdCommitment,
      recipientEnvelope: fill(0xc1, 181),
      outgoingEnvelope: fill(0xc2, 157),
    },
  ],
  publicValue: 5_000_000n,
  depositSource: { kind: 0, payload: accountPublicKey },
};
const actionBytes = serializeCanonicalActionBytes(action, networkId, realmId, poolId);
const actionField = computeActionField(action, networkId, realmId, poolId);
const publicSignals = await computePublicSignals(
  action,
  contextField,
  networkId,
  realmId,
  poolId,
);
write('actions-v1.json', {
  version: 1,
  input: {
    kind: 'deposit',
    assetIndex: action.assetIndex,
    publicValue: action.publicValue.toString(),
    actionNonce: hex(actionNonce),
    assetId: hex(assetId),
    output0Commitment: hex(commitment),
    output1Commitment: hex(secondCommitment),
    output2Commitment: hex(thirdCommitment),
    nullifier0: hex(firstDummyNullifier),
    nullifier1: hex(secondDummyNullifier),
    output0RecipientEnvelope: hex(action.outputs[0].recipientEnvelope),
    output0OutgoingEnvelope: hex(action.outputs[0].outgoingEnvelope),
    output1RecipientEnvelope: hex(action.outputs[1].recipientEnvelope),
    output1OutgoingEnvelope: hex(action.outputs[1].outgoingEnvelope),
    output2RecipientEnvelope: hex(action.outputs[2].recipientEnvelope),
    output2OutgoingEnvelope: hex(action.outputs[2].outgoingEnvelope),
    depositSource: hex(accountPublicKey),
  },
  expected: {
    canonicalBytes: hex(actionBytes),
    actionField: hex(actionField),
    publicSignals: publicSignals.map(hex),
  },
});

const archiveRecord = {
  actionIndex: 0n,
  ledgerSequence: 100,
  startingLeafIndex: 0n,
  actionKind: 1,
  assetIndex: 0,
  asset: { kind: 1, payload: fill(0x88, 32) },
  actionNonce: fill(0x11, 32),
  anchorRoot: fill(0x22, 32),
  treeRootAfter: fill(0x33, 32),
  nullifiers: [fill(0x01, 32), fill(0x02, 32)],
  outputs: [
    { cm: fill(0x03, 32), recipientEnvelope: fill(0x04, 181), outgoingEnvelope: fill(0x05, 157) },
    { cm: fill(0x06, 32), recipientEnvelope: fill(0x07, 181), outgoingEnvelope: fill(0x08, 157) },
    { cm: fill(0x09, 32), recipientEnvelope: fill(0x0a, 181), outgoingEnvelope: fill(0x0b, 157) },
  ],
  publicValue: 1_000n,
  depositSource: { kind: 0, payload: fill(0xaa, 32) },
  publicRecipient: undefined,
};
write('archive-v1.json', {
  schemaVersion: 1,
  record: {
    protocolVersion: 2,
    actionIndex: archiveRecord.actionIndex,
    ledgerSequence: archiveRecord.ledgerSequence,
    startingLeafIndex: archiveRecord.startingLeafIndex,
    actionKind: archiveRecord.actionKind,
    assetIndex: archiveRecord.assetIndex,
    assetKind: archiveRecord.asset.kind,
    assetPayloadFill: 0x88,
    actionNonceFill: 0x11,
    anchorRootFill: 0x22,
    treeRootAfterFill: 0x33,
    nullifier0Fill: 0x01,
    nullifier1Fill: 0x02,
    output0CommitmentFill: 0x03,
    output0RecipientEnvelopeFill: 0x04,
    output0OutgoingEnvelopeFill: 0x05,
    output1CommitmentFill: 0x06,
    output1RecipientEnvelopeFill: 0x07,
    output1OutgoingEnvelopeFill: 0x08,
    output2CommitmentFill: 0x09,
    output2RecipientEnvelopeFill: 0x0a,
    output2OutgoingEnvelopeFill: 0x0b,
    publicValue: Number(archiveRecord.publicValue),
    depositSourceKind: archiveRecord.depositSource.kind,
    depositSourcePayloadFill: 0xaa,
    priorRecordHashFill: 0x55,
  },
  expectedRecordHash: hex(computeRecordHash(archiveRecord, 2, fill(0x55, 32))),
});

sessionRoot.fill(0);
keys.ask.fill(0);
keys.nk.fill(0);
keys.baseOwnerCommitment.fill(0);
keys.hpkePrivateKey.fill(0);
keys.outgoingViewingKey.fill(0);
console.log('✓ Generated fixed Private Balance conformance vectors.');
