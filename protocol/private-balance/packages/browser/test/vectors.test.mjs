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
  derivePrivateAddressDeploymentTag,
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
  deriveOutgoingAad,
  encodeOutgoingPlaintext,
  decodeOutgoingPlaintext,
  sealOutgoingEnvelope,
  openOutgoingEnvelope,
  OUTGOING_ENVELOPE_BYTES,
  OUTGOING_PLAINTEXT_BYTES,
  serializeCanonicalActionBytes,
} from '../dist/index.js';

const fromHex = value => Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
const toHex = value => Buffer.from(value).toString('hex');

test('fixed protocol V1 conformance snapshots match every primitive', async () => {
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
    outgoingViewingKey: keys.outgoingViewingKey,
  })) assert.equal(toHex(value), keyVector.expected[name], name);

  const addressVector = load('addresses');
  const addressDeploymentBindingHash = fromHex(addressVector.input.deploymentBindingHash);
  const addressInput = {
    deploymentTag: derivePrivateAddressDeploymentTag(addressDeploymentBindingHash),
    diversifier: fromHex(addressVector.input.diversifier),
    ownerCommitment: fromHex(addressVector.input.ownerCommitment),
    hpkePublicKey: fromHex(addressVector.input.hpkePublicKey),
  };
  assert.equal(encodePrivateAddress(addressInput, 'tskpay_'), addressVector.expected.testnet);
  assert.equal(encodePrivateAddress(addressInput, 'skpay_'), addressVector.expected.mainnet);

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
    assetIndex: noteInput.assetIndex,
    reserved: new Uint8Array(11),
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
  const outgoingPlaintext = encodeOutgoingPlaintext({
    protocolVersion: 1,
    flags: 0,
    value: BigInt(noteInput.value),
    diversifier: fromHex(noteInput.diversifier),
    ownerCommitment: keys.ownerCommitment,
    recipientHpkePublicKey: keys.hpkePublicKey,
    memoLength: fromHex(noteInput.memo).length,
    memo,
    assetIndex: noteInput.assetIndex,
    reserved: new Uint8Array(11),
  });
  const outgoingAad = deriveOutgoingAad(
    fromHex(encryptionVector.input.deploymentBindingHash),
    fromHex(encryptionVector.input.contextHash),
    fromHex(encryptionVector.input.assetField),
    fromHex(encryptionVector.input.commitment),
    fromHex(encryptionVector.input.actionNonce),
    encryptionVector.input.outputIndex,
  );
  const outgoingEnvelope = await sealOutgoingEnvelope(
    keys.outgoingViewingKey,
    fromHex(encryptionVector.input.ephemeralPublicKey),
    outgoingPlaintext,
    outgoingAad,
    fromHex(encryptionVector.input.outgoingNonce),
  );
  assert.equal(toHex(outgoingPlaintext), encryptionVector.expected.outgoingPlaintext);
  assert.equal(toHex(outgoingAad), encryptionVector.expected.outgoingAad);
  assert.equal(toHex(outgoingEnvelope), encryptionVector.expected.outgoingEnvelope);

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
    assetIndex: actionVector.input.assetIndex,
    asset,
    actionNonce: fromHex(actionVector.input.actionNonce),
    anchorRoot: zero,
    nullifiers: [fromHex(actionVector.input.nullifier0), fromHex(actionVector.input.nullifier1)],
    outputs: [
      {
        cm: fromHex(actionVector.input.output0Commitment),
        recipientEnvelope: fromHex(actionVector.input.output0RecipientEnvelope),
        outgoingEnvelope: fromHex(actionVector.input.output0OutgoingEnvelope),
      },
      {
        cm: fromHex(actionVector.input.output1Commitment),
        recipientEnvelope: fromHex(actionVector.input.output1RecipientEnvelope),
        outgoingEnvelope: fromHex(actionVector.input.output1OutgoingEnvelope),
      },
      {
        cm: fromHex(actionVector.input.output2Commitment),
        recipientEnvelope: fromHex(actionVector.input.output2RecipientEnvelope),
        outgoingEnvelope: fromHex(actionVector.input.output2OutgoingEnvelope),
      },
    ],
    publicValue: BigInt(actionVector.input.publicValue),
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

