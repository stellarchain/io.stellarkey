#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Aes128Gcm, CipherSuite, HkdfSha256 } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import {
  ActionKind,
  appendCommitments,
  computeCommitment,
  computeAssetField,
  computeContextField,
  computeContextHash,
  computeGenesisRecordHash,
  computeRecordHash,
  createEmptyTree,
  deriveHpkeAad,
  deriveHpkeInfo,
  deriveKeysFromSeed,
  deriveDiversifiedAddressKeys,
  deriveX25519SharedSecret,
  encodeNotePlaintext,
  toViewingKey,
} from '@stellarkey/private-balance';

import {
  buildRecoveryGateEvidence,
  parseRecoveryGateArguments,
} from './recovery-gate-lib.mjs';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    return resolved.url.endsWith('.ts')
      ? { ...resolved, format: 'module-typescript' }
      : resolved;
  },
});
const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm(),
});

function bytes(value, length = 32) {
  return new Uint8Array(length).fill(value);
}

function u64Field(value) {
  const result = new Uint8Array(32);
  new DataView(result.buffer).setBigUint64(24, BigInt(value), false);
  return result;
}

function hex(value) {
  return Buffer.from(value).toString('hex');
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function deterministicEkm(actionIndex) {
  return createHash('sha256')
    .update('StellarKey recovery gate HPKE EKM v1\0', 'utf8')
    .update(String(actionIndex), 'utf8')
    .digest();
}

async function deterministicOutputPackage({
  recipientPublicKey,
  recipientPublicKeyBytes,
  recipientPrivateKey,
  diversifier,
  noteBytes,
  contextHash,
  commitment,
  actionNonce,
  actionIndex,
}) {
  const sender = await suite.createSenderContext({
    recipientPublicKey,
    info: deriveHpkeInfo(2, contextHash),
    ekm: deterministicEkm(actionIndex),
  });
  const ciphertext = new Uint8Array(await sender.seal(
    noteBytes,
    deriveHpkeAad(contextHash, commitment, actionNonce, 0),
  ));
  const enc = new Uint8Array(sender.enc);
  const sharedSecret = await deriveX25519SharedSecret(recipientPrivateKey, enc);
  const viewTag = createHash('sha256')
    .update('StellarKey private view tag v2', 'utf8')
    .update(sharedSecret)
    .update(contextHash)
    .update(enc)
    .update(recipientPublicKeyBytes)
    .digest()[0];
  const envelope = new Uint8Array(181);
  envelope[0] = viewTag;
  envelope.set(diversifier, 1);
  envelope.set(enc, 5);
  envelope.set(ciphertext, 37);
  return { cm: commitment, recipientEnvelope: envelope };
}

function ownedActionIndexes(actionCount) {
  const ownedCount = Math.min(10, actionCount);
  return new Set(Array.from(
    { length: ownedCount },
    (_, index) => Math.floor(index * actionCount / ownedCount),
  ));
}

function assertRecoveredResult({ result, finalRecordHash, tree, expectedBalance, ownedIndexes }) {
  if (!equalBytes(result.lastRecordHash, finalRecordHash)) {
    throw new Error('Recovered transcript head mismatch.');
  }
  if (!equalBytes(result.tree.currentRoot, tree.currentRoot)) {
    throw new Error('Recovered tree root mismatch.');
  }
  if (result.notes.some(note => note.status !== 'unspent')) {
    throw new Error('Fresh recovery unexpectedly marked an owned note spent.');
  }
  const recoveredBalance = result.notes.reduce(
    (total, note) => total + BigInt(note.value),
    0n,
  );
  if (recoveredBalance !== expectedBalance) {
    throw new Error('Recovered balance mismatch.');
  }
  const recoveredIndexes = result.activities.map(activity => activity.actionIndex);
  const expectedIndexes = [...ownedIndexes];
  if (
    recoveredIndexes.length !== expectedIndexes.length ||
    recoveredIndexes.some((value, index) => value !== expectedIndexes[index]) ||
    result.activities.some(activity => activity.actionKind !== 'deposit' || activity.direction !== 'inflow')
  ) {
    throw new Error('Recovered owned activity mismatch.');
  }
  return recoveredBalance;
}

export async function runRecoveryGate(argv = process.argv.slice(2)) {
  const options = parseRecoveryGateArguments(argv);
  const startedAt = performance.now();
  let peakRssBytes = process.memoryUsage().rss;
  const sampleMemory = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  };

  const networkId = bytes(1);
  const realmId = bytes(2);
  const poolId = bytes(3);
  const assetId = bytes(4);
  const asset = { kind: 1, payload: assetId };
  const assetField = computeAssetField(asset);
  const accountPublicKey = bytes(5);
  const deploymentBindingHash = bytes(6);
  const externalAccountPublicKey = bytes(9);
  const contextHash = computeContextHash(1, networkId, realmId, poolId);
  const contextField = computeContextField(contextHash);
  const walletSeed = bytes(7);
  const externalSeed = bytes(8);
  const walletKeys = await deriveKeysFromSeed(
    walletSeed,
    1,
    networkId,
    realmId,
    poolId,
    accountPublicKey,
    contextField,
  );
  const externalKeys = await deriveKeysFromSeed(
    externalSeed,
    1,
    networkId,
    realmId,
    poolId,
    externalAccountPublicKey,
    contextField,
  );
  walletSeed.fill(0);
  externalSeed.fill(0);
  const diversifier = new Uint8Array(4);
  const walletAddressKeys = await deriveDiversifiedAddressKeys(
    walletKeys.baseOwnerCommitment,
    walletKeys.hpkePrivateKey,
    diversifier,
  );
  const externalAddressKeys = await deriveDiversifiedAddressKeys(
    externalKeys.baseOwnerCommitment,
    externalKeys.hpkePrivateKey,
    diversifier,
  );
  const walletHpkeKey = await suite.kem.deserializePublicKey(walletKeys.hpkePublicKey);
  const externalHpkeKey = await suite.kem.deserializePublicKey(externalKeys.hpkePublicKey);
  const ownedIndexes = ownedActionIndexes(options.actionCount);
  const tree = await createEmptyTree();
  const records = [];
  let priorRecordHash = computeGenesisRecordHash(contextHash, deploymentBindingHash);
  let expectedBalance = 0n;

  process.stderr.write(`Generating ${options.actionCount} deterministic canonical actions...\n`);
  for (let actionIndex = 0; actionIndex < options.actionCount; actionIndex += 1) {
    const owned = ownedIndexes.has(actionIndex);
    const value = BigInt(actionIndex % 97 + 1);
    const rho = u64Field(actionIndex + 1);
    const ownerCommitment = owned
      ? walletKeys.ownerCommitment
      : externalKeys.ownerCommitment;
    const actionNonce = u64Field(options.actionCount + actionIndex + 1);
    const note = {
      protocolVersion: 1,
      flags: 0,
      value,
      diversifier,
      ownerCommitment,
      rho,
      memoLength: 0,
      memo: new Uint8Array(32),
      reserved: new Uint8Array(15),
    };
    const commitment = computeCommitment(contextField, assetField, ownerCommitment, value, rho);
    const output = await deterministicOutputPackage({
      recipientPublicKey: owned ? walletHpkeKey : externalHpkeKey,
      recipientPublicKeyBytes: owned ? walletKeys.hpkePublicKey : externalKeys.hpkePublicKey,
      recipientPrivateKey: owned
        ? walletAddressKeys.hpkePrivateKey
        : externalAddressKeys.hpkePrivateKey,
      diversifier,
      noteBytes: encodeNotePlaintext(note),
      contextHash,
      commitment,
      actionNonce,
      actionIndex,
    });
    const outputs = [
      output,
      { cm: new Uint8Array(32), recipientEnvelope: new Uint8Array(181) },
    ];
    const treeRootAfter = await appendCommitments(tree, outputs.map(item => item.cm));
    const depositSource = {
      kind: 0,
      payload: owned ? accountPublicKey : externalAccountPublicKey,
    };
    const action = {
      protocolVersion: 1,
      kind: ActionKind.Deposit,
      asset,
      actionNonce,
      anchorRoot: new Uint8Array(32),
      nullifiers: [new Uint8Array(32), new Uint8Array(32)],
      outputs,
      publicValue: value,
      relayerFee: 0n,
      relayer: undefined,
      depositSource,
    };
    const record = {
      actionIndex,
      ledgerSequence: actionIndex + 1,
      startingLeafIndex: actionIndex * 2,
      actionKind: ActionKind.Deposit,
      asset,
      actionNonce,
      anchorRoot: action.anchorRoot,
      treeRootAfter,
      nullifiers: action.nullifiers,
      outputs,
      publicValue: value,
      relayerFee: 0n,
      relayer: undefined,
      depositSource,
    };
    records.push(record);
    priorRecordHash = computeRecordHash(record, 1, priorRecordHash);
    if (owned) expectedBalance += value;
    if ((actionIndex + 1) % 1_000 === 0) {
      sampleMemory();
      process.stderr.write(`Generated ${actionIndex + 1}/${options.actionCount}\n`);
    }
  }

  sampleMemory();
  process.stderr.write('Scanning immutable records with events, mirror, and indexer disabled...\n');
  const { scanArchiveRecords } = await import(
    '../../../../src/features/private-balance/runtime/scanner.ts'
  );
  const result = await scanArchiveRecords({
    records,
    viewingKey: toViewingKey(walletKeys),
    context: {
      protocolVersion: 1,
      networkId,
      realmId,
      poolId,
      contextHash,
      contextField,
      accountAddress: { kind: 0, payload: accountPublicKey },
    },
    expectedPriorRecordHash: computeGenesisRecordHash(contextHash, deploymentBindingHash),
  });
  sampleMemory();
  const recoveredBalance = assertRecoveredResult({
    result,
    finalRecordHash: priorRecordHash,
    tree,
    expectedBalance,
    ownedIndexes,
  });
  const elapsedMs = Math.ceil(performance.now() - startedAt);
  const evidence = buildRecoveryGateEvidence({
    actionCount: options.actionCount,
    recordBatchSize: 200,
    ownedActionCount: ownedIndexes.size,
    recoveredActivityCount: result.activities.length,
    recoveredBalance,
    expectedBalance,
    finalRecordHash: hex(result.lastRecordHash),
    finalTreeRoot: hex(result.tree.currentRoot),
    elapsedMs,
    peakRssBytes,
    completedAt: new Date().toISOString(),
  });
  const outputPath = path.resolve(PROJECT_ROOT, options.outputPath);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  walletKeys.ask.fill(0);
  walletKeys.nk.fill(0);
  walletKeys.hpkePrivateKey.fill(0);
  externalKeys.ask.fill(0);
  externalKeys.nk.fill(0);
  externalKeys.hpkePrivateKey.fill(0);
  return evidence;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  const evidence = await runRecoveryGate();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
