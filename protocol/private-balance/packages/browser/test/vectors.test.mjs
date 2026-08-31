import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isCanonicalField,
  bytesToField,
  fieldId,
  computeContextHash,
  computeContextField,
  encodePrivateAddress,
  decodePrivateAddress,
  createOutputPackage,
  openRecipientEnvelope,
  encodeNotePlaintext,
  decodeNotePlaintext,
  computeCommitment,
  computeNullifier,
  createEmptyTree,
  appendCommitments,
  MerkleNodeStore,
  computeRecordHash,
  verifyProofLocally,
  ActionKind,
  computeActionField,
  computeAssetField,
  deriveHpkeAad,
  deriveHpkeInfo,
  computePublicSignals,
  deriveKeysFromSeed,
  derivePrivacySessionRoot,
  serializeCanonicalActionBytes,
} from '../dist/index.js';

const fromHex = value => Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
const toHex = value => Buffer.from(value).toString('hex');

test('fixed protocol conformance snapshots match every v2 primitive', async () => {
  const load = name => JSON.parse(readFileSync(
    join(import.meta.dirname, `../../../vectors/${name}-v1.json`),
    'utf8',
  ));
  const keyVector = load('keys');
  const keyInput = Object.fromEntries(Object.entries(keyVector.input).map(
    ([name, value]) => [name, fromHex(value)],
  ));
  const contextHash = computeContextHash(
    1,
    keyInput.networkId,
    keyInput.realmId,
    keyInput.poolId,
  );
  const contextField = computeContextField(contextHash);
  const sessionRoot = derivePrivacySessionRoot(
    keyInput.rawSeed,
    1,
    keyInput.networkId,
    keyInput.realmId,
    keyInput.poolId,
    keyInput.accountPublicKey,
  );
  const keys = await deriveKeysFromSeed(
    keyInput.rawSeed,
    1,
    keyInput.networkId,
    keyInput.realmId,
    keyInput.poolId,
    keyInput.accountPublicKey,
    contextField,
  );
  for (const [name, value] of Object.entries({
    contextHash,
    contextField,
    sessionRoot,
    ask: keys.ask,
    nk: keys.nk,
    baseOwnerCommitment: keys.baseOwnerCommitment,
    ownerCommitment: keys.ownerCommitment,
    hpkePrivateKey: keys.hpkePrivateKey,
    hpkePublicKey: keys.hpkePublicKey,
  })) assert.equal(toHex(value), keyVector.expected[name], name);

  const addressVector = load('addresses');
  const addressInput = {
    diversifier: fromHex(addressVector.input.diversifier),
    ownerCommitment: fromHex(addressVector.input.ownerCommitment),
    hpkePublicKey: fromHex(addressVector.input.hpkePublicKey),
  };
  assert.equal(encodePrivateAddress(addressInput, 'tks'), addressVector.expected.testnet);
  assert.equal(encodePrivateAddress(addressInput, 'sks'), addressVector.expected.mainnet);

  const noteVector = load('notes');
  const noteInput = noteVector.input;
  const asset = { kind: 1, payload: fromHex(noteInput.assetId) };
  const assetField = computeAssetField(asset);
  assert.equal(toHex(assetField), noteInput.assetField);
  const memo = new Uint8Array(32);
  memo.set(fromHex(noteInput.memo));
  const noteBytes = encodeNotePlaintext({
    protocolVersion: 1,
    flags: 0,
    value: BigInt(noteInput.value),
    diversifier: fromHex(noteInput.diversifier),
    ownerCommitment: fromHex(noteInput.ownerCommitment),
    rho: fromHex(noteInput.rho),
    memoLength: fromHex(noteInput.memo).length,
    memo,
    reserved: new Uint8Array(15),
  });
  assert.equal(toHex(noteBytes), noteVector.expected.plaintext);
  const cm = computeCommitment(
    contextField,
    assetField,
    keys.ownerCommitment,
    BigInt(noteInput.value),
    fromHex(noteInput.rho),
  );
  assert.equal(toHex(cm), noteVector.expected.commitment);
  assert.equal(toHex(computeNullifier(
    contextField,
    keys.nk,
    fromHex(noteInput.rho),
    BigInt(noteInput.leafIndex),
    cm,
  )), noteVector.expected.nullifier);

  const encryptionVector = load('encryption');
  assert.equal(
    toHex(deriveHpkeInfo(2, fromHex(encryptionVector.input.contextHash))),
    encryptionVector.expected.info,
  );
  assert.equal(toHex(deriveHpkeAad(
    fromHex(encryptionVector.input.contextHash),
    fromHex(encryptionVector.input.commitment),
    fromHex(encryptionVector.input.actionNonce),
    encryptionVector.input.outputIndex,
  )), encryptionVector.expected.aad);

  const treeVector = load('tree');
  const tree = await createEmptyTree();
  assert.equal(toHex(tree.currentRoot), treeVector.expected.emptyRoot);
  await appendCommitments(tree, treeVector.input.leaves.map(fromHex));
  assert.equal(toHex(tree.currentRoot), treeVector.expected.rootAfter);
  assert.equal(tree.nextIndex, treeVector.expected.nextIndex);

  const actionVector = load('actions');
  const zero = new Uint8Array(32);
  const action = {
    protocolVersion: 1,
    kind: ActionKind.Deposit,
    asset,
    actionNonce: fromHex(actionVector.input.actionNonce),
    anchorRoot: zero,
    nullifiers: [zero, zero],
    outputs: [
      { cm: fromHex(actionVector.input.output0Commitment), recipientEnvelope: new Uint8Array(181) },
      { cm: zero, recipientEnvelope: new Uint8Array(181) },
    ],
    publicValue: BigInt(actionVector.input.publicValue),
    relayerFee: 0n,
    depositSource: { kind: 0, payload: fromHex(actionVector.input.depositSource) },
  };
  assert.equal(toHex(serializeCanonicalActionBytes(
    action,
    keyInput.networkId,
    keyInput.realmId,
    keyInput.poolId,
  )), actionVector.expected.canonicalBytes);
  assert.equal(toHex(computeActionField(
    action,
    keyInput.networkId,
    keyInput.realmId,
    keyInput.poolId,
  )), actionVector.expected.actionField);
  assert.deepEqual((await computePublicSignals(
    action,
    contextField,
    keyInput.networkId,
    keyInput.realmId,
    keyInput.poolId,
  )).map(toHex), actionVector.expected.publicSignals);
});