test('outgoing viewing key recovers fixed real and dummy envelopes and binds all context', async () => {
  const fill = (value, length = 32) => new Uint8Array(length).fill(value);
  const keys = await deriveKeysFromSeed(
    fill(0x11),
    1,
    fill(0x22),
    fill(0x33),
    fill(0x44),
    fill(0x66),
    computeContextField(computeContextHash(1, fill(0x22), fill(0x33), fill(0x44))),
  );
  assert.notDeepEqual(keys.outgoingViewingKey, keys.ask);
  assert.notDeepEqual(keys.outgoingViewingKey, keys.nk);
  assert.notDeepEqual(keys.outgoingViewingKey, keys.hpkePrivateKey);

  const memo = new Uint8Array(32);
  memo.set(new TextEncoder().encode('rent'));
  const real = {
    protocolVersion: 1,
    flags: 0,
    value: 25n,
    diversifier: Uint8Array.of(1, 2, 3, 4),
    ownerCommitment: Uint8Array.from([...new Uint8Array(31), 5]),
    recipientHpkePublicKey: fill(6),
    memoLength: 4,
    memo,
    assetIndex: 23,
    reserved: new Uint8Array(11),
  };
  const dummy = {
    ...real,
    flags: 1,
    value: 0n,
    memoLength: 0,
    memo: new Uint8Array(32),
  };
  const realBytes = encodeOutgoingPlaintext(real);
  const dummyBytes = encodeOutgoingPlaintext(dummy);
  assert.equal(realBytes.length, OUTGOING_PLAINTEXT_BYTES);
  assert.deepEqual(decodeOutgoingPlaintext(realBytes), real);
  assert.deepEqual(decodeOutgoingPlaintext(dummyBytes), dummy);

  const binding = fill(7);
  const context = fill(8);
  const asset = fill(9);
  const commitment = fill(10);
  const actionNonce = fill(11);
  const ephemeralPublicKey = fill(12);
  const aad = deriveOutgoingAad(binding, context, asset, commitment, actionNonce, 0);
  const envelope = await sealOutgoingEnvelope(
    keys.outgoingViewingKey,
    ephemeralPublicKey,
    realBytes,
    aad,
    fill(13, 12),
  );
  assert.equal(envelope.length, OUTGOING_ENVELOPE_BYTES);
  assert.deepEqual(
    decodeOutgoingPlaintext(await openOutgoingEnvelope(
      keys.outgoingViewingKey,
      ephemeralPublicKey,
      envelope,
      aad,
    )),
    real,
  );

  const mutations = [binding, context, asset, commitment, actionNonce].map((value, index) => {
    const changed = value.slice();
    changed[index] ^= 1;
    return [
      index === 0 ? changed : binding,
      index === 1 ? changed : context,
      index === 2 ? changed : asset,
      index === 3 ? changed : commitment,
      index === 4 ? changed : actionNonce,
    ];
  });
  for (const mutation of mutations) {
    const changedAad = deriveOutgoingAad(...mutation, 0);
    assert.equal(await openOutgoingEnvelope(
      keys.outgoingViewingKey,
      ephemeralPublicKey,
      envelope,
      changedAad,
    ), null);
  }
  const changedLaneAad = deriveOutgoingAad(binding, context, asset, commitment, actionNonce, 1);
  assert.equal(await openOutgoingEnvelope(
    keys.outgoingViewingKey,
    ephemeralPublicKey,
    envelope,
    changedLaneAad,
  ), null);
  const changedCiphertext = envelope.slice();
  changedCiphertext[changedCiphertext.length - 1] ^= 1;
  assert.equal(await openOutgoingEnvelope(
    keys.outgoingViewingKey,
    ephemeralPublicKey,
    changedCiphertext,
    aad,
  ), null);
  assert.equal(await openOutgoingEnvelope(
    fill(99),
    ephemeralPublicKey,
    envelope,
    aad,
  ), null);
  assert.equal(await openOutgoingEnvelope(
    keys.outgoingViewingKey,
    fill(98),
    envelope,
    aad,
  ), null);

  const dummyEnvelope = await sealOutgoingEnvelope(
    keys.outgoingViewingKey,
    ephemeralPublicKey,
    dummyBytes,
    aad,
    fill(14, 12),
  );
  assert.deepEqual(
    decodeOutgoingPlaintext(await openOutgoingEnvelope(
      keys.outgoingViewingKey,
      ephemeralPublicKey,
      dummyEnvelope,
      aad,
    )),
    dummy,
  );
  assert.throws(() => encodeOutgoingPlaintext({ ...real, value: 0n }), /value/i);
  assert.throws(() => encodeOutgoingPlaintext({ ...dummy, value: 1n }), /value/i);

  const recipientMemo = new Uint8Array(32);
  const recipientRho = Uint8Array.from([...new Uint8Array(31), 15]);
  const recipientContextField = computeContextField(context);
  const recipientNote = encodeNotePlaintext({
    protocolVersion: 1,
    flags: 0,
    value: 25n,
    diversifier: new Uint8Array(4),
    ownerCommitment: keys.ownerCommitment,
    rho: recipientRho,
    memoLength: 0,
    memo: recipientMemo,
    assetIndex: 23,
    reserved: new Uint8Array(11),
  });
  const recipientCommitment = computeCommitment(
    recipientContextField,
    asset,
    keys.ownerCommitment,
    25n,
    recipientRho,
  );
  const recipientPackage = await createOutputPackage(
    keys.hpkePublicKey,
    new Uint8Array(4),
    recipientNote,
    context,
    recipientCommitment,
    actionNonce,
    0,
  );
  assert.notEqual(await openRecipientEnvelope(
    keys.hpkePrivateKey,
    recipientPackage.recipientEnvelope,
    context,
    recipientContextField,
    asset,
    recipientCommitment,
    actionNonce,
    0,
    keys.baseOwnerCommitment,
  ), null);
  assert.equal(await openRecipientEnvelope(
    keys.outgoingViewingKey,
    recipientPackage.recipientEnvelope,
    context,
    recipientContextField,
    asset,
    recipientCommitment,
    actionNonce,
    0,
    keys.baseOwnerCommitment,
  ), null);
});

