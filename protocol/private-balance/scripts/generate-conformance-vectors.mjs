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
  computeNullifier,
  computePublicSignals,
  computeRecordHash,
  createEmptyTree,
  deriveKeysFromSeed,
  derivePrivacySessionRoot,
  encodeNotePlaintext,
  encodePrivateAddress,
  serializeCanonicalActionBytes,
} from '../packages/browser/dist/index.js';

const vectorsDir = join(process.cwd(), 'protocol/private-balance/vectors');
mkdirSync(vectorsDir, { recursive: true });
const fill = (value, length) => new Uint8Array(length).fill(value);
const hex = bytes => Buffer.from(bytes).toString('hex');
const write = (name, value) => writeFileSync(
  join(vectorsDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
);

const rawSeed = fill(0x11, 32);
const networkId = fill(0x22, 32);
const realmId = fill(0x33, 32);
const poolId = fill(0x44, 32);
const assetId = fill(0x55, 32);
const asset = { kind: 1, payload: assetId };
const assetField = computeAssetField(asset);
const accountPublicKey = fill(0x66, 32);
const contextHash = computeContextHash(1, networkId, realmId, poolId);
const contextField = computeContextField(contextHash);
const sessionRoot = derivePrivacySessionRoot(
  rawSeed,
  1,
  networkId,
  realmId,
  poolId,
  accountPublicKey,
);
const keys = await deriveKeysFromSeed(
  rawSeed,
  1,
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
  },
});

const diversifier = new Uint8Array(4);
write('addresses-v1.json', {
  version: 1,
  input: {
    diversifier: hex(diversifier),
    ownerCommitment: hex(keys.ownerCommitment),
    hpkePublicKey: hex(keys.hpkePublicKey),
  },
  expected: {
    testnet: encodePrivateAddress({
      diversifier,
      ownerCommitment: keys.ownerCommitment,
      hpkePublicKey: keys.hpkePublicKey,
    }, 'tks'),
    mainnet: encodePrivateAddress({
      diversifier,
      ownerCommitment: keys.ownerCommitment,
      hpkePublicKey: keys.hpkePublicKey,
    }, 'sks'),
  },
});

const rho = new Uint8Array(32);
rho[31] = 0x99;
const memo = new Uint8Array(32);
memo.set([0x70, 0x61, 0x79, 0x31]);
const note = {
  protocolVersion: 1,
  flags: 0,
  value: 5_000_000n,
  diversifier,
  ownerCommitment: keys.ownerCommitment,
  rho,
  memoLength: 4,
  memo,
  reserved: new Uint8Array(15),
};
const noteBytes = encodeNotePlaintext(note);
const commitment = computeCommitment(contextField, assetField, keys.ownerCommitment, note.value, rho);
const nullifier = computeNullifier(contextField, keys.nk, rho, 0n, commitment);
write('notes-v1.json', {
  version: 1,
  input: {
    value: note.value.toString(),
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
write('encryption-v1.json', {
  version: 1,
  suite: { kemId: '0x0020', kdfId: '0x0001', aeadId: '0x0001' },
  input: {
    contextHash: hex(contextHash),
    commitment: hex(commitment),
    actionNonce: hex(actionNonce),
    outputIndex: 0,
  },
  expected: {
    info: hex(deriveHpkeInfo(2, contextHash)),
    aad: hex(deriveHpkeAad(contextHash, commitment, actionNonce, 0)),
    recipientEnvelopeBytes: 181,
    outputPackageBytes: 213,
  },
});

const tree = await createEmptyTree();
const emptyRoot = tree.currentRoot.slice();
const secondCommitment = new Uint8Array(32);
secondCommitment[31] = 2;
await appendCommitments(tree, [commitment, secondCommitment]);
write('tree-v1.json', {
  version: 1,
  input: { leaves: [hex(commitment), hex(secondCommitment)] },
  expected: { emptyRoot: hex(emptyRoot), rootAfter: hex(tree.currentRoot), nextIndex: 2 },
});

const zero32 = new Uint8Array(32);
const action = {
  protocolVersion: 1,
  kind: ActionKind.Deposit,
  asset,
  actionNonce,
  anchorRoot: zero32,
  nullifiers: [zero32, zero32],
  outputs: [
    { cm: commitment, recipientEnvelope: new Uint8Array(181) },
    { cm: zero32, recipientEnvelope: new Uint8Array(181) },
  ],
  publicValue: 5_000_000n,
  relayerFee: 0n,
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
    publicValue: action.publicValue.toString(),
    actionNonce: hex(actionNonce),
    assetId: hex(assetId),
    output0Commitment: hex(commitment),
    depositSource: hex(accountPublicKey),
  },
  expected: {
    canonicalBytes: hex(actionBytes),
    actionField: hex(actionField),
    publicSignals: publicSignals.map(hex),
  },
});

const archiveRecord = {
  actionIndex: 0,
  ledgerSequence: 100,
  startingLeafIndex: 0,
  actionKind: 1,
  asset: { kind: 1, payload: fill(0x88, 32) },
  actionNonce: fill(0x11, 32),
  anchorRoot: fill(0x22, 32),
  treeRootAfter: fill(0x33, 32),
  nullifiers: [zero32, zero32],
  outputs: [
    { cm: zero32, recipientEnvelope: new Uint8Array(181) },
    { cm: zero32, recipientEnvelope: new Uint8Array(181) },
  ],
  publicValue: 1_000n,
  depositSource: { kind: 0, payload: fill(0xaa, 32) },
  publicRecipient: undefined,
  relayerFee: 0n,
  relayer: undefined,
};
write('archive-v1.json', {
  schemaVersion: 1,
  record: {
    protocolVersion: 1,
    actionIndex: archiveRecord.actionIndex,
    ledgerSequence: archiveRecord.ledgerSequence,
    startingLeafIndex: archiveRecord.startingLeafIndex,
    actionKind: archiveRecord.actionKind,
    assetKind: archiveRecord.asset.kind,
    assetPayloadFill: 0x88,
    actionNonceFill: 0x11,
    anchorRootFill: 0x22,
    treeRootAfterFill: 0x33,
    publicValue: Number(archiveRecord.publicValue),
    relayerFee: Number(archiveRecord.relayerFee),
    depositSourceKind: archiveRecord.depositSource.kind,
    depositSourcePayloadFill: 0xaa,
    priorRecordHashFill: 0x55,
  },
  expectedRecordHash: hex(computeRecordHash(archiveRecord, 1, fill(0x55, 32))),
});

sessionRoot.fill(0);
keys.ask.fill(0);
keys.nk.fill(0);
keys.baseOwnerCommitment.fill(0);
keys.hpkePrivateKey.fill(0);
console.log('✓ Generated fixed Private Balance conformance vectors.');