test('archive: Rust and TypeScript record hashes match', () => {
  const vectorPath = join(import.meta.dirname, '../../../vectors/archive-v1.json');
  const vector = JSON.parse(readFileSync(vectorPath, 'utf8'));
  const fill = (value, length) => new Uint8Array(length).fill(value);
  const zero = (length) => new Uint8Array(length);
  const record = {
    actionIndex: vector.record.actionIndex,
    ledgerSequence: vector.record.ledgerSequence,
    startingLeafIndex: vector.record.startingLeafIndex,
    actionKind: vector.record.actionKind,
    asset: {
      kind: vector.record.assetKind,
      payload: fill(vector.record.assetPayloadFill, 32),
    },
    actionNonce: fill(vector.record.actionNonceFill, 32),
    anchorRoot: fill(vector.record.anchorRootFill, 32),
    treeRootAfter: fill(vector.record.treeRootAfterFill, 32),
    nullifiers: [zero(32), zero(32)],
    outputs: [
      { cm: zero(32), recipientEnvelope: zero(181) },
      { cm: zero(32), recipientEnvelope: zero(181) },
    ],
    publicValue: BigInt(vector.record.publicValue),
    depositSource: {
      kind: vector.record.depositSourceKind,
      payload: fill(vector.record.depositSourcePayloadFill, 32),
    },
    publicRecipient: undefined,
    relayerFee: BigInt(vector.record.relayerFee ?? 0),
    relayer: undefined,
  };
  const priorRecordHash = fill(vector.record.priorRecordHashFill, 32);
  const recordHash = computeRecordHash(
    record,
    vector.record.protocolVersion,
    priorRecordHash,
  );
  assert.equal(Buffer.from(recordHash).toString('hex'), vector.expectedRecordHash);
  assert.notDeepEqual(
    computeRecordHash({ ...record, actionIndex: 1 }, 1, priorRecordHash),
    recordHash,
  );
  assert.notDeepEqual(computeRecordHash(record, 2, priorRecordHash), recordHash);
  assert.notDeepEqual(computeRecordHash(record, 1, fill(86, 32)), recordHash);
});