test('archive: Rust and TypeScript record hashes match', () => {
  const vectorPath = join(import.meta.dirname, '../../../vectors/archive-v1.json');
  const vector = JSON.parse(readFileSync(vectorPath, 'utf8'));
  const fill = (value, length) => new Uint8Array(length).fill(value);
  const record = {
    actionIndex: vector.record.actionIndex,
    ledgerSequence: vector.record.ledgerSequence,
    startingLeafIndex: vector.record.startingLeafIndex,
    actionKind: vector.record.actionKind,
    assetIndex: vector.record.assetIndex,
    asset: {
      kind: vector.record.assetKind,
      payload: fill(vector.record.assetPayloadFill, 32),
    },
    actionNonce: fill(vector.record.actionNonceFill, 32),
    anchorRoot: fill(vector.record.anchorRootFill, 32),
    treeRootAfter: fill(vector.record.treeRootAfterFill, 32),
    nullifiers: [fill(vector.record.nullifier0Fill, 32), fill(vector.record.nullifier1Fill, 32)],
    outputs: [
      {
        cm: fill(vector.record.output0CommitmentFill, 32),
        recipientEnvelope: fill(vector.record.output0RecipientEnvelopeFill, 181),
        outgoingEnvelope: fill(vector.record.output0OutgoingEnvelopeFill, 157),
      },
      {
        cm: fill(vector.record.output1CommitmentFill, 32),
        recipientEnvelope: fill(vector.record.output1RecipientEnvelopeFill, 181),
        outgoingEnvelope: fill(vector.record.output1OutgoingEnvelopeFill, 157),
      },
      {
        cm: fill(vector.record.output2CommitmentFill, 32),
        recipientEnvelope: fill(vector.record.output2RecipientEnvelopeFill, 181),
        outgoingEnvelope: fill(vector.record.output2OutgoingEnvelopeFill, 157),
      },
    ],
    publicValue: BigInt(vector.record.publicValue),
    depositSource: {
      kind: vector.record.depositSourceKind,
      payload: fill(vector.record.depositSourcePayloadFill, 32),
    },
    publicRecipient: undefined,
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
    deploymentTag: derivePrivateAddressDeploymentTag(new Uint8Array(32).fill(0x44)),
    diversifier,
    ownerCommitment: owner,
    hpkePublicKey: hpkePk,
  };

  const encoded = encodePrivateAddress(addrObj, 'tskpay_');
  assert.equal(encoded.startsWith('tskpay_'), true);
  assert.equal(encoded.length, 128);

  const decoded = await decodePrivateAddress(encoded, 'tskpay_');
  assert.deepEqual(decoded.deploymentTag, addrObj.deploymentTag);
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
    assetIndex: 7,
    reserved: new Uint8Array(11),
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
  assert.equal(tree.frontier.length, 34);

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
  assert.deepEqual(path.siblings[0], [leaves[0], leaves[2]]);
  assert.deepEqual(path.positions.slice(0, 3), [1, 0, 0]);
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