test('field: canonical checks and fieldId', () => {
  const zero = new Uint8Array(32);
  assert.equal(isCanonicalField(zero), true);

  const maxModulus = new Uint8Array([
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
  ]);
  assert.equal(isCanonicalField(maxModulus), false);

  const fid = fieldId('TEST_LABEL', new Uint8Array([1, 2, 3, 4]));
  assert.equal(fid.length, 32);
  assert.equal(isCanonicalField(fid), true);
});

test('address: encode and decode roundtrip', async () => {
  const diversifier = Uint8Array.of(1, 2, 3, 4);
  const owner = new Uint8Array(32).fill(0x22);
  const hpkePk = new Uint8Array(32).fill(0x33);

  const addrObj = {
    diversifier,
    ownerCommitment: owner,
    hpkePublicKey: hpkePk,
  };

  const encoded = encodePrivateAddress(addrObj, 'tks');
  assert.equal(encoded.startsWith('tks1'), true);
  assert.equal(encoded.length, 119);

  const decoded = await decodePrivateAddress(encoded, 'tks');
  assert.deepEqual(decoded.diversifier, diversifier);
  assert.deepEqual(decoded.ownerCommitment, owner);
  assert.deepEqual(decoded.hpkePublicKey, hpkePk);
});

test('note: encode and decode plaintext', () => {
  const note = {
    protocolVersion: 1,
    flags: 0,
    value: 5000000n,
    diversifier: Uint8Array.of(4, 3, 2, 1),
    ownerCommitment: new Uint8Array([...new Uint8Array(31), 0x55]),
    rho: new Uint8Array(32).fill(0x11), // canonical Fr (< 0x30...)
    memoLength: 32,
    memo: new Uint8Array(32).fill(0x22),
    reserved: new Uint8Array(15),
  };

  const encoded = encodeNotePlaintext(note);
  assert.equal(encoded.length, 128);

  const decoded = decodeNotePlaintext(encoded);
  assert.equal(decoded.value, 5000000n);
  assert.deepEqual(decoded.rho, note.rho);
  assert.deepEqual(decoded.memo, note.memo);
});

test('tree: create empty tree and append leaves', async () => {
  const tree = await createEmptyTree();
  assert.equal(tree.nextIndex, 0);
  assert.equal(tree.frontier.length, 32);

  const leaf0 = new Uint8Array(32).fill(0x01);
  const leaf1 = new Uint8Array(32).fill(0x02);

  const rootAfter = await appendCommitments(tree, [leaf0, leaf1]);
  assert.equal(tree.nextIndex, 2);
  assert.equal(rootAfter.length, 32);
});

test('tree: public node store rebuilds exact local witness paths', async () => {
  const leaves = [
    new Uint8Array(32).fill(1),
    new Uint8Array(32).fill(2),
    new Uint8Array(32),
    new Uint8Array(32).fill(3),
  ];
  const tree = await createEmptyTree();
  await appendCommitments(tree, leaves);
  const store = await MerkleNodeStore.fromCommitments(leaves);
  assert.deepEqual(store.currentRoot, tree.currentRoot);
  assert.equal(store.nextIndex, leaves.length);

  const path = await store.getPath(1);
  assert.deepEqual(path.leaf, leaves[1]);
  assert.deepEqual(path.siblings[0], leaves[0]);
  assert.deepEqual(path.directionBits.slice(0, 3), [1, 0, 0]);
  assert.deepEqual(path.root, tree.currentRoot);
  await assert.rejects(() => store.getPath(4), /not present/i);
});

test('prover: verify proof vectors from proofs-v1.json locally', async () => {
  const vkPath = join(import.meta.dirname, '../../../circuits/build/verification_key.json');
  const vk = JSON.parse(readFileSync(vkPath, 'utf8'));

  const vectorsPath = join(import.meta.dirname, '../../../vectors/proofs-v1.json');
  const vectorFile = JSON.parse(readFileSync(vectorsPath, 'utf8'));

  for (const item of vectorFile.proofs) {
    const valid = await verifyProofLocally(vk, item.publicSignals, item.proof);
    assert.equal(valid, true, `Proof vector ${item.name} must verify locally`);
  }
});
